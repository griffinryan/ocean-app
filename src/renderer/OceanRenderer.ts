/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { WaveSystemManager, WaveSystemConfig } from './WaveSystemManager';
import { TextureManager, CAConfig } from './TextureManager';
import { Mat4 } from '../utils/math';

export interface RenderConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  waveConfig?: Partial<WaveSystemConfig>;
  caConfig?: Partial<CAConfig>;
}

export class OceanRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private oceanProgram: ShaderProgram | null = null;
  private geometry: GeometryData;
  private bufferManager: BufferManager;

  // Wave system managers
  private waveSystemManager: WaveSystemManager;
  private textureManager: TextureManager;

  // Matrices for transformation
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Animation state
  private startTime: number;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  // Resize observer for responsive canvas
  private resizeObserver!: ResizeObserver;

  // Performance tracking
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;
  private fps: number = 0;

  // Debug mode
  private debugMode: number = 0;

  constructor(config: RenderConfig) {
    this.canvas = config.canvas;
    this.startTime = performance.now();
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();

    // Initialize WebGL2 context
    const gl = this.canvas.getContext('webgl2', {
      antialias: config.antialias ?? true,
      alpha: config.alpha ?? false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.gl = gl;
    this.shaderManager = new ShaderManager(gl);

    // Initialize wave system and texture managers
    this.waveSystemManager = new WaveSystemManager(config.waveConfig);

    // Initialize texture manager with safe fallback
    try {
      this.textureManager = new TextureManager(gl, this.shaderManager, config.caConfig);
      if (!this.textureManager.isCASupported()) {
        console.warn('Cellular automaton not supported, disabling CA waves');
        this.waveSystemManager.setPatternWeight('cellularAutomaton', 0);
      }
    } catch (error) {
      console.error('Failed to initialize TextureManager:', error);
      // Create a minimal texture manager without CA support
      this.textureManager = new TextureManager(gl, this.shaderManager, { enabled: false });
      this.waveSystemManager.setPatternWeight('cellularAutomaton', 0);
    }

    // Create full-screen quad geometry for screen-space rendering
    this.geometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.geometry);

    // Set up WebGL state
    this.setupWebGL();

    // Set up responsive resizing
    this.setupResizing();

    // Set up camera for top-down view
    this.setupCamera();
  }

  /**
   * Initialize WebGL state
   */
  private setupWebGL(): void {
    const gl = this.gl;

    // Enable depth testing
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Enable blending for transparency effects
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Set clear color (black for contrast with ocean)
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);

    // Enable face culling for performance
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  /**
   * Set up responsive canvas resizing
   */
  private setupResizing(): void {
    // Initial resize
    this.resize();

    // Set up ResizeObserver for efficient resize handling
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this.canvas) {
          this.resize();
        }
      }
    });

    this.resizeObserver.observe(this.canvas);
  }

  /**
   * Handle canvas resize with device pixel ratio consideration
   */
  private resize(): void {
    const displayWidth = this.canvas.clientWidth;
    const displayHeight = this.canvas.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    const canvasWidth = Math.round(displayWidth * devicePixelRatio);
    const canvasHeight = Math.round(displayHeight * devicePixelRatio);

    // Update canvas resolution
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;

      // Update WebGL viewport
      this.gl.viewport(0, 0, canvasWidth, canvasHeight);

      // Update projection matrix
      this.updateProjectionMatrix();
    }
  }

  /**
   * Set up camera for angular top-down ocean view
   * Note: For full-screen quad rendering, we don't need complex camera setup
   */
  private setupCamera(): void {
    // Simple identity matrices - no transformations needed for screen-space rendering
    this.viewMatrix.identity();
    this.projectionMatrix.identity();
  }

  /**
   * Update projection matrix based on canvas aspect ratio
   * Note: For full-screen quad, this is mainly for aspect ratio uniform
   */
  private updateProjectionMatrix(): void {
    // Keep simple identity matrix for full-screen quad
    this.projectionMatrix.identity();
  }

  /**
   * Initialize ocean shader program
   */
  async initializeShaders(vertexSource: string, fragmentSource: string): Promise<void> {
    // Define uniforms and attributes for ocean shader
    const uniforms = [
      'u_time',
      'u_aspectRatio',
      'u_resolution',
      'u_debugMode',
      // Wave pattern controls
      'u_gerstnerWeight',
      'u_phillipsWeight',
      'u_caWeight',
      'u_windSpeed',
      'u_windDirection',
      'u_gerstnerSteepness',
      'u_waveQuality',
      'u_caTexture'
    ];

    const attributes = [
      'a_position',
      'a_texcoord'
    ];

    // Create shader program
    this.oceanProgram = this.shaderManager.createProgram(
      'ocean',
      vertexSource,
      fragmentSource,
      uniforms,
      attributes
    );

    // Set up vertex attributes
    const positionLocation = this.oceanProgram.attributeLocations.get('a_position')!;
    const texcoordLocation = this.oceanProgram.attributeLocations.get('a_texcoord')!;

    this.bufferManager.setupAttributes(positionLocation, texcoordLocation);
  }

  /**
   * Render one frame
   */
  private render(): void {
    if (!this.oceanProgram) return;

    const gl = this.gl;
    const currentTime = performance.now();
    const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds

    // Update wave system dynamics
    this.waveSystemManager.updateDynamicParameters(elapsedTime);

    // Update cellular automaton
    this.textureManager.update(currentTime);

    // Clear the frame
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Use ocean shader
    const program = this.shaderManager.useProgram('ocean');

    // Set basic uniforms
    this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);
    const aspect = this.canvas.width / this.canvas.height;
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
    this.shaderManager.setUniform2f(program, 'u_resolution', this.canvas.width, this.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_debugMode', this.debugMode);

    // Set wave system uniforms
    const waveConfig = this.waveSystemManager.getConfig();
    this.shaderManager.setUniform1f(program, 'u_gerstnerWeight', waveConfig.gerstnerWeight);
    this.shaderManager.setUniform1f(program, 'u_phillipsWeight', waveConfig.phillipsWeight);
    this.shaderManager.setUniform1f(program, 'u_caWeight', waveConfig.caWeight);
    this.shaderManager.setUniform1f(program, 'u_windSpeed', waveConfig.windSpeed);
    this.shaderManager.setUniform1f(program, 'u_windDirection', waveConfig.windDirection);
    this.shaderManager.setUniform1f(program, 'u_gerstnerSteepness', waveConfig.gerstnerSteepness);
    this.shaderManager.setUniform1f(program, 'u_waveQuality', waveConfig.waveQuality);

    // Bind cellular automaton texture if available
    const caTexture = this.textureManager.getCurrentCATexture();
    if (caTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, caTexture);
      this.shaderManager.setUniform1f(program, 'u_caTexture', 0);
    } else {
      // Bind a 1x1 white texture as fallback to prevent shader errors
      const fallbackTexture = this.createFallbackTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fallbackTexture);
      this.shaderManager.setUniform1f(program, 'u_caTexture', 0);
    }

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Update FPS counter
    this.updateFPS(currentTime);
  }

  /**
   * Update FPS counter
   */
  private updateFPS(currentTime: number): void {
    this.frameCount++;

    if (currentTime - this.lastFpsUpdate >= 1000) { // Update every second
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = currentTime;

      // Update FPS display if element exists
      const fpsElement = document.getElementById('fps');
      if (fpsElement) {
        fpsElement.textContent = `FPS: ${this.fps}`;
      }
    }
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startTime = performance.now();
    this.lastFpsUpdate = this.startTime;

    const renderLoop = () => {
      if (!this.isRunning) return;

      this.render();
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.fps;
  }

  /**
   * Set debug mode
   */
  setDebugMode(mode: number): void {
    this.debugMode = mode;
  }

  /**
   * Get current debug mode
   */
  getDebugMode(): number {
    return this.debugMode;
  }

  /**
   * Get wave system manager for external control
   */
  getWaveSystemManager(): WaveSystemManager {
    return this.waveSystemManager;
  }

  /**
   * Get texture manager for external control
   */
  getTextureManager(): TextureManager {
    return this.textureManager;
  }

  /**
   * Set wave pattern weight
   */
  setWavePatternWeight(patternName: string, weight: number): void {
    this.waveSystemManager.setPatternWeight(patternName, weight);
  }

  /**
   * Apply wave preset
   */
  applyWavePreset(presetName: string): void {
    this.waveSystemManager.applyPreset(presetName);
  }

  /**
   * Set wave quality (0=low, 1=medium, 2=high)
   */
  setWaveQuality(quality: number): void {
    this.waveSystemManager.setQuality(quality);
  }

  /**
   * Set wind parameters for Phillips spectrum
   */
  setWindParameters(speed: number, direction: number): void {
    this.waveSystemManager.setWindParameters(speed, direction);
  }

  /**
   * Set Gerstner wave steepness
   */
  setGerstnerSteepness(steepness: number): void {
    this.waveSystemManager.setGerstnerSteepness(steepness);
  }

  /**
   * Reset cellular automaton simulation
   */
  resetCellularAutomaton(): void {
    if (this.textureManager.isCASupported()) {
      this.textureManager.reset();
    } else {
      console.warn('Cellular automaton not supported, cannot reset');
    }
  }

  // Fallback texture for when CA is not available
  private fallbackTexture: WebGLTexture | null = null;

  /**
   * Create a simple fallback texture when CA is not available
   */
  private createFallbackTexture(): WebGLTexture {
    if (this.fallbackTexture) {
      return this.fallbackTexture;
    }

    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create fallback texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Create a 1x1 pixel with neutral value (0.5 in middle)
    const data = new Uint8Array([127, 127, 127, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    this.fallbackTexture = texture;
    return texture;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.bufferManager.dispose();
    this.textureManager.dispose();
    if (this.fallbackTexture) {
      this.gl.deleteTexture(this.fallbackTexture);
    }
    this.shaderManager.dispose();
  }
}
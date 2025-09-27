/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4, Vec3 } from '../utils/math';
import { WavePatternManager, WavePatternType } from './WavePatternManager';

export interface RenderConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
}

export class OceanRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private oceanProgram: ShaderProgram | null = null;
  private geometry: GeometryData;
  private bufferManager: BufferManager;
  private wavePatternManager: WavePatternManager;

  // Matrices for transformation
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Animation state
  private startTime: number;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  // Resize observer for responsive canvas
  private resizeObserver: ResizeObserver | null = null;

  // Performance tracking
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;
  private fps: number = 0;

  // Debug mode
  private debugMode: number = 0;

  // Environmental settings for natural rendering
  private sunDirection: Vec3 = new Vec3(0.3, 0.8, 0.5).normalize();
  private sunColor: Vec3 = new Vec3(1.0, 0.95, 0.8);
  private skyColor: Vec3 = new Vec3(0.4, 0.7, 1.0);
  private horizonColor: Vec3 = new Vec3(0.8, 0.9, 1.0);
  private sunIntensity: number = 1.0;

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

    // Initialize wave pattern manager
    this.wavePatternManager = new WavePatternManager();

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

      // Wave pattern control
      'u_wavePatternType',
      'u_waveScale',
      'u_foamThreshold',
      'u_transitionFactor',

      // Primary Gerstner waves
      'u_primaryAmplitudes[0]',
      'u_primaryWavelengths[0]',
      'u_primarySpeeds[0]',
      'u_primaryDirections[0]',
      'u_primarySteepness[0]',
      'u_primaryPhases[0]',
      'u_numPrimaryWaves',

      // Swell systems
      'u_swellAmplitudes[0]',
      'u_swellWavelengths[0]',
      'u_swellSpeeds[0]',
      'u_swellDirections[0]',
      'u_swellSteepness[0]',
      'u_swellPhases[0]',
      'u_numSwellWaves',

      // Choppy wave layer
      'u_choppyWindDirection',
      'u_choppyWindSpeed',
      'u_choppyFrequency',
      'u_choppyAmplitude',
      'u_choppyModulation',

      // Performance optimization
      'u_lodBias',
      'u_cameraPosition',

      // Environmental uniforms for natural rendering
      'u_sunDirection',
      'u_sunColor',
      'u_skyColor',
      'u_horizonColor',
      'u_sunIntensity'
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

    // Update wave pattern manager
    this.wavePatternManager.update(elapsedTime);

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

    // Set wave pattern uniforms
    this.setWaveUniforms(program, elapsedTime);

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Update FPS counter
    this.updateFPS(currentTime);
  }

  /**
   * Set all wave-related uniforms
   */
  private setWaveUniforms(program: ShaderProgram, _time: number): void {
    const waveData = this.wavePatternManager.getCurrentWaveData();
    const currentPattern = this.wavePatternManager.getCurrentPatternType();

    // Basic wave control
    this.shaderManager.setUniform1i(program, 'u_wavePatternType', currentPattern);
    this.shaderManager.setUniform1f(program, 'u_waveScale', waveData.waveScale);
    this.shaderManager.setUniform1f(program, 'u_foamThreshold', waveData.foamThreshold);
    this.shaderManager.setUniform1f(program, 'u_transitionFactor', waveData.transitionFactor);

    // Primary waves
    this.setGerstnerWaveUniforms(program, waveData.primaryWaves, 'u_primary');
    this.shaderManager.setUniform1i(program, 'u_numPrimaryWaves', waveData.primaryWaves.length);

    // Swell waves
    const allSwellWaves = waveData.swellSystems.flatMap(system => system.waves);
    this.setGerstnerWaveUniforms(program, allSwellWaves, 'u_swell');
    this.shaderManager.setUniform1i(program, 'u_numSwellWaves', allSwellWaves.length);

    // Choppy layer
    this.shaderManager.setUniform2f(program, 'u_choppyWindDirection',
      waveData.choppyLayer.windDirection.x, waveData.choppyLayer.windDirection.z);
    this.shaderManager.setUniform1f(program, 'u_choppyWindSpeed', waveData.choppyLayer.windSpeed);
    this.shaderManager.setUniform1f(program, 'u_choppyFrequency', waveData.choppyLayer.frequency);
    this.shaderManager.setUniform1f(program, 'u_choppyAmplitude', waveData.choppyLayer.amplitude);
    this.shaderManager.setUniform1f(program, 'u_choppyModulation', waveData.choppyLayer.modulation);

    // Performance optimization
    this.shaderManager.setUniform1f(program, 'u_lodBias', 0.8); // Adjust as needed
    this.shaderManager.setUniform2f(program, 'u_cameraPosition', 0.0, 0.0); // Top-down view center

    // Environmental uniforms for natural rendering
    this.shaderManager.setUniform3f(program, 'u_sunDirection',
      this.sunDirection.x, this.sunDirection.y, this.sunDirection.z);
    this.shaderManager.setUniform3f(program, 'u_sunColor',
      this.sunColor.x, this.sunColor.y, this.sunColor.z);
    this.shaderManager.setUniform3f(program, 'u_skyColor',
      this.skyColor.x, this.skyColor.y, this.skyColor.z);
    this.shaderManager.setUniform3f(program, 'u_horizonColor',
      this.horizonColor.x, this.horizonColor.y, this.horizonColor.z);
    this.shaderManager.setUniform1f(program, 'u_sunIntensity', this.sunIntensity);
  }

  /**
   * Set Gerstner wave uniforms for an array of waves
   */
  private setGerstnerWaveUniforms(program: ShaderProgram, waves: any[], prefix: string): void {
    const maxWaves = prefix === 'u_primary' ? 8 : 12;

    // Prepare arrays
    const amplitudes = new Float32Array(maxWaves);
    const wavelengths = new Float32Array(maxWaves);
    const speeds = new Float32Array(maxWaves);
    const directions = new Float32Array(maxWaves * 2); // vec2 array
    const steepness = new Float32Array(maxWaves);
    const phases = new Float32Array(maxWaves);

    // Fill arrays with wave data
    for (let i = 0; i < Math.min(waves.length, maxWaves); i++) {
      const wave = waves[i];
      amplitudes[i] = wave.amplitude;
      wavelengths[i] = wave.wavelength;
      speeds[i] = wave.speed;
      directions[i * 2] = wave.direction.x;
      directions[i * 2 + 1] = wave.direction.z;
      steepness[i] = wave.steepness;
      phases[i] = wave.phaseOffset;
    }

    // Set uniform arrays
    this.shaderManager.setUniform1fv(program, `${prefix}Amplitudes[0]`, amplitudes);
    this.shaderManager.setUniform1fv(program, `${prefix}Wavelengths[0]`, wavelengths);
    this.shaderManager.setUniform1fv(program, `${prefix}Speeds[0]`, speeds);
    this.shaderManager.setUniform2fv(program, `${prefix}Directions[0]`, directions);
    this.shaderManager.setUniform1fv(program, `${prefix}Steepness[0]`, steepness);
    this.shaderManager.setUniform1fv(program, `${prefix}Phases[0]`, phases);
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
   * Switch wave pattern
   */
  setWavePattern(patternType: WavePatternType, transitionDuration: number = 3.0): void {
    this.wavePatternManager.switchPattern(patternType, transitionDuration);
  }

  /**
   * Get current wave pattern type
   */
  getCurrentWavePattern(): WavePatternType {
    return this.wavePatternManager.getCurrentPatternType();
  }

  /**
   * Get current wave pattern name for display
   */
  getCurrentWavePatternName(): string {
    return this.wavePatternManager.getCurrentPatternName();
  }

  /**
   * Set wind properties manually
   */
  setWindProperties(direction: Vec3, speed: number): void {
    this.wavePatternManager.setWindProperties(direction, speed);
  }

  /**
   * Get current wind properties
   */
  getWindProperties(): { direction: Vec3; speed: number } {
    return this.wavePatternManager.getWindProperties();
  }

  /**
   * Set environmental lighting properties
   */
  setEnvironmentalLighting(
    sunDirection: Vec3,
    sunColor: Vec3,
    skyColor: Vec3,
    sunIntensity: number = 1.0
  ): void {
    this.sunDirection = sunDirection.normalize();
    this.sunColor = sunColor;
    this.skyColor = skyColor;
    this.sunIntensity = sunIntensity;
  }

  /**
   * Get current environmental settings
   */
  getEnvironmentalSettings(): {
    sunDirection: Vec3;
    sunColor: Vec3;
    skyColor: Vec3;
    horizonColor: Vec3;
    sunIntensity: number;
  } {
    return {
      sunDirection: this.sunDirection,
      sunColor: this.sunColor,
      skyColor: this.skyColor,
      horizonColor: this.horizonColor,
      sunIntensity: this.sunIntensity
    };
  }

  /**
   * Update environmental settings based on time of day
   */
  updateTimeOfDay(timeOfDay: number): void {
    // timeOfDay: 0.0 = midnight, 0.5 = noon, 1.0 = midnight
    const normalizedTime = (timeOfDay % 1.0) * 2.0 * Math.PI;

    // Update sun direction
    const sunAngle = normalizedTime - Math.PI / 2; // Start at dawn
    this.sunDirection = new Vec3(
      Math.cos(sunAngle) * 0.6,
      Math.sin(sunAngle),
      0.5
    ).normalize();

    // Update sun color based on time
    const dayAmount = Math.max(0, this.sunDirection.y);

    // Interpolate colors
    const midnightColor = new Vec3(0.1, 0.15, 0.3);
    const sunriseColor = new Vec3(1.0, 0.7, 0.4);
    const noonColor = new Vec3(1.0, 0.95, 0.8);

    if (dayAmount > 0) {
      // Day time
      this.sunColor = new Vec3(
        this.lerp(sunriseColor.x, noonColor.x, dayAmount),
        this.lerp(sunriseColor.y, noonColor.y, dayAmount),
        this.lerp(sunriseColor.z, noonColor.z, dayAmount)
      );
      this.skyColor = new Vec3(
        this.lerp(0.6, 0.4, dayAmount),
        this.lerp(0.8, 0.7, dayAmount),
        1.0
      );
      this.sunIntensity = 0.8 + dayAmount * 0.4;
    } else {
      // Night time
      this.sunColor = midnightColor;
      this.skyColor = new Vec3(0.1, 0.2, 0.4);
      this.sunIntensity = 0.2;
    }
  }

  /**
   * Helper function for linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.bufferManager.dispose();
    this.shaderManager.dispose();
  }
}
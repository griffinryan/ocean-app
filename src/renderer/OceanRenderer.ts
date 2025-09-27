/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4, Vec3 } from '../utils/math';
import { VesselSystem, VesselConfig } from './VesselSystem';
import { CellularAutomaton } from './CellularAutomaton';
import { createDefaultDisplacementConfig } from '../utils/WavePhysics';

// Import cellular automata shaders
import cellularUpdateVert from '../shaders/cellular-update.vert';
import cellularUpdateFrag from '../shaders/cellular-update.frag';

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

  // Vessel system for wake generation
  private vesselSystem!: VesselSystem;
  private wakesEnabled: boolean = true;

  // Cellular automata wave simulation system
  private cellularAutomaton: CellularAutomaton | null = null;
  private useCellularAutomaton: boolean = false; // Disabled by default for safety

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

    // Create full-screen quad geometry for screen-space rendering
    this.geometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.geometry);

    // Set up WebGL state
    this.setupWebGL();

    // Set up responsive resizing
    this.setupResizing();

    // Set up camera for top-down view
    this.setupCamera();

    // Initialize vessel system
    this.initializeVesselSystem();

    // Initialize cellular automata system
    this.initializeCellularAutomaton();
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
   * Initialize vessel system with default configuration
   */
  private initializeVesselSystem(): void {
    const vesselConfig: VesselConfig = {
      maxVessels: 3,
      spawnInterval: 8000, // 8 seconds between spawns
      vesselLifetime: 30000, // 30 seconds vessel lifetime
      speedRange: [2.0, 5.0], // Speed range in units/second
      oceanBounds: [-20, 20, -20, 20], // Ocean bounds [minX, maxX, minZ, maxZ]
      wakeTrailLength: 200, // Maximum wake trail points
      wakeDecayTime: 15000 // 15 seconds for wake to decay
    };

    this.vesselSystem = new VesselSystem(vesselConfig);
  }

  /**
   * Initialize cellular automata wave simulation system
   */
  private initializeCellularAutomaton(): void {
    if (!this.useCellularAutomaton) return;

    try {
      // Create cellular automata configuration
      const caConfig = createDefaultDisplacementConfig();

      // Initialize cellular automata system with shader sources
      this.cellularAutomaton = new CellularAutomaton(
        this.gl,
        this.shaderManager,
        caConfig,
        cellularUpdateVert,
        cellularUpdateFrag
      );

      console.log('[OceanRenderer] Cellular automata system initialized');
    } catch (error) {
      console.error('[OceanRenderer] Failed to initialize cellular automata:', error);
      this.useCellularAutomaton = false;
      this.cellularAutomaton = null;
    }
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
      'u_vesselCount',
      'u_vesselPositions',
      'u_vesselVelocities',
      'u_wakesEnabled',
      'u_useCellularAutomaton',
      'u_displacementTexture',
      'u_velocityTexture',
      'u_energyTexture',
      'u_foamTexture'
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
    const deltaTime = 1 / 60; // Approximate 60 FPS for vessel updates

    // Update vessel system
    this.vesselSystem.update(currentTime, deltaTime);

    // Update cellular automata system
    if (this.useCellularAutomaton && this.cellularAutomaton) {
      // Convert vessel data for cellular automata
      const activeVessels = this.vesselSystem.getActiveVessels();
      const vesselPositions: Vec3[] = activeVessels.map(vessel => vessel.position);
      const vesselVelocities: Vec3[] = activeVessels.map(vessel => vessel.velocity);

      // Add vessel wakes to cellular automata
      this.cellularAutomaton.addVesselWakes(vesselPositions, vesselVelocities);

      // Update the cellular automata simulation
      this.cellularAutomaton.update(deltaTime);
    }

    // Clear the frame
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Use ocean shader
    const program = this.shaderManager.useProgram('ocean');

    // Set time for animation
    this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);

    // Set aspect ratio
    const aspect = this.canvas.width / this.canvas.height;
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', this.canvas.width, this.canvas.height);

    // Set debug mode
    this.shaderManager.setUniform1i(program, 'u_debugMode', this.debugMode);

    // Set vessel wake uniforms
    const vesselData = this.vesselSystem.getVesselDataForShader(5);
    this.shaderManager.setUniform1i(program, 'u_vesselCount', vesselData.count);
    this.shaderManager.setUniform1i(program, 'u_wakesEnabled', this.wakesEnabled ? 1 : 0);

    // Debug logging (throttled to avoid spam)
    if (Math.floor(elapsedTime) % 2 === 0 && Math.floor(elapsedTime * 10) % 10 === 0) {
      console.log(`[OceanRenderer] Frame ${Math.floor(elapsedTime)}s: ${vesselData.count} vessels, wakes ${this.wakesEnabled ? 'ON' : 'OFF'}`);
    }

    if (vesselData.count > 0) {
      this.shaderManager.setUniform3fv(program, 'u_vesselPositions', vesselData.positions);
      this.shaderManager.setUniform3fv(program, 'u_vesselVelocities', vesselData.velocities);
    }

    // Set cellular automata uniforms
    this.shaderManager.setUniform1i(program, 'u_useCellularAutomaton', this.useCellularAutomaton ? 1 : 0);

    if (this.useCellularAutomaton && this.cellularAutomaton) {
      try {
        const displacementTextures = this.cellularAutomaton.getDisplacementTextures();

        // Verify textures are valid before binding
        if (displacementTextures.heightCurrent &&
            displacementTextures.velocity &&
            displacementTextures.energy &&
            displacementTextures.foam) {

          // Bind displacement textures
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, displacementTextures.heightCurrent);
          this.shaderManager.setUniform1i(program, 'u_displacementTexture', 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, displacementTextures.velocity);
          this.shaderManager.setUniform1i(program, 'u_velocityTexture', 1);

          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, displacementTextures.energy);
          this.shaderManager.setUniform1i(program, 'u_energyTexture', 2);

          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, displacementTextures.foam);
          this.shaderManager.setUniform1i(program, 'u_foamTexture', 3);
        } else {
          console.warn('[OceanRenderer] Cellular automata textures not ready, disabling CA');
          this.useCellularAutomaton = false;
        }
      } catch (error) {
        console.error('[OceanRenderer] Error binding cellular automata textures:', error);
        this.useCellularAutomaton = false;
      }
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
   * Toggle vessel wake system
   */
  toggleWakes(): void {
    this.wakesEnabled = !this.wakesEnabled;
    this.vesselSystem.setEnabled(this.wakesEnabled);
  }

  /**
   * Get wake system enabled state
   */
  getWakesEnabled(): boolean {
    return this.wakesEnabled;
  }

  /**
   * Get vessel system statistics
   */
  getVesselStats(): { activeVessels: number; totalWakePoints: number } {
    return this.vesselSystem.getStats();
  }

  /**
   * Toggle cellular automata system
   */
  toggleCellularAutomaton(): void {
    this.useCellularAutomaton = !this.useCellularAutomaton;
    console.log(`[OceanRenderer] Cellular automata ${this.useCellularAutomaton ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get cellular automata enabled state
   */
  getCellularAutomatonEnabled(): boolean {
    return this.useCellularAutomaton;
  }

  /**
   * Get cellular automata debug information
   */
  getCellularAutomatonDebugInfo(): any {
    if (!this.cellularAutomaton) return null;
    return this.cellularAutomaton.getDebugInfo();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.bufferManager.dispose();
    this.shaderManager.dispose();

    // Clean up cellular automata system
    if (this.cellularAutomaton) {
      this.cellularAutomaton.dispose();
      this.cellularAutomaton = null;
    }
  }
}
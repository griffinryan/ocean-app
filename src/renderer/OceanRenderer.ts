/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';
import { VesselSystem, VesselConfig } from './VesselSystem';
import { GlassRenderer } from './GlassRenderer';

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

  // Glass panel renderer
  private glassRenderer: GlassRenderer | null = null;
  private glassEnabled: boolean = false;

  // Cached panel data for performance
  private panelCache = {
    positions: new Float32Array(4), // Reusable buffer for 2 panels * 2 coords
    sizes: new Float32Array(4),     // Reusable buffer for 2 panels * 2 coords
    strengths: new Float32Array(2), // Reusable buffer for 2 panels
    count: 0,
    lastUpdate: 0,
    updateInterval: 250, // Update every 250ms instead of every frame
    dirty: true
  };

  // Pre-cached DOM elements
  private cachedElements = {
    landingPanel: null as HTMLElement | null,
    appPanel: null as HTMLElement | null,
    fpsElement: null as HTMLElement | null,
    elementsInitialized: false
  };

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

    // Initialize glass renderer
    this.initializeGlassRenderer();
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

      // Resize glass renderer framebuffer if enabled
      if (this.glassRenderer) {
        this.glassRenderer.resizeFramebuffer(canvasWidth, canvasHeight);
      }

      // Mark panel cache as dirty since canvas size changed
      this.markPanelCacheDirty();
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
   * Initialize vessel system with enhanced configuration for long curling wakes
   */
  private initializeVesselSystem(): void {
    const vesselConfig: VesselConfig = {
      maxVessels: 3,
      spawnInterval: 8000, // 8 seconds between spawns
      vesselLifetime: 30000, // 30 seconds vessel lifetime
      speedRange: [2.0, 5.0], // Speed range in units/second
      oceanBounds: [-20, 20, -20, 20], // Ocean bounds [minX, maxX, minZ, maxZ]
      wakeTrailLength: 150, // Maximum wake trail points (increased from 20)
      wakeDecayTime: 35000, // 35 seconds for wake to decay (increased from 15)
      shearRate: 0.15, // Progressive wake curling rate
      waveletSigma: 0.35, // Wavelet decay spread
      maxTrailDistance: 80.0, // Maximum trail distance in units
      splineControlPoints: [
        { position: 0.0, value: 1.0, tangent: -0.5 }, // Strong start
        { position: 0.3, value: 0.85, tangent: -0.8 }, // Gentle initial decay
        { position: 0.6, value: 0.5, tangent: -1.2 }, // Mid-trail fade
        { position: 0.85, value: 0.2, tangent: -2.0 }, // Rapid final fade
        { position: 1.0, value: 0.0, tangent: -3.0 } // Complete fade
      ]
    };

    this.vesselSystem = new VesselSystem(vesselConfig);
  }

  /**
   * Initialize glass renderer system
   */
  private initializeGlassRenderer(): void {
    try {
      this.glassRenderer = new GlassRenderer(this.gl, this.shaderManager);
      this.glassRenderer.setupDefaultPanels();
      console.log('Glass renderer initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize glass renderer:', error);
      this.glassRenderer = null;
    }
  }

  /**
   * Initialize ocean shader program and glass shaders
   */
  async initializeShaders(
    oceanVertexSource: string,
    oceanFragmentSource: string,
    glassVertexSource?: string,
    glassFragmentSource?: string
  ): Promise<void> {
    // Define uniforms and attributes for ocean shader
    const uniforms = [
      'u_time',
      'u_aspectRatio',
      'u_resolution',
      'u_debugMode',
      'u_vesselCount',
      'u_vesselPositions',
      'u_vesselVelocities',
      'u_vesselWeights',
      'u_vesselClasses',
      'u_vesselHullLengths',
      'u_vesselStates',
      'u_wakesEnabled',
      'u_glassEnabled',
      'u_glassPanelCount',
      'u_glassPanelPositions',
      'u_glassPanelSizes',
      'u_glassDistortionStrengths'
    ];

    const attributes = [
      'a_position',
      'a_texcoord'
    ];

    // Create ocean shader program
    this.oceanProgram = this.shaderManager.createProgram(
      'ocean',
      oceanVertexSource,
      oceanFragmentSource,
      uniforms,
      attributes
    );

    // Set up vertex attributes
    const positionLocation = this.oceanProgram.attributeLocations.get('a_position')!;
    const texcoordLocation = this.oceanProgram.attributeLocations.get('a_texcoord')!;

    this.bufferManager.setupAttributes(positionLocation, texcoordLocation);

    // Initialize glass shaders if provided
    if (glassVertexSource && glassFragmentSource && this.glassRenderer) {
      try {
        await this.glassRenderer.initializeShaders(glassVertexSource, glassFragmentSource);
        this.glassEnabled = true;
        console.log('Glass shaders initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize glass shaders:', error);
        this.glassEnabled = false;
      }
    }
  }

  /**
   * Render ocean scene with integrated glass distortion
   */
  private renderOceanScene(elapsedTime: number): void {
    const gl = this.gl;

    // Clear and render ocean with integrated glass distortion
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawOcean(elapsedTime);
  }

  /**
   * Draw the ocean scene with current uniforms
   */
  private drawOcean(elapsedTime: number): void {
    const gl = this.gl;

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
    const vesselData = this.vesselSystem.getVesselDataForShader(5, performance.now());
    this.shaderManager.setUniform1i(program, 'u_vesselCount', vesselData.count);
    this.shaderManager.setUniform1i(program, 'u_wakesEnabled', this.wakesEnabled ? 1 : 0);

    if (vesselData.count > 0) {
      this.shaderManager.setUniform3fv(program, 'u_vesselPositions', vesselData.positions);
      this.shaderManager.setUniform3fv(program, 'u_vesselVelocities', vesselData.velocities);
      this.shaderManager.setUniform1fv(program, 'u_vesselWeights', vesselData.weights);
      this.shaderManager.setUniform1fv(program, 'u_vesselClasses', vesselData.classes);
      this.shaderManager.setUniform1fv(program, 'u_vesselHullLengths', vesselData.hullLengths);
      this.shaderManager.setUniform1fv(program, 'u_vesselStates', vesselData.states);
    }

    // Set glass panel uniforms
    this.shaderManager.setUniform1i(program, 'u_glassEnabled', this.glassEnabled ? 1 : 0);
    const glassData = this.getGlassPanelDataForShader();
    this.shaderManager.setUniform1i(program, 'u_glassPanelCount', glassData.count);

    if (glassData.count > 0) {
      this.shaderManager.setUniform2fv(program, 'u_glassPanelPositions', glassData.positions);
      this.shaderManager.setUniform2fv(program, 'u_glassPanelSizes', glassData.sizes);
      this.shaderManager.setUniform1fv(program, 'u_glassDistortionStrengths', glassData.strengths);
    }

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Render one frame
   */
  private render(): void {
    if (!this.oceanProgram) return;

    const currentTime = performance.now();
    const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds
    const deltaTime = 1 / 60; // Approximate 60 FPS for vessel updates

    // Update vessel system
    this.vesselSystem.update(currentTime, deltaTime);

    // Render ocean scene with integrated glass distortion
    this.renderOceanScene(elapsedTime);

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

      // Update FPS display if element exists (using cached reference)
      this.initializeCachedElements();
      if (this.cachedElements.fpsElement) {
        this.cachedElements.fpsElement.textContent = `FPS: ${this.fps}`;
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
   * Enable/disable glass panel rendering
   */
  setGlassEnabled(enabled: boolean): void {
    this.glassEnabled = enabled && this.glassRenderer !== null;
    if (this.glassEnabled) {
      this.markPanelCacheDirty();
    }
  }

  /**
   * Mark panel cache as dirty to force update on next frame
   */
  public markPanelCacheDirty(): void {
    this.panelCache.dirty = true;
  }

  /**
   * Get glass rendering state
   */
  getGlassEnabled(): boolean {
    return this.glassEnabled;
  }

  /**
   * Get glass renderer instance for external control
   */
  getGlassRenderer(): GlassRenderer | null {
    return this.glassRenderer;
  }

  /**
   * Initialize cached DOM elements for performance
   */
  private initializeCachedElements(): void {
    if (this.cachedElements.elementsInitialized) return;

    this.cachedElements.landingPanel = document.getElementById('landing-panel');
    this.cachedElements.appPanel = document.getElementById('app-panel');
    this.cachedElements.fpsElement = document.getElementById('fps');
    this.cachedElements.elementsInitialized = true;
  }

  /**
   * Update panel cache with current panel positions
   */
  private updatePanelCache(): void {
    const now = performance.now();

    // Skip update if not dirty and within update interval
    if (!this.panelCache.dirty && (now - this.panelCache.lastUpdate) < this.panelCache.updateInterval) {
      return;
    }

    this.initializeCachedElements();

    const canvasRect = this.canvas.getBoundingClientRect();
    let count = 0;

    // Reset arrays (reuse existing buffers)
    this.panelCache.positions.fill(0);
    this.panelCache.sizes.fill(0);
    this.panelCache.strengths.fill(0);

    // Check landing panel
    if (this.cachedElements.landingPanel && !this.cachedElements.landingPanel.classList.contains('hidden')) {
      const rect = this.cachedElements.landingPanel.getBoundingClientRect();
      const panelData = this.htmlRectToShaderCoords(rect, canvasRect);

      this.panelCache.positions[count * 2] = panelData.position[0];
      this.panelCache.positions[count * 2 + 1] = panelData.position[1];
      this.panelCache.sizes[count * 2] = panelData.size[0];
      this.panelCache.sizes[count * 2 + 1] = panelData.size[1];
      this.panelCache.strengths[count] = 2.0; // Strong distortion for landing panel
      count++;
    }

    // Check app panel
    if (this.cachedElements.appPanel && !this.cachedElements.appPanel.classList.contains('hidden')) {
      const rect = this.cachedElements.appPanel.getBoundingClientRect();
      const panelData = this.htmlRectToShaderCoords(rect, canvasRect);

      this.panelCache.positions[count * 2] = panelData.position[0];
      this.panelCache.positions[count * 2 + 1] = panelData.position[1];
      this.panelCache.sizes[count * 2] = panelData.size[0];
      this.panelCache.sizes[count * 2 + 1] = panelData.size[1];
      this.panelCache.strengths[count] = 1.5; // Medium distortion for app panel
      count++;
    }

    this.panelCache.count = count;
    this.panelCache.lastUpdate = now;
    this.panelCache.dirty = false;
  }

  /**
   * Get glass panel data for ocean shader (optimized)
   */
  private getGlassPanelDataForShader(): { count: number; positions: Float32Array; sizes: Float32Array; strengths: Float32Array } {
    if (!this.glassEnabled) {
      return {
        count: 0,
        positions: this.panelCache.positions,
        sizes: this.panelCache.sizes,
        strengths: this.panelCache.strengths
      };
    }

    this.updatePanelCache();

    return {
      count: this.panelCache.count,
      positions: this.panelCache.positions,
      sizes: this.panelCache.sizes,
      strengths: this.panelCache.strengths
    };
  }

  /**
   * Convert HTML element rect to ocean shader coordinates
   */
  private htmlRectToShaderCoords(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    // Convert to normalized screen coordinates (-1 to 1)
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width * 2.0 - 1.0;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height * 2.0 - 1.0;

    // Flip Y coordinate for WebGL
    const flippedY = -centerY;

    // Calculate size in screen space
    const sizeX = elementRect.width / canvasRect.width * 2.0;
    const sizeY = elementRect.height / canvasRect.height * 2.0;

    return {
      position: [centerX, flippedY],
      size: [sizeX, sizeY]
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.bufferManager.dispose();
    this.shaderManager.dispose();

    // Clean up glass renderer
    if (this.glassRenderer) {
      this.glassRenderer.dispose();
      this.glassRenderer = null;
    }
  }
}
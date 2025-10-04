/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';
import { VesselSystem, VesselConfig } from './VesselSystem';
import { GlassRenderer } from './GlassRenderer';
import { TextRenderer } from './TextRenderer';

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

  // High-resolution timing for smooth animation regardless of throttling
  private lastFrameTime: number = 0;
  private deltaTime: number = 0;
  private targetFPS: number = 60;
  private isThrottled: boolean = false;

  // Vessel uniform batching (set once per frame, reused across passes)
  private vesselDataCache: {
    positions: Float32Array;
    velocities: Float32Array;
    weights: Float32Array;
    classes: Float32Array;
    hullLengths: Float32Array;
    states: Float32Array;
    count: number;
  } | null = null;

  // Adaptive quality system for performance
  private currentQuality: number = 2; // 0=LOW, 1=MEDIUM, 2=HIGH
  private qualityResolutionScale: number = 1.0;
  private consecutiveLowFPS: number = 0;
  private consecutiveHighFPS: number = 0;
  private readonly FPS_LOW_THRESHOLD = 40;
  private readonly FPS_HIGH_THRESHOLD = 50;
  private readonly FPS_CHECK_FRAMES = 10; // Stabilize before changing

  // Debug mode
  private debugMode: number = 0;

  // Vessel system for wake generation
  private vesselSystem!: VesselSystem;
  private wakesEnabled: boolean = true;

  // Glass panel renderer
  private glassRenderer: GlassRenderer | null = null;
  private glassEnabled: boolean = false;

  // Text renderer for adaptive text overlay
  private textRenderer: TextRenderer | null = null;
  private textEnabled: boolean = false;

  // Pre-cached DOM elements
  private cachedElements = {
    fpsElement: null as HTMLElement | null,
    elementsInitialized: false
  };

  // Uniform update cache to reduce redundant WebGL calls
  private uniformCache = {
    lastAspectRatio: -1,
    lastResolution: new Float32Array(2),
    lastDebugMode: -1,
    lastWakesEnabled: false,
    lastVesselCount: -1
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

    // Initialize text renderer
    this.initializeTextRenderer();
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

    // Apply quality-based resolution scaling for adaptive performance
    const effectivePixelRatio = devicePixelRatio * this.qualityResolutionScale;
    const canvasWidth = Math.round(displayWidth * effectivePixelRatio);
    const canvasHeight = Math.round(displayHeight * effectivePixelRatio);

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

      // Resize text renderer framebuffer if enabled
      if (this.textRenderer) {
        this.textRenderer.resizeFramebuffer(canvasWidth, canvasHeight);
      }
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
   * Initialize text renderer system
   */
  private initializeTextRenderer(): void {
    try {
      this.textRenderer = new TextRenderer(this.gl, this.shaderManager);
      this.textRenderer.setupDefaultTextElements();
      console.log('Text renderer initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text renderer:', error);
      this.textRenderer = null;
    }
  }

  /**
   * Initialize ocean shader program, glass shaders, text shaders, and blur map shaders
   */
  async initializeShaders(
    oceanVertexSource: string,
    oceanFragmentSource: string,
    glassVertexSource?: string,
    glassFragmentSource?: string,
    textVertexSource?: string,
    textFragmentSource?: string,
    blurMapVertexSource?: string,
    blurMapFragmentSource?: string
  ): Promise<void> {
    // Define uniforms and attributes for ocean shader
    const uniforms = [
      'u_time',
      'u_aspectRatio',
      'u_resolution',
      'u_debugMode',
      'u_qualityLevel',
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

    // Initialize text shaders if provided
    if (textVertexSource && textFragmentSource && this.textRenderer) {
      try {
        await this.textRenderer.initializeShaders(textVertexSource, textFragmentSource);
        this.textEnabled = true;
        console.log('Text shaders initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize text shaders:', error);
        this.textEnabled = false;
      }
    }

    // Initialize blur map shaders if provided
    if (blurMapVertexSource && blurMapFragmentSource && this.textRenderer) {
      try {
        await this.textRenderer.initializeBlurMapShaders(blurMapVertexSource, blurMapFragmentSource);
        console.log('Blur map shaders initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize blur map shaders:', error);
      }
    }
  }

  /**
   * Render ocean scene with glass and text overlay pipeline
   */
  private renderOceanScene(elapsedTime: number): void {
    const gl = this.gl;

    // Get vessel data for text renderer glow distortion
    const vesselData = this.vesselSystem.getVesselDataForShader(5, performance.now());

    if (this.textEnabled && this.textRenderer) {
      // Full pipeline: Ocean -> Glass -> Text Color Analysis

      if (this.glassEnabled && this.glassRenderer) {
        // 1. Render ocean to texture for glass distortion
        this.glassRenderer.captureOceanScene(() => {
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          this.drawOcean(elapsedTime);
        });

        // 2. Render combined ocean + glass scene to texture for text background analysis
        this.textRenderer.captureScene(() => {
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          this.drawOcean(elapsedTime);
          this.glassRenderer!.render();
        });

        // 3. Pass blur map from TextRenderer to GlassRenderer
        // Note: Blur map is generated in TextRenderer.render() → generateBlurMap()
        // We get the texture after text rendering updates it
        const blurMapTexture = this.textRenderer.getBlurMapTexture();
        this.glassRenderer.setBlurMapTexture(blurMapTexture);

        // 4. Final render: Ocean + Glass (with blur modulation) + WebGL Text Overlay with glow
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
        this.glassRenderer.render();
        this.textRenderer.render(vesselData, this.wakesEnabled);
      } else {
        // Ocean + Text pipeline (no glass)

        // 1. Render ocean to texture for text background analysis
        this.textRenderer.captureScene(() => {
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          this.drawOcean(elapsedTime);
        });

        // 2. Final render: Ocean + WebGL Text Overlay with glow
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
        this.textRenderer.render(vesselData, this.wakesEnabled);
      }
    } else if (this.glassEnabled && this.glassRenderer) {
      // Glass pipeline only (no text)

      // Render ocean to texture for glass distortion
      this.glassRenderer.captureOceanScene(() => {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
      });

      // Clear screen and render ocean without glass effects
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);

      // Render glass panels as overlay
      this.glassRenderer.render();
    } else {
      // Basic ocean rendering only
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);
    }
  }

  /**
   * Draw the ocean scene with optimized uniform updates
   */
  private drawOcean(elapsedTime: number): void {
    const gl = this.gl;

    // Use ocean shader
    const program = this.shaderManager.useProgram('ocean');

    // Always set time for animation (changes every frame)
    this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);

    // Set aspect ratio only if changed
    const aspect = this.canvas.width / this.canvas.height;
    if (aspect !== this.uniformCache.lastAspectRatio) {
      this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
      this.uniformCache.lastAspectRatio = aspect;
    }

    // Set resolution only if changed
    if (this.uniformCache.lastResolution[0] !== this.canvas.width ||
        this.uniformCache.lastResolution[1] !== this.canvas.height) {
      this.shaderManager.setUniform2f(program, 'u_resolution', this.canvas.width, this.canvas.height);
      this.uniformCache.lastResolution[0] = this.canvas.width;
      this.uniformCache.lastResolution[1] = this.canvas.height;
    }

    // Set debug mode only if changed
    if (this.debugMode !== this.uniformCache.lastDebugMode) {
      this.shaderManager.setUniform1i(program, 'u_debugMode', this.debugMode);
      this.uniformCache.lastDebugMode = this.debugMode;
    }

    // Set quality level for shader LOD
    this.shaderManager.setUniform1i(program, 'u_qualityLevel', this.currentQuality);

    // Set vessel wake uniforms using cached data (OPTIMIZED - batching)
    // Cache is populated once per frame in render() method
    const vesselData = this.vesselDataCache || {
      positions: new Float32Array(0),
      velocities: new Float32Array(0),
      weights: new Float32Array(0),
      classes: new Float32Array(0),
      hullLengths: new Float32Array(0),
      states: new Float32Array(0),
      count: 0
    };

    // Set vessel count only if changed
    if (vesselData.count !== this.uniformCache.lastVesselCount) {
      this.shaderManager.setUniform1i(program, 'u_vesselCount', vesselData.count);
      this.uniformCache.lastVesselCount = vesselData.count;
    }

    // Set wakes enabled only if changed
    if (this.wakesEnabled !== this.uniformCache.lastWakesEnabled) {
      this.shaderManager.setUniform1i(program, 'u_wakesEnabled', this.wakesEnabled ? 1 : 0);
      this.uniformCache.lastWakesEnabled = this.wakesEnabled;
    }

    // Vessel data arrays need to be updated every frame when vessels are active
    if (vesselData.count > 0) {
      this.shaderManager.setUniform3fv(program, 'u_vesselPositions', vesselData.positions);
      this.shaderManager.setUniform3fv(program, 'u_vesselVelocities', vesselData.velocities);
      this.shaderManager.setUniform1fv(program, 'u_vesselWeights', vesselData.weights);
      this.shaderManager.setUniform1fv(program, 'u_vesselClasses', vesselData.classes);
      this.shaderManager.setUniform1fv(program, 'u_vesselHullLengths', vesselData.hullLengths);
      this.shaderManager.setUniform1fv(program, 'u_vesselStates', vesselData.states);
    }

    // Disable integrated glass effects since we're using overlay approach
    this.shaderManager.setUniform1i(program, 'u_glassEnabled', 0);
    this.shaderManager.setUniform1i(program, 'u_glassPanelCount', 0);

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Render one frame with high-resolution timing
   */
  private render(): void {
    if (!this.oceanProgram) return;

    const currentTime = performance.now();

    // Calculate actual deltaTime in seconds (high-resolution)
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = currentTime;
    }
    const frameDelta = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // Convert to seconds and clamp to prevent spiral of death
    // Max deltaTime of 100ms (10fps minimum) prevents huge jumps
    this.deltaTime = Math.min(frameDelta / 1000, 0.1);

    // Detect browser throttling (frame time > 20ms indicates < 50fps)
    this.isThrottled = frameDelta > 20;

    const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds

    // Update vessel system with real deltaTime for smooth animation
    this.vesselSystem.update(currentTime, this.deltaTime);

    // Update vessel uniform data cache once per frame (OPTIMIZATION - batching)
    // This eliminates redundant calls during multi-pass rendering
    this.vesselDataCache = this.vesselSystem.getVesselDataForShader(5, currentTime);

    // Render ocean scene with integrated glass distortion and per-pixel adaptive text
    this.renderOceanScene(elapsedTime);

    // Update FPS counter
    this.updateFPS(currentTime);

    // Adaptive quality monitoring and adjustment
    this.monitorAndAdaptQuality();
  }

  /**
   * Monitor FPS and adaptively adjust quality level
   */
  private monitorAndAdaptQuality(): void {
    if (this.fps < this.FPS_LOW_THRESHOLD) {
      this.consecutiveLowFPS++;
      this.consecutiveHighFPS = 0;

      // Downgrade quality if consistently low FPS
      if (this.consecutiveLowFPS >= this.FPS_CHECK_FRAMES) {
        this.downgradeQuality();
        this.consecutiveLowFPS = 0;
      }
    } else if (this.fps > this.FPS_HIGH_THRESHOLD) {
      this.consecutiveHighFPS++;
      this.consecutiveLowFPS = 0;

      // Upgrade quality if consistently high FPS (need more frames for stability)
      if (this.consecutiveHighFPS >= this.FPS_CHECK_FRAMES * 2) {
        this.upgradeQuality();
        this.consecutiveHighFPS = 0;
      }
    } else {
      // FPS in acceptable range, reset counters
      this.consecutiveLowFPS = 0;
      this.consecutiveHighFPS = 0;
    }
  }

  /**
   * Downgrade rendering quality to improve performance
   */
  private downgradeQuality(): void {
    if (this.currentQuality === 0) {
      console.log('OceanRenderer: Already at lowest quality');
      return;
    }

    this.currentQuality--;

    // Update resolution scale and settings based on new quality
    switch (this.currentQuality) {
      case 1: // MEDIUM
        this.qualityResolutionScale = 0.75;
        if (this.textRenderer) {
          this.textRenderer.setBlurMapGenerationEnabled(false);
        }
        console.log('OceanRenderer: Downgraded to MEDIUM quality (75% resolution, 4 waves, no blur)');
        break;
      case 0: // LOW
        this.qualityResolutionScale = 0.5;
        if (this.textRenderer) {
          this.textRenderer.setBlurMapGenerationEnabled(false);
        }
        console.log('OceanRenderer: Downgraded to LOW quality (50% resolution, 2 waves, no blur)');
        break;
    }

    // Trigger resize to apply new resolution
    this.resize();
  }

  /**
   * Upgrade rendering quality when performance allows
   */
  private upgradeQuality(): void {
    if (this.currentQuality === 2) {
      console.log('OceanRenderer: Already at highest quality');
      return;
    }

    this.currentQuality++;

    // Update resolution scale and settings based on new quality
    switch (this.currentQuality) {
      case 1: // MEDIUM
        this.qualityResolutionScale = 0.75;
        if (this.textRenderer) {
          this.textRenderer.setBlurMapGenerationEnabled(false);
        }
        console.log('OceanRenderer: Upgraded to MEDIUM quality (75% resolution, 4 waves, no blur)');
        break;
      case 2: // HIGH
        this.qualityResolutionScale = 1.0;
        if (this.textRenderer) {
          this.textRenderer.setBlurMapGenerationEnabled(true);
        }
        console.log('OceanRenderer: Upgraded to HIGH quality (100% resolution, 8 waves, blur)');
        break;
    }

    // Trigger resize to apply new resolution
    this.resize();
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
   * Start the render loop with high-resolution timing
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const now = performance.now();
    this.startTime = now;
    this.lastFpsUpdate = now;
    this.lastFrameTime = now;

    const renderLoop = (timestamp: number) => {
      if (!this.isRunning) return;

      this.render();
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    this.animationFrameId = requestAnimationFrame(renderLoop);
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
   * Enable/disable text rendering
   */
  setTextEnabled(enabled: boolean): void {
    this.textEnabled = enabled && this.textRenderer !== null;
  }

  /**
   * Get text rendering state
   */
  getTextEnabled(): boolean {
    return this.textEnabled;
  }

  /**
   * Get text renderer instance for external control
   */
  getTextRenderer(): TextRenderer | null {
    return this.textRenderer;
  }

  /**
   * Enable/disable blur map effect
   */
  setBlurMapEnabled(enabled: boolean): void {
    if (this.glassRenderer) {
      this.glassRenderer.setBlurMapEnabled(enabled);
    }
  }

  /**
   * Get blur map enabled state
   */
  getBlurMapEnabled(): boolean {
    return this.glassRenderer?.getBlurMapEnabled() ?? false;
  }

  /**
   * Initialize cached DOM elements for performance
   */
  private initializeCachedElements(): void {
    if (this.cachedElements.elementsInitialized) return;

    this.cachedElements.fpsElement = document.getElementById('fps');
    this.cachedElements.elementsInitialized = true;
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

    // Clean up text renderer
    if (this.textRenderer) {
      this.textRenderer.dispose();
      this.textRenderer = null;
    }
  }
}
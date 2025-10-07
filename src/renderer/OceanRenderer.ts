/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';
import { VesselSystem, VesselConfig } from './VesselSystem';
import { GlassRenderer } from './GlassRenderer';
import { TextRenderer } from './TextRenderer';
import { WakeRenderer } from './WakeRenderer';
import { QualityManager, QualitySettings } from '../config/QualityPresets';
import { PerformanceMonitor } from '../utils/PerformanceMonitor';
import { FrameBudgetManager } from '../utils/FrameBudget';
import type { PanelLayoutTracker } from '../utils/PanelLayoutTracker';

export interface RenderConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  layoutTracker?: PanelLayoutTracker | null;
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

  // First-frame callback for smooth CSS→WebGL transition
  private firstFrameRendered: boolean = false;
  private onFirstFrameCallback: (() => void) | null = null;

  // Vessel system for wake generation
  private vesselSystem!: VesselSystem;
  private wakesEnabled: boolean = true;

  // Wake renderer for dedicated wake texture generation
  private wakeRenderer: WakeRenderer | null = null;

  // Glass panel renderer
  private glassRenderer: GlassRenderer | null = null;
  private glassEnabled: boolean = false;

  // Text renderer for adaptive text overlay
  private textRenderer: TextRenderer | null = null;
  private textEnabled: boolean = false;

  // Quality and performance management
  private qualityManager: QualityManager;
  private performanceMonitor: PerformanceMonitor;
  private frameBudget: FrameBudgetManager;
  private currentQuality: QualitySettings;
  private layoutTracker: PanelLayoutTracker | null;

  // Upscaling system
  private upscaleFramebuffer: WebGLFramebuffer | null = null;
  private upscaleTexture: WebGLTexture | null = null;
  private upscaleDepthBuffer: WebGLRenderbuffer | null = null;
  private upscaleProgram: ShaderProgram | null = null;
  private upscaleGeometry: GeometryData;
  private upscaleBufferManager: BufferManager;

  // PERFORMANCE: Shared ocean buffer - render ocean once, sample multiple times
  // This eliminates redundant ocean draws (3x per frame → 1x per frame)
  private sharedOceanFramebuffer: WebGLFramebuffer | null = null;
  private sharedOceanTexture: WebGLTexture | null = null;
  private sharedOceanDepthBuffer: WebGLRenderbuffer | null = null;

  // Resolution scaling
  private displayWidth: number = 0;
  private displayHeight: number = 0;
  private renderWidth: number = 0;
  private renderHeight: number = 0;

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
    lastWakesEnabled: false
  };

  constructor(config: RenderConfig) {
    this.canvas = config.canvas;
    this.startTime = performance.now();
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();
    this.layoutTracker = config.layoutTracker ?? null;

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

    // Initialize quality and performance systems
    this.qualityManager = new QualityManager();
    this.performanceMonitor = new PerformanceMonitor(this.qualityManager);
    this.frameBudget = new FrameBudgetManager();
    this.currentQuality = this.qualityManager.getSettings();

    // Listen for quality changes
    this.qualityManager.onChange((settings) => {
      this.currentQuality = settings;
      this.onQualityChanged(settings);
    });

    // Create full-screen quad geometry for screen-space rendering
    this.geometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.geometry);

    // Create upscaling quad geometry
    this.upscaleGeometry = GeometryBuilder.createFullScreenQuad();
    this.upscaleBufferManager = new BufferManager(gl, this.upscaleGeometry);

    // Set up WebGL state
    this.setupWebGL();

    // Initialize upscaling framebuffer
    this.initializeUpscaleFramebuffer();

    // PERFORMANCE: Initialize shared ocean buffer for consolidating ocean renders
    this.initializeSharedOceanBuffer();

    // Set up camera for top-down view
    this.setupCamera();

    // Initialize vessel system
    this.initializeVesselSystem();

    // Initialize wake renderer BEFORE setupResizing() so framebuffer gets sized correctly
    this.initializeWakeRenderer();

    // Initialize glass renderer BEFORE setupResizing() so framebuffer gets sized correctly
    this.initializeGlassRenderer();

    // Initialize text renderer BEFORE setupResizing() so framebuffer gets sized correctly
    this.initializeTextRenderer();

    // Set up responsive resizing (MUST be called after initializing renderers)
    this.setupResizing();

    // Initialize GPU timing for performance monitoring
    this.performanceMonitor.initializeGPUTiming(gl);

    console.log(`OceanRenderer: Initialized with quality preset "${this.qualityManager.getPreset()}"`);
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
   * Initialize upscaling framebuffer
   */
  private initializeUpscaleFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.upscaleFramebuffer = gl.createFramebuffer();
    if (!this.upscaleFramebuffer) {
      throw new Error('Failed to create upscale framebuffer');
    }

    // Create texture for color attachment
    this.upscaleTexture = gl.createTexture();
    if (!this.upscaleTexture) {
      throw new Error('Failed to create upscale texture');
    }

    // Create depth renderbuffer
    this.upscaleDepthBuffer = gl.createRenderbuffer();
    if (!this.upscaleDepthBuffer) {
      throw new Error('Failed to create upscale depth buffer');
    }

    console.log('OceanRenderer: Upscaling framebuffer initialized');
  }

  /**
   * Initialize shared ocean buffer for consolidated ocean rendering
   * PERFORMANCE: Allows ocean to be rendered once and sampled by glass/text
   */
  private initializeSharedOceanBuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.sharedOceanFramebuffer = gl.createFramebuffer();
    if (!this.sharedOceanFramebuffer) {
      throw new Error('Failed to create shared ocean framebuffer');
    }

    // Create texture for color attachment
    this.sharedOceanTexture = gl.createTexture();
    if (!this.sharedOceanTexture) {
      throw new Error('Failed to create shared ocean texture');
    }

    // Create depth renderbuffer
    this.sharedOceanDepthBuffer = gl.createRenderbuffer();
    if (!this.sharedOceanDepthBuffer) {
      throw new Error('Failed to create shared ocean depth buffer');
    }

    console.log('OceanRenderer: Shared ocean buffer initialized');
  }

  /**
   * Resize shared ocean buffer to match render resolution
   * PERFORMANCE: Ocean capture resolution can be independently scaled
   */
  private resizeSharedOceanBuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.sharedOceanFramebuffer || !this.sharedOceanTexture || !this.sharedOceanDepthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharedOceanFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.sharedOceanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sharedOceanTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sharedOceanDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sharedOceanDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Shared ocean framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  /**
   * Resize upscaling framebuffer
   */
  private resizeUpscaleFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.upscaleFramebuffer || !this.upscaleTexture || !this.upscaleDepthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscaleFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.upscaleTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.upscaleTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.upscaleDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.upscaleDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Upscale framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  /**
   * Handle quality settings change
   */
  private onQualityChanged(settings: QualitySettings): void {
    console.log(`OceanRenderer: Quality changed, updating resolution scaling`);

    // Trigger resize to update render resolutions
    this.resize();

    // Update sub-renderers
    if (this.wakeRenderer) {
      this.wakeRenderer.updateQualitySettings(settings);
    }

    if (this.glassRenderer) {
      this.glassRenderer.updateQualitySettings(settings);
    }

    if (this.textRenderer) {
      this.textRenderer.updateQualitySettings(settings);
    }
  }

  /**
   * Handle canvas resize with device pixel ratio consideration
   */
  private resize(): void {
    this.layoutTracker?.markDirty();

    const displayWidth = this.canvas.clientWidth;
    const displayHeight = this.canvas.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Store display resolution
    this.displayWidth = Math.round(displayWidth * devicePixelRatio);
    this.displayHeight = Math.round(displayHeight * devicePixelRatio);

    // Calculate render resolution based on quality settings
    let finalPassScale = this.currentQuality.finalPassResolution;

    // PERFORMANCE: Additional resolution scaling for 4K+ displays
    // At high DPI, rendering at lower resolution is imperceptible due to bilinear upscaling
    // This provides massive performance gains without visible quality loss
    const displayPixels = this.displayWidth * this.displayHeight;

    if (displayPixels > 6000000) {
      // 4K+ (>6M pixels): Cap at 0.5× max
      // With bilinear upscale, this is visually identical but 4× faster
      finalPassScale = Math.min(finalPassScale, 0.5);
    } else if (displayPixels > 3500000) {
      // 1440p-4K (3.5M-6M pixels): Cap at 0.66× max
      finalPassScale = Math.min(finalPassScale, 0.66);
    }

    this.renderWidth = Math.round(this.displayWidth * finalPassScale);
    this.renderHeight = Math.round(this.displayHeight * finalPassScale);

    // Update canvas to display resolution (for final upscale target)
    if (this.canvas.width !== this.displayWidth || this.canvas.height !== this.displayHeight) {
      this.canvas.width = this.displayWidth;
      this.canvas.height = this.displayHeight;

      console.log(`OceanRenderer: Display ${this.displayWidth}×${this.displayHeight}, Render ${this.renderWidth}×${this.renderHeight} (${(finalPassScale * 100).toFixed(0)}%)`);
    }

    // Update WebGL viewport to render resolution
    this.gl.viewport(0, 0, this.renderWidth, this.renderHeight);

    // Update projection matrix
    this.updateProjectionMatrix();

    // Resize upscale framebuffer to render resolution
    this.resizeUpscaleFramebuffer(this.renderWidth, this.renderHeight);

    // PERFORMANCE: Resize shared ocean buffer with ocean capture resolution
    const oceanCaptureScale = this.currentQuality.oceanCaptureResolution;
    const oceanCaptureWidth = Math.round(this.renderWidth * oceanCaptureScale);
    const oceanCaptureHeight = Math.round(this.renderHeight * oceanCaptureScale);
    this.resizeSharedOceanBuffer(oceanCaptureWidth, oceanCaptureHeight);

    // Resize wake renderer framebuffer
    if (this.wakeRenderer) {
      this.wakeRenderer.resizeFramebuffer(this.renderWidth, this.renderHeight);
    }

    // Resize glass renderer framebuffer with scaled resolution
    if (this.glassRenderer) {
      const glassScale = this.currentQuality.glassResolution;
      const glassWidth = Math.round(this.renderWidth * glassScale);
      const glassHeight = Math.round(this.renderHeight * glassScale);
      this.glassRenderer.resizeFramebuffer(glassWidth, glassHeight);
    }

    // Resize text renderer framebuffer with scaled resolution
    if (this.textRenderer) {
      const textScale = this.currentQuality.oceanCaptureResolution; // Scene capture resolution
      const textWidth = Math.round(this.renderWidth * textScale);
      const textHeight = Math.round(this.renderHeight * textScale);
      this.textRenderer.resizeFramebuffer(textWidth, textHeight);
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
   * Initialize wake renderer system
   */
  private initializeWakeRenderer(): void {
    try {
      this.wakeRenderer = new WakeRenderer(this.gl, this.shaderManager);
      this.wakeRenderer.updateQualitySettings(this.currentQuality);
      console.log('Wake renderer initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize wake renderer:', error);
      this.wakeRenderer = null;
    }
  }

  /**
   * Initialize glass renderer system
   */
  private initializeGlassRenderer(): void {
    try {
      this.glassRenderer = new GlassRenderer(this.gl, this.shaderManager);
      this.glassRenderer.setupDefaultPanels();
      this.glassRenderer.updateQualitySettings(this.currentQuality);
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
      this.textRenderer.updateQualitySettings(this.currentQuality);
      console.log('Text renderer initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text renderer:', error);
      this.textRenderer = null;
    }
  }

  /**
   * Initialize ocean shader program, wake shaders, glass shaders, text shaders, blur map shaders, and upscaling shaders
   */
  async initializeShaders(
    oceanVertexSource: string,
    oceanFragmentSource: string,
    wakeVertexSource?: string,
    wakeFragmentSource?: string,
    glassVertexSource?: string,
    glassFragmentSource?: string,
    textVertexSource?: string,
    textFragmentSource?: string,
    blurMapVertexSource?: string,
    blurMapFragmentSource?: string,
    upscaleVertexSource?: string,
    upscaleFragmentSource?: string
  ): Promise<void> {
    // Define uniforms and attributes for ocean shader
    const uniforms = [
      'u_time',
      'u_aspectRatio',
      'u_resolution',
      'u_debugMode',
      'u_wakeTexture',
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
    console.log('[DEBUG] OceanRenderer: Creating ocean shader program...');
    this.oceanProgram = this.shaderManager.createProgram(
      'ocean',
      oceanVertexSource,
      oceanFragmentSource,
      uniforms,
      attributes
    );
    console.log('[DEBUG] OceanRenderer: Ocean shader program created successfully!', !!this.oceanProgram);

    // Set up vertex attributes
    const positionLocation = this.oceanProgram.attributeLocations.get('a_position')!;
    const texcoordLocation = this.oceanProgram.attributeLocations.get('a_texcoord')!;

    this.bufferManager.setupAttributes(positionLocation, texcoordLocation);
    console.log('[DEBUG] OceanRenderer: Ocean shader attributes set up successfully');

    // Initialize wake shaders if provided
    if (wakeVertexSource && wakeFragmentSource && this.wakeRenderer) {
      try {
        await this.wakeRenderer.initializeShaders(wakeVertexSource, wakeFragmentSource);
        console.log('Wake shaders initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize wake shaders:', error);
      }
    }

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

    // Initialize upscaling shaders if provided
    if (upscaleVertexSource && upscaleFragmentSource) {
      try {
        const upscaleUniforms = [
          'u_sourceTexture',
          'u_sourceResolution',
          'u_targetResolution',
          'u_sharpness',
          'u_upscaleMethod'
        ];

        const upscaleAttributes = [
          'a_position',
          'a_uv'
        ];

        this.upscaleProgram = this.shaderManager.createProgram(
          'upscale',
          upscaleVertexSource,
          upscaleFragmentSource,
          upscaleUniforms,
          upscaleAttributes
        );

        // Set up vertex attributes for upscaling
        const positionLocation = this.upscaleProgram.attributeLocations.get('a_position')!;
        const uvLocation = this.upscaleProgram.attributeLocations.get('a_uv')!;
        this.upscaleBufferManager.setupAttributes(positionLocation, uvLocation);

        console.log('Upscaling shaders initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize upscaling shaders:', error);
      }
    }

    // Pre-warm all pipeline variants after all shaders are compiled
  }

  /**
   * Capture ocean to shared buffer
   * PERFORMANCE: Renders ocean once to shared buffer for glass/text sampling
   */
  private captureOceanToSharedBuffer(elapsedTime: number): void {
    const gl = this.gl;

    if (!this.sharedOceanFramebuffer || !this.sharedOceanTexture) {
      return;
    }

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind shared ocean framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharedOceanFramebuffer);

    // Set viewport to match shared ocean buffer size
    const oceanCaptureScale = this.currentQuality.oceanCaptureResolution;
    const oceanCaptureWidth = Math.round(this.renderWidth * oceanCaptureScale);
    const oceanCaptureHeight = Math.round(this.renderHeight * oceanCaptureScale);
    gl.viewport(0, 0, oceanCaptureWidth, oceanCaptureHeight);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render ocean scene to shared buffer
    this.drawOcean(elapsedTime);

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Restore viewport
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  }

  /**
   * Get shared ocean texture for glass/text sampling
   * PERFORMANCE: Allows glass and text to sample from single ocean render
   */
  public getSharedOceanTexture(): WebGLTexture | null {
    return this.sharedOceanTexture;
  }

  /**
   * Render ocean scene with glass and text overlay pipeline
   * Always runs the full pipeline each frame for consistent visuals
   */
  private renderOceanScene(elapsedTime: number): void {
    const gl = this.gl;

    // Get wake texture for text renderer glow distortion
    const wakeTexture = this.wakeRenderer?.getWakeTexture() || null;
    const textPresence = this.textRenderer ? this.textRenderer.getIntroVisibility() : 0.0;

    // Determine if we need upscaling
    const needsUpscale = this.currentQuality.finalPassResolution < 1.0 && this.upscaleProgram;

    // Bind upscale framebuffer if upscaling is needed
    if (needsUpscale) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscaleFramebuffer);
      gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    } else {
      // Ensure viewport is restored to full display size (critical after wake rendering)
      gl.viewport(0, 0, this.displayWidth, this.displayHeight);
    }

    // Update shared panel layout snapshot once per frame
    if (this.layoutTracker) {
      const snapshot = this.layoutTracker.getSnapshot(this.canvas);
      if (snapshot) {
        if (this.glassRenderer) {
          this.glassRenderer.applyPanelLayouts(snapshot);
        }
        if (this.textRenderer) {
          this.textRenderer.applyPanelLayouts(snapshot);
        }
      }
    }

    // Render ocean once to shared buffer for reuse by downstream passes
    this.captureOceanToSharedBuffer(elapsedTime);

    if (this.glassEnabled && this.glassRenderer) {
      this.glassRenderer.setOceanTexture(this.sharedOceanTexture);
      this.glassRenderer.setTextPresence(textPresence);
    }

    // Compose ocean + glass into upscale framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscaleFramebuffer);
    gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.compositeTexture(this.sharedOceanTexture);
    if (this.glassEnabled && this.glassRenderer) {
      this.glassRenderer.render();
    }

    if (this.textEnabled && this.textRenderer) {
      this.textRenderer.setSceneTexture(this.upscaleTexture);
    }

    // Prepare to draw to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.displayWidth, this.displayHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (needsUpscale) {
      this.applyUpscaling();
    } else {
      this.compositeTexture(this.upscaleTexture);
    }

    if (this.textEnabled && this.textRenderer) {
      this.textRenderer.render(wakeTexture, this.wakesEnabled);

      if (!this.frameBudget.shouldSkipOptionalWork() && this.glassRenderer) {
        const blurMapTexture = this.textRenderer.getBlurMapTexture();
        this.glassRenderer.setBlurMapTexture(blurMapTexture);
      }
    } else if (this.glassRenderer) {
      this.glassRenderer.setBlurMapTexture(null);
    }
  }

  /**
   * Apply upscaling from render resolution to display resolution
   */
  private applyUpscaling(): void {
    const gl = this.gl;

    if (!this.upscaleProgram || !this.upscaleTexture) {
      return;
    }

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.displayWidth, this.displayHeight);

    // Use upscale shader
    const program = this.shaderManager.useProgram('upscale');

    // Bind source texture (rendered scene at lower resolution)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.upscaleTexture);
    this.shaderManager.setUniform1i(program, 'u_sourceTexture', 0);

    // Set resolutions
    this.shaderManager.setUniform2f(program, 'u_sourceResolution', this.renderWidth, this.renderHeight);
    this.shaderManager.setUniform2f(program, 'u_targetResolution', this.displayWidth, this.displayHeight);

    // Set upscaling parameters from quality settings
    this.shaderManager.setUniform1f(program, 'u_sharpness', this.currentQuality.upscaleSharpness);

    // PERFORMANCE: Adaptive upscale method based on target resolution
    // FSR is excellent for large upscales (1080p→4K) but wasteful for small upscales at high res
    // Resolution-aware selection provides massive performance gains at 4K
    const targetPixels = this.displayWidth * this.displayHeight;
    let upscaleMethod: number;

    if (targetPixels > 6000000) {
      // 4K+ (>6M pixels): Use bilinear
      // At high DPI, bilinear vs FSR is imperceptible but 16× faster
      upscaleMethod = 0; // bilinear
    } else if (targetPixels > 2000000) {
      // 1440p-4K (2M-6M pixels): Use bicubic
      // Good quality/performance balance, 4× faster than FSR
      upscaleMethod = 1; // bicubic
    } else {
      // <1440p (<2M pixels): Use quality setting
      // FSR excels at small target resolutions
      const methodMap: Record<string, number> = {
        'bilinear': 0,
        'bicubic': 1,
        'fsr': 2,
        'lanczos': 3
      };
      upscaleMethod = methodMap[this.currentQuality.upscaleMethod] || 0;
    }

    this.shaderManager.setUniform1i(program, 'u_upscaleMethod', upscaleMethod);

    // Disable depth test for upscaling
    gl.disable(gl.DEPTH_TEST);

    // Render full-screen quad with upscaling
    this.upscaleBufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.upscaleGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Re-enable depth test
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * Composite a texture to the current framebuffer
   * PERFORMANCE: Reuses upscale shader for simple 1:1 texture blitting
   * This eliminates redundant ocean renders by compositing from shared buffer
   */
  private compositeTexture(texture: WebGLTexture | null): void {
    if (!texture || !this.upscaleProgram) {
      return;
    }

    const gl = this.gl;

    // Use upscale shader in bilinear mode (fastest, 1:1 composite)
    const program = this.shaderManager.useProgram('upscale');

    // Get current viewport dimensions
    const viewport = gl.getParameter(gl.VIEWPORT);
    const width = viewport[2];
    const height = viewport[3];

    // Bind source texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.shaderManager.setUniform1i(program, 'u_sourceTexture', 0);

    // Set 1:1 resolution (no actual scaling, just composite)
    this.shaderManager.setUniform2f(program, 'u_sourceResolution', width, height);
    this.shaderManager.setUniform2f(program, 'u_targetResolution', width, height);
    this.shaderManager.setUniform1f(program, 'u_sharpness', 0.0);
    this.shaderManager.setUniform1i(program, 'u_upscaleMethod', 0); // bilinear (fastest)

    // Disable depth test for compositing
    gl.disable(gl.DEPTH_TEST);

    // Render full-screen quad
    this.upscaleBufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.upscaleGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Re-enable depth test
    gl.enable(gl.DEPTH_TEST);
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

    // Bind wake texture
    if (this.wakeRenderer) {
      const wakeTexture = this.wakeRenderer.getWakeTexture();
      if (wakeTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, wakeTexture);
        this.shaderManager.setUniform1i(program, 'u_wakeTexture', 1);
      }
    }

    // Set wakes enabled only if changed
    if (this.wakesEnabled !== this.uniformCache.lastWakesEnabled) {
      this.shaderManager.setUniform1i(program, 'u_wakesEnabled', this.wakesEnabled ? 1 : 0);
      this.uniformCache.lastWakesEnabled = this.wakesEnabled;
    }

    // Disable integrated glass effects since we're using overlay approach
    this.shaderManager.setUniform1i(program, 'u_glassEnabled', 0);
    this.shaderManager.setUniform1i(program, 'u_glassPanelCount', 0);

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Render one frame
   */
  private render(): void {
    // DEBUG: Check if oceanProgram is initialized
    if (!this.oceanProgram) {
      console.error('[DEBUG] OceanRenderer.render(): oceanProgram is NULL! Render loop exiting early.');
      return;
    }

    // Begin performance monitoring
    this.performanceMonitor.beginFrame();
    this.frameBudget.beginFrame();

    const currentTime = performance.now();
    const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds
    const deltaTime = 1 / 60; // Approximate 60 FPS for vessel updates

    // Update vessel system
    this.vesselSystem.update(currentTime, deltaTime);

    // Render wake texture FIRST (if wakes are enabled)
    if (this.wakesEnabled && this.wakeRenderer) {
      const vesselData = this.vesselSystem.getVesselDataForShader(5, currentTime);
      this.wakeRenderer.render(vesselData, elapsedTime);
    }

    // Render ocean scene with integrated glass distortion and per-pixel adaptive text
    this.renderOceanScene(elapsedTime);

    // CRITICAL: First-frame callback for smooth CSS→WebGL transition
    // After first successful render, we can safely remove CSS backdrop-filter
    if (!this.firstFrameRendered && this.onFirstFrameCallback) {
      this.firstFrameRendered = true;
      this.onFirstFrameCallback();
      this.onFirstFrameCallback = null; // Clear callback after use
      console.log('OceanRenderer: First frame rendered, CSS→WebGL transition complete');
    }

    // Process any deferred work before ending frame
    this.frameBudget.processDeferredWork();

    // End performance monitoring
    this.performanceMonitor.endFrame();
    this.frameBudget.endFrame();

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

    console.log('[DEBUG] OceanRenderer.start(): Starting render loop, oceanProgram exists:', !!this.oceanProgram);

    this.isRunning = true;
    this.startTime = performance.now();
    this.lastFpsUpdate = this.startTime;

    const renderLoop = () => {
      if (!this.isRunning) return;

      this.render();
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    console.log('[DEBUG] OceanRenderer.start(): Render loop started successfully');
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
    if (this.wakeRenderer) {
      this.wakeRenderer.setEnabled(this.wakesEnabled);
    }
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
   * Set blur radius (controls frost spread distance)
   */
  setBlurRadius(radius: number): void {
    if (this.textRenderer) {
      this.textRenderer.setBlurRadius(radius);
    }
  }

  /**
   * Get current blur radius
   */
  getBlurRadius(): number {
    return this.textRenderer?.getBlurRadius() ?? 60.0;
  }

  /**
   * Set blur falloff power (controls frost fade sharpness)
   */
  setBlurFalloffPower(power: number): void {
    if (this.textRenderer) {
      this.textRenderer.setBlurFalloffPower(power);
    }
  }

  /**
   * Get current blur falloff power
   */
  getBlurFalloffPower(): number {
    return this.textRenderer?.getBlurFalloffPower() ?? 2.5;
  }

  /**
   * Get quality manager instance
   */
  getQualityManager(): QualityManager {
    return this.qualityManager;
  }

  /**
   * Get performance monitor instance
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor;
  }

  /**
   * Get frame budget manager instance
   */
  getFrameBudgetManager(): FrameBudgetManager {
    return this.frameBudget;
  }

  /**
   * Get frame budget statistics
   */
  getFrameBudgetStats() {
    return this.frameBudget.getStats();
  }

  /**
   * Get frame budget report
   */
  getFrameBudgetReport(): string {
    return this.frameBudget.generateReport();
  }

  /**
   * Get current quality settings
   */
  getQualitySettings(): QualitySettings {
    return this.currentQuality;
  }

  /**
   * Set quality preset
   */
  setQualityPreset(preset: 'ultra' | 'high' | 'medium' | 'low' | 'potato' | 'custom'): void {
    this.qualityManager.setPreset(preset);
  }

  /**
   * Enable/disable dynamic quality scaling
   */
  setDynamicQuality(enabled: boolean): void {
    this.performanceMonitor.setDynamicQuality(enabled);
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): string {
    return this.performanceMonitor.generateReport();
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
   * Set callback to be invoked after first frame renders
   * Used for smooth CSS→WebGL transition
   */
  public setOnFirstFrameCallback(callback: () => void): void {
    this.onFirstFrameCallback = callback;
  }


  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.bufferManager.dispose();
    this.upscaleBufferManager.dispose();
    this.shaderManager.dispose();

    const gl = this.gl;

    // Clean up upscale framebuffer
    if (this.upscaleFramebuffer) {
      gl.deleteFramebuffer(this.upscaleFramebuffer);
      this.upscaleFramebuffer = null;
    }

    if (this.upscaleTexture) {
      gl.deleteTexture(this.upscaleTexture);
      this.upscaleTexture = null;
    }

    if (this.upscaleDepthBuffer) {
      gl.deleteRenderbuffer(this.upscaleDepthBuffer);
      this.upscaleDepthBuffer = null;
    }

    // Clean up shared ocean buffer
    if (this.sharedOceanFramebuffer) {
      gl.deleteFramebuffer(this.sharedOceanFramebuffer);
      this.sharedOceanFramebuffer = null;
    }

    if (this.sharedOceanTexture) {
      gl.deleteTexture(this.sharedOceanTexture);
      this.sharedOceanTexture = null;
    }

    if (this.sharedOceanDepthBuffer) {
      gl.deleteRenderbuffer(this.sharedOceanDepthBuffer);
      this.sharedOceanDepthBuffer = null;
    }

    // Clean up wake renderer
    if (this.wakeRenderer) {
      this.wakeRenderer.dispose();
      this.wakeRenderer = null;
    }

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

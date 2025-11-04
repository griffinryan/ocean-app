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
import { PerformanceMonitor } from '../utils/PerformanceMonitor';
import { FrameBudgetManager, WorkPriority } from '../utils/FrameBudget';
import { PipelineManager } from './PipelineManager';

const FINAL_PASS_BASE_SCALE = 1.0;
const OCEAN_CAPTURE_SCALE = 1.0;
const GLASS_CAPTURE_SCALE = 1.0;
const TEXT_CAPTURE_SCALE = 1.0;
const UPSCALE_SHARPNESS = 0.0;
const UPSCALE_METHOD_BILINEAR = 0;

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

  // Performance management
  private performanceMonitor: PerformanceMonitor;
  private frameBudget: FrameBudgetManager;
  private pipelineManager: PipelineManager;
  private renderScale: number = FINAL_PASS_BASE_SCALE;

  // Upscaling system
  private upscaleFramebuffer: WebGLFramebuffer | null = null;
  private upscaleTexture: WebGLTexture | null = null;
  private upscaleDepthBuffer: WebGLRenderbuffer | null = null;
  private upscaleProgram: ShaderProgram | null = null;
  private upscaleGeometry: GeometryData;
  private upscaleBufferManager: BufferManager;
  private upscaleWidth: number = 1;
  private upscaleHeight: number = 1;

  // PERFORMANCE: Shared ocean buffer - render ocean once, sample multiple times
  // This eliminates redundant ocean draws (3x per frame → 1x per frame)
  private sharedOceanFramebuffer: WebGLFramebuffer | null = null;
  private sharedOceanTexture: WebGLTexture | null = null;
  private sharedOceanDepthBuffer: WebGLRenderbuffer | null = null;
  private sharedOceanWidth: number = 1;
  private sharedOceanHeight: number = 1;

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

  // Fallback logging guard
  private loggedUpscaleFallback: boolean = false;

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

    // Initialize performance systems
    this.performanceMonitor = new PerformanceMonitor();
    this.frameBudget = new FrameBudgetManager();
    this.pipelineManager = new PipelineManager();

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

    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    if (safeWidth !== width || safeHeight !== height) {
      console.warn(`OceanRenderer: Clamping shared ocean buffer from ${width}×${height} to ${safeWidth}×${safeHeight}`);
    }

    this.sharedOceanWidth = safeWidth;
    this.sharedOceanHeight = safeHeight;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharedOceanFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.sharedOceanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, safeWidth, safeHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sharedOceanTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sharedOceanDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, safeWidth, safeHeight);
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

    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    if (safeWidth !== width || safeHeight !== height) {
      console.warn(`OceanRenderer: Clamping upscale framebuffer from ${width}×${height} to ${safeWidth}×${safeHeight}`);
    }

    this.upscaleWidth = safeWidth;
    this.upscaleHeight = safeHeight;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscaleFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.upscaleTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, safeWidth, safeHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.upscaleTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.upscaleDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, safeWidth, safeHeight);
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
   * Handle canvas resize with device pixel ratio consideration
   */
  private resize(): void {
    const displayWidth = this.canvas.clientWidth;
    const displayHeight = this.canvas.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Store display resolution
    this.displayWidth = Math.max(1, Math.round(displayWidth * devicePixelRatio));
    this.displayHeight = Math.max(1, Math.round(displayHeight * devicePixelRatio));

    // Calculate render resolution based on global settings
    let finalPassScale = FINAL_PASS_BASE_SCALE;

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

    this.renderWidth = Math.max(1, Math.round(this.displayWidth * finalPassScale));
    this.renderHeight = Math.max(1, Math.round(this.displayHeight * finalPassScale));
    this.renderScale = finalPassScale;

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
    const oceanCaptureScale = OCEAN_CAPTURE_SCALE;
    const oceanCaptureWidth = Math.max(1, Math.round(this.renderWidth * oceanCaptureScale));
    const oceanCaptureHeight = Math.max(1, Math.round(this.renderHeight * oceanCaptureScale));
    this.resizeSharedOceanBuffer(oceanCaptureWidth, oceanCaptureHeight);

    // Resize wake renderer framebuffer
    if (this.wakeRenderer) {
      this.wakeRenderer.resizeFramebuffer(this.renderWidth, this.renderHeight);
    }

    // Resize glass renderer framebuffer with scaled resolution
    if (this.glassRenderer) {
      const glassScale = GLASS_CAPTURE_SCALE;
      const glassWidth = Math.max(1, Math.round(this.renderWidth * glassScale));
      const glassHeight = Math.max(1, Math.round(this.renderHeight * glassScale));
      this.glassRenderer.resizeFramebuffer(glassWidth, glassHeight);
    }

    // Resize text renderer framebuffer with scaled resolution
    if (this.textRenderer) {
      const textScale = TEXT_CAPTURE_SCALE; // Scene capture resolution
      const textWidth = Math.max(1, Math.round(this.renderWidth * textScale));
      const textHeight = Math.max(1, Math.round(this.renderHeight * textScale));
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
    await this.pipelineManager.preWarmAllVariants();
    console.log('OceanRenderer: All pipeline variants pre-warmed');
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
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    // Bind shared ocean framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharedOceanFramebuffer);

    // Set viewport to match shared ocean buffer size
    gl.viewport(0, 0, this.sharedOceanWidth, this.sharedOceanHeight);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render ocean scene to shared buffer
    this.drawOcean(elapsedTime);

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);

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
   * OPTIMIZED: Skips expensive captures during text transitions
   */
  private renderOceanScene(elapsedTime: number): void {
    const gl = this.gl;

    // Get wake texture for text renderer glow distortion
    const wakeTexture = this.wakeRenderer?.getWakeTexture() || null;

    // Check if text is transitioning (blocks expensive multi-pass rendering)
    const isTransitioning = this.textRenderer?.isTransitioning() || false;
    const textPresence = this.textRenderer ? this.textRenderer.getIntroVisibility() : 0.0;

    // Determine if we need upscaling
    const needsUpscale = this.renderScale < 1.0 && this.upscaleProgram;

    // Bind upscale framebuffer if upscaling is needed
    if (needsUpscale) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscaleFramebuffer);
      gl.viewport(0, 0, this.upscaleWidth, this.upscaleHeight);
    } else {
      // Ensure viewport is restored to full display size (critical after wake rendering)
      gl.viewport(0, 0, this.displayWidth, this.displayHeight);
    }

    // PERFORMANCE OPTIMIZATION: Lightweight rendering during text transitions
    // Reduces 3 ocean draws to 1, skips glass/text captures
    if (isTransitioning) {
      // During CSS transitions we still want glass distortion active for visual continuity,
      // but we keep text disabled until positions settle.
      if (this.glassEnabled && this.glassRenderer) {
        // Render ocean once to shared buffer and composite with glass
        this.captureOceanToSharedBuffer(elapsedTime);
        this.glassRenderer.setOceanTexture(this.sharedOceanTexture, this.sharedOceanWidth, this.sharedOceanHeight);
        this.glassRenderer.setTextPresence(textPresence);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.compositeTexture(this.sharedOceanTexture, elapsedTime);
        this.glassRenderer.render();
      } else {
        // Fall back to simple ocean render (no glass configured)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
      }

      if (needsUpscale) {
        this.applyUpscaling();
      }
      return;
    }

    // MAJOR PERFORMANCE OPTIMIZATION: Shared Ocean Buffer Pipeline
    // Renders ocean ONCE to shared buffer, then samples it multiple times
    // Reduces 3 ocean draws per frame → 1 ocean draw (~30-40% speedup)

    if (this.textEnabled && this.textRenderer) {
      // Full pipeline: Ocean -> Glass -> Text Color Analysis

      if (this.glassEnabled && this.glassRenderer) {
        // 1. Render ocean ONCE to shared buffer (CRITICAL - always do)
        this.captureOceanToSharedBuffer(elapsedTime);

        // 2. Glass uses shared ocean texture (no capture needed)
        this.glassRenderer.setOceanTexture(this.sharedOceanTexture, this.sharedOceanWidth, this.sharedOceanHeight);
        this.glassRenderer.setTextPresence(textPresence);

        // 3. Text captures glass overlay (MEDIUM priority - skip if tight on budget)
        const canAffordTextCapture = this.frameBudget.canAfford(2.0, WorkPriority.MEDIUM);
        if (canAffordTextCapture) {
          this.textRenderer.captureScene(() => {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            this.compositeTexture(this.sharedOceanTexture, elapsedTime); // Composite instead of re-render
            this.glassRenderer!.render();
          });
        }

        // 4. Pass blur map from TextRenderer to GlassRenderer so buttons retain WebGL clarity
        const blurMapTexture = this.textRenderer.getBlurMapTexture();
        this.glassRenderer.setBlurMapTexture(blurMapTexture);

        // 5. Final render: Ocean (composited from shared buffer, NO re-render!) + Glass + Text (CRITICAL - always do)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.compositeTexture(this.sharedOceanTexture, elapsedTime); // Composite instead of re-render
        this.glassRenderer.render();
        this.textRenderer.render(wakeTexture, this.wakesEnabled);
      } else {
        // Ocean + Text pipeline (no glass)

        // 1. Render ocean ONCE to shared buffer (CRITICAL - always do)
        this.captureOceanToSharedBuffer(elapsedTime);

        // 2. Text captures ocean from shared buffer (MEDIUM priority - skip if tight)
        const canAffordTextCapture = this.frameBudget.canAfford(2.0, WorkPriority.MEDIUM);
        if (canAffordTextCapture) {
          this.textRenderer.captureScene(() => {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            this.compositeTexture(this.sharedOceanTexture, elapsedTime); // Composite instead of re-render
          });
        }

        // 3. Final render: Ocean (composited from shared buffer, NO re-render!) + Text (CRITICAL - always do)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.compositeTexture(this.sharedOceanTexture, elapsedTime); // Composite instead of re-render
        this.textRenderer.render(wakeTexture, this.wakesEnabled);
      }
    } else if (this.glassEnabled && this.glassRenderer) {
      // Glass pipeline only (no text)

      // 1. Render ocean ONCE to shared buffer (CRITICAL - always do)
      this.captureOceanToSharedBuffer(elapsedTime);

      // 2. Glass uses shared ocean texture (no capture needed)
      this.glassRenderer.setOceanTexture(this.sharedOceanTexture, this.sharedOceanWidth, this.sharedOceanHeight);
      this.glassRenderer.setTextPresence(textPresence);

      // 3. Final render: Ocean (composited from shared buffer, CONSISTENT!) + Glass (HIGH priority - always do unless desperate)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.compositeTexture(this.sharedOceanTexture, elapsedTime); // Use shared buffer (not drawOcean)
      if (this.frameBudget.canAfford(1.5, WorkPriority.HIGH)) {
        this.glassRenderer.render();
      }
    } else {
      // Basic ocean rendering only (CRITICAL - always do)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);
    }

    // Apply upscaling if needed
    if (needsUpscale) {
      this.applyUpscaling();
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

    const sourceWidth = Math.max(1, this.upscaleWidth);
    const sourceHeight = Math.max(1, this.upscaleHeight);

    // Set resolutions
    this.shaderManager.setUniform2f(program, 'u_sourceResolution', sourceWidth, sourceHeight);
    this.shaderManager.setUniform2f(program, 'u_targetResolution', this.displayWidth, this.displayHeight);

    // Set upscaling parameters for the single-pass bilinear upscale
    this.shaderManager.setUniform1f(program, 'u_sharpness', UPSCALE_SHARPNESS);
    this.shaderManager.setUniform1i(program, 'u_upscaleMethod', UPSCALE_METHOD_BILINEAR);

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
  private compositeTexture(texture: WebGLTexture | null, elapsedTime: number): void {
    if (!texture) {
      this.drawOcean(elapsedTime);
      return;
    }

    if (!this.upscaleProgram) {
      if (!this.loggedUpscaleFallback) {
        console.warn('OceanRenderer: Upscale shader unavailable, falling back to direct ocean rendering');
        this.loggedUpscaleFallback = true;
      }
      this.drawOcean(elapsedTime);
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

    // Update pipeline manager
    this.pipelineManager.toggleFeature('wakes');
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

    // Update pipeline manager
    this.pipelineManager.switchToState({ glass: this.glassEnabled });
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

    // Update pipeline manager
    this.pipelineManager.switchToState({ text: this.textEnabled });
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

    // Update pipeline manager
    this.pipelineManager.switchToState({ blurMap: enabled });
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
   * Get pipeline manager instance
   */
  getPipelineManager(): PipelineManager {
    return this.pipelineManager;
  }

  /**
   * Get pipeline manager report
   */
  getPipelineReport(): string {
    return this.pipelineManager.generateReport();
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

/**
 * Main ocean renderer class that manages WebGL rendering
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';
import { VesselSystem, VesselConfig } from './VesselSystem';
import { GlassRenderer } from './GlassRenderer';
import { TextContrastAnalyzer } from './TextContrastAnalyzer';
import { TextRenderLayer } from './TextRenderLayer';

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

  // Text contrast analyzer (legacy)
  private textAnalyzer: TextContrastAnalyzer | null = null;
  private textAnalyzerEnabled: boolean = false;

  // New per-pixel text rendering system
  private textRenderLayer: TextRenderLayer | null = null;
  private textCompositeProgram: ShaderProgram | null = null;
  private textRenderEnabled: boolean = false;
  private textDebugMode: number = 0; // 0=off, 1=text, 2=ocean, 3=analysis

  // Independent ocean texture capture for text system
  private textOceanFramebuffer: WebGLFramebuffer | null = null;
  private textOceanTexture: WebGLTexture | null = null;
  private textOceanDepthBuffer: WebGLRenderbuffer | null = null;

  // Debug logging control
  private hasLoggedTextRenderFailure: boolean = false;

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

    // Initialize text contrast analyzer
    this.initializeTextAnalyzer();

    // Initialize new text render layer
    this.initializeTextRenderLayer();

    // Initialize text ocean capture system
    this.initializeTextOceanCapture();
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

      // Resize text ocean capture framebuffer
      this.resizeTextOceanCapture(canvasWidth, canvasHeight);
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
   * Initialize text contrast analyzer system (legacy)
   */
  private initializeTextAnalyzer(): void {
    try {
      this.textAnalyzer = new TextContrastAnalyzer(
        this.gl,
        this.shaderManager,
        this.canvas,
        {
          updateFrequency: 12, // 12 Hz for smooth text updates
          samplingPoints: 9,   // 3x3 sampling grid
          contrastThreshold: 7.0, // WCAG AAA compliance
          smoothingFactor: 0.7,   // Smooth color transitions
          glassAwareMode: true    // Consider glass panels in analysis
        }
      );
      console.log('Text contrast analyzer (legacy) initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text contrast analyzer:', error);
      this.textAnalyzer = null;
    }
  }

  /**
   * Initialize new per-pixel text render layer
   */
  private initializeTextRenderLayer(): void {
    console.log('[INIT DEBUG] Starting TextRenderLayer initialization...');
    console.log('[INIT DEBUG] WebGL context available:', !!this.gl);
    console.log('[INIT DEBUG] Canvas available:', !!this.canvas);

    try {
      console.log('[INIT DEBUG] Creating TextRenderLayer...');
      this.textRenderLayer = new TextRenderLayer(
        this.gl,
        this.canvas,
        {
          enableHighDPI: true,
          updateFrequency: 15, // 15 Hz for text texture updates
          debugMode: false,    // Can be toggled later
          fontScaling: 2.0     // 2x scaling for crisp text
        }
      );
      console.log('[INIT DEBUG] ✓ TextRenderLayer created successfully!');
      console.log('[INIT DEBUG] TextRenderLayer instance:', !!this.textRenderLayer);
    } catch (error) {
      console.error('[INIT DEBUG] ✗ Failed to initialize text render layer:', error);
      this.textRenderLayer = null;
    }
  }

  /**
   * Initialize independent ocean texture capture for text system
   */
  private initializeTextOceanCapture(): void {
    try {
      const gl = this.gl;

      // Create framebuffer
      this.textOceanFramebuffer = gl.createFramebuffer();
      if (!this.textOceanFramebuffer) {
        throw new Error('Failed to create text ocean framebuffer');
      }

      // Create texture for ocean capture
      this.textOceanTexture = gl.createTexture();
      if (!this.textOceanTexture) {
        throw new Error('Failed to create text ocean texture');
      }

      // Create depth buffer
      this.textOceanDepthBuffer = gl.createRenderbuffer();
      if (!this.textOceanDepthBuffer) {
        throw new Error('Failed to create text ocean depth buffer');
      }

      // Setup will be completed in resize method
      this.resizeTextOceanCapture(gl.canvas.width, gl.canvas.height);

      console.log('Text ocean capture system initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text ocean capture:', error);
      this.textOceanFramebuffer = null;
      this.textOceanTexture = null;
      this.textOceanDepthBuffer = null;
    }
  }

  /**
   * Resize text ocean capture framebuffer
   */
  private resizeTextOceanCapture(width: number, height: number): void {
    const gl = this.gl;

    if (!this.textOceanFramebuffer || !this.textOceanTexture || !this.textOceanDepthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.textOceanFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.textOceanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textOceanTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.textOceanDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.textOceanDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Text ocean framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  /**
   * Initialize ocean shader program and glass shaders
   */
  async initializeShaders(
    oceanVertexSource: string,
    oceanFragmentSource: string,
    glassVertexSource?: string,
    glassFragmentSource?: string,
    textSamplingVertexSource?: string,
    textSamplingFragmentSource?: string,
    textCompositeVertexSource?: string,
    textCompositeFragmentSource?: string
  ): Promise<void> {
    // CRITICAL: Early validation for undefined shaders
    console.log('[SHADER INIT] Starting shader initialization with parameters:');
    console.log('[SHADER INIT] - oceanVertexSource exists:', !!oceanVertexSource, 'length:', oceanVertexSource?.length || 0);
    console.log('[SHADER INIT] - oceanFragmentSource exists:', !!oceanFragmentSource, 'length:', oceanFragmentSource?.length || 0);
    console.log('[SHADER INIT] - textCompositeVertexSource exists:', !!textCompositeVertexSource, 'length:', textCompositeVertexSource?.length || 0);
    console.log('[SHADER INIT] - textCompositeFragmentSource exists:', !!textCompositeFragmentSource, 'length:', textCompositeFragmentSource?.length || 0);

    if (!textCompositeVertexSource || !textCompositeFragmentSource) {
      console.error('[SHADER INIT] CRITICAL: Text composite shaders are undefined!');
      console.error('[SHADER INIT] This indicates a fundamental import issue.');
      console.error('[SHADER INIT] Text rendering will be disabled.');
    } else if (textCompositeVertexSource.length < 50 || textCompositeFragmentSource.length < 50) {
      console.error('[SHADER INIT] CRITICAL: Text composite shaders are too short - may be empty!');
      console.error('[SHADER INIT] Vertex shader length:', textCompositeVertexSource.length);
      console.error('[SHADER INIT] Fragment shader length:', textCompositeFragmentSource.length);
    }
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

    // Initialize text sampling shaders if provided (legacy)
    if (textSamplingVertexSource && textSamplingFragmentSource && this.textAnalyzer) {
      try {
        await this.textAnalyzer.initializeShader(textSamplingVertexSource, textSamplingFragmentSource);
        this.textAnalyzerEnabled = true;
        console.log('Text sampling shaders (legacy) initialized successfully!');
      } catch (error) {
        console.error('Failed to initialize text sampling shaders:', error);
        this.textAnalyzerEnabled = false;
      }
    }

    // Initialize text composite shaders for new per-pixel system
    console.log('[INIT DEBUG] Checking text composite shader sources...');
    console.log('[INIT DEBUG] textCompositeVertexSource type:', typeof textCompositeVertexSource);
    console.log('[INIT DEBUG] textCompositeVertexSource truthy:', !!textCompositeVertexSource);
    console.log('[INIT DEBUG] textCompositeVertexSource length:', textCompositeVertexSource?.length || 0);
    console.log('[INIT DEBUG] textCompositeVertexSource preview:', textCompositeVertexSource?.substring(0, 50) || 'UNDEFINED');
    console.log('[INIT DEBUG] textCompositeVertexSource is valid GLSL?:', textCompositeVertexSource?.includes('#version') || false);
    console.log('[INIT DEBUG] textCompositeFragmentSource type:', typeof textCompositeFragmentSource);
    console.log('[INIT DEBUG] textCompositeFragmentSource truthy:', !!textCompositeFragmentSource);
    console.log('[INIT DEBUG] textCompositeFragmentSource length:', textCompositeFragmentSource?.length || 0);
    console.log('[INIT DEBUG] textCompositeFragmentSource preview:', textCompositeFragmentSource?.substring(0, 50) || 'UNDEFINED');
    console.log('[INIT DEBUG] textCompositeFragmentSource is valid GLSL?:', textCompositeFragmentSource?.includes('#version') || false);

    if (textCompositeVertexSource && textCompositeFragmentSource) {
      console.log('[INIT DEBUG] Text composite shader sources are available, proceeding with compilation...');
      try {
        // Define uniforms and attributes for text compositing
        const textUniforms = [
          'u_projectionMatrix',
          'u_viewMatrix',
          'u_textTexture',
          'u_oceanTexture',
          'u_resolution',
          'u_time',
          'u_contrastThreshold',
          'u_transitionWidth',
          'u_debugMode'
        ];

        const textAttributes = [
          'a_position',
          'a_texcoord'
        ];

        console.log('[INIT DEBUG] Creating text composite shader program...');
        // Create text composite shader program
        this.textCompositeProgram = this.shaderManager.createProgram(
          'textComposite',
          textCompositeVertexSource,
          textCompositeFragmentSource,
          textUniforms,
          textAttributes
        );

        console.log('[INIT DEBUG] ✓ Text composite shader program created:', !!this.textCompositeProgram);
        this.textRenderEnabled = true;
        console.log('[INIT DEBUG] ✓ Text render enabled set to true');
        console.log('Text composite shaders initialized successfully!');
      } catch (error) {
        console.error('[INIT DEBUG] ✗ Failed to initialize text composite shaders!');
        console.error('[INIT DEBUG] Error details:', error);
        if (error instanceof Error) {
          console.error('[INIT DEBUG] Error message:', error.message);
          console.error('[INIT DEBUG] Error stack:', error.stack);
        }
        console.error('[INIT DEBUG] This indicates a shader compilation or linking error.');
        console.error('[INIT DEBUG] Check the shader source files for syntax errors.');
        this.textRenderEnabled = false;
        this.textCompositeProgram = null;
      }
    } else {
      console.error('[INIT DEBUG] ✗ Text composite shader sources are missing or invalid!');
      console.error('[INIT DEBUG] - Vertex source:', textCompositeVertexSource ? 'Available' : 'MISSING');
      console.error('[INIT DEBUG] - Fragment source:', textCompositeFragmentSource ? 'Available' : 'MISSING');
      this.textRenderEnabled = false;
      this.textCompositeProgram = null;
    }
  }

  /**
   * Render ocean scene with glass overlay and adaptive text pipeline
   */
  private renderOceanScene(elapsedTime: number): void {
    const gl = this.gl;

    if (this.glassEnabled && this.glassRenderer) {
      // Render ocean to texture for glass distortion and text analysis
      this.glassRenderer.captureOceanScene(() => {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
      });

      // Clear screen and render ocean without glass effects
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);

      // Render glass panels as overlay
      this.glassRenderer.render();

      // Render adaptive text overlay using the captured ocean texture
      if (this.isTextSystemReady()) {
        this.renderAdaptiveText(elapsedTime);
      }
    } else {
      // Normal rendering without glass effects
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);

      // For adaptive text without glass, we need to capture the current framebuffer
      // This is a simplified approach - in production you might want a separate capture
      if (this.isTextSystemReady()) {
        this.renderAdaptiveText(elapsedTime);
      }
    }
  }

  /**
   * Capture ocean scene to independent texture for text analysis
   */
  private captureOceanForText(elapsedTime: number): void {
    if (!this.textOceanFramebuffer || !this.textOceanTexture) {
      return;
    }

    const gl = this.gl;

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind text ocean framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.textOceanFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Clear and render ocean to texture
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawOcean(elapsedTime);

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  }

  /**
   * Render adaptive text overlay with per-pixel coloring
   */
  private renderAdaptiveText(elapsedTime: number): void {
    // Only log text render failure once to prevent spam
    if (!this.textRenderEnabled || !this.textRenderLayer || !this.textCompositeProgram) {
      if (!this.hasLoggedTextRenderFailure) {
        console.log(`[TEXT DEBUG] renderAdaptiveText() early return - missing components:`);
        console.log(`[TEXT DEBUG] - enabled: ${this.textRenderEnabled}, layer: ${!!this.textRenderLayer}, program: ${!!this.textCompositeProgram}`);
        this.hasLoggedTextRenderFailure = true;
      }
      return;
    }

    const gl = this.gl;

    // Update text layer
    console.log(`[TEXT DEBUG] Calling textRenderLayer.update()...`);
    this.textRenderLayer.update();

    // Get text texture
    const textTexture = this.textRenderLayer.getTextTexture();
    if (!textTexture) {
      console.warn('[TEXT DEBUG] No text texture available for rendering');
      return;
    }
    console.log(`[TEXT DEBUG] ✓ Text texture available`);

    const textureDimensions = this.textRenderLayer.getTextureDimensions();
    console.log(`[TEXT DEBUG] Text texture dimensions: ${textureDimensions.width}x${textureDimensions.height}`);

    // Get ocean texture for background analysis
    let oceanTexture: WebGLTexture | null = null;

    // First try to use glass renderer's ocean texture (if available)
    if (this.glassRenderer) {
      oceanTexture = this.glassRenderer.getOceanTexture();
      console.log(`[TEXT DEBUG] Glass renderer ocean texture: ${!!oceanTexture}`);
    }

    // If no glass renderer texture, use our independent capture
    if (!oceanTexture && this.textOceanTexture) {
      console.log(`[TEXT DEBUG] Using independent ocean texture capture...`);
      this.captureOceanForText(elapsedTime);
      oceanTexture = this.textOceanTexture;
      console.log(`[TEXT DEBUG] Independent ocean texture: ${!!oceanTexture}`);
    }

    // If still no ocean texture, skip rendering
    if (!oceanTexture) {
      console.warn('[TEXT DEBUG] No ocean texture available for text rendering');
      return;
    }

    // Use text composite shader
    console.log(`[TEXT DEBUG] Using text composite shader program...`);
    const program = this.shaderManager.useProgram('textComposite');
    console.log(`[TEXT DEBUG] Shader program: ${!!program}`);

    console.log(`[TEXT DEBUG] Setting shader uniforms - debugMode: ${this.textDebugMode}`);

    // Set matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time and resolution
    this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);
    this.shaderManager.setUniform2f(program, 'u_resolution', this.canvas.width, this.canvas.height);

    // Set contrast parameters
    this.shaderManager.setUniform1f(program, 'u_contrastThreshold', 0.5); // Adjust based on preference
    this.shaderManager.setUniform1f(program, 'u_transitionWidth', 0.2);   // Smoothness of transitions

    // Set debug mode
    this.shaderManager.setUniform1i(program, 'u_debugMode', this.textDebugMode);

    // Bind text texture
    console.log(`[TEXT DEBUG] Binding text texture to unit 0...`);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    this.shaderManager.setUniform1i(program, 'u_textTexture', 0);

    // Bind ocean texture
    console.log(`[TEXT DEBUG] Binding ocean texture to unit 1...`);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 1);

    // Set up blending for text overlay
    console.log(`[TEXT DEBUG] Setting up blending and depth state...`);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable depth testing for text overlay
    const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);

    // Render full-screen quad with text composite shader
    console.log(`[TEXT DEBUG] Executing draw call - ${this.geometry.indexCount} indices...`);
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Check for GL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error(`[TEXT DEBUG] WebGL error after draw call: ${error}`);
    } else {
      console.log(`[TEXT DEBUG] ✓ Draw call successful`);
    }

    // Restore depth testing state
    if (depthTestEnabled) {
      gl.enable(gl.DEPTH_TEST);
    }

    // Cleanup texture bindings
    console.log(`[TEXT DEBUG] Cleaning up texture bindings...`);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    console.log(`[TEXT DEBUG] renderAdaptiveText() complete`);
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

    // Set vessel wake uniforms
    const vesselData = this.vesselSystem.getVesselDataForShader(5, performance.now());

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

    // Update text contrast analyzer if enabled
    if (this.textAnalyzerEnabled && this.textAnalyzer && this.glassRenderer) {
      const oceanTexture = this.glassRenderer.getOceanTexture();
      if (oceanTexture) {
        this.textAnalyzer.update(oceanTexture);
      }
    }

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
   * Enable/disable text contrast analyzer
   */
  setTextAnalyzerEnabled(enabled: boolean): void {
    this.textAnalyzerEnabled = enabled && this.textAnalyzer !== null;
    if (this.textAnalyzer) {
      if (enabled) {
        this.textAnalyzer.start();
      } else {
        this.textAnalyzer.stop();
      }
    }
  }

  /**
   * Get text analyzer enabled state
   */
  getTextAnalyzerEnabled(): boolean {
    return this.textAnalyzerEnabled;
  }

  /**
   * Register a text element for adaptive coloring
   */
  registerTextElement(id: string, element: HTMLElement): void {
    if (this.textAnalyzer) {
      this.textAnalyzer.registerTextElement(id, element);
    }
  }

  /**
   * Unregister a text element
   */
  unregisterTextElement(id: string): void {
    if (this.textAnalyzer) {
      this.textAnalyzer.unregisterTextElement(id);
    }
  }

  /**
   * Update text element bounds (call on resize or layout changes)
   */
  updateTextElementBounds(id: string): void {
    if (this.textAnalyzer) {
      this.textAnalyzer.updateElementBounds(id);
    }
  }

  /**
   * Get text contrast analyzer instance for external control
   */
  getTextAnalyzer(): TextContrastAnalyzer | null {
    return this.textAnalyzer;
  }

  /**
   * Get text analyzer performance metrics (legacy)
   */
  getTextAnalyzerMetrics(): {
    elementCount: number;
    lastAnalysisTime: number;
    updateFrequency: number;
    isRunning: boolean;
  } | null {
    return this.textAnalyzer ? this.textAnalyzer.getPerformanceMetrics() : null;
  }

  /**
   * Enable/disable new per-pixel text rendering system
   */
  setTextRenderEnabled(enabled: boolean): void {
    console.log('[INIT DEBUG] setTextRenderEnabled called with:', enabled);
    console.log('[INIT DEBUG] Current state before setting:');
    console.log('[INIT DEBUG] - textRenderEnabled:', this.textRenderEnabled);
    console.log('[INIT DEBUG] - textRenderLayer:', !!this.textRenderLayer);
    console.log('[INIT DEBUG] - textCompositeProgram:', !!this.textCompositeProgram);

    const wasEnabled = this.textRenderEnabled;
    this.textRenderEnabled = enabled && this.textRenderLayer !== null && this.textCompositeProgram !== null;

    // Reset the logging flag if we're attempting to enable
    if (enabled && !wasEnabled) {
      this.hasLoggedTextRenderFailure = false;
    }

    console.log('[INIT DEBUG] setTextRenderEnabled result:');
    console.log('[INIT DEBUG] - Previous value:', wasEnabled);
    console.log('[INIT DEBUG] - New value:', this.textRenderEnabled);
    console.log('[INIT DEBUG] - Change:', wasEnabled !== this.textRenderEnabled ? 'CHANGED' : 'NO CHANGE');

    if (enabled && !this.textRenderEnabled) {
      console.error('[INIT DEBUG] ✗ Failed to enable text rendering - missing components:');
      if (!this.textRenderLayer) console.error('[INIT DEBUG]   - TextRenderLayer is NULL');
      if (!this.textCompositeProgram) console.error('[INIT DEBUG]   - textCompositeProgram is NULL');
    }
  }

  /**
   * Get text render enabled state
   */
  getTextRenderEnabled(): boolean {
    return this.textRenderEnabled;
  }

  /**
   * Register a text element for per-pixel adaptive rendering
   */
  registerTextForRendering(id: string, element: HTMLElement): void {
    console.log(`[TEXT DEBUG] OceanRenderer.registerTextForRendering("${id}")`);
    if (this.textRenderLayer) {
      this.textRenderLayer.registerTextElement(id, element);
      console.log(`[TEXT DEBUG] ✓ Delegated to TextRenderLayer: ${id}`);
    } else {
      console.error(`[TEXT DEBUG] ✗ No TextRenderLayer available for registration: ${id}`);
    }
  }

  /**
   * Unregister a text element from per-pixel rendering
   */
  unregisterTextFromRendering(id: string): void {
    if (this.textRenderLayer) {
      this.textRenderLayer.unregisterTextElement(id);
    }
  }

  /**
   * Get text render layer instance for external control
   */
  getTextRenderLayer(): TextRenderLayer | null {
    return this.textRenderLayer;
  }

  /**
   * Get text render performance metrics
   */
  getTextRenderMetrics(): {
    elementCount: number;
    lastRenderTime: number;
    textureUpdateCount: number;
    textureSize: { width: number; height: number };
  } | null {
    return this.textRenderLayer ? this.textRenderLayer.getPerformanceMetrics() : null;
  }

  /**
   * Set text render debug mode (cycles through modes)
   */
  setTextRenderDebugMode(enabled: boolean): void {
    if (enabled) {
      // Cycle through debug modes: 0 -> 1 -> 2 -> 3 -> 0
      this.textDebugMode = (this.textDebugMode + 1) % 4;
    } else {
      this.textDebugMode = 0;
    }

    // Also set debug mode on text render layer for canvas rendering
    if (this.textRenderLayer) {
      this.textRenderLayer.setDebugMode(this.textDebugMode === 1); // Only mode 1 shows text rendering debug
    }

    console.log(`Text debug mode: ${this.textDebugMode} (${['Off', 'Text Texture', 'Ocean Sampling', 'Analysis'][this.textDebugMode]})`);
  }

  /**
   * Get current text debug mode
   */
  getTextDebugMode(): number {
    return this.textDebugMode;
  }

  /**
   * Force update all text element bounds and visibility (for debugging)
   */
  forceUpdateTextElements(): void {
    if (this.textRenderLayer) {
      this.textRenderLayer.forceUpdateAllElements();
    }
  }

  /**
   * Force all text elements to be visible (for debugging/testing)
   */
  forceAllTextElementsVisible(): void {
    if (this.textRenderLayer) {
      this.textRenderLayer.forceAllElementsVisible();
    }
  }

  /**
   * Check if the text rendering system is fully initialized and ready
   */
  private isTextSystemReady(): boolean {
    return this.textRenderEnabled &&
           this.textRenderLayer !== null &&
           this.textCompositeProgram !== null;
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

    // Clean up text contrast analyzer
    if (this.textAnalyzer) {
      this.textAnalyzer.dispose();
      this.textAnalyzer = null;
    }

    // Clean up text render layer
    if (this.textRenderLayer) {
      this.textRenderLayer.dispose();
      this.textRenderLayer = null;
    }

    // Clean up text ocean capture resources
    if (this.textOceanFramebuffer) {
      this.gl.deleteFramebuffer(this.textOceanFramebuffer);
      this.textOceanFramebuffer = null;
    }

    if (this.textOceanTexture) {
      this.gl.deleteTexture(this.textOceanTexture);
      this.textOceanTexture = null;
    }

    if (this.textOceanDepthBuffer) {
      this.gl.deleteRenderbuffer(this.textOceanDepthBuffer);
      this.textOceanDepthBuffer = null;
    }
  }
}
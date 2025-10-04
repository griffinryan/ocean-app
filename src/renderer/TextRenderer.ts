/**
 * Text Renderer with Per-Pixel Adaptive Coloring
 * Analyzes ocean+glass background and renders text with WebGL shader for per-pixel color adaptation
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';
import { DOMCache } from '../utils/DOMCache';

export interface TextElementConfig {
  selector: string;            // CSS selector for the element
  panelId: string;             // ID of the panel this text belongs to
  // Note: position, size, and styling are all computed dynamically from the DOM element
}

export class TextRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private textProgram: ShaderProgram | null = null;

  // Geometry for rendering text quads
  private quadGeometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for capturing combined ocean+glass scene
  private sceneFramebuffer: WebGLFramebuffer | null = null;
  private sceneTexture: WebGLTexture | null = null;
  private sceneDepthBuffer: WebGLRenderbuffer | null = null;

  // Canvas for text generation (RESTORED)
  private textCanvas!: HTMLCanvasElement;
  private textContext!: CanvasRenderingContext2D;
  private textTexture: WebGLTexture | null = null;

  // Blur map framebuffer for frosted glass effect
  private blurMapFramebuffer: WebGLFramebuffer | null = null;
  private blurMapTexture: WebGLTexture | null = null;
  private blurMapDepthBuffer: WebGLRenderbuffer | null = null;

  // Blur map shader program
  private blurMapProgram: ShaderProgram | null = null;

  // Blur map update flag
  private needsBlurMapUpdate: boolean = false;

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Text element configurations
  private textElements: Map<string, TextElementConfig> = new Map();

  // Scene texture caching for performance
  private sceneTextureDirty: boolean = true;
  private lastCaptureTime: number = 0;
  private captureThrottleMs: number = 16; // Max 60fps captures

  // Text texture update flag
  private needsTextureUpdate: boolean = false;

  // Resize observer for responsive text positioning
  private resizeObserver: ResizeObserver | null = null;

  // Font loading state
  private fontsLoaded: boolean = false;

  // Transition state tracking - block updates during CSS transitions
  private isTransitioningFlag: boolean = false;

  // Text intro animation state
  private textIntroStartTime: number = 0;
  private isIntroActive: boolean = false;
  private readonly TEXT_INTRO_DURATION = 1000; // milliseconds

  // Glow control properties
  private glowRadius: number = 64.0;
  private glowIntensity: number = 0.8;
  private glowWaveReactivity: number = 0.4;

  // Blur control properties
  private blurRadius: number = 192.0; // pixels
  private blurFalloffPower: number = 1.5; // 1.0 = linear, >1.0 = sharper

  // DOM position cache for performance
  private domCache: DOMCache;

  // Panel IDs to track
  private readonly panelIds: string[] = [
    'landing',
    'app',
    'app-bio',
    'navbar',
    'portfolio-lakehouse',
    'portfolio-encryption',
    'portfolio-dotereditor',
    'portfolio-dreamrequiem',
    'portfolio-greenlightgo',
    'resume-playember',
    'resume-meta',
    'resume-outlier',
    'resume-uwtutor',
    'resume-uwedu'
  ];

  constructor(gl: WebGL2RenderingContext, _shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = _shaderManager;

    // Initialize matrices
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();

    // Create geometry for rendering text quads
    this.quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.quadGeometry);

    // Set up projection matrix for screen-space rendering
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Initialize DOM cache for performance
    this.domCache = new DOMCache(gl.canvas as HTMLCanvasElement);

    // Initialize text canvas for rasterization
    this.initializeTextCanvas();

    // Initialize framebuffer for scene capture
    this.initializeFramebuffer();

    // Initialize blur map framebuffer for frosted glass effect
    this.initializeBlurMapFramebuffer();

    // Wait for fonts to load
    this.waitForFonts();
  }

  /**
   * Initialize HTML canvas for text generation
   * Canvas will be sized to match WebGL canvas dimensions
   */
  private initializeTextCanvas(): void {
    this.textCanvas = document.createElement('canvas');

    // Initial size - will be updated in resize
    this.textCanvas.width = 1920;
    this.textCanvas.height = 1080;

    const context = this.textCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true
    });
    if (!context) {
      throw new Error('Failed to get 2D context for text canvas');
    }

    this.textContext = context;

    // Set up high-quality text rendering
    this.textContext.textBaseline = 'top';
    this.textContext.fillStyle = 'white';

    // IMPORTANT: Disable image smoothing for crisp text
    // imageSmoothingEnabled is for IMAGE scaling, not text rendering
    // Text should be rendered at native resolution without interpolation
    this.textContext.imageSmoothingEnabled = false;

    console.log(`TextRenderer: Canvas initialized at ${this.textCanvas.width}x${this.textCanvas.height}`);
  }

  /**
   * Wait for fonts to load before rendering text
   */
  private async waitForFonts(): Promise<void> {
    try {
      await document.fonts.ready;
      this.fontsLoaded = true;
      this.needsTextureUpdate = true;
      console.log('TextRenderer: Fonts loaded, ready to render');
    } catch (error) {
      console.warn('TextRenderer: Font loading check failed:', error);
      this.fontsLoaded = true; // Continue anyway
    }
  }

  /**
   * Initialize framebuffer for scene texture capture
   */
  private initializeFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.sceneFramebuffer = gl.createFramebuffer();
    if (!this.sceneFramebuffer) {
      throw new Error('Failed to create scene framebuffer');
    }

    // Create texture for color attachment
    this.sceneTexture = gl.createTexture();
    if (!this.sceneTexture) {
      throw new Error('Failed to create scene texture');
    }

    // Create depth renderbuffer
    this.sceneDepthBuffer = gl.createRenderbuffer();
    if (!this.sceneDepthBuffer) {
      throw new Error('Failed to create scene depth buffer');
    }

    // Create text texture
    this.textTexture = gl.createTexture();
    if (!this.textTexture) {
      throw new Error('Failed to create text texture');
    }

    // Setup will be completed in resize method
    this.resizeFramebuffer(gl.canvas.width, gl.canvas.height);
  }

  /**
   * Initialize blur map framebuffer for frosted glass effect around text
   */
  private initializeBlurMapFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.blurMapFramebuffer = gl.createFramebuffer();
    if (!this.blurMapFramebuffer) {
      throw new Error('Failed to create blur map framebuffer');
    }

    // Create texture (single channel R for blur intensity)
    this.blurMapTexture = gl.createTexture();
    if (!this.blurMapTexture) {
      throw new Error('Failed to create blur map texture');
    }

    // Create depth renderbuffer
    this.blurMapDepthBuffer = gl.createRenderbuffer();
    if (!this.blurMapDepthBuffer) {
      throw new Error('Failed to create blur map depth buffer');
    }

    // Setup will be completed in resize method
    this.resizeBlurMapFramebuffer(gl.canvas.width, gl.canvas.height);
  }

  /**
   * Resize blur map framebuffer to match canvas size
   */
  private resizeBlurMapFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.blurMapFramebuffer || !this.blurMapTexture || !this.blurMapDepthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurMapFramebuffer);

    // Setup color texture (R8 format for single channel)
    gl.bindTexture(gl.TEXTURE_2D, this.blurMapTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurMapTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.blurMapDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.blurMapDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Blur map framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    this.needsBlurMapUpdate = true;
  }

  /**
   * Initialize text shaders (RESTORED)
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define uniforms and attributes for text shader
      const uniforms = [
        'u_projectionMatrix',
        'u_viewMatrix',
        'u_time',
        'u_aspectRatio',
        'u_resolution',
        'u_sceneTexture',
        'u_textTexture',
        'u_adaptiveStrength',
        'u_panelPositions',
        'u_panelSizes',
        'u_panelCount',
        'u_textIntroProgress',
        // Vessel wake uniforms
        'u_vesselCount',
        'u_vesselPositions',
        'u_vesselVelocities',
        'u_vesselWeights',
        'u_vesselHullLengths',
        'u_vesselStates',
        'u_wakesEnabled',
        // Glow control uniforms
        'u_glowRadius',
        'u_glowIntensity',
        'u_glowWaveReactivity'
      ];

      const attributes = [
        'a_position',
        'a_uv'
      ];

      // Create text shader program
      this.textProgram = this.shaderManager.createProgram(
        'text',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes for text rendering
      const positionLocation = this.textProgram.attributeLocations.get('a_position');
      const uvLocation = this.textProgram.attributeLocations.get('a_uv');

      if (positionLocation !== undefined && uvLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, uvLocation);
      }

      console.log('Text shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text shaders:', error);
      throw error;
    }
  }

  /**
   * Initialize blur map shaders for frosted glass effect
   */
  async initializeBlurMapShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define uniforms and attributes for blur map shader
      const uniforms = [
        'u_projectionMatrix',
        'u_viewMatrix',
        'u_resolution',
        'u_textTexture',
        'u_blurRadius',
        'u_blurFalloffPower'
      ];

      const attributes = [
        'a_position',
        'a_uv'
      ];

      // Create blur map shader program
      this.blurMapProgram = this.shaderManager.createProgram(
        'blurmap',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes for blur map rendering
      const positionLocation = this.blurMapProgram.attributeLocations.get('a_position');
      const uvLocation = this.blurMapProgram.attributeLocations.get('a_uv');

      if (positionLocation !== undefined && uvLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, uvLocation);
      }

      console.log('Blur map shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize blur map shaders:', error);
      throw error;
    }
  }

  /**
   * Resize framebuffer to match canvas size
   */
  public resizeFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.sceneFramebuffer || !this.sceneTexture || !this.sceneDepthBuffer) {
      return;
    }

    // Resize text canvas to match WebGL canvas
    this.textCanvas.width = width;
    this.textCanvas.height = height;

    // Re-apply text rendering settings after resize
    this.textContext.textBaseline = 'top';
    this.textContext.fillStyle = 'white';
    this.textContext.imageSmoothingEnabled = false; // Crisp text, no interpolation

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Text framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    // Resize blur map framebuffer
    this.resizeBlurMapFramebuffer(width, height);

    // Mark scene as dirty after resize
    this.markSceneDirty();
    this.needsTextureUpdate = true;
  }

  /**
   * Capture current scene (ocean + glass) to texture for text background analysis
   */
  public captureScene(renderSceneCallback: () => void): void {
    const gl = this.gl;
    const currentTime = performance.now();

    if (!this.sceneFramebuffer || !this.sceneTexture) {
      return;
    }

    // Skip capture if scene isn't dirty and we're within throttle window
    if (!this.sceneTextureDirty && (currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
      return;
    }

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind framebuffer for rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);

    // Set viewport to match framebuffer size
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render scene to framebuffer
    renderSceneCallback();

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Restore viewport
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

    // Update cache state
    this.sceneTextureDirty = false;
    this.lastCaptureTime = currentTime;
  }

  /**
   * Mark scene texture as dirty to force recapture on next render
   */
  public markSceneDirty(): void {
    this.sceneTextureDirty = true;
  }

  /**
   * Render individual text element to canvas using direct screen-space coordinates
   * Handles flexbox centering, standard flow, and all CSS layout modes
   */
  private renderTextToCanvas(element: HTMLElement, _config: TextElementConfig): void {
    const ctx = this.textContext;
    const glCanvas = this.gl.canvas as HTMLCanvasElement;

    // CRITICAL: Force layout recalculation before getBoundingClientRect()
    // This ensures CSS transitions are complete and layout is settled
    void element.offsetHeight; // Force reflow
    void glCanvas.offsetHeight; // Force canvas reflow

    const canvasRect = glCanvas.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Skip if element or canvas has no size
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      return;
    }

    // Get computed styles from HTML element for pixel-perfect matching
    const styles = getComputedStyle(element);
    const fontSize = parseFloat(styles.fontSize);
    const fontFamily = styles.fontFamily;
    const fontWeight = styles.fontWeight;
    const textAlign = styles.textAlign as CanvasTextAlign;

    // Parse line-height (can be 'normal', number, or pixels)
    let lineHeightPx: number;
    const lineHeightStyle = styles.lineHeight;
    if (lineHeightStyle === 'normal') {
      lineHeightPx = fontSize * 1.2; // Browser default
    } else if (lineHeightStyle.endsWith('px')) {
      lineHeightPx = parseFloat(lineHeightStyle);
    } else {
      // Unitless number
      lineHeightPx = parseFloat(lineHeightStyle) * fontSize;
    }

    // Detect flexbox layout on element itself
    const elementDisplay = styles.display;
    const isFlexContainer = elementDisplay === 'flex' || elementDisplay === 'inline-flex';
    const alignItems = styles.alignItems;
    const justifyContent = styles.justifyContent;

    // Detect flexbox layout on parent
    const parent = element.parentElement;
    let parentIsFlexContainer = false;
    let parentAlignItems = '';
    if (parent) {
      const parentStyles = getComputedStyle(parent);
      const parentDisplay = parentStyles.display;
      parentIsFlexContainer = parentDisplay === 'flex' || parentDisplay === 'inline-flex';
      parentAlignItems = parentStyles.alignItems;
    }

    // Element position in screen space (pixels from canvas top-left)
    // getBoundingClientRect() returns position AFTER all CSS transforms and layout
    const screenX = elementRect.left - canvasRect.left;
    const screenY = elementRect.top - canvasRect.top;

    // Scale to canvas texture coordinates
    // TextCanvas dimensions match WebGL canvas dimensions, so this is 1:1 mapping
    const scaleX = this.textCanvas.width / canvasRect.width;
    const scaleY = this.textCanvas.height / canvasRect.height;

    // Convert screen coordinates to canvas texture coordinates
    const textureX = screenX * scaleX;
    const textureY = screenY * scaleY;

    // Scale font and line height
    const scaledFontSize = Math.round(fontSize * scaleY);
    const scaledLineHeight = Math.round(lineHeightPx * scaleY);
    const scaledWidth = Math.round(elementRect.width * scaleX);
    const scaledHeight = Math.round(elementRect.height * scaleY);

    // Get text content with proper multi-line support
    // CRITICAL: Must use innerText for <br> tag support, with fallback handling
    const text = this.extractTextWithLineBreaks(element);
    let lines = text.split('\n');

    // Calculate text position within element
    // HTML renders text inside the content box (after border and padding)
    const paddingTop = parseFloat(styles.paddingTop) * scaleY;
    const paddingLeft = parseFloat(styles.paddingLeft) * scaleX;
    const paddingRight = parseFloat(styles.paddingRight) * scaleX;
    const borderTopWidth = parseFloat(styles.borderTopWidth) * scaleY;
    const borderLeftWidth = parseFloat(styles.borderLeftWidth) * scaleX;
    const borderRightWidth = parseFloat(styles.borderRightWidth) * scaleX;

    // Calculate content box (inside border and padding)
    const contentLeft = textureX + borderLeftWidth + paddingLeft;
    const contentTop = textureY + borderTopWidth + paddingTop;
    const contentWidth = scaledWidth - borderLeftWidth - borderRightWidth - paddingLeft - paddingRight;

    // Apply automatic word wrapping to fit content width
    // Set Canvas2D font first so measureText works correctly
    ctx.save();
    ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;

    // Wrap each line (preserving explicit <br> line breaks)
    const wrappedLines: string[] = [];
    for (const line of lines) {
      const wrapped = this.wrapTextToWidth(ctx, line, contentWidth);
      wrappedLines.push(...wrapped);
    }
    lines = wrappedLines;

    ctx.restore();

    // Calculate total text block height for multi-line centering
    const totalTextHeight = lines.length * scaledLineHeight;

    // Line-height creates leading space (vertical centering within line box)
    const leading = (scaledLineHeight - scaledFontSize) / 2;

    // Detect if this is a button element (glass-button class or anchor with button styling)
    const isButton = element.classList.contains('glass-button') ||
                     (element.tagName === 'A' && elementDisplay === 'inline-flex');

    // Determine text position based on layout mode
    let textX = contentLeft;
    let textY = contentTop + leading;
    let baselineMode: CanvasTextBaseline = 'top';
    let alignMode: CanvasTextAlign = 'left';

    // SPECIAL CASE: Glass buttons with inline-flex centering
    // Buttons use `display: inline-flex; align-items: center; justify-content: center`
    // The text should be centered within the button's actual rendered bounds
    if (isButton && elementDisplay === 'inline-flex') {
      // Use the button's actual screen position (elementRect already accounts for flexbox layout)
      // Center both horizontally and vertically within the button
      textX = textureX + scaledWidth / 2;
      textY = textureY + scaledHeight / 2;
      alignMode = 'center';

      // Multi-line text requires centering the entire text block, not just the first line
      if (lines.length > 1) {
        // Center the entire text block by adjusting starting Y position
        textY = textY - (totalTextHeight / 2);
        baselineMode = 'top';
      } else {
        // Single-line text: use 'middle' baseline for proper centering
        baselineMode = 'middle';
      }

      // Debug logging for button positioning
      if (element.id === 'paper-btn' || element.id === 'app-btn') {
        console.debug(`Button ${element.id} positioning:`, {
          elementRect: {
            left: elementRect.left,
            top: elementRect.top,
            width: elementRect.width,
            height: elementRect.height
          },
          canvasRect: {
            width: canvasRect.width,
            height: canvasRect.height
          },
          textureCoords: { textureX, textureY, scaledWidth, scaledHeight },
          textPosition: { textX, textY },
          text: text.substring(0, 30),
          lines: lines.length,
          baselineMode
        });
      }
    }

    // CASE 1: Element itself is flex container with centering
    else if (isFlexContainer) {
      if (alignItems === 'center') {
        // Vertically center text in element's full height
        textY = textureY + scaledHeight / 2;

        // Multi-line text requires centering the entire text block
        if (lines.length > 1) {
          textY = textY - (totalTextHeight / 2);
          baselineMode = 'top';
        } else {
          baselineMode = 'middle';
        }
      }

      if (justifyContent === 'center') {
        // Horizontally center text in element's full width
        textX = textureX + scaledWidth / 2;
        alignMode = 'center';
      }
    }

    // CASE 2: Element is child of flex container with centering
    // NOTE: This case now only applies to non-button elements
    else if (parentIsFlexContainer && parentAlignItems === 'center' && !isButton) {
      // Vertically center text in element's full height
      textY = textureY + scaledHeight / 2;

      // Multi-line text requires centering the entire text block
      if (lines.length > 1) {
        textY = textY - (totalTextHeight / 2);
        baselineMode = 'top';
      } else {
        baselineMode = 'middle';
      }

      // For horizontal, still use element's text-align
      if (textAlign === 'center') {
        textX = contentLeft + contentWidth / 2;
        alignMode = 'center';
      } else if (textAlign === 'right') {
        textX = contentLeft + contentWidth;
        alignMode = 'right';
      }
    }

    // CASE 3: Standard flow (no flex centering)
    else if (!isButton) {
      // Use text-align from CSS
      if (textAlign === 'center') {
        textX = contentLeft + contentWidth / 2;
        alignMode = 'center';
      } else if (textAlign === 'right') {
        textX = contentLeft + contentWidth;
        alignMode = 'right';
      }
    }

    // CRITICAL: Reset ALL Canvas2D context state before rendering
    // Prevents state leakage between different text elements
    ctx.save(); // Save context state for restoration later

    // Reset text properties explicitly
    ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
    ctx.textBaseline = baselineMode;
    ctx.textAlign = alignMode;
    ctx.fillStyle = 'white';
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';

    // Render each line of text
    lines.forEach((line, index) => {
      const y = textY + (index * scaledLineHeight);

      // Ensure text stays within canvas bounds
      if (y >= 0 && y < this.textCanvas.height && line.trim().length > 0) {
        ctx.fillText(line, textX, y);
      }
    });

    // CRITICAL: Restore context state to prevent leakage
    ctx.restore();
  }

  /**
   * Generate text texture from all current text elements
   * Only renders text from visible panels to prevent cross-panel bleeding
   */
  private updateTextTexture(): void {
    // CRITICAL: Block updates during CSS transitions to prevent capturing mid-animation positions
    if (this.isTransitioningFlag) {
      console.debug('TextRenderer: Skipping update during CSS transition');
      return;
    }

    if (!this.needsTextureUpdate || this.textElements.size === 0 || !this.fontsLoaded) {
      return;
    }

    const gl = this.gl;
    const ctx = this.textContext;

    // CRITICAL: Aggressively clear canvas and reset ALL context state
    // This prevents ghosting and state accumulation across frames
    ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    // Reset global Canvas2D state to defaults before rendering any text
    ctx.save(); // Save clean state
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    ctx.restore(); // Apply clean state

    // Get list of visible panels (all 16: 3 main + 5 portfolio + 5 resume + navbar + app + app-bio)
    const visiblePanels = new Set<string>();
    const panelIds = [
      'landing-panel',
      'app-panel',
      'app-bio-panel',
      'navbar',
      // Portfolio panels
      'portfolio-lakehouse-panel',
      'portfolio-encryption-panel',
      'portfolio-dotereditor-panel',
      'portfolio-dreamrequiem-panel',
      'portfolio-greenlightgo-panel',
      // Resume panels
      'resume-playember-panel',
      'resume-meta-panel',
      'resume-outlier-panel',
      'resume-uwtutor-panel',
      'resume-uwedu-panel'
    ];

    panelIds.forEach(panelId => {
      const panelElement = document.getElementById(panelId);
      if (panelElement && !panelElement.classList.contains('hidden')) {
        // For panels inside scroll containers, also check if parent container is visible
        const parent = panelElement.parentElement?.parentElement;
        const parentHidden = parent?.classList.contains('hidden') ?? false;

        if (!parentHidden) {
          // Add both full panel ID and short name for matching
          visiblePanels.add(panelId);
          visiblePanels.add(panelId.replace('-panel', '')); // e.g., 'landing-panel' → 'landing'
        }
      }
    });

    // Debug: Log visible panels when updating texture
    console.debug('TextRenderer: Updating text texture for visible panels:', Array.from(visiblePanels));

    // Render ONLY text elements from visible panels
    this.textElements.forEach((config) => {
      // Check if this text element's panel is visible
      if (!visiblePanels.has(config.panelId)) {
        return; // Skip text from hidden panels
      }

      const element = document.querySelector(config.selector) as HTMLElement;
      if (element) {
        this.renderTextToCanvas(element, config);
      }
    });

    // Update WebGL texture
    if (this.textTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.textTexture);

      // CRITICAL: Flip Y-axis when uploading Canvas2D to WebGL texture
      // Canvas2D has top-left origin (Y down), WebGL has bottom-left origin (Y up)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    this.needsTextureUpdate = false;
  }

  /**
   * Get panel information for shader uniforms using DOMCache
   * Returns positions and sizes for all visible panels (OPTIMIZED - no DOM queries)
   */
  private getPanelInfo(): { positions: Float32Array, sizes: Float32Array, count: number } {
    // Update cache (happens only on resize or manual invalidation, not every frame)
    this.domCache.updatePanels(this.panelIds);

    // Get pre-computed panel data from cache
    const positions = this.domCache.getPanelPositionsArray(16);
    const sizes = this.domCache.getPanelSizesArray(16);
    const count = this.domCache.getVisiblePanelCount();

    return { positions, sizes, count };
  }

  /**
   * Generate blur map from text texture for frosted glass effect
   */
  private generateBlurMap(): void {
    const gl = this.gl;

    // Skip if transitioning or no program
    if (this.isTransitioningFlag || !this.blurMapProgram || !this.blurMapFramebuffer || !this.textTexture) {
      return;
    }

    if (!this.needsBlurMapUpdate) {
      return;
    }

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind blur map framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurMapFramebuffer);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear framebuffer (black = no blur)
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Use blur map shader
    const program = this.shaderManager.useProgram('blurmap');

    // Set matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', gl.canvas.width, gl.canvas.height);

    // Set blur parameters
    this.shaderManager.setUniform1f(program, 'u_blurRadius', this.blurRadius);
    this.shaderManager.setUniform1f(program, 'u_blurFalloffPower', this.blurFalloffPower);

    // Bind text texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    this.shaderManager.setUniform1i(program, 'u_textTexture', 0);

    // Disable depth test, enable blending
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Render full-screen quad
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Re-enable depth test
    gl.enable(gl.DEPTH_TEST);

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

    this.needsBlurMapUpdate = false;
  }

  /**
   * Render all text elements with per-pixel adaptive coloring and glow
   */
  public render(vesselData?: {
    positions: Float32Array;
    velocities: Float32Array;
    weights: Float32Array;
    hullLengths: Float32Array;
    states: Float32Array;
    count: number;
  }, wakesEnabled: boolean = true): void {
    const gl = this.gl;

    // CRITICAL: Skip rendering entirely during CSS transitions
    // This prevents rendering stale texture data at wrong positions
    if (this.isTransitioningFlag) {
      return;
    }

    if (!this.textProgram || !this.sceneTexture || this.textElements.size === 0) {
      return;
    }

    // Update text texture if needed
    this.updateTextTexture();

    // Generate blur map after text texture is updated
    this.generateBlurMap();

    // Use text shader program
    const program = this.shaderManager.useProgram('text');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time uniform for animation
    const currentTime = performance.now() / 1000.0;
    this.shaderManager.setUniform1f(program, 'u_time', currentTime);

    // Calculate and pass text intro progress
    let introProgress = 1.0; // Default: animation complete (no distortion)
    if (this.isIntroActive) {
      const elapsed = performance.now() - this.textIntroStartTime;
      introProgress = Math.min(elapsed / this.TEXT_INTRO_DURATION, 1.0);

      // Disable intro animation when complete
      if (introProgress >= 1.0) {
        this.isIntroActive = false;
        console.log('TextRenderer: Text intro animation complete');
      }
    }
    this.shaderManager.setUniform1f(program, 'u_textIntroProgress', introProgress);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', gl.canvas.width, gl.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', gl.canvas.width / gl.canvas.height);

    // Bind scene texture (combined ocean + glass)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    this.shaderManager.setUniform1i(program, 'u_sceneTexture', 0);

    // Bind text texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    this.shaderManager.setUniform1i(program, 'u_textTexture', 1);

    // Set adaptive strength
    this.shaderManager.setUniform1f(program, 'u_adaptiveStrength', 1.0);

    // Get panel information and set uniforms
    const panelInfo = this.getPanelInfo();
    this.shaderManager.setUniform2fv(program, 'u_panelPositions', panelInfo.positions);
    this.shaderManager.setUniform2fv(program, 'u_panelSizes', panelInfo.sizes);
    this.shaderManager.setUniform1i(program, 'u_panelCount', panelInfo.count);

    // Set vessel wake uniforms for glow distortion
    if (vesselData && vesselData.count > 0) {
      this.shaderManager.setUniform1i(program, 'u_vesselCount', vesselData.count);
      this.shaderManager.setUniform3fv(program, 'u_vesselPositions', vesselData.positions);
      this.shaderManager.setUniform3fv(program, 'u_vesselVelocities', vesselData.velocities);
      this.shaderManager.setUniform1fv(program, 'u_vesselWeights', vesselData.weights);
      this.shaderManager.setUniform1fv(program, 'u_vesselHullLengths', vesselData.hullLengths);
      this.shaderManager.setUniform1fv(program, 'u_vesselStates', vesselData.states);
    } else {
      this.shaderManager.setUniform1i(program, 'u_vesselCount', 0);
    }
    this.shaderManager.setUniform1i(program, 'u_wakesEnabled', wakesEnabled ? 1 : 0);

    // Set glow control uniforms
    this.shaderManager.setUniform1f(program, 'u_glowRadius', this.glowRadius);
    this.shaderManager.setUniform1f(program, 'u_glowIntensity', this.glowIntensity);
    this.shaderManager.setUniform1f(program, 'u_glowWaveReactivity', this.glowWaveReactivity);

    // Enable blending for text overlay
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable depth testing for text overlay
    gl.disable(gl.DEPTH_TEST);

    // Render full-screen quad with text
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Re-enable depth testing
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * Add a text element configuration
   */
  public addTextElement(id: string, config: TextElementConfig): void {
    this.textElements.set(id, config);
    this.needsTextureUpdate = true;
  }

  /**
   * Remove a text element
   */
  public removeTextElement(id: string): void {
    this.textElements.delete(id);
    this.needsTextureUpdate = true;
  }

  /**
   * Update text element configuration
   */
  public updateTextElement(id: string, config: Partial<TextElementConfig>): void {
    const existingConfig = this.textElements.get(id);
    if (existingConfig) {
      this.textElements.set(id, { ...existingConfig, ...config });
      this.needsTextureUpdate = true;
    }
  }

  /**
   * Force text texture update on next render
   */
  public forceTextureUpdate(): void {
    this.needsTextureUpdate = true;
    this.needsBlurMapUpdate = true;
  }

  /**
   * Set transitioning state - blocks text updates during CSS transitions
   */
  public setTransitioning(transitioning: boolean): void {
    this.isTransitioningFlag = transitioning;

    // If transitioning just ended, force immediate update and trigger intro animation
    if (!transitioning) {
      // Invalidate DOM cache to force recalculation of panel positions
      this.domCache.invalidate();

      this.needsTextureUpdate = true;
      this.needsBlurMapUpdate = true;
      this.markSceneDirty();

      // Trigger text intro animation
      this.textIntroStartTime = performance.now();
      this.isIntroActive = true;
      console.log('TextRenderer: Text intro animation started');
    }
  }

  /**
   * Check if currently transitioning
   */
  public isTransitioning(): boolean {
    return this.isTransitioningFlag;
  }

  /**
   * Convert HTML element rect to normalized WebGL coordinates
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      return { position: [0, 0], size: [0, 0] };
    }

    // Calculate center position in normalized coordinates (0 to 1)
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    // Convert to WebGL coordinates (-1 to 1, with Y flipped)
    const glX = centerX * 2.0 - 1.0;
    const glY = (1.0 - centerY) * 2.0 - 1.0;

    // Calculate size in normalized coordinates
    const width = (elementRect.width / canvasRect.width) * 2.0;
    const height = (elementRect.height / canvasRect.height) * 2.0;

    return {
      position: [glX, glY],
      size: [width, height]
    };
  }

  /**
   * Set up text element tracking from HTML elements
   */
  public setupDefaultTextElements(): void {
    // Define text elements to track with their selectors and panel associations
    const textElementSelectors = [
      // Landing Panel
      { selector: '#landing-panel h1', id: 'landing-title', panelId: 'landing-panel' },
      { selector: '#landing-panel .subtitle', id: 'landing-subtitle', panelId: 'landing-panel' },
      { selector: '#paper-btn', id: 'paper-button', panelId: 'landing-panel' },
      { selector: '#app-btn', id: 'app-button', panelId: 'landing-panel' },

      // App Bio Panel
      { selector: '#app-bio-panel .bio-text:nth-child(1)', id: 'app-bio-p1', panelId: 'app-bio-panel' },
      { selector: '#app-bio-panel .bio-text:nth-child(2)', id: 'app-bio-p2', panelId: 'app-bio-panel' },

      // Portfolio: Lakehouse
      { selector: '#portfolio-lakehouse-panel .project-title', id: 'portfolio-lakehouse-title', panelId: 'portfolio-lakehouse-panel' },
      { selector: '#portfolio-lakehouse-panel .project-description', id: 'portfolio-lakehouse-desc', panelId: 'portfolio-lakehouse-panel' },
      { selector: '#portfolio-lakehouse-panel .project-section-title', id: 'portfolio-lakehouse-section', panelId: 'portfolio-lakehouse-panel' },

      // Portfolio: encryption-suite
      { selector: '#portfolio-encryption-panel .project-title', id: 'portfolio-encryption-title', panelId: 'portfolio-encryption-panel' },
      { selector: '#portfolio-encryption-panel .project-description', id: 'portfolio-encryption-desc', panelId: 'portfolio-encryption-panel' },
      { selector: '#portfolio-encryption-panel .project-section-title', id: 'portfolio-encryption-section', panelId: 'portfolio-encryption-panel' },

      // Portfolio: DoterEditor
      { selector: '#portfolio-dotereditor-panel .project-title', id: 'portfolio-dotereditor-title', panelId: 'portfolio-dotereditor-panel' },
      { selector: '#portfolio-dotereditor-panel .project-description', id: 'portfolio-dotereditor-desc', panelId: 'portfolio-dotereditor-panel' },
      { selector: '#portfolio-dotereditor-panel .project-section-title', id: 'portfolio-dotereditor-section', panelId: 'portfolio-dotereditor-panel' },

      // Portfolio: DreamRequiem
      { selector: '#portfolio-dreamrequiem-panel .project-title', id: 'portfolio-dreamrequiem-title', panelId: 'portfolio-dreamrequiem-panel' },
      { selector: '#portfolio-dreamrequiem-panel .project-description', id: 'portfolio-dreamrequiem-desc', panelId: 'portfolio-dreamrequiem-panel' },
      { selector: '#portfolio-dreamrequiem-panel .project-section-title', id: 'portfolio-dreamrequiem-section', panelId: 'portfolio-dreamrequiem-panel' },

      // Portfolio: GreenLightGo
      { selector: '#portfolio-greenlightgo-panel .project-title', id: 'portfolio-greenlightgo-title', panelId: 'portfolio-greenlightgo-panel' },
      { selector: '#portfolio-greenlightgo-panel .project-description', id: 'portfolio-greenlightgo-desc', panelId: 'portfolio-greenlightgo-panel' },
      { selector: '#portfolio-greenlightgo-panel .project-section-title', id: 'portfolio-greenlightgo-section', panelId: 'portfolio-greenlightgo-panel' },

      // Resume: PlayEmber
      { selector: '#resume-playember-panel .resume-position', id: 'resume-playember-position', panelId: 'resume-playember-panel' },
      { selector: '#resume-playember-panel .resume-company', id: 'resume-playember-company', panelId: 'resume-playember-panel' },
      { selector: '#resume-playember-panel .resume-date', id: 'resume-playember-date', panelId: 'resume-playember-panel' },
      { selector: '#resume-playember-panel .resume-description', id: 'resume-playember-desc', panelId: 'resume-playember-panel' },

      // Resume: Meta
      { selector: '#resume-meta-panel .resume-position', id: 'resume-meta-position', panelId: 'resume-meta-panel' },
      { selector: '#resume-meta-panel .resume-company', id: 'resume-meta-company', panelId: 'resume-meta-panel' },
      { selector: '#resume-meta-panel .resume-date', id: 'resume-meta-date', panelId: 'resume-meta-panel' },
      { selector: '#resume-meta-panel .resume-team', id: 'resume-meta-team', panelId: 'resume-meta-panel' },
      { selector: '#resume-meta-panel .resume-description', id: 'resume-meta-desc', panelId: 'resume-meta-panel' },

      // Resume: Outlier
      { selector: '#resume-outlier-panel .resume-position', id: 'resume-outlier-position', panelId: 'resume-outlier-panel' },
      { selector: '#resume-outlier-panel .resume-company', id: 'resume-outlier-company', panelId: 'resume-outlier-panel' },
      { selector: '#resume-outlier-panel .resume-date', id: 'resume-outlier-date', panelId: 'resume-outlier-panel' },
      { selector: '#resume-outlier-panel .resume-description', id: 'resume-outlier-desc', panelId: 'resume-outlier-panel' },

      // Resume: UW Tutor
      { selector: '#resume-uwtutor-panel .resume-position', id: 'resume-uwtutor-position', panelId: 'resume-uwtutor-panel' },
      { selector: '#resume-uwtutor-panel .resume-company', id: 'resume-uwtutor-company', panelId: 'resume-uwtutor-panel' },
      { selector: '#resume-uwtutor-panel .resume-date', id: 'resume-uwtutor-date', panelId: 'resume-uwtutor-panel' },
      { selector: '#resume-uwtutor-panel .resume-description', id: 'resume-uwtutor-desc', panelId: 'resume-uwtutor-panel' },

      // Resume: UW Education
      { selector: '#resume-uwedu-panel .resume-position', id: 'resume-uwedu-position', panelId: 'resume-uwedu-panel' },
      { selector: '#resume-uwedu-panel .resume-company', id: 'resume-uwedu-company', panelId: 'resume-uwedu-panel' },
      { selector: '#resume-uwedu-panel .resume-date', id: 'resume-uwedu-date', panelId: 'resume-uwedu-panel' },
      { selector: '#resume-uwedu-panel .resume-location', id: 'resume-uwedu-location', panelId: 'resume-uwedu-panel' },
      { selector: '#resume-uwedu-panel .resume-description', id: 'resume-uwedu-desc', panelId: 'resume-uwedu-panel' },
      { selector: '#resume-uwedu-panel .resume-subsection', id: 'resume-uwedu-subsection', panelId: 'resume-uwedu-panel' },

      // Navigation
      { selector: '.brand-text', id: 'nav-brand', panelId: 'navbar' }
    ];

    // Setup each text element
    textElementSelectors.forEach(config => {
      const element = document.querySelector(config.selector);
      if (element) {
        const textConfig: TextElementConfig = {
          selector: config.selector,
          panelId: config.panelId
        };

        this.addTextElement(config.id, textConfig);
      }
    });

    // Add multi-instance elements (project cards, nav items, etc.)
    this.setupMultiInstanceElements();

    // Set up resize observer for responsive positioning
    this.setupResizeObserver();

    // Set up mutation observer for content changes
    this.setupMutationObserver();

    // Enable WebGL text rendering - hide CSS text to prevent double-vision
    this.enableWebGLText();

    console.log(`TextRenderer: Tracking ${this.textElements.size} text elements for per-pixel adaptive coloring`);
  }

  /**
   * Enable WebGL text rendering by hiding CSS text
   * Keeps HTML elements in DOM for layout, accessibility, and SEO
   */
  private enableWebGLText(): void {
    // Add class to all glass panels to hide their CSS text
    document.querySelectorAll('.glass-panel').forEach(panel => {
      panel.classList.add('webgl-text-enabled');
    });

    // Also add to body for global text elements
    document.body.classList.add('webgl-text-enabled');

    console.log('TextRenderer: WebGL text rendering enabled, CSS text hidden');
  }

  /**
   * Setup text tracking for elements that appear multiple times
   */
  private setupMultiInstanceElements(): void {
    // Tech tags for all portfolio panels
    const portfolioPanelIds = [
      'portfolio-lakehouse-panel',
      'portfolio-encryption-panel',
      'portfolio-dotereditor-panel',
      'portfolio-dreamrequiem-panel',
      'portfolio-greenlightgo-panel'
    ];

    portfolioPanelIds.forEach(panelId => {
      const techTags = document.querySelectorAll(`#${panelId} .tech-tag`);
      techTags.forEach((_tag, index) => {
        this.addTextElement(`${panelId}-tech-${index}`, {
          selector: `#${panelId} .tech-tags .tech-tag:nth-child(${index + 1})`,
          panelId: panelId
        });
      });

      // Project features list items
      const features = document.querySelectorAll(`#${panelId} .project-features li`);
      features.forEach((_feature, index) => {
        this.addTextElement(`${panelId}-feature-${index}`, {
          selector: `#${panelId} .project-features li:nth-child(${index + 1})`,
          panelId: panelId
        });
      });
    });

    // Resume responsibilities list items
    const resumePanelIds = [
      'resume-playember-panel',
      'resume-meta-panel',
      'resume-outlier-panel',
      'resume-uwtutor-panel',
      'resume-uwedu-panel'
    ];

    resumePanelIds.forEach(panelId => {
      const responsibilities = document.querySelectorAll(`#${panelId} .resume-responsibilities li`);
      responsibilities.forEach((_item, index) => {
        this.addTextElement(`${panelId}-resp-${index}`, {
          selector: `#${panelId} .resume-responsibilities li:nth-child(${index + 1})`,
          panelId: panelId
        });
      });
    });

    // Navigation items
    const navItems = document.querySelectorAll('.nav-item .nav-label');
    navItems.forEach((_item, index) => {
      this.addTextElement(`nav-label-${index}`, {
        selector: `.nav-item:nth-child(${index + 1}) .nav-label`,
        panelId: 'navbar'
      });
    });
  }

  /**
   * Set up mutation observer to track content changes
   * Observes all 16 panels for DOM mutations
   */
  private setupMutationObserver(): void {
    const observer = new MutationObserver(() => {
      this.needsTextureUpdate = true;
    });

    // Observe changes in text content for all panels
    const observeTargets = [
      '#landing-panel',
      '#app-panel',
      '#app-bio-panel',
      '#navbar',
      // Portfolio panels
      '#portfolio-lakehouse-panel',
      '#portfolio-encryption-panel',
      '#portfolio-dotereditor-panel',
      '#portfolio-dreamrequiem-panel',
      '#portfolio-greenlightgo-panel',
      // Resume panels
      '#resume-playember-panel',
      '#resume-meta-panel',
      '#resume-outlier-panel',
      '#resume-uwtutor-panel',
      '#resume-uwedu-panel'
    ];

    observeTargets.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        observer.observe(element, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    });
  }

  /**
   * Wrap text to fit within a maximum width, breaking at word boundaries
   * Uses Canvas2D measureText API to calculate text widths
   *
   * @param ctx Canvas2D context (must have font already set)
   * @param text Text string to wrap
   * @param maxWidth Maximum width in pixels
   * @returns Array of wrapped lines
   */
  private wrapTextToWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    // Empty or whitespace-only text
    if (!text || !text.trim()) {
      return [text]; // Preserve empty lines
    }

    // If maxWidth is too small, return text as-is (avoid infinite loops)
    if (maxWidth <= 0) {
      return [text];
    }

    // Measure full text width
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;

    // Text fits within width - no wrapping needed
    if (textWidth <= maxWidth) {
      return [text];
    }

    // Text needs wrapping - split into words
    const words = text.split(/\s+/); // Split on any whitespace
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth <= maxWidth) {
        // Word fits on current line
        currentLine = testLine;
      } else {
        // Word doesn't fit
        if (currentLine) {
          // Save current line and start new line with word
          lines.push(currentLine);
          currentLine = word;
        } else {
          // Single word is too long - add it anyway (allow overflow for unbreakable words)
          // This prevents infinite loops and is better than breaking mid-word
          lines.push(word);
          currentLine = '';
        }
      }
    }

    // Add remaining line
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text];
  }

  /**
   * Extract text content with proper line break handling
   * innerText converts <br> → \n, but textContent does not
   * This method ensures multi-line text works correctly
   */
  private extractTextWithLineBreaks(element: HTMLElement): string {
    // Try innerText first (handles <br> correctly)
    let text = element.innerText;

    // If innerText is empty or whitespace, element might be hidden
    if (!text || !text.trim()) {
      // Fallback: Parse innerHTML and convert <br> tags to \n
      const innerHTML = element.innerHTML;

      // Convert <br>, <br/>, <br /> to \n
      text = innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '') // Remove other HTML tags
        .replace(/&nbsp;/g, ' ') // Convert &nbsp; to space
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
    }

    // Final fallback to textContent (won't have line breaks, but better than nothing)
    if (!text || !text.trim()) {
      text = element.textContent || '';
    }

    return text;
  }

  /**
   * Set up resize observer for responsive text positioning
   * Observes all 15 panels for size changes
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateTextPositions();
    });

    // Observe the canvas and all text containers
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.resizeObserver.observe(canvas);

    const observeTargets = [
      '#landing-panel',
      '#app-panel',
      '#app-bio-panel',
      '#navbar',
      // Portfolio panels
      '#portfolio-lakehouse-panel',
      '#portfolio-encryption-panel',
      '#portfolio-dotereditor-panel',
      '#portfolio-dreamrequiem-panel',
      '#portfolio-greenlightgo-panel',
      // Resume panels
      '#resume-playember-panel',
      '#resume-meta-panel',
      '#resume-outlier-panel',
      '#resume-uwtutor-panel',
      '#resume-uwedu-panel'
    ];

    observeTargets.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        this.resizeObserver!.observe(element);
      }
    });
  }

  /**
   * Update text element positions based on HTML element positions
   * With DOMCache, positions are calculated on-the-fly and cached
   */
  public updateTextPositions(): void {
    // Invalidate DOM cache to force recalculation
    this.domCache.invalidate();

    // Mark texture as needing update when positions change
    this.needsTextureUpdate = true;
  }

  /**
   * Get scene texture for external use
   */
  public getSceneTexture(): WebGLTexture | null {
    return this.sceneTexture;
  }

  /**
   * Set glow radius in pixels
   */
  public setGlowRadius(radius: number): void {
    this.glowRadius = Math.max(0, radius);
  }

  /**
   * Get current glow radius
   */
  public getGlowRadius(): number {
    return this.glowRadius;
  }

  /**
   * Set glow intensity (0-1 range recommended)
   */
  public setGlowIntensity(intensity: number): void {
    this.glowIntensity = Math.max(0, Math.min(1.5, intensity));
  }

  /**
   * Get current glow intensity
   */
  public getGlowIntensity(): number {
    return this.glowIntensity;
  }

  /**
   * Set glow wave reactivity (how much waves affect glow)
   */
  public setGlowWaveReactivity(reactivity: number): void {
    this.glowWaveReactivity = Math.max(0, Math.min(1, reactivity));
  }

  /**
   * Get current glow wave reactivity
   */
  public getGlowWaveReactivity(): number {
    return this.glowWaveReactivity;
  }

  /**
   * Get blur map texture for external use (e.g., GlassRenderer)
   */
  public getBlurMapTexture(): WebGLTexture | null {
    return this.blurMapTexture;
  }

  /**
   * Set blur radius in pixels
   */
  public setBlurRadius(radius: number): void {
    this.blurRadius = Math.max(0, Math.min(256, radius));
    this.needsBlurMapUpdate = true;
  }

  /**
   * Get current blur radius
   */
  public getBlurRadius(): number {
    return this.blurRadius;
  }

  /**
   * Set blur falloff power (controls how sharply blur fades with distance)
   * - power < 1.0: softer falloff, more spread
   * - power = 1.0: linear falloff
   * - power > 1.0: sharper falloff, tighter around text
   */
  public setBlurFalloffPower(power: number): void {
    this.blurFalloffPower = Math.max(0.5, Math.min(3.0, power));
    this.needsBlurMapUpdate = true;
  }

  /**
   * Get current blur falloff power
   */
  public getBlurFalloffPower(): number {
    return this.blurFalloffPower;
  }

  /**
   * Mark blur map as dirty to force regeneration on next render
   */
  public markBlurMapDirty(): void {
    this.needsBlurMapUpdate = true;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    const gl = this.gl;

    // Clean up framebuffer
    if (this.sceneFramebuffer) {
      gl.deleteFramebuffer(this.sceneFramebuffer);
      this.sceneFramebuffer = null;
    }

    if (this.sceneTexture) {
      gl.deleteTexture(this.sceneTexture);
      this.sceneTexture = null;
    }

    if (this.sceneDepthBuffer) {
      gl.deleteRenderbuffer(this.sceneDepthBuffer);
      this.sceneDepthBuffer = null;
    }

    if (this.textTexture) {
      gl.deleteTexture(this.textTexture);
      this.textTexture = null;
    }

    // Clean up blur map framebuffer
    if (this.blurMapFramebuffer) {
      gl.deleteFramebuffer(this.blurMapFramebuffer);
      this.blurMapFramebuffer = null;
    }

    if (this.blurMapTexture) {
      gl.deleteTexture(this.blurMapTexture);
      this.blurMapTexture = null;
    }

    if (this.blurMapDepthBuffer) {
      gl.deleteRenderbuffer(this.blurMapDepthBuffer);
      this.blurMapDepthBuffer = null;
    }

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up DOM cache
    this.domCache.clear();

    // Clean up geometry
    this.bufferManager.dispose();

    // Clear text elements
    this.textElements.clear();
  }
}
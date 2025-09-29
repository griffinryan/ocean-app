/**
 * Text Renderer with Per-Pixel Adaptive Coloring
 * Analyzes ocean+glass background and renders text with WebGL shader for per-pixel color adaptation
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';

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

    // Initialize text canvas for rasterization
    this.initializeTextCanvas();

    // Initialize framebuffer for scene capture
    this.initializeFramebuffer();

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
        'u_panelCount'
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
   * Render individual text element to canvas using actual screen coordinates
   * Accounts for complete CSS box model (border, padding, line-height)
   */
  private renderTextToCanvas(element: HTMLElement, _config: TextElementConfig): void {
    const ctx = this.textContext;
    const glCanvas = this.gl.canvas as HTMLCanvasElement;
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

    // Get CSS box model dimensions
    // These determine where text actually appears vs where border box is
    const paddingTop = parseFloat(styles.paddingTop);
    const paddingLeft = parseFloat(styles.paddingLeft);
    const paddingRight = parseFloat(styles.paddingRight);
    const borderTopWidth = parseFloat(styles.borderTopWidth);
    const borderLeftWidth = parseFloat(styles.borderLeftWidth);
    const borderRightWidth = parseFloat(styles.borderRightWidth);

    // Calculate position in canvas pixel coordinates
    // getBoundingClientRect() returns border box edge
    const relativeX = elementRect.left - canvasRect.left;
    const relativeY = elementRect.top - canvasRect.top;

    // Add border and padding to get to content area where text actually renders
    const contentOffsetX = borderLeftWidth + paddingLeft;
    const contentOffsetY = borderTopWidth + paddingTop;

    // Calculate line-height leading (extra vertical space distributed around text)
    // This centers text vertically within its line box
    const leading = (lineHeightPx - fontSize) / 2;

    // Scale to canvas texture size (which matches WebGL canvas pixel-for-pixel)
    const scaleX = this.textCanvas.width / canvasRect.width;
    const scaleY = this.textCanvas.height / canvasRect.height;

    // CRITICAL: Round to integer pixels to avoid subpixel blur
    // Apply all offsets (border + padding + leading) before scaling
    const canvasX = Math.round((relativeX + contentOffsetX) * scaleX);
    const canvasY = Math.round((relativeY + contentOffsetY + leading) * scaleY);
    const scaledFontSize = Math.round(fontSize * scaleY);
    const scaledLineHeight = Math.round(lineHeightPx * scaleY);

    // Set font properties
    ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';  // Consistent with our Y calculation
    ctx.textAlign = textAlign;
    ctx.fillStyle = 'white'; // Always white on canvas, shader will handle color adaptation

    // Get text content - use innerText to preserve line breaks from <br> tags
    const text = element.innerText || element.textContent || '';
    const lines = text.split('\n');

    // Calculate content width (excludes border and padding) for text alignment
    const contentWidth = elementRect.width - borderLeftWidth - borderRightWidth - paddingLeft - paddingRight;
    const contentWidthInCanvas = contentWidth * scaleX;

    // Adjust X position based on text alignment within content area
    let adjustedX = canvasX;
    if (textAlign === 'center') {
      adjustedX = canvasX + contentWidthInCanvas / 2;
    } else if (textAlign === 'right') {
      adjustedX = canvasX + contentWidthInCanvas;
    }

    // Render each line
    lines.forEach((line, index) => {
      const y = canvasY + (index * scaledLineHeight);

      // Ensure text stays within canvas bounds
      if (y >= 0 && y < this.textCanvas.height && line.trim().length > 0) {
        ctx.fillText(line, adjustedX, y);
      }
    });
  }

  /**
   * Generate text texture from all current text elements
   */
  private updateTextTexture(): void {
    if (!this.needsTextureUpdate || this.textElements.size === 0 || !this.fontsLoaded) {
      return;
    }

    const gl = this.gl;
    const ctx = this.textContext;

    // Clear canvas
    ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    // Render each text element to canvas (including hidden ones for smooth transitions)
    this.textElements.forEach((config) => {
      const element = document.querySelector(config.selector) as HTMLElement;
      if (element) {
        // Render text even if parent panel is hidden - WebGL shader will handle visibility
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
   * Get panel information for shader uniforms
   */
  private getPanelInfo(): { positions: Float32Array, sizes: Float32Array, count: number } {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    const panelIds = ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel', 'navbar'];
    const positions = new Float32Array(10); // 5 panels * 2 components (x,y)
    const sizes = new Float32Array(10);
    let validPanelCount = 0;

    panelIds.forEach((panelId) => {
      const element = document.getElementById(panelId);
      if (element && !element.classList.contains('hidden') && canvasRect.width > 0 && canvasRect.height > 0) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);

          positions[validPanelCount * 2] = normalizedPos.position[0];
          positions[validPanelCount * 2 + 1] = normalizedPos.position[1];
          sizes[validPanelCount * 2] = normalizedPos.size[0];
          sizes[validPanelCount * 2 + 1] = normalizedPos.size[1];
          validPanelCount++;
        }
      }
    });

    return { positions, sizes, count: validPanelCount };
  }

  /**
   * Render all text elements with per-pixel adaptive coloring (RESTORED)
   */
  public render(): void {
    const gl = this.gl;

    if (!this.textProgram || !this.sceneTexture || this.textElements.size === 0) {
      return;
    }

    // Update text texture if needed
    this.updateTextTexture();

    // Use text shader program
    const program = this.shaderManager.useProgram('text');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time uniform for animation
    const currentTime = performance.now() / 1000.0;
    this.shaderManager.setUniform1f(program, 'u_time', currentTime);

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

      // App Panel
      { selector: '#app-panel > h2', id: 'app-title', panelId: 'app-panel' },
      { selector: '#app-panel > p', id: 'app-description', panelId: 'app-panel' },

      // Portfolio Panel
      { selector: '#portfolio-panel > h2', id: 'portfolio-title', panelId: 'portfolio-panel' },
      { selector: '#portfolio-panel > p', id: 'portfolio-description', panelId: 'portfolio-panel' },

      // Resume Panel
      { selector: '#resume-panel > h2', id: 'resume-title', panelId: 'resume-panel' },

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
    // Project cards in app panel
    const projectCards = document.querySelectorAll('#app-panel .project-card');
    projectCards.forEach((card, index) => {
      const h3 = card.querySelector('h3');
      const p = card.querySelector('p');

      if (h3) {
        this.addTextElement(`project-card-title-${index}`, {
          selector: `#app-panel .project-card:nth-child(${index + 1}) h3`,
          panelId: 'app-panel'
        });
      }

      if (p) {
        this.addTextElement(`project-card-desc-${index}`, {
          selector: `#app-panel .project-card:nth-child(${index + 1}) p`,
          panelId: 'app-panel'
        });
      }
    });

    // Project details in portfolio panel
    const projectDetails = document.querySelectorAll('#portfolio-panel .project-detail');
    projectDetails.forEach((detail, index) => {
      const h3 = detail.querySelector('h3');
      const p = detail.querySelector('p');

      if (h3) {
        this.addTextElement(`project-detail-title-${index}`, {
          selector: `#portfolio-panel .project-detail:nth-child(${index + 1}) h3`,
          panelId: 'portfolio-panel'
        });
      }

      if (p) {
        this.addTextElement(`project-detail-desc-${index}`, {
          selector: `#portfolio-panel .project-detail:nth-child(${index + 1}) p`,
          panelId: 'portfolio-panel'
        });
      }
    });

    // Resume sections
    const resumeSections = document.querySelectorAll('#resume-panel .resume-section');
    resumeSections.forEach((section, index) => {
      const h3 = section.querySelector('h3');
      const h4 = section.querySelector('h4');
      const p = section.querySelector('p');

      if (h3) {
        this.addTextElement(`resume-section-title-${index}`, {
          selector: `#resume-panel .resume-section:nth-child(${index + 1}) h3`,
          panelId: 'resume-panel'
        });
      }

      if (h4) {
        this.addTextElement(`resume-section-subtitle-${index}`, {
          selector: `#resume-panel .resume-section:nth-child(${index + 1}) h4`,
          panelId: 'resume-panel'
        });
      }

      if (p) {
        this.addTextElement(`resume-section-desc-${index}`, {
          selector: `#resume-panel .resume-section:nth-child(${index + 1}) p`,
          panelId: 'resume-panel'
        });
      }
    });

    // Skill tags
    const skillTags = document.querySelectorAll('#resume-panel .skill-tag');
    skillTags.forEach((_tag, index) => {
      this.addTextElement(`skill-tag-${index}`, {
        selector: `#resume-panel .skill-tag:nth-child(${index + 1})`,
        panelId: 'resume-panel'
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
   */
  private setupMutationObserver(): void {
    const observer = new MutationObserver(() => {
      this.needsTextureUpdate = true;
    });

    // Observe changes in text content
    const observeTargets = ['#landing-panel', '#app-panel', '#portfolio-panel', '#resume-panel', '#navbar'];

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
   * Set up resize observer for responsive text positioning
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateTextPositions();
    });

    // Observe the canvas and key text containers
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.resizeObserver.observe(canvas);

    const observeTargets = ['#landing-panel', '#app-panel', '#portfolio-panel', '#resume-panel', '#navbar'];

    observeTargets.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        this.resizeObserver!.observe(element);
      }
    });
  }

  /**
   * Update text element positions based on HTML element positions
   * With new coordinate system, positions are calculated on-the-fly during rendering
   */
  public updateTextPositions(): void {
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

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up geometry
    this.bufferManager.dispose();

    // Clear text elements
    this.textElements.clear();
  }
}
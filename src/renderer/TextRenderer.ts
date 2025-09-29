/**
 * Text Renderer with Adaptive Color and WebGL Overlay Effects
 * Renders text elements with background-aware color adaptation
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';

export interface TextElementConfig {
  position: [number, number]; // Screen position in normalized coordinates
  size: [number, number];     // Size in normalized coordinates
  content: string;            // Text content
  fontSize: number;           // Font size in pixels
  fontFamily: string;         // Font family
  fontWeight: string;         // Font weight (normal, bold, etc.)
  color: string;              // Fallback color for CSS compatibility
  textAlign: 'left' | 'center' | 'right'; // Text alignment
  lineHeight: number;         // Line height multiplier
  panelId: string;            // ID of the panel this text belongs to
  panelRelativePosition: [number, number]; // Position relative to panel [0,1]
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

  // Canvas for text generation
  private textCanvas!: HTMLCanvasElement;
  private textContext!: CanvasRenderingContext2D;
  private textTexture: WebGLTexture | null = null;

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Text element configurations organized by panel
  private textElements: Map<string, TextElementConfig> = new Map();
  private panelTextElements: Map<string, TextElementConfig[]> = new Map();

  // Animation and state
  private startTime: number;
  private needsTextureUpdate: boolean = false;

  // Scene texture caching for performance
  private sceneTextureDirty: boolean = true;
  private lastCaptureTime: number = 0;
  private captureThrottleMs: number = 16; // Max 60fps captures

  // Resize observer for responsive text positioning
  private resizeObserver: ResizeObserver | null = null;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Initialize matrices
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();

    // Create geometry for rendering text quads
    this.quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.quadGeometry);

    // Set up projection matrix for screen-space rendering
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Initialize text canvas
    this.initializeTextCanvas();

    // Initialize framebuffer for scene capture
    this.initializeFramebuffer();
  }

  /**
   * Initialize HTML canvas for text generation
   */
  private initializeTextCanvas(): void {
    this.textCanvas = document.createElement('canvas');
    this.textCanvas.width = 1024;
    this.textCanvas.height = 1024;

    const context = this.textCanvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D context for text canvas');
    }

    this.textContext = context;

    // Set up high-quality text rendering
    this.textContext.textBaseline = 'top';
    this.textContext.fillStyle = 'white';
    this.textContext.imageSmoothingEnabled = true;
    this.textContext.imageSmoothingQuality = 'high';
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
   * Initialize text shaders
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
  }

  /**
   * Capture current scene (ocean + glass) to texture for text background analysis
   * Now with caching to improve performance
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
   * Get panel information for shader uniforms (matching GlassRenderer approach)
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
   * Generate text texture from all current text elements
   */
  private updateTextTexture(): void {
    if (!this.needsTextureUpdate || this.textElements.size === 0) {
      return;
    }

    const gl = this.gl;
    const ctx = this.textContext;

    // Clear canvas
    ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    // Render each text element to canvas
    this.textElements.forEach((config) => {
      this.renderTextToCanvas(config, ctx);
    });

    // Update WebGL texture
    if (this.textTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
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
   * Render individual text element to canvas using panel-relative coordinates
   */
  private renderTextToCanvas(config: TextElementConfig, ctx: CanvasRenderingContext2D): void {
    // Set font properties
    const fontString = `${config.fontWeight} ${config.fontSize}px ${config.fontFamily}`;
    ctx.font = fontString;
    ctx.textAlign = config.textAlign;
    ctx.fillStyle = 'white'; // Always white on canvas, shader will handle color adaptation

    // Use panel-relative coordinates directly [0,1] range
    // No coordinate flipping needed since UV coordinates are now fixed
    const canvasX = config.panelRelativePosition[0] * this.textCanvas.width;
    const canvasY = config.panelRelativePosition[1] * this.textCanvas.height;

    // Handle multi-line text with proper line height
    const lines = config.content.split('\n');
    const lineHeight = config.fontSize * config.lineHeight;

    // Calculate adjusted Y position for text alignment
    let adjustedY = canvasY;

    // Adjust Y position based on text alignment
    if (config.textAlign === 'center') {
      // Center text vertically around the specified position
      adjustedY = canvasY - (lines.length * lineHeight) / 2;
    }

    // Render each line
    lines.forEach((line, index) => {
      const y = adjustedY + (index * lineHeight);

      // Ensure text stays within canvas bounds
      if (y > 0 && y < this.textCanvas.height) {
        ctx.fillText(line, canvasX, y);
      }
    });
  }

  /**
   * Set up text element tracking from HTML elements
   */
  public setupDefaultTextElements(): void {
    // Scan and setup text elements from the HTML
    this.scanAndSetupTextElements();

    // Set up mutation observer for dynamic content changes
    this.setupMutationObserver();

    // Set up resize observer for responsive positioning
    this.setupResizeObserver();

    // Update positions immediately
    this.updateTextPositions();

    // Mark scene as dirty when text elements change
    this.markSceneDirty();
  }

  /**
   * Scan HTML and automatically setup text elements
   */
  private scanAndSetupTextElements(): void {
    // Define text elements to track with their selectors and panel associations
    const textElementSelectors = [
      {
        selector: '#landing-panel h1',
        id: 'landing-title',
        panelId: 'landing-panel',
        fontSize: 48,
        fontWeight: '200',
        textAlign: 'center' as const,
        lineHeight: 1.2,
        panelRelativePosition: [0.5, 0.3] // Center horizontally, upper third
      },
      {
        selector: '#landing-panel .subtitle',
        id: 'landing-subtitle',
        panelId: 'landing-panel',
        fontSize: 22,
        fontWeight: '400',
        textAlign: 'center' as const,
        lineHeight: 1.2,
        panelRelativePosition: [0.5, 0.7] // Center horizontally, lower third
      },
      {
        selector: '#app-panel h2',
        id: 'app-title',
        panelId: 'app-panel',
        fontSize: 36,
        fontWeight: '500',
        textAlign: 'left' as const,
        lineHeight: 1.3,
        panelRelativePosition: [0.1, 0.2] // Left margin, top
      },
      {
        selector: '#app-panel p',
        id: 'app-description',
        panelId: 'app-panel',
        fontSize: 18,
        fontWeight: '400',
        textAlign: 'left' as const,
        lineHeight: 1.5,
        panelRelativePosition: [0.1, 0.6] // Left margin, middle
      },
      {
        selector: '#portfolio-panel h2',
        id: 'portfolio-title',
        panelId: 'portfolio-panel',
        fontSize: 36,
        fontWeight: '500',
        textAlign: 'left' as const,
        lineHeight: 1.3,
        panelRelativePosition: [0.1, 0.2] // Left margin, top
      },
      {
        selector: '#resume-panel h2',
        id: 'resume-title',
        panelId: 'resume-panel',
        fontSize: 36,
        fontWeight: '500',
        textAlign: 'left' as const,
        lineHeight: 1.3,
        panelRelativePosition: [0.1, 0.2] // Left margin, top
      },
      {
        selector: '.brand-text',
        id: 'nav-brand',
        panelId: 'navbar',
        fontSize: 24,
        fontWeight: '600',
        textAlign: 'left' as const,
        lineHeight: 1.0,
        panelRelativePosition: [0.05, 0.5] // Left edge, center
      },
      {
        selector: '.nav-label',
        id: 'nav-labels',
        panelId: 'navbar',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center' as const,
        lineHeight: 1.0,
        panelRelativePosition: [0.5, 0.5] // Will be updated for each label
      }
    ];

    // Clear existing panel text elements
    this.panelTextElements.clear();

    // Setup each text element
    textElementSelectors.forEach(config => {
      const element = document.querySelector(config.selector);
      if (element && element.textContent) {
        const textConfig: TextElementConfig = {
          position: [0.0, 0.0], // Will be updated by updateTextPositions
          size: [1.0, 0.2], // Will be updated by updateTextPositions
          content: element.textContent.trim(),
          fontSize: config.fontSize,
          fontFamily: getComputedStyle(element).fontFamily || '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
          fontWeight: config.fontWeight,
          color: getComputedStyle(element).color || 'white',
          textAlign: config.textAlign,
          lineHeight: config.lineHeight,
          panelId: config.panelId,
          panelRelativePosition: [config.panelRelativePosition[0], config.panelRelativePosition[1]]
        };

        // Add to main text elements map
        this.addTextElement(config.id, textConfig);

        // Add to panel-organized map
        if (!this.panelTextElements.has(config.panelId)) {
          this.panelTextElements.set(config.panelId, []);
        }
        this.panelTextElements.get(config.panelId)!.push(textConfig);
      }
    });
  }

  /**
   * Set up mutation observer to track content changes
   */
  private setupMutationObserver(): void {
    const observer = new MutationObserver((mutations) => {
      let needsUpdate = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        // Rescan text elements after DOM changes
        this.scanAndSetupTextElements();
        this.needsTextureUpdate = true;
      }
    });

    // Observe changes in text content
    const observeTargets = [
      '#landing-panel',
      '#app-panel',
      '#portfolio-panel',
      '#resume-panel',
      '#navbar'
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
   * Set up resize observer for responsive text positioning
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      // Update text positions when elements resize
      this.updateTextPositions();
    });

    // Observe the canvas and key text containers
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.resizeObserver.observe(canvas);

    const observeTargets = [
      '#landing-panel',
      '#app-panel',
      '#portfolio-panel',
      '#resume-panel',
      '#navbar'
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
   */
  public updateTextPositions(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    // Ensure canvas has valid dimensions
    if (canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('TextRenderer: Canvas has invalid dimensions, skipping text position update');
      return;
    }

    // Define element mappings for position updates
    const elementMappings = [
      { selector: '#landing-panel h1', id: 'landing-title' },
      { selector: '#landing-panel .subtitle', id: 'landing-subtitle' },
      { selector: '#app-panel h2', id: 'app-title' },
      { selector: '#app-panel p', id: 'app-description' },
      { selector: '#portfolio-panel h2', id: 'portfolio-title' },
      { selector: '#resume-panel h2', id: 'resume-title' },
      { selector: '.brand-text', id: 'nav-brand' },
      { selector: '.nav-label', id: 'nav-labels' }
    ];

    // Update positions for each mapped element
    elementMappings.forEach(mapping => {
      const element = document.querySelector(mapping.selector);
      if (element && !element.closest('.hidden')) {
        const rect = element.getBoundingClientRect();

        // Only update if element is visible and has valid dimensions
        if (rect.width > 0 && rect.height > 0) {
          const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);

          // Check if we have this text element tracked
          if (this.textElements.has(mapping.id)) {
            this.updateTextElement(mapping.id, {
              position: normalizedPos.position,
              size: normalizedPos.size,
              content: element.textContent?.trim() || ''
            });
          }
        }
      }
    });

    // Handle special case for navigation labels (multiple elements)
    const navLabels = document.querySelectorAll('.nav-label');
    if (navLabels.length > 0) {
      navLabels.forEach((label, index) => {
        const rect = label.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !label.closest('.hidden')) {
          const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);
          const id = `nav-label-${index}`;

          this.updateTextElement(id, {
            position: normalizedPos.position,
            size: normalizedPos.size,
            content: label.textContent?.trim() || ''
          });
        }
      });
    }
  }

  /**
   * Convert HTML element rect to normalized WebGL coordinates
   * (Exact copy from GlassRenderer for consistent positioning)
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    // Ensure we have valid rectangles
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('TextRenderer: Invalid rectangle dimensions detected');
      return { position: [0, 0], size: [0, 0] };
    }

    // Calculate center position in normalized coordinates (0 to 1)
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    // Convert to WebGL coordinates (-1 to 1, with Y flipped)
    const glX = centerX * 2.0 - 1.0;
    const glY = (1.0 - centerY) * 2.0 - 1.0; // Flip Y and convert to [-1,1]

    // Calculate size in normalized coordinates (as fraction of screen size * 2 for [-1,1] range)
    const width = (elementRect.width / canvasRect.width) * 2.0;
    const height = (elementRect.height / canvasRect.height) * 2.0;

    // Debug logging for positioning verification (remove after testing)
    console.debug(`TextRenderer Panel Mapping:
      Element: ${elementRect.width}x${elementRect.height} at (${elementRect.left}, ${elementRect.top})
      Canvas: ${canvasRect.width}x${canvasRect.height}
      WebGL Center: (${glX.toFixed(3)}, ${glY.toFixed(3)})
      WebGL Size: (${width.toFixed(3)}, ${height.toFixed(3)})`);

    return {
      position: [glX, glY],
      size: [width, height]
    };
  }

  /**
   * Render all text elements with adaptive coloring
   */
  public render(): void {
    const gl = this.gl;

    if (!this.textProgram || !this.sceneTexture || this.textElements.size === 0) {
      return;
    }

    // Update text texture if needed
    this.updateTextTexture();

    // Only update text positions if text texture was updated (positions likely changed)
    // This reduces expensive position calculations every frame
    if (this.needsTextureUpdate) {
      this.updateTextPositions();
      this.markSceneDirty();
    }

    // Use text shader program
    const program = this.shaderManager.useProgram('text');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time uniform for animation
    const currentTime = (performance.now() - this.startTime) / 1000.0;
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

    // Batched rendering: render all text elements in single pass
    // Since all text is in one texture, we only need one draw call for the full-screen quad
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Re-enable depth testing
    gl.enable(gl.DEPTH_TEST);
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

    // Clean up geometry
    this.bufferManager.dispose();

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear text elements
    this.textElements.clear();
  }
}
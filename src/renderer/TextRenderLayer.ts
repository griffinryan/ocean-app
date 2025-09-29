/**
 * Text Render Layer - Renders HTML text to WebGL textures for per-pixel adaptive coloring
 * This system captures text layout from the DOM and creates textures that can be composited
 * with per-pixel logic in shaders for true adaptive text coloring.
 */

export interface TextElement {
  id: string;
  element: HTMLElement;
  bounds: DOMRect;
  lastUpdate: number;
  visible: boolean;
}

export interface TextRenderConfig {
  enableHighDPI: boolean;
  textureSize: { width: number; height: number };
  updateFrequency: number; // Hz
  debugMode: boolean;
  fontScaling: number; // Scale factor for crisp text rendering
}

export class TextRenderLayer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  // Off-screen canvas for text rendering
  private textCanvas: HTMLCanvasElement;
  private textContext: CanvasRenderingContext2D;

  // WebGL texture resources
  private textTexture: WebGLTexture | null = null;
  private textureWidth: number = 0;
  private textureHeight: number = 0;

  // Text element tracking
  private textElements: Map<string, TextElement> = new Map();
  private needsUpdate: boolean = true;
  private lastUpdate: number = 0;

  // Configuration
  private config: TextRenderConfig = {
    enableHighDPI: true,
    textureSize: { width: 1920, height: 1080 },
    updateFrequency: 15, // 15 Hz for text updates (slower than ocean)
    debugMode: false,
    fontScaling: 2.0 // 2x for crisp text
  };

  // Performance tracking
  private renderTime: number = 0;
  private textureUpdateCount: number = 0;

  constructor(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    config?: Partial<TextRenderConfig>
  ) {
    this.gl = gl;
    this.canvas = canvas;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Create off-screen canvas for text rendering
    this.textCanvas = document.createElement('canvas');
    const context = this.textCanvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2D context for text rendering');
    }
    this.textContext = context;

    // Initialize WebGL resources
    this.initializeTexture();

    // Set up resize observer to track canvas changes
    this.setupResizeObserver();

    console.log('TextRenderLayer initialized successfully!');
  }

  /**
   * Initialize WebGL texture for text rendering
   */
  private initializeTexture(): void {
    const gl = this.gl;

    // Calculate texture size based on canvas size and config
    this.updateTextureSize();

    // Create WebGL texture
    this.textTexture = gl.createTexture();
    if (!this.textTexture) {
      throw new Error('Failed to create text texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);

    // Set up texture parameters for crisp text
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Initialize with transparent black
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      this.textureWidth, this.textureHeight, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    console.log(`Text texture initialized: ${this.textureWidth}x${this.textureHeight}`);
  }

  /**
   * Update texture size based on canvas and configuration
   */
  private updateTextureSize(): void {
    const canvasRect = this.canvas.getBoundingClientRect();
    const devicePixelRatio = this.config.enableHighDPI ? (window.devicePixelRatio || 1) : 1;

    // Use actual canvas size scaled by device pixel ratio and font scaling
    this.textureWidth = Math.round(canvasRect.width * devicePixelRatio * this.config.fontScaling);
    this.textureHeight = Math.round(canvasRect.height * devicePixelRatio * this.config.fontScaling);

    // Ensure texture size is power of 2 for better performance (optional)
    // this.textureWidth = this.nearestPowerOfTwo(this.textureWidth);
    // this.textureHeight = this.nearestPowerOfTwo(this.textureHeight);

    // Update off-screen canvas size
    this.textCanvas.width = this.textureWidth;
    this.textCanvas.height = this.textureHeight;

    // Set up high-DPI rendering context
    this.textContext.scale(this.config.fontScaling, this.config.fontScaling);

    // Configure text rendering quality
    this.textContext.textAlign = 'left';
    this.textContext.textBaseline = 'top';
    this.textContext.imageSmoothingEnabled = true;
    this.textContext.imageSmoothingQuality = 'high';
  }

  /**
   * Set up resize observer to handle canvas size changes
   */
  private setupResizeObserver(): void {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this.canvas) {
          this.updateTextureSize();
          this.resizeTexture();
          this.markForUpdate();
        }
      }
    });

    resizeObserver.observe(this.canvas);
  }

  /**
   * Resize the WebGL texture when canvas size changes
   */
  private resizeTexture(): void {
    if (!this.textTexture) return;

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      this.textureWidth, this.textureHeight, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    console.log(`Text texture resized: ${this.textureWidth}x${this.textureHeight}`);
  }

  /**
   * Register a text element for rendering
   */
  registerTextElement(id: string, element: HTMLElement): void {
    const bounds = element.getBoundingClientRect();

    this.textElements.set(id, {
      id,
      element,
      bounds,
      lastUpdate: 0,
      visible: this.isElementVisible(element)
    });

    this.markForUpdate();
    console.log(`Registered text element: ${id}`);
  }

  /**
   * Unregister a text element
   */
  unregisterTextElement(id: string): void {
    if (this.textElements.delete(id)) {
      this.markForUpdate();
      console.log(`Unregistered text element: ${id}`);
    }
  }

  /**
   * Check if an element is visible and should be rendered
   */
  private isElementVisible(element: HTMLElement): boolean {
    return element.offsetParent !== null &&
           !element.classList.contains('hidden') &&
           window.getComputedStyle(element).visibility !== 'hidden' &&
           window.getComputedStyle(element).opacity !== '0';
  }

  /**
   * Update bounds for all registered text elements
   */
  updateElementBounds(): void {
    let needsUpdate = false;

    this.textElements.forEach((textElement) => {
      const newBounds = textElement.element.getBoundingClientRect();
      const newVisible = this.isElementVisible(textElement.element);

      // Check if bounds or visibility changed significantly
      if (this.boundsChanged(textElement.bounds, newBounds) ||
          textElement.visible !== newVisible) {
        textElement.bounds = newBounds;
        textElement.visible = newVisible;
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      this.markForUpdate();
    }
  }

  /**
   * Check if element bounds changed significantly
   */
  private boundsChanged(oldBounds: DOMRect, newBounds: DOMRect): boolean {
    const threshold = 1; // 1 pixel threshold
    return Math.abs(oldBounds.x - newBounds.x) > threshold ||
           Math.abs(oldBounds.y - newBounds.y) > threshold ||
           Math.abs(oldBounds.width - newBounds.width) > threshold ||
           Math.abs(oldBounds.height - newBounds.height) > threshold;
  }

  /**
   * Mark the text layer for update on next frame
   */
  markForUpdate(): void {
    this.needsUpdate = true;
  }

  /**
   * Render all text elements to the off-screen canvas
   */
  private renderTextToCanvas(): void {
    const startTime = performance.now();
    const canvasRect = this.canvas.getBoundingClientRect();
    const devicePixelRatio = this.config.enableHighDPI ? (window.devicePixelRatio || 1) : 1;

    // Clear the text canvas
    this.textContext.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    // Debug: fill with semi-transparent background if debug mode is on
    if (this.config.debugMode) {
      this.textContext.fillStyle = 'rgba(255, 0, 0, 0.1)';
      this.textContext.fillRect(0, 0, this.textCanvas.width, this.textCanvas.height);
    }

    // Render each visible text element
    this.textElements.forEach((textElement) => {
      if (!textElement.visible) return;

      const element = textElement.element;
      const bounds = textElement.bounds;

      // Calculate position relative to canvas
      const x = (bounds.left - canvasRect.left) * devicePixelRatio;
      const y = (bounds.top - canvasRect.top) * devicePixelRatio;
      const width = bounds.width * devicePixelRatio;
      const height = bounds.height * devicePixelRatio;

      // Skip if element is outside canvas bounds
      if (x + width < 0 || y + height < 0 ||
          x > this.textCanvas.width || y > this.textCanvas.height) {
        return;
      }

      // Get computed styles from the element
      const computedStyle = window.getComputedStyle(element);
      const fontSize = parseFloat(computedStyle.fontSize) * devicePixelRatio;
      const fontFamily = computedStyle.fontFamily;
      const fontWeight = computedStyle.fontWeight;
      const color = this.config.debugMode ? '#ff0000' : '#ffffff'; // Red in debug mode, white otherwise

      // Set up text rendering style
      this.textContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      this.textContext.fillStyle = color;
      this.textContext.textAlign = 'left';
      this.textContext.textBaseline = 'top';

      // Render text content
      const textContent = element.textContent || '';
      if (textContent.trim()) {
        // Handle multi-line text
        const lines = this.wrapText(textContent, width / devicePixelRatio, computedStyle);
        const lineHeight = fontSize * 1.2; // Standard line height

        lines.forEach((line, index) => {
          const lineY = y + (index * lineHeight);
          if (lineY < this.textCanvas.height) {
            this.textContext.fillText(line, x, lineY);
          }
        });
      }

      // Debug: draw element bounds
      if (this.config.debugMode) {
        this.textContext.strokeStyle = '#ff0000';
        this.textContext.lineWidth = 1;
        this.textContext.strokeRect(x, y, width, height);
      }
    });

    this.renderTime = performance.now() - startTime;
  }

  /**
   * Wrap text to fit within specified width
   */
  private wrapText(text: string, maxWidth: number, _style: CSSStyleDeclaration): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    // For simplicity, we'll do basic word wrapping
    // In a production system, you might want more sophisticated text layout
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = this.textContext.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text]; // Fallback to original text
  }

  /**
   * Update the WebGL texture from the canvas
   */
  private updateTexture(): void {
    if (!this.textTexture) return;

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);

    // Handle premultiplied alpha correctly
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    // Upload canvas data to texture
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      this.textCanvas
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    this.textureUpdateCount++;
  }

  /**
   * Update the text layer (call from render loop)
   */
  update(): void {
    const now = performance.now();
    const deltaTime = now - this.lastUpdate;
    const updateInterval = 1000 / this.config.updateFrequency;

    // Throttle updates to target frequency
    if (deltaTime < updateInterval && !this.needsUpdate) return;

    // Update element bounds first
    this.updateElementBounds();

    // Render text to canvas if needed
    if (this.needsUpdate) {
      this.renderTextToCanvas();
      this.updateTexture();
      this.needsUpdate = false;
      this.lastUpdate = now;
    }
  }

  /**
   * Get the text texture for use in shaders
   */
  getTextTexture(): WebGLTexture | null {
    return this.textTexture;
  }

  /**
   * Get texture dimensions
   */
  getTextureDimensions(): { width: number; height: number } {
    return { width: this.textureWidth, height: this.textureHeight };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TextRenderConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };

    // Check if we need to resize texture
    if (oldConfig.enableHighDPI !== this.config.enableHighDPI ||
        oldConfig.fontScaling !== this.config.fontScaling) {
      this.updateTextureSize();
      this.resizeTexture();
      this.markForUpdate();
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): {
    elementCount: number;
    lastRenderTime: number;
    textureUpdateCount: number;
    textureSize: { width: number; height: number };
  } {
    return {
      elementCount: this.textElements.size,
      lastRenderTime: this.renderTime,
      textureUpdateCount: this.textureUpdateCount,
      textureSize: { width: this.textureWidth, height: this.textureHeight }
    };
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    if (this.config.debugMode !== enabled) {
      this.config.debugMode = enabled;
      this.markForUpdate();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    const gl = this.gl;

    if (this.textTexture) {
      gl.deleteTexture(this.textTexture);
      this.textTexture = null;
    }

    this.textElements.clear();

    console.log('TextRenderLayer disposed');
  }
}
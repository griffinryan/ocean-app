/**
 * Text Renderer with Ocean Color Inverse Mapping
 * Renders text with colors automatically inverted based on ocean background for optimal legibility
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { FontAtlas, TextMeshData } from '../utils/FontAtlas';
import { Mat4 } from '../utils/math';

export interface TextElement {
  id: string;                    // Unique identifier
  element: HTMLElement;          // Associated HTML element
  text: string;                  // Text content
  fontSize: number;              // Font size in pixels
  position: [number, number];    // Screen position
  bounds: { width: number; height: number }; // Text bounds
  visible: boolean;              // Visibility state
  needsUpdate: boolean;          // Whether mesh needs regeneration
  meshData?: TextMeshData;       // Generated mesh data
  buffers?: {                    // WebGL buffers
    vertex: WebGLBuffer;
    index: WebGLBuffer;
  };
}

export interface TextRenderConfig {
  enableWaveSync: boolean;       // Enable wave-synchronized animations
  defaultOpacity: number;        // Default text opacity
  updateFrequency: number;       // How often to check for updates (ms)
}

export class TextRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private fontAtlas: FontAtlas;
  private textProgram: ShaderProgram | null = null;

  // Text elements tracking
  private textElements: Map<string, TextElement> = new Map();

  // Matrices for 2D text positioning
  private projectionMatrix: Mat4 = new Mat4();
  private viewMatrix: Mat4 = new Mat4();

  // Configuration
  private config: TextRenderConfig = {
    enableWaveSync: true,
    defaultOpacity: 0.95,
    updateFrequency: 100 // Check for updates every 100ms
  };

  // Performance tracking
  private lastPositionUpdate: number = 0;
  private positionUpdateInterval: number = 16; // ~60fps

  // Resize observer for tracking element changes
  private resizeObserver: ResizeObserver;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.fontAtlas = new FontAtlas(gl);

    // Initialize view matrix as identity
    this.viewMatrix.identity();

    // Set up resize observer for tracking HTML element changes
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const textElement = this.findTextElementByHTMLElement(element);
        if (textElement) {
          textElement.needsUpdate = true;
        }
      }
    });
  }

  /**
   * Update projection matrix for current canvas dimensions
   */
  public updateProjectionMatrix(canvasWidth: number, canvasHeight: number): void {
    // Create orthographic projection matrix for 2D screen-space rendering
    // Left: 0, Right: canvasWidth, Bottom: canvasHeight, Top: 0 (Y-flipped for screen coords)
    this.projectionMatrix.ortho(0, canvasWidth, canvasHeight, 0, -1, 1);
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
        'u_textPosition',
        'u_textScale',
        'u_time',
        'u_resolution',
        'u_aspectRatio',
        'u_fontTexture',
        'u_oceanTexture',
        'u_textOpacity',
        'u_fontSize',
        'u_enableWaveSync'
      ];

      const attributes = [
        'a_position',
        'a_texCoord'
      ];

      // Create text shader program
      this.textProgram = this.shaderManager.createProgram(
        'text',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      console.log('Text shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text shaders:', error);
      throw error;
    }
  }

  /**
   * Add a text element for rendering
   */
  public addTextElement(id: string, element: HTMLElement, fontSize: number = 32): void {
    if (this.textElements.has(id)) {
      console.warn(`Text element '${id}' already exists, updating...`);
      this.removeTextElement(id);
    }

    const textContent = this.extractTextContent(element);
    const bounds = this.fontAtlas.measureText(textContent, fontSize);

    const textElement: TextElement = {
      id,
      element,
      text: textContent,
      fontSize,
      position: [0, 0], // Will be updated in updateElementPositions
      bounds,
      visible: !element.classList.contains('hidden'),
      needsUpdate: true
    };

    this.textElements.set(id, textElement);

    // Start observing this element for changes
    this.resizeObserver.observe(element);

    // Generate initial mesh
    this.generateTextMesh(textElement);
  }

  /**
   * Remove a text element
   */
  public removeTextElement(id: string): void {
    const textElement = this.textElements.get(id);
    if (!textElement) return;

    // Stop observing element
    this.resizeObserver.unobserve(textElement.element);

    // Clean up WebGL buffers
    if (textElement.buffers) {
      this.gl.deleteBuffer(textElement.buffers.vertex);
      this.gl.deleteBuffer(textElement.buffers.index);
    }

    this.textElements.delete(id);
  }

  /**
   * Update text element content
   */
  public updateTextElement(id: string, newText?: string, newFontSize?: number): void {
    const textElement = this.textElements.get(id);
    if (!textElement) return;

    let needsUpdate = false;

    if (newText !== undefined && newText !== textElement.text) {
      textElement.text = newText;
      needsUpdate = true;
    }

    if (newFontSize !== undefined && newFontSize !== textElement.fontSize) {
      textElement.fontSize = newFontSize;
      needsUpdate = true;
    }

    if (needsUpdate) {
      textElement.bounds = this.fontAtlas.measureText(textElement.text, textElement.fontSize);
      textElement.needsUpdate = true;
    }
  }

  /**
   * Extract text content from HTML element
   */
  private extractTextContent(element: HTMLElement): string {
    // Get text content but preserve line breaks
    let text = '';

    function extractFromNode(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const elem = node as Element;

        // Add line break for block elements
        if (['DIV', 'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(elem.tagName)) {
          if (text.length > 0 && !text.endsWith('\n')) {
            text += '\n';
          }
        }

        // Recursively process child nodes
        for (const child of Array.from(node.childNodes)) {
          extractFromNode(child);
        }
      }
    }

    extractFromNode(element);
    return text.trim();
  }

  /**
   * Generate mesh data for text element
   */
  private generateTextMesh(textElement: TextElement): void {
    if (!this.fontAtlas.isReady()) {
      console.warn('Font atlas not ready, skipping mesh generation');
      return;
    }

    try {
      // Generate mesh data
      textElement.meshData = this.fontAtlas.generateTextMesh(textElement.text, textElement.fontSize);

      // Create or update WebGL buffers
      this.createTextBuffers(textElement);

      textElement.needsUpdate = false;
    } catch (error) {
      console.error(`Failed to generate mesh for text element '${textElement.id}':`, error);
    }
  }

  /**
   * Create WebGL buffers for text element
   */
  private createTextBuffers(textElement: TextElement): void {
    const gl = this.gl;
    const meshData = textElement.meshData;

    if (!meshData) return;

    // Clean up existing buffers
    if (textElement.buffers) {
      gl.deleteBuffer(textElement.buffers.vertex);
      gl.deleteBuffer(textElement.buffers.index);
    }

    // Create vertex buffer
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error('Failed to create vertex buffer');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, meshData.vertices, gl.STATIC_DRAW);

    // Create index buffer
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
      throw new Error('Failed to create index buffer');
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.indices, gl.STATIC_DRAW);

    textElement.buffers = {
      vertex: vertexBuffer,
      index: indexBuffer
    };

    // Unbind buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  /**
   * Update positions of all text elements based on their HTML counterparts
   */
  public updateElementPositions(canvasRect: DOMRect): void {
    const now = performance.now();

    // Throttle position updates for performance
    if (now - this.lastPositionUpdate < this.positionUpdateInterval) {
      return;
    }

    this.lastPositionUpdate = now;

    for (const textElement of this.textElements.values()) {
      const elementRect = textElement.element.getBoundingClientRect();

      // Check visibility
      textElement.visible = !textElement.element.classList.contains('hidden') &&
                           elementRect.width > 0 && elementRect.height > 0;

      // Update position if element is visible
      if (textElement.visible && canvasRect.width > 0 && canvasRect.height > 0) {
        // Calculate position relative to canvas in screen coordinates
        // Use element's top-left corner as the text origin
        const x = elementRect.left - canvasRect.left;
        const y = elementRect.top - canvasRect.top;

        // Get computed styles for proper text positioning
        const computedStyle = window.getComputedStyle(textElement.element);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;

        // Position text at the content area (inside padding)
        textElement.position = [x + paddingLeft, y + paddingTop];

        // Check if text content has changed
        const currentText = this.extractTextContent(textElement.element);
        if (currentText !== textElement.text) {
          textElement.text = currentText;
          textElement.bounds = this.fontAtlas.measureText(textElement.text, textElement.fontSize);
          textElement.needsUpdate = true;
        }
      }

      // Update mesh if needed
      if (textElement.needsUpdate && textElement.visible) {
        this.generateTextMesh(textElement);
      }
    }
  }

  /**
   * Render all text elements
   */
  public render(oceanTexture: WebGLTexture, time: number, canvasWidth: number, canvasHeight: number): void {
    if (!this.textProgram || !this.fontAtlas.isReady()) {
      return;
    }

    const gl = this.gl;

    // Use text shader program
    const program = this.shaderManager.useProgram('text');

    // Update projection matrix for current canvas dimensions
    this.updateProjectionMatrix(canvasWidth, canvasHeight);

    // Set matrix uniforms
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set global uniforms
    this.shaderManager.setUniform1f(program, 'u_time', time);
    this.shaderManager.setUniform2f(program, 'u_resolution', canvasWidth, canvasHeight);
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', canvasWidth / canvasHeight);
    this.shaderManager.setUniform1f(program, 'u_textOpacity', this.config.defaultOpacity);
    this.shaderManager.setUniform1i(program, 'u_enableWaveSync', this.config.enableWaveSync ? 1 : 0);

    // Bind font texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fontAtlas.getTexture());
    this.shaderManager.setUniform1i(program, 'u_fontTexture', 0);

    // Bind ocean texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 1);

    // Enable blending for text transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable depth testing for overlay rendering
    gl.disable(gl.DEPTH_TEST);

    // Get attribute locations
    const positionLocation = this.textProgram.attributeLocations.get('a_position');
    const texCoordLocation = this.textProgram.attributeLocations.get('a_texCoord');

    if (positionLocation === undefined || texCoordLocation === undefined) {
      console.error('Text shader attribute locations not found');
      return;
    }

    // Render each visible text element
    for (const textElement of this.textElements.values()) {
      if (!textElement.visible || !textElement.meshData || !textElement.buffers) {
        continue;
      }

      this.renderTextElement(textElement, program, positionLocation, texCoordLocation);
    }

    // Re-enable depth testing
    gl.enable(gl.DEPTH_TEST);

    // Reset texture bindings
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Render individual text element
   */
  private renderTextElement(
    textElement: TextElement,
    program: ShaderProgram,
    positionLocation: number,
    texCoordLocation: number
  ): void {
    const gl = this.gl;

    if (!textElement.meshData || !textElement.buffers) return;

    // Set up scissor test to clip text to element bounds
    const elementRect = textElement.element.getBoundingClientRect();
    const canvasRect = (this.gl.canvas instanceof HTMLCanvasElement)
      ? this.gl.canvas.getBoundingClientRect()
      : { left: 0, top: 0, width: this.gl.canvas.width, height: this.gl.canvas.height, bottom: this.gl.canvas.height, right: this.gl.canvas.width };

    // Calculate scissor rectangle in WebGL coordinates (bottom-left origin)
    const scissorX = Math.max(0, elementRect.left - canvasRect.left);
    const scissorY = Math.max(0, canvasRect.height - (elementRect.bottom - canvasRect.top));
    const scissorWidth = Math.min(elementRect.width, canvasRect.width - scissorX);
    const scissorHeight = Math.min(elementRect.height, canvasRect.height - scissorY);

    // Only render if scissor area is valid
    if (scissorWidth > 0 && scissorHeight > 0) {
      // Enable scissor test for clipping
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.floor(scissorX * devicePixelRatio),
        Math.floor(scissorY * devicePixelRatio),
        Math.floor(scissorWidth * devicePixelRatio),
        Math.floor(scissorHeight * devicePixelRatio)
      );

      // Set text-specific uniforms
      this.shaderManager.setUniform2f(program, 'u_textPosition', textElement.position[0], textElement.position[1]);
      this.shaderManager.setUniform2f(program, 'u_textScale', 1.0, 1.0);
      this.shaderManager.setUniform1f(program, 'u_fontSize', textElement.fontSize);

      // Bind vertex buffer and set up attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, textElement.buffers.vertex);

      // Position attribute (x, y)
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0); // 4 floats * 4 bytes, offset 0

      // Texture coordinate attribute (u, v)
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8); // 4 floats * 4 bytes, offset 8

      // Bind index buffer and render
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, textElement.buffers.index);
      gl.drawElements(gl.TRIANGLES, textElement.meshData.indexCount, gl.UNSIGNED_SHORT, 0);

      // Clean up
      gl.disableVertexAttribArray(positionLocation);
      gl.disableVertexAttribArray(texCoordLocation);

      // Disable scissor test
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  /**
   * Find text element by HTML element
   */
  private findTextElementByHTMLElement(htmlElement: HTMLElement): TextElement | null {
    for (const textElement of this.textElements.values()) {
      if (textElement.element === htmlElement) {
        return textElement;
      }
    }
    return null;
  }

  /**
   * Set configuration options
   */
  public setConfig(newConfig: Partial<TextRenderConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  public getConfig(): TextRenderConfig {
    return { ...this.config };
  }

  /**
   * Set visibility for specific text element
   */
  public setTextElementVisible(id: string, visible: boolean): void {
    const textElement = this.textElements.get(id);
    if (textElement) {
      textElement.visible = visible;
    }
  }

  /**
   * Activate WebGL text rendering and hide HTML text
   */
  public activateWebGLText(debug: boolean = false): void {
    for (const textElement of this.textElements.values()) {
      // Add class to hide HTML text
      textElement.element.classList.add('webgl-text-active');

      // Add debug class if in debug mode
      if (debug) {
        textElement.element.classList.add('webgl-text-debug');
      }
    }
  }

  /**
   * Deactivate WebGL text rendering and show HTML text
   */
  public deactivateWebGLText(): void {
    for (const textElement of this.textElements.values()) {
      // Remove classes to show HTML text
      textElement.element.classList.remove('webgl-text-active', 'webgl-text-debug');
    }
  }

  /**
   * Toggle between WebGL and HTML text rendering
   */
  public toggleWebGLText(debug: boolean = false): boolean {
    const firstElement = this.textElements.values().next().value;
    if (!firstElement) return false;

    const isActive = firstElement.element.classList.contains('webgl-text-active');

    if (isActive) {
      this.deactivateWebGLText();
      return false;
    } else {
      this.activateWebGLText(debug);
      return true;
    }
  }

  /**
   * Get text element statistics
   */
  public getStats(): { totalElements: number; visibleElements: number; bufferedElements: number } {
    let visibleElements = 0;
    let bufferedElements = 0;

    for (const textElement of this.textElements.values()) {
      if (textElement.visible) visibleElements++;
      if (textElement.buffers) bufferedElements++;
    }

    return {
      totalElements: this.textElements.size,
      visibleElements,
      bufferedElements
    };
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    // Clean up all text elements
    for (const textElement of this.textElements.values()) {
      this.removeTextElement(textElement.id);
    }

    // Disconnect resize observer
    this.resizeObserver.disconnect();

    // Clean up font atlas
    this.fontAtlas.dispose();

    this.textElements.clear();
  }
}
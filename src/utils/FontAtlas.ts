/**
 * Font Atlas Management for SDF Text Rendering
 * Handles character mapping, texture generation, and geometry for text rendering
 */

export interface CharacterInfo {
  id: number;        // Character code
  x: number;         // X position in atlas texture
  y: number;         // Y position in atlas texture
  width: number;     // Character width in pixels
  height: number;    // Character height in pixels
  xoffset: number;   // X rendering offset
  yoffset: number;   // Y rendering offset
  xadvance: number;  // Horizontal advance for next character
  uvRect: [number, number, number, number]; // UV coordinates [u1, v1, u2, v2]
}

export interface FontMetrics {
  lineHeight: number;
  base: number;
  scaleW: number;    // Atlas texture width
  scaleH: number;    // Atlas texture height
}

export interface TextMeshData {
  vertices: Float32Array;    // Position + UV coordinates (x, y, u, v)
  indices: Uint16Array;      // Triangle indices
  vertexCount: number;
  indexCount: number;
}

export class FontAtlas {
  private gl: WebGL2RenderingContext;
  private characters: Map<number, CharacterInfo> = new Map();
  private fontTexture: WebGLTexture | null = null;
  private metrics: FontMetrics;
  private isLoaded: boolean = false;

  // Simple fallback character data for basic ASCII characters
  private readonly fallbackChars = this.generateFallbackCharacterSet();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    // Initialize with fallback metrics
    this.metrics = {
      lineHeight: 64,
      base: 52,
      scaleW: 512,
      scaleH: 512
    };

    this.initializeFallbackFont();
  }

  /**
   * Generate a simple fallback character set for basic ASCII
   */
  private generateFallbackCharacterSet(): Map<number, CharacterInfo> {
    const chars = new Map<number, CharacterInfo>();
    const gridSize = 16; // 16x16 grid for 256 characters
    const charSize = 32; // Each character is 32x32 pixels

    // Generate basic ASCII characters (32-126)
    for (let i = 32; i <= 126; i++) {
      const gridX = (i - 32) % gridSize;
      const gridY = Math.floor((i - 32) / gridSize);

      const x = gridX * charSize;
      const y = gridY * charSize;

      chars.set(i, {
        id: i,
        x: x,
        y: y,
        width: charSize - 4, // Slight padding
        height: charSize - 4,
        xoffset: 2,
        yoffset: 2,
        xadvance: charSize - 2,
        uvRect: [
          x / 512,                      // u1
          1.0 - (y + charSize) / 512,   // v1 (flipped)
          (x + charSize) / 512,         // u2
          1.0 - y / 512                 // v2 (flipped)
        ]
      });
    }

    return chars;
  }

  /**
   * Initialize a simple fallback font using canvas-generated SDF
   */
  private initializeFallbackFont(): void {
    // Create a simple SDF-like texture using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Set font properties
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px -apple-system, system-ui, sans-serif';

    // Clear background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = 'white';

    // Render characters to texture
    const gridSize = 16;
    const charSize = 32;

    for (let i = 32; i <= 126; i++) {
      const char = String.fromCharCode(i);
      const gridX = (i - 32) % gridSize;
      const gridY = Math.floor((i - 32) / gridSize);

      const x = gridX * charSize + charSize / 2;
      const y = gridY * charSize + charSize / 2;

      ctx.fillText(char, x, y);
    }

    // Create WebGL texture
    this.createTextureFromCanvas(canvas);
    this.characters = this.fallbackChars;
    this.isLoaded = true;
  }

  /**
   * Create WebGL texture from canvas
   */
  private createTextureFromCanvas(canvas: HTMLCanvasElement): void {
    const gl = this.gl;

    this.fontTexture = gl.createTexture();
    if (!this.fontTexture) {
      throw new Error('Failed to create font texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, this.fontTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    // Set texture parameters for SDF rendering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Generate mesh data for text string
   */
  public generateTextMesh(text: string, fontSize: number = 32): TextMeshData {
    if (!this.isLoaded) {
      throw new Error('Font atlas not loaded');
    }

    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    let x = 0;
    let y = 0;
    const scale = fontSize / this.metrics.lineHeight;

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);

      // Handle newlines
      if (charCode === 10) { // \n
        x = 0;
        y += this.metrics.lineHeight * scale;
        continue;
      }

      // Handle spaces
      if (charCode === 32) { // space
        x += fontSize * 0.5;
        continue;
      }

      const char = this.characters.get(charCode);
      if (!char) {
        // Skip unknown characters
        continue;
      }

      // Calculate quad positions
      const x1 = x + char.xoffset * scale;
      const y1 = y + char.yoffset * scale;
      const x2 = x1 + char.width * scale;
      const y2 = y1 + char.height * scale;

      // UV coordinates
      const [u1, v1, u2, v2] = char.uvRect;

      // Add vertices (x, y, u, v)
      vertices.push(
        // Top-left
        x1, y1, u1, v1,
        // Top-right
        x2, y1, u2, v1,
        // Bottom-right
        x2, y2, u2, v2,
        // Bottom-left
        x1, y2, u1, v2
      );

      // Add indices for two triangles
      const baseIndex = vertexIndex * 4;
      indices.push(
        baseIndex, baseIndex + 1, baseIndex + 2,
        baseIndex, baseIndex + 2, baseIndex + 3
      );

      vertexIndex++;
      x += char.xadvance * scale;
    }

    return {
      vertices: new Float32Array(vertices),
      indices: new Uint16Array(indices),
      vertexCount: vertices.length / 4, // 4 components per vertex
      indexCount: indices.length
    };
  }

  /**
   * Calculate text bounds
   */
  public measureText(text: string, fontSize: number = 32): { width: number; height: number } {
    if (!this.isLoaded) {
      return { width: 0, height: 0 };
    }

    let width = 0;
    let height = this.metrics.lineHeight;
    let lineWidth = 0;
    const scale = fontSize / this.metrics.lineHeight;

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);

      if (charCode === 10) { // \n
        width = Math.max(width, lineWidth);
        lineWidth = 0;
        height += this.metrics.lineHeight;
        continue;
      }

      if (charCode === 32) { // space
        lineWidth += fontSize * 0.5;
        continue;
      }

      const char = this.characters.get(charCode);
      if (char) {
        lineWidth += char.xadvance * scale;
      }
    }

    width = Math.max(width, lineWidth);

    return {
      width: width,
      height: height * scale
    };
  }

  /**
   * Get font texture for rendering
   */
  public getTexture(): WebGLTexture | null {
    return this.fontTexture;
  }

  /**
   * Get font metrics
   */
  public getMetrics(): FontMetrics {
    return this.metrics;
  }

  /**
   * Check if font is loaded
   */
  public isReady(): boolean {
    return this.isLoaded;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.fontTexture) {
      this.gl.deleteTexture(this.fontTexture);
      this.fontTexture = null;
    }
    this.characters.clear();
    this.isLoaded = false;
  }
}
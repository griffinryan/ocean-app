/**
 * Geometry utilities for generating mesh data
 */

export interface GeometryData {
  vertices: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
}

export class GeometryBuilder {
  /**
   * Create a subdivided plane geometry for ocean surface
   */
  static createPlane(
    width: number = 2,
    height: number = 2,
    widthSegments: number = 32,
    heightSegments: number = 32
  ): GeometryData {
    const verticesPerRow = widthSegments + 1;
    const verticesPerColumn = heightSegments + 1;
    const vertexCount = verticesPerRow * verticesPerColumn;

    // Each vertex has: position (x, y, z) + texcoord (u, v) = 5 floats
    const vertices = new Float32Array(vertexCount * 5);

    const stepX = width / widthSegments;
    const stepY = height / heightSegments;
    const stepU = 1.0 / widthSegments;
    const stepV = 1.0 / heightSegments;

    let vertexIndex = 0;

    // Generate vertices
    for (let j = 0; j <= heightSegments; j++) {
      for (let i = 0; i <= widthSegments; i++) {
        // Position (center the plane around origin)
        const x = (i * stepX) - width * 0.5;
        const y = 0; // Flat plane, waves will be in shader
        const z = (j * stepY) - height * 0.5;

        // Texture coordinates
        const u = i * stepU;
        const v = j * stepV;

        vertices[vertexIndex * 5 + 0] = x;
        vertices[vertexIndex * 5 + 1] = y;
        vertices[vertexIndex * 5 + 2] = z;
        vertices[vertexIndex * 5 + 3] = u;
        vertices[vertexIndex * 5 + 4] = v;

        vertexIndex++;
      }
    }

    // Generate indices for triangles
    const indexCount = widthSegments * heightSegments * 6; // 2 triangles per quad, 3 vertices per triangle
    const indices = new Uint16Array(indexCount);

    let indexOffset = 0;

    for (let j = 0; j < heightSegments; j++) {
      for (let i = 0; i < widthSegments; i++) {
        // Current quad corners
        const a = j * verticesPerRow + i;
        const b = j * verticesPerRow + i + 1;
        const c = (j + 1) * verticesPerRow + i + 1;
        const d = (j + 1) * verticesPerRow + i;

        // First triangle (a, b, d)
        indices[indexOffset + 0] = a;
        indices[indexOffset + 1] = b;
        indices[indexOffset + 2] = d;

        // Second triangle (b, c, d)
        indices[indexOffset + 3] = b;
        indices[indexOffset + 4] = c;
        indices[indexOffset + 5] = d;

        indexOffset += 6;
      }
    }

    return {
      vertices,
      indices,
      vertexCount,
      indexCount
    };
  }

  /**
   * Create a full-screen quad for shader-based rendering
   */
  static createFullScreenQuad(): GeometryData {
    // Simple quad covering the entire screen in normalized device coordinates
    const vertices = new Float32Array([
      // Position (x, y, z) + TexCoord (u, v)
      -1.0, -1.0, 0.0,   0.0, 0.0,  // Bottom-left
       1.0, -1.0, 0.0,   1.0, 0.0,  // Bottom-right
       1.0,  1.0, 0.0,   1.0, 1.0,  // Top-right
      -1.0,  1.0, 0.0,   0.0, 1.0   // Top-left
    ]);

    const indices = new Uint16Array([
      0, 1, 2,  // First triangle
      0, 2, 3   // Second triangle
    ]);

    return {
      vertices,
      indices,
      vertexCount: 4,
      indexCount: 6
    };
  }
}

/**
 * Buffer manager for WebGL vertex and index buffers
 */
export class BufferManager {
  private gl: WebGL2RenderingContext;
  public vertexBuffer: WebGLBuffer;
  public indexBuffer: WebGLBuffer;
  public vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext, geometry: GeometryData) {
    this.gl = gl;

    // Create vertex array object
    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error('Failed to create vertex array object');
    }
    this.vao = vao;

    // Create vertex buffer
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error('Failed to create vertex buffer');
    }
    this.vertexBuffer = vertexBuffer;

    // Create index buffer
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
      throw new Error('Failed to create index buffer');
    }
    this.indexBuffer = indexBuffer;

    // Upload geometry data
    this.uploadGeometry(geometry);
  }

  /**
   * Upload geometry data to GPU buffers
   */
  uploadGeometry(geometry: GeometryData): void {
    this.gl.bindVertexArray(this.vao);

    // Upload vertex data
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, geometry.vertices, this.gl.STATIC_DRAW);

    // Upload index data
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, geometry.indices, this.gl.STATIC_DRAW);

    this.gl.bindVertexArray(null);
  }

  /**
   * Set up vertex attributes for a shader program
   */
  setupAttributes(positionLocation: number, texcoordLocation?: number): void {
    this.gl.bindVertexArray(this.vao);

    // Position attribute (x, y, z) - 3 floats
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(positionLocation, 3, this.gl.FLOAT, false, 5 * 4, 0);

    // Texture coordinate attribute (u, v) - 2 floats, offset by 3 floats
    if (texcoordLocation !== undefined) {
      this.gl.enableVertexAttribArray(texcoordLocation);
      this.gl.vertexAttribPointer(texcoordLocation, 2, this.gl.FLOAT, false, 5 * 4, 3 * 4);
    }

    this.gl.bindVertexArray(null);
  }

  /**
   * Bind for rendering
   */
  bind(): void {
    this.gl.bindVertexArray(this.vao);
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteBuffer(this.indexBuffer);
    this.gl.deleteVertexArray(this.vao);
  }
}
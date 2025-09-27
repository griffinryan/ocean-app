/**
 * ShaderManager handles loading, compiling, and managing WebGL shaders
 */

export interface ShaderProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
  attributeLocations: Map<string, number>;
}

export class ShaderManager {
  private gl: WebGL2RenderingContext;
  private programs: Map<string, ShaderProgram> = new Map();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /**
   * Compile a single shader
   */
  private compileShader(source: string, type: number): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const error = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation error: ${error}`);
    }

    return shader;
  }

  /**
   * Create and link a shader program
   */
  createProgram(
    name: string,
    vertexSource: string,
    fragmentSource: string,
    uniforms: string[] = [],
    attributes: string[] = []
  ): ShaderProgram {
    // Compile shaders
    const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);

    // Create program
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error('Failed to create shader program');
    }

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const error = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`Shader program linking error: ${error}`);
    }

    // Clean up shaders (they're now linked to the program)
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);

    // Get uniform locations
    const uniformLocations = new Map<string, WebGLUniformLocation>();
    for (const uniform of uniforms) {
      const location = this.gl.getUniformLocation(program, uniform);
      if (location !== null) {
        uniformLocations.set(uniform, location);
      } else {
        console.warn(`Uniform '${uniform}' not found in shader program '${name}'`);
      }
    }

    // Get attribute locations
    const attributeLocations = new Map<string, number>();
    for (const attribute of attributes) {
      const location = this.gl.getAttribLocation(program, attribute);
      if (location !== -1) {
        attributeLocations.set(attribute, location);
      } else {
        console.warn(`Attribute '${attribute}' not found in shader program '${name}'`);
      }
    }

    const shaderProgram: ShaderProgram = {
      program,
      uniformLocations,
      attributeLocations
    };

    this.programs.set(name, shaderProgram);
    return shaderProgram;
  }

  /**
   * Get a shader program by name
   */
  getProgram(name: string): ShaderProgram | undefined {
    return this.programs.get(name);
  }

  /**
   * Use a shader program
   */
  useProgram(name: string): ShaderProgram {
    const shaderProgram = this.programs.get(name);
    if (!shaderProgram) {
      throw new Error(`Shader program '${name}' not found`);
    }

    this.gl.useProgram(shaderProgram.program);
    return shaderProgram;
  }

  /**
   * Set uniform values
   */
  setUniform1f(program: ShaderProgram, name: string, value: number): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform1f(location, value);
    }
  }

  setUniform1i(program: ShaderProgram, name: string, value: number): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform1i(location, value);
    }
  }

  setUniform2f(program: ShaderProgram, name: string, x: number, y: number): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform2f(location, x, y);
    }
  }

  setUniform3f(program: ShaderProgram, name: string, x: number, y: number, z: number): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform3f(location, x, y, z);
    }
  }

  setUniform4f(program: ShaderProgram, name: string, x: number, y: number, z: number, w: number): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform4f(location, x, y, z, w);
    }
  }

  setUniformMatrix4fv(program: ShaderProgram, name: string, matrix: Float32Array): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniformMatrix4fv(location, false, matrix);
    }
  }

  setUniform1fv(program: ShaderProgram, name: string, values: Float32Array): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform1fv(location, values);
    }
  }

  setUniform3fv(program: ShaderProgram, name: string, values: Float32Array): void {
    const location = program.uniformLocations.get(name);
    if (location) {
      this.gl.uniform3fv(location, values);
    }
  }

  /**
   * Set up vertex attributes
   */
  enableAttribute(program: ShaderProgram, name: string): number {
    const location = program.attributeLocations.get(name);
    if (location !== undefined) {
      this.gl.enableVertexAttribArray(location);
      return location;
    }
    throw new Error(`Attribute '${name}' not found`);
  }

  setAttributePointer(
    location: number,
    size: number,
    type: number = this.gl.FLOAT,
    normalized: boolean = false,
    stride: number = 0,
    offset: number = 0
  ): void {
    this.gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
  }

  /**
   * Clean up all shader programs
   */
  dispose(): void {
    for (const [, shaderProgram] of this.programs) {
      this.gl.deleteProgram(shaderProgram.program);
    }
    this.programs.clear();
  }
}
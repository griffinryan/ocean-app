/**
 * Navier-Stokes fluid simulator for ocean current simulation
 * Based on Jos Stam's "Stable Fluids" method
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { BufferManager, GeometryBuilder } from './Geometry';

export interface FluidParameters {
  viscosity: number;
  dissipation: number;
  pressureIterations: number;
  gridSize: number;
}

export class FluidSimulator {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private params: FluidParameters;

  // Shader programs
  private advectionProgram: ShaderProgram | null = null;
  private diffusionProgram: ShaderProgram | null = null;
  private divergenceProgram: ShaderProgram | null = null;
  private pressureProgram: ShaderProgram | null = null;
  private projectionProgram: ShaderProgram | null = null;

  // Textures for ping-pong rendering
  private velocityTextures: WebGLTexture[] = [];
  private pressureTextures: WebGLTexture[] = [];
  private divergenceTexture: WebGLTexture | null = null;

  // Framebuffers
  private framebuffers: WebGLFramebuffer[] = [];

  // Geometry for full-screen quad
  private quadBuffer: BufferManager;

  private currentFrame: number = 0;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager, params: FluidParameters) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.params = params;

    // Create full-screen quad
    const quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.quadBuffer = new BufferManager(gl, quadGeometry);

    this.initializeTextures();
    this.initializeFramebuffers();
  }

  /**
   * Initialize textures for fluid simulation
   */
  private initializeTextures(): void {
    const gl = this.gl;
    const size = this.params.gridSize;

    // Create velocity textures (ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, size, size, 0, gl.RG, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.velocityTextures.push(texture!);
    }

    // Create pressure textures (ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.pressureTextures.push(texture!);
    }

    // Create divergence texture
    this.divergenceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.divergenceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Initialize framebuffers for off-screen rendering
   */
  private initializeFramebuffers(): void {
    const gl = this.gl;

    for (let i = 0; i < 4; i++) {
      const framebuffer = gl.createFramebuffer();
      this.framebuffers.push(framebuffer!);
    }
  }

  /**
   * Initialize all fluid simulation shaders
   */
  async initializeShaders(
    vertexSource: string,
    advectionFragSource: string,
    diffusionFragSource: string,
    divergenceFragSource: string,
    pressureFragSource: string,
    projectionFragSource: string
  ): Promise<void> {
    // Advection shader
    this.advectionProgram = this.shaderManager.createProgram(
      'advection',
      vertexSource,
      advectionFragSource,
      ['u_velocityTexture', 'u_sourceTexture', 'u_deltaTime', 'u_dissipation', 'u_texelSize'],
      ['a_position', 'a_texcoord']
    );

    // Diffusion shader
    this.diffusionProgram = this.shaderManager.createProgram(
      'diffusion',
      vertexSource,
      diffusionFragSource,
      ['u_sourceTexture', 'u_viscosity', 'u_deltaTime', 'u_texelSize'],
      ['a_position', 'a_texcoord']
    );

    // Divergence shader
    this.divergenceProgram = this.shaderManager.createProgram(
      'divergence',
      vertexSource,
      divergenceFragSource,
      ['u_velocityTexture', 'u_texelSize'],
      ['a_position', 'a_texcoord']
    );

    // Pressure shader
    this.pressureProgram = this.shaderManager.createProgram(
      'pressure',
      vertexSource,
      pressureFragSource,
      ['u_divergenceTexture', 'u_pressureTexture', 'u_texelSize'],
      ['a_position', 'a_texcoord']
    );

    // Projection shader
    this.projectionProgram = this.shaderManager.createProgram(
      'projection',
      vertexSource,
      projectionFragSource,
      ['u_velocityTexture', 'u_pressureTexture', 'u_texelSize'],
      ['a_position', 'a_texcoord']
    );

    // Set up vertex attributes
    const posLocation = this.advectionProgram.attributeLocations.get('a_position')!;
    const texLocation = this.advectionProgram.attributeLocations.get('a_texcoord')!;
    this.quadBuffer.setupAttributes(posLocation, texLocation);
  }

  /**
   * Apply advection step
   */
  private advect(sourceTexture: WebGLTexture, velocityTexture: WebGLTexture, deltaTime: number, dissipation: number): WebGLTexture {
    const gl = this.gl;
    const outputIndex = (this.currentFrame + 1) % 2;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.velocityTextures[outputIndex],
      0
    );

    gl.viewport(0, 0, this.params.gridSize, this.params.gridSize);

    // Use advection shader
    const program = this.shaderManager.useProgram('advection');

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    this.shaderManager.setUniform1f(program, 'u_velocityTexture', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    this.shaderManager.setUniform1f(program, 'u_sourceTexture', 1);

    // Set uniforms
    this.shaderManager.setUniform1f(program, 'u_deltaTime', deltaTime);
    this.shaderManager.setUniform1f(program, 'u_dissipation', dissipation);
    this.shaderManager.setUniform2f(program, 'u_texelSize', 1.0 / this.params.gridSize, 1.0 / this.params.gridSize);

    // Render quad
    this.quadBuffer.bind();
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    return this.velocityTextures[outputIndex];
  }

  /**
   * Apply diffusion step
   */
  private diffuse(sourceTexture: WebGLTexture, deltaTime: number): WebGLTexture {
    const gl = this.gl;
    const outputIndex = (this.currentFrame + 1) % 2;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[1]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.velocityTextures[outputIndex],
      0
    );

    gl.viewport(0, 0, this.params.gridSize, this.params.gridSize);

    // Use diffusion shader
    const program = this.shaderManager.useProgram('diffusion');

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    this.shaderManager.setUniform1f(program, 'u_sourceTexture', 0);

    // Set uniforms
    this.shaderManager.setUniform1f(program, 'u_viscosity', this.params.viscosity);
    this.shaderManager.setUniform1f(program, 'u_deltaTime', deltaTime);
    this.shaderManager.setUniform2f(program, 'u_texelSize', 1.0 / this.params.gridSize, 1.0 / this.params.gridSize);

    // Render quad
    this.quadBuffer.bind();
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    return this.velocityTextures[outputIndex];
  }

  /**
   * Calculate divergence
   */
  private calculateDivergence(velocityTexture: WebGLTexture): void {
    const gl = this.gl;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[2]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.divergenceTexture,
      0
    );

    gl.viewport(0, 0, this.params.gridSize, this.params.gridSize);

    // Use divergence shader
    const program = this.shaderManager.useProgram('divergence');

    // Bind velocity texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    this.shaderManager.setUniform1f(program, 'u_velocityTexture', 0);

    // Set uniforms
    this.shaderManager.setUniform2f(program, 'u_texelSize', 1.0 / this.params.gridSize, 1.0 / this.params.gridSize);

    // Render quad
    this.quadBuffer.bind();
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Solve pressure with Jacobi iteration
   */
  private solvePressure(): WebGLTexture {
    const gl = this.gl;

    // Clear pressure field
    let currentPressure = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.pressureTextures[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.params.gridSize, this.params.gridSize, 0, gl.RED, gl.FLOAT, null);

    // Jacobi iterations
    for (let i = 0; i < this.params.pressureIterations; i++) {
      const outputIndex = (currentPressure + 1) % 2;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[3]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.pressureTextures[outputIndex],
        0
      );

      gl.viewport(0, 0, this.params.gridSize, this.params.gridSize);

      // Use pressure shader
      const program = this.shaderManager.useProgram('pressure');

      // Bind textures
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.divergenceTexture);
      this.shaderManager.setUniform1f(program, 'u_divergenceTexture', 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.pressureTextures[currentPressure]);
      this.shaderManager.setUniform1f(program, 'u_pressureTexture', 1);

      // Set uniforms
      this.shaderManager.setUniform2f(program, 'u_texelSize', 1.0 / this.params.gridSize, 1.0 / this.params.gridSize);

      // Render quad
      this.quadBuffer.bind();
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      currentPressure = outputIndex;
    }

    return this.pressureTextures[currentPressure];
  }

  /**
   * Project velocity to be divergence-free
   */
  private project(velocityTexture: WebGLTexture, pressureTexture: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    const outputIndex = (this.currentFrame + 1) % 2;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.velocityTextures[outputIndex],
      0
    );

    gl.viewport(0, 0, this.params.gridSize, this.params.gridSize);

    // Use projection shader
    const program = this.shaderManager.useProgram('projection');

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    this.shaderManager.setUniform1f(program, 'u_velocityTexture', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pressureTexture);
    this.shaderManager.setUniform1f(program, 'u_pressureTexture', 1);

    // Set uniforms
    this.shaderManager.setUniform2f(program, 'u_texelSize', 1.0 / this.params.gridSize, 1.0 / this.params.gridSize);

    // Render quad
    this.quadBuffer.bind();
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    return this.velocityTextures[outputIndex];
  }

  /**
   * Add force to velocity field
   */
  addForce(position: [number, number], force: [number, number], radius: number): void {
    // This would be implemented with a separate shader or direct texture manipulation
    // For now, we'll implement this later when needed
  }

  /**
   * Step the fluid simulation
   */
  step(deltaTime: number): void {
    const currentVelocity = this.velocityTextures[this.currentFrame % 2];

    // 1. Advection
    let newVelocity = this.advect(currentVelocity, currentVelocity, deltaTime, this.params.dissipation);

    // 2. Diffusion
    newVelocity = this.diffuse(newVelocity, deltaTime);

    // 3. Projection (make divergence-free)
    this.calculateDivergence(newVelocity);
    const pressure = this.solvePressure();
    newVelocity = this.project(newVelocity, pressure);

    this.currentFrame++;
  }

  /**
   * Get current velocity field texture
   */
  getVelocityTexture(): WebGLTexture {
    return this.velocityTextures[this.currentFrame % 2];
  }

  /**
   * Get current pressure field texture
   */
  getPressureTexture(): WebGLTexture {
    return this.pressureTextures[0]; // Last computed pressure
  }

  /**
   * Update simulation parameters
   */
  updateParameters(params: Partial<FluidParameters>): void {
    Object.assign(this.params, params);
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    const gl = this.gl;

    this.velocityTextures.forEach(texture => gl.deleteTexture(texture));
    this.pressureTextures.forEach(texture => gl.deleteTexture(texture));
    this.framebuffers.forEach(fb => gl.deleteFramebuffer(fb));

    if (this.divergenceTexture) gl.deleteTexture(this.divergenceTexture);

    this.quadBuffer.dispose();
  }
}
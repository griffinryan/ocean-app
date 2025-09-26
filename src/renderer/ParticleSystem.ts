/**
 * GPU-based particle system for ocean foam and spray effects
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';

export interface ParticleConfig {
  maxParticles: number;
  emissionRate: number;
  particleLifetime: number;
  particleSize: number;
  gravity: number;
}

export class ParticleSystem {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private config: ParticleConfig;

  // Particle data textures for GPU-based simulation
  private positionTextures: WebGLTexture[] = [];
  private velocityTextures: WebGLTexture[] = [];
  private particleFramebuffers: WebGLFramebuffer[] = [];

  // Shader programs
  private updateProgram: ShaderProgram | null = null;
  private renderProgram: ShaderProgram | null = null;

  // Render state
  private particleVAO: WebGLVertexArrayObject | null = null;
  private particleBuffer: WebGLBuffer | null = null;
  private currentFrame: number = 0;

  // Texture dimensions for particle data
  private textureSize: number;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager, config: ParticleConfig) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.config = config;

    // Calculate texture size (square texture to hold particle data)
    this.textureSize = Math.ceil(Math.sqrt(config.maxParticles));

    this.initializeParticleSystem();
  }

  /**
   * Initialize GPU textures and buffers for particle simulation
   */
  private initializeParticleSystem(): void {
    const gl = this.gl;

    // Create double-buffered textures for ping-pong updating
    for (let i = 0; i < 2; i++) {
      // Position texture (RGBA32F: x, y, life, age)
      const posTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, posTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        this.textureSize, this.textureSize, 0,
        gl.RGBA, gl.FLOAT, this.generateInitialPositions()
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.positionTextures.push(posTexture!);

      // Velocity texture (RGBA32F: vx, vy, vz, speed)
      const velTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, velTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        this.textureSize, this.textureSize, 0,
        gl.RGBA, gl.FLOAT, this.generateInitialVelocities()
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.velocityTextures.push(velTexture!);

      // Framebuffer for off-screen rendering
      const framebuffer = gl.createFramebuffer();
      this.particleFramebuffers.push(framebuffer!);
    }

    // Create vertex array for particle rendering
    this.createParticleVertexArray();
  }

  /**
   * Generate initial particle positions
   */
  private generateInitialPositions(): Float32Array {
    const data = new Float32Array(this.textureSize * this.textureSize * 4);

    for (let i = 0; i < this.config.maxParticles; i++) {
      const index = i * 4;

      // Random initial position across ocean surface
      data[index + 0] = (Math.random() - 0.5) * 20; // x
      data[index + 1] = Math.random() * 0.5;        // y (height)
      data[index + 2] = (Math.random() - 0.5) * 20; // z
      data[index + 3] = Math.random() * this.config.particleLifetime; // age
    }

    return data;
  }

  /**
   * Generate initial particle velocities
   */
  private generateInitialVelocities(): Float32Array {
    const data = new Float32Array(this.textureSize * this.textureSize * 4);

    for (let i = 0; i < this.config.maxParticles; i++) {
      const index = i * 4;

      // Random initial velocity
      data[index + 0] = (Math.random() - 0.5) * 2; // vx
      data[index + 1] = Math.random() * 3 + 1;     // vy (upward)
      data[index + 2] = (Math.random() - 0.5) * 2; // vz
      data[index + 3] = Math.random() * 2 + 1;     // speed multiplier
    }

    return data;
  }

  /**
   * Create vertex array for rendering particles as points
   */
  private createParticleVertexArray(): void {
    const gl = this.gl;

    // Generate particle indices for point rendering
    const indices = new Float32Array(this.config.maxParticles * 2);
    for (let i = 0; i < this.config.maxParticles; i++) {
      const x = i % this.textureSize;
      const y = Math.floor(i / this.textureSize);
      indices[i * 2 + 0] = (x + 0.5) / this.textureSize; // u
      indices[i * 2 + 1] = (y + 0.5) / this.textureSize; // v
    }

    this.particleVAO = gl.createVertexArray();
    this.particleBuffer = gl.createBuffer();

    gl.bindVertexArray(this.particleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // Set up vertex attribute for texture coordinates
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  /**
   * Initialize particle shaders
   */
  initializeShaders(): void {
    // Particle update shader (for GPU simulation)
    const updateVertexShader = `#version 300 es
      in vec2 a_texcoord;
      out vec2 v_uv;

      void main() {
        v_uv = a_texcoord;
        gl_Position = vec4(a_texcoord * 2.0 - 1.0, 0.0, 1.0);
      }
    `;

    const updateFragmentShader = `#version 300 es
      precision highp float;

      in vec2 v_uv;
      uniform sampler2D u_positionTexture;
      uniform sampler2D u_velocityTexture;
      uniform float u_time;
      uniform float u_deltaTime;
      uniform float u_gravity;
      uniform float u_particleLifetime;

      layout(location = 0) out vec4 outPosition;
      layout(location = 1) out vec4 outVelocity;

      void main() {
        vec4 position = texture(u_positionTexture, v_uv);
        vec4 velocity = texture(u_velocityTexture, v_uv);

        // Update particle age
        float age = position.w + u_deltaTime;

        // Reset particle if it's too old
        if (age > u_particleLifetime) {
          age = 0.0;
          position.xyz = vec3(
            (fract(sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 20.0,
            0.1,
            (fract(sin(dot(v_uv + vec2(1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 20.0
          );
          velocity.xyz = vec3(
            (fract(sin(dot(v_uv + vec2(2.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 2.0,
            fract(sin(dot(v_uv + vec2(3.0), vec2(12.9898, 78.233))) * 43758.5453) * 3.0 + 1.0,
            (fract(sin(dot(v_uv + vec2(4.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 2.0
          );
        } else {
          // Update position
          position.xyz += velocity.xyz * u_deltaTime;

          // Apply gravity
          velocity.y -= u_gravity * u_deltaTime;
        }

        outPosition = vec4(position.xyz, age);
        outVelocity = velocity;
      }
    `;

    // Particle render shader
    const renderVertexShader = `#version 300 es
      in vec2 a_texcoord;
      uniform sampler2D u_positionTexture;
      uniform sampler2D u_velocityTexture;
      uniform mat4 u_viewProjection;
      uniform float u_particleSize;
      uniform float u_particleLifetime;

      out float v_life;
      out float v_alpha;

      void main() {
        vec4 position = texture(u_positionTexture, a_texcoord);
        float age = position.w;

        v_life = age / u_particleLifetime;
        v_alpha = 1.0 - v_life;

        // Convert world position to screen space for top-down view
        vec4 worldPos = vec4(position.xyz, 1.0);
        gl_Position = u_viewProjection * worldPos;
        gl_PointSize = u_particleSize * v_alpha;
      }
    `;

    const renderFragmentShader = `#version 300 es
      precision highp float;

      in float v_life;
      in float v_alpha;

      out vec4 fragColor;

      void main() {
        // Circular particle shape
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;

        // Foam white color with fade
        float alpha = (1.0 - dist * 2.0) * v_alpha;
        fragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `;

    // Create shader programs
    this.updateProgram = this.shaderManager.createProgram(
      'particleUpdate',
      updateVertexShader,
      updateFragmentShader,
      ['u_positionTexture', 'u_velocityTexture', 'u_time', 'u_deltaTime', 'u_gravity', 'u_particleLifetime'],
      ['a_texcoord']
    );

    this.renderProgram = this.shaderManager.createProgram(
      'particleRender',
      renderVertexShader,
      renderFragmentShader,
      ['u_positionTexture', 'u_velocityTexture', 'u_viewProjection', 'u_particleSize', 'u_particleLifetime'],
      ['a_texcoord']
    );
  }

  /**
   * Update particle simulation
   */
  update(deltaTime: number): void {
    if (!this.updateProgram) return;

    const gl = this.gl;
    const currentIndex = this.currentFrame % 2;
    const nextIndex = (this.currentFrame + 1) % 2;

    // Set up framebuffer for off-screen rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleFramebuffers[nextIndex]);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    // Attach textures to framebuffer
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.positionTextures[nextIndex], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.velocityTextures[nextIndex], 0);

    gl.viewport(0, 0, this.textureSize, this.textureSize);

    // Use update shader
    const program = this.shaderManager.useProgram('particleUpdate');

    // Bind input textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.positionTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_positionTexture', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_velocityTexture', 1);

    // Set uniforms
    this.shaderManager.setUniform1f(program, 'u_deltaTime', deltaTime);
    this.shaderManager.setUniform1f(program, 'u_gravity', this.config.gravity);
    this.shaderManager.setUniform1f(program, 'u_particleLifetime', this.config.particleLifetime);

    // Render full-screen quad to update particles
    // Note: This would need a simple quad setup for the update pass

    this.currentFrame++;
  }

  /**
   * Render particles
   */
  render(viewProjectionMatrix: Float32Array): void {
    if (!this.renderProgram || !this.particleVAO) return;

    const gl = this.gl;
    const currentIndex = this.currentFrame % 2;

    // Restore main framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Enable additive blending for foam effect
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    // Use render shader
    const program = this.shaderManager.useProgram('particleRender');

    // Bind particle textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.positionTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_positionTexture', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_velocityTexture', 1);

    // Set uniforms
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewProjection', viewProjectionMatrix);
    this.shaderManager.setUniform1f(program, 'u_particleSize', this.config.particleSize);
    this.shaderManager.setUniform1f(program, 'u_particleLifetime', this.config.particleLifetime);

    // Render particles as points
    gl.bindVertexArray(this.particleVAO);
    gl.drawArrays(gl.POINTS, 0, this.config.maxParticles);

    // Restore normal blending
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    const gl = this.gl;

    this.positionTextures.forEach(texture => gl.deleteTexture(texture));
    this.velocityTextures.forEach(texture => gl.deleteTexture(texture));
    this.particleFramebuffers.forEach(fb => gl.deleteFramebuffer(fb));

    if (this.particleVAO) gl.deleteVertexArray(this.particleVAO);
    if (this.particleBuffer) gl.deleteBuffer(this.particleBuffer);
  }
}
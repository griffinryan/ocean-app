/**
 * TextureManager handles creation and management of textures for cellular automaton
 * wave propagation and other dynamic texture needs
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';

export interface CAConfig {
  textureSize: number;
  waveSpeed: number;
  damping: number;
  sourceStrength: number;
  updateFrequency: number; // Updates per second
  enabled: boolean; // Whether CA is supported and enabled
}

export class TextureManager {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;

  // Cellular automaton textures (ping-pong)
  private caTextures: WebGLTexture[] = [];
  private caFramebuffers: WebGLFramebuffer[] = [];
  private caProgram: ShaderProgram | null = null;

  // Full-screen quad for texture rendering
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  // CA configuration
  private caConfig: CAConfig;
  private currentFrame: number = 0;
  private lastUpdateTime: number = 0;

  // Animation state
  private sourcePosition: [number, number] = [0.5, 0.5];
  private isInitialized: boolean = false;
  private isSupported: boolean = false;

  // WebGL extension support
  private hasFloatTextureSupport: boolean = false;

  constructor(
    gl: WebGL2RenderingContext,
    shaderManager: ShaderManager,
    config?: Partial<CAConfig>
  ) {
    this.gl = gl;
    this.shaderManager = shaderManager;

    this.caConfig = {
      textureSize: 256,
      waveSpeed: 1.0,
      damping: 0.995,
      sourceStrength: 0.5,
      updateFrequency: 60, // 60 updates per second
      enabled: true,
      ...config
    };

    this.checkWebGLSupport();
    if (this.caConfig.enabled && this.isSupported) {
      this.initializeCA();
    }
  }

  /**
   * Check WebGL support for required extensions
   */
  private checkWebGLSupport(): void {
    const gl = this.gl;

    // Check for floating-point texture support
    const floatExtension = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear'); // Enable linear filtering if available

    this.hasFloatTextureSupport = floatExtension !== null;

    if (!this.hasFloatTextureSupport) {
      console.warn('Floating-point textures not supported, CA will use RGBA8 fallback');
    }

    this.isSupported = true; // We can always fall back to RGBA8
  }

  /**
   * Initialize cellular automaton system with fallback support
   */
  private initializeCA(): void {
    const gl = this.gl;

    try {
      // Try to initialize with float textures first, fall back to RGBA8 if needed
      const success = this.tryInitializeCAWithFormat(true) || this.tryInitializeCAWithFormat(false);

      if (!success) {
        throw new Error('Failed to initialize CA with any supported texture format');
      }

      // Create full-screen quad for rendering
      this.createFullScreenQuad();

      // Initialize CA shader
      this.initializeCAShader();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.isInitialized = true;
      console.log(`Cellular automaton initialized with ${this.hasFloatTextureSupport ? 'RGBA16F' : 'RGBA8'} textures`);

    } catch (error) {
      console.error('Failed to initialize cellular automaton:', error);
      this.isSupported = false;
      this.caConfig.enabled = false;
      // Clean up any partially created resources
      this.dispose();
    }
  }

  /**
   * Try to initialize CA with a specific texture format
   */
  private tryInitializeCAWithFormat(useFloatTextures: boolean): boolean {
    const gl = this.gl;

    try {
      // Clear any existing resources
      this.caTextures.forEach(texture => {
        if (texture) gl.deleteTexture(texture);
      });
      this.caFramebuffers.forEach(framebuffer => {
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
      });
      this.caTextures = [];
      this.caFramebuffers = [];

      // Use float textures only if supported and requested
      const shouldUseFloat = useFloatTextures && this.hasFloatTextureSupport;
      const internalFormat = shouldUseFloat ? gl.RGBA16F : gl.RGBA8;
      const format = gl.RGBA;
      const type = shouldUseFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

      // Create ping-pong textures for CA simulation
      for (let i = 0; i < 2; i++) {
        // Create texture
        const texture = gl.createTexture();
        if (!texture) {
          throw new Error('Failed to create CA texture');
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Generate appropriate initial data based on texture type
        const initialData = shouldUseFloat ?
          this.generateInitialCAData() :
          this.generateInitialCADataUint8();

        gl.texImage2D(
          gl.TEXTURE_2D, 0, internalFormat,
          this.caConfig.textureSize, this.caConfig.textureSize, 0,
          format, type, initialData
        );

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

        this.caTextures.push(texture);

        // Create framebuffer and test attachment
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
          throw new Error('Failed to create CA framebuffer');
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`CA framebuffer is not complete. Status: ${this.getFramebufferStatusName(status)}`);
        }

        this.caFramebuffers.push(framebuffer);
      }

      // Update the actual format being used
      this.hasFloatTextureSupport = shouldUseFloat;

      console.log(`Successfully created CA textures with ${shouldUseFloat ? 'RGBA16F' : 'RGBA8'} format`);
      return true;

    } catch (error) {
      console.warn(`Failed to initialize CA with ${useFloatTextures ? 'float' : 'RGBA8'} textures:`, error);

      // Clean up failed attempt
      this.caTextures.forEach(texture => {
        if (texture) gl.deleteTexture(texture);
      });
      this.caFramebuffers.forEach(framebuffer => {
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
      });
      this.caTextures = [];
      this.caFramebuffers = [];

      return false;
    }
  }

  /**
   * Get human-readable framebuffer status name
   */
  private getFramebufferStatusName(status: number): string {
    const gl = this.gl;
    switch (status) {
      case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: return 'INCOMPLETE_ATTACHMENT';
      case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: return 'INCOMPLETE_MISSING_ATTACHMENT';
      case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: return 'INCOMPLETE_DIMENSIONS';
      case gl.FRAMEBUFFER_UNSUPPORTED: return 'UNSUPPORTED';
      default: return `UNKNOWN(${status})`;
    }
  }


  /**
   * Generate initial data for cellular automaton (float version)
   */
  private generateInitialCAData(): Float32Array {
    const size = this.caConfig.textureSize;
    const data = new Float32Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;

        // Initialize with small random noise
        data[index + 0] = (Math.random() - 0.5) * 0.01; // Height
        data[index + 1] = 0.0; // Velocity
        data[index + 2] = 0.0; // Reserved
        data[index + 3] = 1.0; // Alpha
      }
    }

    return data;
  }

  /**
   * Generate initial data for cellular automaton (uint8 fallback version)
   */
  private generateInitialCADataUint8(): Uint8Array {
    const size = this.caConfig.textureSize;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;

        // Initialize with small random noise, scaled to 0-255 range
        data[index + 0] = Math.floor((Math.random() - 0.5) * 5 + 127.5); // Height around middle
        data[index + 1] = 127; // Velocity at middle
        data[index + 2] = 0; // Reserved
        data[index + 3] = 255; // Alpha
      }
    }

    return data;
  }

  /**
   * Create full-screen quad for texture rendering
   */
  private createFullScreenQuad(): void {
    const gl = this.gl;

    // Vertex data for full-screen quad
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 0.0, // Bottom-left
       1.0, -1.0, 1.0, 0.0, // Bottom-right
       1.0,  1.0, 1.0, 1.0, // Top-right
      -1.0,  1.0, 0.0, 1.0  // Top-left
    ]);

    const indices = new Uint16Array([
      0, 1, 2,
      0, 2, 3
    ]);

    // Create VAO
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);

    // Create vertex buffer
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Set up vertex attributes
    gl.enableVertexAttribArray(0); // Position
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);

    gl.enableVertexAttribArray(1); // Texture coordinates
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

    // Create index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  /**
   * Initialize cellular automaton shader program
   */
  private initializeCAShader(): void {
    // Simple vertex shader for full-screen quad
    const vertexShader = `#version 300 es
      in vec2 a_position;
      in vec2 a_texcoord;
      out vec2 v_uv;

      void main() {
        v_uv = a_texcoord;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Load fragment shader from file content (we'll inline it since we can't import)
    const fragmentShader = `#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_currentState;
uniform sampler2D u_previousState;
uniform float u_deltaTime;
uniform float u_waveSpeed;
uniform float u_damping;
uniform float u_sourceStrength;
uniform vec2 u_sourcePosition;
uniform float u_time;

out vec4 fragColor;

// Wave equation parameters
const float WAVE_SPEED_FACTOR = 0.5;
const float DAMPING_FACTOR = 0.98;
const float SOURCE_RADIUS = 0.05;

// Hash function for procedural wave sources
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Get neighbor values for wave equation
float getNeighbor(sampler2D tex, vec2 uv, vec2 offset, vec2 texelSize) {
    vec2 sampleUV = uv + offset * texelSize;
    sampleUV = fract(sampleUV);
    return texture(tex, sampleUV).r;
}

// 2D wave equation solver using finite difference method
float solveWaveEquation(vec2 uv, vec2 texelSize) {
    float current = texture(u_currentState, uv).r;
    float previous = texture(u_previousState, uv).r;

    float left = getNeighbor(u_currentState, uv, vec2(-1.0, 0.0), texelSize);
    float right = getNeighbor(u_currentState, uv, vec2(1.0, 0.0), texelSize);
    float up = getNeighbor(u_currentState, uv, vec2(0.0, 1.0), texelSize);
    float down = getNeighbor(u_currentState, uv, vec2(0.0, -1.0), texelSize);

    float laplacian = left + right + up + down - 4.0 * current;
    float waveSpeedSq = u_waveSpeed * u_waveSpeed;
    float acceleration = waveSpeedSq * laplacian;

    float velocity = (current - previous) / u_deltaTime;
    float newHeight = current + velocity * u_deltaTime + 0.5 * acceleration * u_deltaTime * u_deltaTime;

    newHeight *= u_damping;
    return newHeight;
}

// Add wave sources
float addWaveSources(vec2 uv, float currentHeight) {
    float height = currentHeight;

    // Primary animated source
    vec2 sourceUV = u_sourcePosition;
    float sourceDistance = distance(uv, sourceUV);

    if (sourceDistance < SOURCE_RADIUS) {
        float sourceInfluence = smoothstep(SOURCE_RADIUS, 0.0, sourceDistance);
        float sourceWave = sin(u_time * 3.0) * u_sourceStrength * sourceInfluence;
        height += sourceWave;
    }

    // Multiple procedural sources for complexity
    for(float i = 0.0; i < 4.0; i += 1.0) {
        vec2 randomOffset = vec2(hash21(vec2(i, 0.0)), hash21(vec2(i, 1.0)));
        vec2 proceduralSource = randomOffset * 0.8 + 0.1;

        float proceduralDistance = distance(uv, proceduralSource);
        float proceduralRadius = SOURCE_RADIUS * 0.5;

        if (proceduralDistance < proceduralRadius) {
            float proceduralInfluence = smoothstep(proceduralRadius, 0.0, proceduralDistance);
            float proceduralPhase = u_time * (2.0 + i * 0.5) + i * 3.14159;
            float proceduralWave = sin(proceduralPhase) * u_sourceStrength * 0.3 * proceduralInfluence;
            height += proceduralWave;
        }
    }

    return height;
}

void main() {
    vec2 texelSize = 1.0 / textureSize(u_currentState, 0);

    float newHeight = solveWaveEquation(v_uv, texelSize);
    newHeight = addWaveSources(v_uv, newHeight);
    newHeight = clamp(newHeight, -1.0, 1.0);

    float velocity = (newHeight - texture(u_currentState, v_uv).r) / u_deltaTime;

    fragColor = vec4(newHeight, velocity, 0.0, 1.0);
}
    `;

    this.caProgram = this.shaderManager.createProgram(
      'cellularAutomaton',
      vertexShader,
      fragmentShader,
      [
        'u_currentState',
        'u_previousState',
        'u_deltaTime',
        'u_waveSpeed',
        'u_damping',
        'u_sourceStrength',
        'u_sourcePosition',
        'u_time'
      ],
      ['a_position', 'a_texcoord']
    );
  }

  /**
   * Update cellular automaton simulation
   */
  update(currentTime: number): void {
    if (!this.isInitialized || !this.caProgram || !this.caConfig.enabled || !this.isSupported) return;

    const deltaTime = currentTime - this.lastUpdateTime;
    const targetDelta = 1000 / this.caConfig.updateFrequency; // Convert to milliseconds

    // Only update at the specified frequency
    if (deltaTime < targetDelta) return;

    const gl = this.gl;
    const currentIndex = this.currentFrame % 2;
    const nextIndex = (this.currentFrame + 1) % 2;

    // Store original viewport
    const originalViewport = gl.getParameter(gl.VIEWPORT);

    // Set up framebuffer for off-screen rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.caFramebuffers[nextIndex]);
    gl.viewport(0, 0, this.caConfig.textureSize, this.caConfig.textureSize);

    // Use CA shader
    const program = this.shaderManager.useProgram('cellularAutomaton');

    // Bind input textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.caTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_currentState', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.caTextures[currentIndex]);
    this.shaderManager.setUniform1f(program, 'u_previousState', 1);

    // Set uniforms
    this.shaderManager.setUniform1f(program, 'u_deltaTime', deltaTime / 1000); // Convert to seconds
    this.shaderManager.setUniform1f(program, 'u_waveSpeed', this.caConfig.waveSpeed);
    this.shaderManager.setUniform1f(program, 'u_damping', this.caConfig.damping);
    this.shaderManager.setUniform1f(program, 'u_sourceStrength', this.caConfig.sourceStrength);
    this.shaderManager.setUniform2f(program, 'u_sourcePosition', this.sourcePosition[0], this.sourcePosition[1]);
    this.shaderManager.setUniform1f(program, 'u_time', currentTime / 1000);

    // Render full-screen quad
    gl.bindVertexArray(this.quadVAO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Restore original state
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(originalViewport[0], originalViewport[1], originalViewport[2], originalViewport[3]);
    gl.bindVertexArray(null);

    this.currentFrame++;
    this.lastUpdateTime = currentTime;

    // Animate source position for dynamic waves
    this.updateSourcePosition(currentTime / 1000);
  }

  /**
   * Update source position for animated wave generation
   */
  private updateSourcePosition(time: number): void {
    // Move source in a figure-8 pattern
    const speed = 0.3;
    this.sourcePosition[0] = 0.5 + 0.3 * Math.sin(time * speed);
    this.sourcePosition[1] = 0.5 + 0.2 * Math.sin(time * speed * 2);
  }

  /**
   * Get the current CA texture for sampling in other shaders
   */
  getCurrentCATexture(): WebGLTexture | null {
    if (!this.isInitialized || !this.isSupported || !this.caConfig.enabled || this.caTextures.length === 0) {
      return null;
    }
    return this.caTextures[this.currentFrame % 2];
  }

  /**
   * Check if cellular automaton is supported and enabled
   */
  isCASupported(): boolean {
    return this.isSupported && this.caConfig.enabled;
  }

  /**
   * Update CA configuration
   */
  updateConfig(newConfig: Partial<CAConfig>): void {
    this.caConfig = { ...this.caConfig, ...newConfig };
  }

  /**
   * Reset CA simulation
   */
  reset(): void {
    if (!this.isInitialized || !this.isSupported || !this.caConfig.enabled) return;

    const gl = this.gl;
    const newData = this.hasFloatTextureSupport ?
      this.generateInitialCAData() :
      this.generateInitialCADataUint8();

    const type = this.hasFloatTextureSupport ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    for (let i = 0; i < this.caTextures.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.caTextures[i]);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0,
        this.caConfig.textureSize, this.caConfig.textureSize,
        gl.RGBA, type, newData
      );
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    this.currentFrame = 0;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    const gl = this.gl;

    this.caTextures.forEach(texture => {
      if (texture) gl.deleteTexture(texture);
    });

    this.caFramebuffers.forEach(framebuffer => {
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
    });

    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);

    this.caTextures = [];
    this.caFramebuffers = [];
    this.isInitialized = false;
  }
}
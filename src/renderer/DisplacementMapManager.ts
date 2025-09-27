/**
 * DisplacementMapManager - Core manager for cellular automata wave displacement
 *
 * Manages multiple displacement layers:
 * - Base ocean waves (static patterns)
 * - Dynamic cellular automata grid
 * - Vessel influence zones
 * - Turbulence and foam maps
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';

export interface DisplacementConfig {
  gridSize: number;           // Size of cellular automata grid (512x512)
  worldSize: number;          // World space size in units (40x40)
  dampingFactor: number;      // Wave energy damping (0.995)
  waveSpeed: number;          // Wave propagation speed (5.0)
  timeStep: number;           // Simulation time step (0.016)
  enableFoam: boolean;        // Generate foam from energy thresholds
}

export interface DisplacementTextures {
  heightCurrent: WebGLTexture;    // Current wave heights
  heightPrevious: WebGLTexture;   // Previous wave heights
  velocity: WebGLTexture;         // Wave velocities
  energy: WebGLTexture;           // Wave energy distribution
  vesselInfluence: WebGLTexture;  // Vessel influence map
  foam: WebGLTexture;             // Foam generation map
}

export class DisplacementMapManager {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private config: DisplacementConfig;

  // Core cellular automata textures (double-buffered)
  private heightTextures: WebGLTexture[] = [];
  private velocityTextures: WebGLTexture[] = [];
  private energyTextures: WebGLTexture[] = [];

  // Additional displacement layers
  private vesselInfluenceTexture: WebGLTexture | null = null;
  private foamTexture: WebGLTexture | null = null;

  // Framebuffers for off-screen rendering
  private updateFramebuffer: WebGLFramebuffer | null = null;
  private combineFramebuffer: WebGLFramebuffer | null = null;

  // Final combined displacement texture
  private combinedDisplacementTexture: WebGLTexture | null = null;

  // Current frame index for ping-pong buffers
  private currentFrame: number = 0;

  // Cellular automata shader programs
  private caUpdateProgram: ShaderProgram | null = null;

  // Geometry for full-screen quad rendering
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager, config: DisplacementConfig) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.config = config;

    this.initializeTextures();
    this.initializeFramebuffers();
    this.initializeQuadGeometry();
  }

  /**
   * Initialize all displacement textures
   */
  private initializeTextures(): void {
    const gl = this.gl;
    const size = this.config.gridSize;

    // Create double-buffered height textures (RGBA32F: height, velocity, energy, flags)
    for (let i = 0; i < 2; i++) {
      const heightTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, heightTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        size, size, 0,
        gl.RGBA, gl.FLOAT, this.generateInitialHeightData()
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.heightTextures.push(heightTexture!);

      const velocityTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        size, size, 0,
        gl.RGBA, gl.FLOAT, this.generateInitialVelocityData()
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.velocityTextures.push(velocityTexture!);

      const energyTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, energyTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        size, size, 0,
        gl.RGBA, gl.FLOAT, null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.energyTextures.push(energyTexture!);
    }

    // Create vessel influence texture
    this.vesselInfluenceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.vesselInfluenceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F,
      size, size, 0,
      gl.RGBA, gl.FLOAT, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Create foam texture
    this.foamTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.foamTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F,
      size, size, 0,
      gl.RGBA, gl.FLOAT, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Create final combined displacement texture
    this.combinedDisplacementTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.combinedDisplacementTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F,
      size, size, 0,
      gl.RGBA, gl.FLOAT, null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    console.log(`[DisplacementMapManager] Initialized ${size}x${size} cellular grid with ${this.heightTextures.length} height buffers`);
  }

  /**
   * Generate initial height data with base ocean waves
   */
  private generateInitialHeightData(): Float32Array {
    const size = this.config.gridSize;
    const data = new Float32Array(size * size * 4);
    const worldSize = this.config.worldSize;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;

        // Convert grid coordinates to world coordinates
        const worldX = (x / size - 0.5) * worldSize;
        const worldZ = (y / size - 0.5) * worldSize;

        // Generate base ocean waves as initial conditions
        let height = 0.0;
        height += 0.3 * Math.sin(worldX * 0.1 + worldZ * 0.05);
        height += 0.2 * Math.sin(worldX * 0.15 - worldZ * 0.08);
        height += 0.15 * Math.sin(worldX * 0.08 + worldZ * 0.12);

        data[index + 0] = height;        // Current height
        data[index + 1] = height;        // Previous height (start with same)
        data[index + 2] = 0.0;          // Initial velocity
        data[index + 3] = Math.abs(height) * 0.5; // Initial energy
      }
    }

    return data;
  }

  /**
   * Generate initial velocity data
   */
  private generateInitialVelocityData(): Float32Array {
    const size = this.config.gridSize;
    const data = new Float32Array(size * size * 4);

    // Initialize with zero velocities
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.0;
    }

    return data;
  }

  /**
   * Initialize framebuffers for off-screen rendering
   */
  private initializeFramebuffers(): void {
    const gl = this.gl;

    // Update framebuffer for cellular automata updates
    this.updateFramebuffer = gl.createFramebuffer();

    // Combine framebuffer for final displacement assembly
    this.combineFramebuffer = gl.createFramebuffer();
  }

  /**
   * Initialize full-screen quad geometry for shader passes
   */
  private initializeQuadGeometry(): void {
    const gl = this.gl;

    // Quad vertices (position + texcoord)
    const quadVertices = new Float32Array([
      -1.0, -1.0, 0.0, 0.0,  // Bottom-left
       1.0, -1.0, 1.0, 0.0,  // Bottom-right
      -1.0,  1.0, 0.0, 1.0,  // Top-left
       1.0,  1.0, 1.0, 1.0   // Top-right
    ]);

    this.quadVAO = gl.createVertexArray();
    this.quadBuffer = gl.createBuffer();

    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    // Position attribute (location 0)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);

    // Texcoord attribute (location 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
  }

  /**
   * Initialize cellular automata shader programs
   */
  initializeShaders(): void {
    // Get the CA update program that was created by CellularAutomaton
    this.caUpdateProgram = this.shaderManager.getProgram('caUpdate') || null;

    if (!this.caUpdateProgram) {
      console.warn('[DisplacementMapManager] CA update program not found');
    } else {
      console.log('[DisplacementMapManager] Shader initialization complete');
    }
  }

  /**
   * Update the cellular automata simulation
   */
  update(deltaTime: number): void {
    if (!this.caUpdateProgram) return;

    const gl = this.gl;
    const currentIndex = this.currentFrame % 2;
    const nextIndex = (this.currentFrame + 1) % 2;

    // Set up framebuffer for CA update
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.updateFramebuffer);
    gl.viewport(0, 0, this.config.gridSize, this.config.gridSize);

    // Attach next frame textures as render targets
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.heightTextures[nextIndex], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.velocityTextures[nextIndex], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.energyTextures[nextIndex], 0);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    // Use CA update shader and bind current state textures
    const program = this.shaderManager.useProgram('caUpdate');

    // Bind current state as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTextures[currentIndex]);
    this.shaderManager.setUniform1i(program, 'u_heightTexture', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTextures[currentIndex]);
    this.shaderManager.setUniform1i(program, 'u_velocityTexture', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.vesselInfluenceTexture);
    this.shaderManager.setUniform1i(program, 'u_vesselInfluence', 2);

    // Set simulation parameters
    this.shaderManager.setUniform1f(program, 'u_deltaTime', deltaTime);
    this.shaderManager.setUniform1f(program, 'u_dampingFactor', this.config.dampingFactor);
    this.shaderManager.setUniform1f(program, 'u_waveSpeed', this.config.waveSpeed);
    this.shaderManager.setUniform1f(program, 'u_gridSize', this.config.gridSize);
    this.shaderManager.setUniform1f(program, 'u_worldSize', this.config.worldSize);

    // Render full-screen quad
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.currentFrame++;
  }

  /**
   * Get current displacement textures for rendering
   */
  getDisplacementTextures(): DisplacementTextures {
    const currentIndex = this.currentFrame % 2;

    return {
      heightCurrent: this.heightTextures[currentIndex],
      heightPrevious: this.heightTextures[(currentIndex + 1) % 2],
      velocity: this.velocityTextures[currentIndex],
      energy: this.energyTextures[currentIndex],
      vesselInfluence: this.vesselInfluenceTexture!,
      foam: this.foamTexture!
    };
  }

  /**
   * Get the final combined displacement texture
   */
  getCombinedDisplacementTexture(): WebGLTexture | null {
    return this.combinedDisplacementTexture;
  }

  /**
   * Update vessel influence map
   */
  updateVesselInfluence(_vesselData: Float32Array, vesselCount: number): void {
    // This will be implemented when we integrate with VesselSystem
    console.log(`[DisplacementMapManager] Vessel influence update: ${vesselCount} vessels`);
  }

  /**
   * Get configuration
   */
  getConfig(): DisplacementConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DisplacementConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get debug information
   */
  getDebugInfo(): { frameIndex: number; gridSize: number; textureCount: number } {
    return {
      frameIndex: this.currentFrame,
      gridSize: this.config.gridSize,
      textureCount: this.heightTextures.length + this.velocityTextures.length + this.energyTextures.length + 3
    };
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    const gl = this.gl;

    // Clean up textures
    this.heightTextures.forEach(texture => gl.deleteTexture(texture));
    this.velocityTextures.forEach(texture => gl.deleteTexture(texture));
    this.energyTextures.forEach(texture => gl.deleteTexture(texture));

    if (this.vesselInfluenceTexture) gl.deleteTexture(this.vesselInfluenceTexture);
    if (this.foamTexture) gl.deleteTexture(this.foamTexture);
    if (this.combinedDisplacementTexture) gl.deleteTexture(this.combinedDisplacementTexture);

    // Clean up framebuffers
    if (this.updateFramebuffer) gl.deleteFramebuffer(this.updateFramebuffer);
    if (this.combineFramebuffer) gl.deleteFramebuffer(this.combineFramebuffer);

    // Clean up geometry
    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);

    console.log('[DisplacementMapManager] Disposed GPU resources');
  }
}
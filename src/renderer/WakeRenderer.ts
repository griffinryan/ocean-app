/**
 * Wake Renderer - Dedicated renderer for vessel wake system
 * Renders wakes to a texture at independent resolution for performance optimization
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { QualitySettings } from '../config/QualityPresets';

export class WakeRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private wakeProgram: ShaderProgram | null = null;

  // Geometry for rendering full-screen quad
  private geometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for wake texture
  private wakeFramebuffer: WebGLFramebuffer | null = null;
  private wakeTexture: WebGLTexture | null = null;
  private depthBuffer: WebGLRenderbuffer | null = null;

  // Resolution management
  private wakeWidth: number = 0;
  private wakeHeight: number = 0;
  private wakeResolutionScale: number = 0.5; // Default to 0.5x for performance

  // Animation
  private enabled: boolean = true;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;

    // Create full-screen quad geometry for wake rendering
    this.geometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.geometry);

    // Initialize framebuffer
    this.initializeFramebuffer();

    console.log('WakeRenderer: Initialized');
  }

  /**
   * Initialize shaders for wake rendering
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define uniforms and attributes for wake shader
      const uniforms = [
        'u_time',
        'u_aspectRatio',
        'u_resolution',
        'u_vesselCount',
        'u_vesselPositions',
        'u_vesselVelocities',
        'u_vesselWeights',
        'u_vesselClasses',
        'u_vesselHullLengths',
        'u_vesselStates',
        'u_wakesEnabled'
      ];

      const attributes = [
        'a_position',
        'a_texcoord'
      ];

      // Create wake shader program
      this.wakeProgram = this.shaderManager.createProgram(
        'wake',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes
      const positionLocation = this.wakeProgram.attributeLocations.get('a_position');
      const texcoordLocation = this.wakeProgram.attributeLocations.get('a_texcoord');

      if (positionLocation !== undefined && texcoordLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, texcoordLocation);
      }

      console.log('WakeRenderer: Shaders initialized successfully');
    } catch (error) {
      console.error('WakeRenderer: Failed to initialize shaders:', error);
      throw error;
    }
  }

  /**
   * Initialize framebuffer for wake texture
   */
  private initializeFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.wakeFramebuffer = gl.createFramebuffer();
    if (!this.wakeFramebuffer) {
      throw new Error('WakeRenderer: Failed to create framebuffer');
    }

    // Create texture for wake data
    this.wakeTexture = gl.createTexture();
    if (!this.wakeTexture) {
      throw new Error('WakeRenderer: Failed to create wake texture');
    }

    // Create depth renderbuffer
    this.depthBuffer = gl.createRenderbuffer();
    if (!this.depthBuffer) {
      throw new Error('WakeRenderer: Failed to create depth buffer');
    }

    console.log('WakeRenderer: Framebuffer initialized');
  }

  /**
   * Resize wake framebuffer
   */
  resizeFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.wakeFramebuffer || !this.wakeTexture || !this.depthBuffer) {
      return;
    }

    // Calculate wake texture resolution based on scale
    this.wakeWidth = Math.max(1, Math.round(width * this.wakeResolutionScale));
    this.wakeHeight = Math.max(1, Math.round(height * this.wakeResolutionScale));

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wakeFramebuffer);

    // Setup wake texture
    gl.bindTexture(gl.TEXTURE_2D, this.wakeTexture);

    // Use R32F format for single-channel float data (wake height)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.wakeWidth, this.wakeHeight, 0, gl.RED, gl.FLOAT, null);

    // Use linear filtering for smooth upscaling
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach texture to framebuffer
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.wakeTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.wakeWidth, this.wakeHeight);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('WakeRenderer: Framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    console.log(`WakeRenderer: Framebuffer resized to ${this.wakeWidth}×${this.wakeHeight} (${(this.wakeResolutionScale * 100).toFixed(0)}% scale)`);
  }

  /**
   * Update quality settings
   */
  updateQualitySettings(settings: QualitySettings): void {
    // Use wake resolution from quality settings
    this.wakeResolutionScale = settings.wakeResolution;

    console.log(`WakeRenderer: Wake resolution set to ${(this.wakeResolutionScale * 100).toFixed(0)}%`);
  }

  /**
   * Render wake texture
   */
  render(
    vesselData: {
      positions: Float32Array;
      velocities: Float32Array;
      weights: Float32Array;
      classes: Float32Array;
      hullLengths: Float32Array;
      states: Float32Array;
      count: number;
    },
    elapsedTime: number
  ): void {
    if (!this.enabled || !this.wakeProgram || !this.wakeFramebuffer) {
      return;
    }

    const gl = this.gl;

    // Bind wake framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wakeFramebuffer);
    gl.viewport(0, 0, this.wakeWidth, this.wakeHeight);

    // Clear to zero (no wakes)
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Use wake shader
    const program = this.shaderManager.useProgram('wake');

    // Set time uniform
    this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);

    // Set aspect ratio
    const aspect = this.wakeWidth / this.wakeHeight;
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', this.wakeWidth, this.wakeHeight);

    // Set wakes enabled
    this.shaderManager.setUniform1i(program, 'u_wakesEnabled', 1);

    // Set vessel data
    this.shaderManager.setUniform1i(program, 'u_vesselCount', vesselData.count);

    if (vesselData.count > 0) {
      this.shaderManager.setUniform3fv(program, 'u_vesselPositions', vesselData.positions);
      this.shaderManager.setUniform3fv(program, 'u_vesselVelocities', vesselData.velocities);
      this.shaderManager.setUniform1fv(program, 'u_vesselWeights', vesselData.weights);
      this.shaderManager.setUniform1fv(program, 'u_vesselClasses', vesselData.classes);
      this.shaderManager.setUniform1fv(program, 'u_vesselHullLengths', vesselData.hullLengths);
      this.shaderManager.setUniform1fv(program, 'u_vesselStates', vesselData.states);
    }

    // Render full-screen quad
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Get wake texture for sampling in other shaders
   */
  getWakeTexture(): WebGLTexture | null {
    return this.wakeTexture;
  }

  /**
   * Enable or disable wake rendering
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      // Clear wake texture when disabled
      const gl = this.gl;
      if (this.wakeFramebuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.wakeFramebuffer);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
  }

  /**
   * Get enabled state
   */
  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    const gl = this.gl;

    if (this.wakeFramebuffer) {
      gl.deleteFramebuffer(this.wakeFramebuffer);
      this.wakeFramebuffer = null;
    }

    if (this.wakeTexture) {
      gl.deleteTexture(this.wakeTexture);
      this.wakeTexture = null;
    }

    if (this.depthBuffer) {
      gl.deleteRenderbuffer(this.depthBuffer);
      this.depthBuffer = null;
    }

    this.bufferManager.dispose();

    console.log('WakeRenderer: Disposed');
  }
}

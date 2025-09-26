/**
 * FFT-based ocean wave renderer using Tessendorf's method
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { BufferManager, GeometryBuilder } from './Geometry';
import { FFTUtilities, Complex } from '../utils/fft';

export interface WaveParameters {
  windSpeed: number;
  windDirection: [number, number];
  amplitude: number;
  gravity: number;
  size: number; // Power of 2 (128, 256, 512)
  spectrumType: 'phillips' | 'jonswap';
}

export class FFTRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private params: WaveParameters;

  // Shader programs
  private spectrumProgram: ShaderProgram | null = null;
  private fftProgram: ShaderProgram | null = null;

  // Textures for ping-pong rendering
  private spectrumTextures: WebGLTexture[] = [];
  private fftTextures: WebGLTexture[] = [];
  private heightTexture: WebGLTexture | null = null;
  private normalTexture: WebGLTexture | null = null;

  // Framebuffers
  private framebuffers: WebGLFramebuffer[] = [];

  // Geometry for full-screen quad
  private quadBuffer: BufferManager;

  private currentFrame: number = 0;
  private fftStages: number;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager, params: WaveParameters) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.params = params;
    this.fftStages = Math.log2(params.size);

    // Create full-screen quad
    const quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.quadBuffer = new BufferManager(gl, quadGeometry);

    this.initializeTextures();
    this.initializeFramebuffers();
  }

  /**
   * Initialize textures for wave computation
   */
  private initializeTextures(): void {
    const gl = this.gl;
    const size = this.params.size;

    // Create spectrum textures (ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.spectrumTextures.push(texture!);
    }

    // Create FFT working textures (ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.fftTextures.push(texture!);
    }

    // Create height texture (final result)
    this.heightTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // Create normal texture
    this.normalTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  /**
   * Initialize framebuffers for off-screen rendering
   */
  private initializeFramebuffers(): void {
    const gl = this.gl;

    for (let i = 0; i < 2; i++) {
      const framebuffer = gl.createFramebuffer();
      this.framebuffers.push(framebuffer!);
    }
  }

  /**
   * Initialize shaders
   */
  async initializeShaders(
    fftVertexSource: string,
    spectrumFragmentSource: string,
    fftFragmentSource: string
  ): Promise<void> {
    // Wave spectrum generation shader
    this.spectrumProgram = this.shaderManager.createProgram(
      'waveSpectrum',
      fftVertexSource,
      spectrumFragmentSource,
      [
        'u_time',
        'u_windSpeed',
        'u_windDirection',
        'u_amplitude',
        'u_gravity',
        'u_size',
        'u_spectrumType'
      ],
      ['a_position', 'a_texcoord']
    );

    // FFT computation shader
    this.fftProgram = this.shaderManager.createProgram(
      'fft',
      fftVertexSource,
      fftFragmentSource,
      [
        'u_inputTexture',
        'u_stage',
        'u_direction',
        'u_size'
      ],
      ['a_position', 'a_texcoord']
    );

    // Set up vertex attributes
    const posLocation = this.spectrumProgram.attributeLocations.get('a_position')!;
    const texLocation = this.spectrumProgram.attributeLocations.get('a_texcoord')!;
    this.quadBuffer.setupAttributes(posLocation, texLocation);
  }

  /**
   * Generate wave spectrum
   */
  private generateSpectrum(time: number): void {
    const gl = this.gl;
    const currentTexture = this.currentFrame % 2;

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[currentTexture]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.spectrumTextures[currentTexture],
      0
    );

    gl.viewport(0, 0, this.params.size, this.params.size);

    // Use spectrum shader
    const program = this.shaderManager.useProgram('waveSpectrum');

    // Set uniforms
    this.shaderManager.setUniform1f(program, 'u_time', time);
    this.shaderManager.setUniform1f(program, 'u_windSpeed', this.params.windSpeed);
    this.shaderManager.setUniform2f(program, 'u_windDirection', this.params.windDirection[0], this.params.windDirection[1]);
    this.shaderManager.setUniform1f(program, 'u_amplitude', this.params.amplitude);
    this.shaderManager.setUniform1f(program, 'u_gravity', this.params.gravity);
    this.shaderManager.setUniform1f(program, 'u_size', this.params.size);
    this.shaderManager.setUniform1f(program, 'u_spectrumType', this.params.spectrumType === 'phillips' ? 0 : 1);

    // Render quad
    this.quadBuffer.bind();
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Perform FFT computation
   */
  private performFFT(): void {
    const gl = this.gl;
    const program = this.shaderManager.useProgram('fft');

    let inputTexture = this.spectrumTextures[this.currentFrame % 2];
    let outputIndex = 0;

    // Horizontal FFT passes
    for (let stage = 0; stage < this.fftStages; stage++) {
      const outputTexture = this.fftTextures[outputIndex % 2];

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[outputIndex % 2]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        outputTexture,
        0
      );

      gl.viewport(0, 0, this.params.size, this.params.size);

      // Bind input texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      this.shaderManager.setUniform1f(program, 'u_inputTexture', 0);

      // Set uniforms
      this.shaderManager.setUniform1f(program, 'u_stage', stage);
      this.shaderManager.setUniform1f(program, 'u_direction', 0); // Horizontal
      this.shaderManager.setUniform1f(program, 'u_size', this.params.size);

      // Render quad
      this.quadBuffer.bind();
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      inputTexture = outputTexture;
      outputIndex++;
    }

    // Vertical FFT passes
    for (let stage = 0; stage < this.fftStages; stage++) {
      const outputTexture = this.fftTextures[outputIndex % 2];

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[outputIndex % 2]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        outputTexture,
        0
      );

      gl.viewport(0, 0, this.params.size, this.params.size);

      // Bind input texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      this.shaderManager.setUniform1f(program, 'u_inputTexture', 0);

      // Set uniforms
      this.shaderManager.setUniform1f(program, 'u_stage', stage);
      this.shaderManager.setUniform1f(program, 'u_direction', 1); // Vertical
      this.shaderManager.setUniform1f(program, 'u_size', this.params.size);

      // Render quad
      this.quadBuffer.bind();
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      inputTexture = outputTexture;
      outputIndex++;
    }

    // Store final result in height texture
    this.extractHeightField(inputTexture);
  }

  /**
   * Extract height field from FFT result
   */
  private extractHeightField(fftResult: WebGLTexture): void {
    const gl = this.gl;

    // For now, we'll use the real component of the FFT result as height
    // In a more complete implementation, we'd have a separate shader for this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.heightTexture,
      0
    );

    // Copy red channel (real part) to height texture
    // This would normally be done with a dedicated shader
  }

  /**
   * Update wave simulation
   */
  update(time: number): void {
    this.generateSpectrum(time);
    this.performFFT();
    this.currentFrame++;
  }

  /**
   * Get height texture for ocean rendering
   */
  getHeightTexture(): WebGLTexture | null {
    return this.heightTexture;
  }

  /**
   * Get normal texture for ocean rendering
   */
  getNormalTexture(): WebGLTexture | null {
    return this.normalTexture;
  }

  /**
   * Update wave parameters
   */
  updateParameters(params: Partial<WaveParameters>): void {
    Object.assign(this.params, params);
  }

  /**
   * Get current wave parameters
   */
  getParameters(): WaveParameters {
    return { ...this.params };
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    const gl = this.gl;

    this.spectrumTextures.forEach(texture => gl.deleteTexture(texture));
    this.fftTextures.forEach(texture => gl.deleteTexture(texture));
    this.framebuffers.forEach(fb => gl.deleteFramebuffer(fb));

    if (this.heightTexture) gl.deleteTexture(this.heightTexture);
    if (this.normalTexture) gl.deleteTexture(this.normalTexture);

    this.quadBuffer.dispose();
  }
}
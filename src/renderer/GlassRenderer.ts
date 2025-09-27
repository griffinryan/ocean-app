/**
 * Liquid Glass Renderer with Two-Pass Rendering
 * Renders ocean to texture, then applies liquid glass distortion
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { PanelTracker } from './PanelTracker';
import { Mat4 } from '../utils/math';

export interface LiquidGlassConfig {
  enabled: boolean;
  viscosity: number;
  surfaceTension: number;
  refractionIndex: number;
  chromaticStrength: number;
  flowSpeed: number;
}

export class GlassRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private panelTracker: PanelTracker;
  private liquidGlassProgram: ShaderProgram | null = null;

  // Geometry for rendering full-screen quad
  private quadGeometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for ocean texture capture
  private oceanFramebuffer: WebGLFramebuffer | null = null;
  private oceanTexture: WebGLTexture | null = null;
  private depthBuffer: WebGLRenderbuffer | null = null;

  // Matrices
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Liquid glass configuration
  private config: LiquidGlassConfig = {
    enabled: true,
    viscosity: 1.0,
    surfaceTension: 0.072,
    refractionIndex: 1.33,
    chromaticStrength: 0.5,
    flowSpeed: 1.0
  };

  // Performance monitoring
  private lastPanelUpdate: number = 0;
  private readonly UPDATE_INTERVAL = 16; // ~60fps
  private startTime: number;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Initialize matrices
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Create full-screen quad geometry
    this.quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.quadGeometry);

    // Initialize panel tracker
    this.panelTracker = new PanelTracker(canvas);

    // Set up update callback
    this.panelTracker.onUpdate(() => {
      this.onPanelsUpdated();
    });

    // Initialize framebuffer
    this.initializeFramebuffer();

    console.log('Liquid glass renderer initialized');
  }

  /**
   * Initialize liquid glass shaders
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define all uniforms used in liquid glass shaders
      const uniforms = [
        'u_time',
        'u_aspectRatio',
        'u_resolution',
        'u_oceanTexture',
        'u_panelCount',
        'u_panelBounds',
        'u_panelCenters',
        'u_panelDistortionStrength',
        'u_panelStates',
        'u_liquidGlassEnabled',
        'u_liquidViscosity',
        'u_surfaceTension',
        'u_refractionIndex',
        'u_chromaticStrength',
        'u_flowSpeed',
        'u_projectionMatrix',
        'u_viewMatrix'
      ];

      // Define attributes
      const attributes = [
        'a_position',
        'a_texcoord'
      ];

      this.liquidGlassProgram = await this.shaderManager.createProgram(
        'liquidGlass',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes
      const positionLocation = this.liquidGlassProgram.attributeLocations.get('a_position')!;
      const texcoordLocation = this.liquidGlassProgram.attributeLocations.get('a_texcoord')!;

      this.bufferManager.setupAttributes(positionLocation, texcoordLocation);

      console.log('Liquid glass shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize liquid glass shaders:', error);
      throw error;
    }
  }

  /**
   * Initialize framebuffer for ocean texture capture
   */
  private initializeFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.oceanFramebuffer = gl.createFramebuffer();
    if (!this.oceanFramebuffer) {
      throw new Error('Failed to create framebuffer');
    }

    // Create texture for color attachment
    this.oceanTexture = gl.createTexture();
    if (!this.oceanTexture) {
      throw new Error('Failed to create ocean texture');
    }

    // Create depth renderbuffer
    this.depthBuffer = gl.createRenderbuffer();
    if (!this.depthBuffer) {
      throw new Error('Failed to create depth buffer');
    }

    // Setup will be completed in resize method
    this.resizeFramebuffer(gl.canvas.width, gl.canvas.height);
  }

  /**
   * Set liquid glass configuration
   */
  public setConfig(config: Partial<LiquidGlassConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('Liquid glass config updated:', this.config);
  }

  /**
   * Resize framebuffer to match canvas size
   */
  public resizeFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.oceanFramebuffer || !this.oceanTexture || !this.depthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.oceanTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    // Update panel tracker
    this.panelTracker.forceUpdate();
  }

  /**
   * Capture ocean scene to framebuffer
   */
  public captureOceanScene(renderOceanCallback: () => void): void {
    const gl = this.gl;

    if (!this.oceanFramebuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render ocean scene to texture
    renderOceanCallback();

    // Unbind framebuffer (render to screen)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Handle panel updates from tracker
   */
  private onPanelsUpdated(): void {
    const now = performance.now();
    if (now - this.lastPanelUpdate < this.UPDATE_INTERVAL) {
      return; // Throttle updates for performance
    }
    this.lastPanelUpdate = now;

    // Panel data is automatically tracked by PanelTracker
    // No need to manually manage panels
  }

  /**
   * Render liquid glass distortion effect with fallback
   */
  public render(): void {
    const gl = this.gl;

    // Always ensure we render something - fallback to simple texture display
    if (!this.oceanTexture) {
      console.error('Ocean texture not available for liquid glass rendering');
      return;
    }

    // If liquid glass isn't ready or enabled, render ocean texture directly
    if (!this.liquidGlassProgram || !this.config.enabled) {
      console.log('Liquid glass not ready, falling back to direct ocean render');
      this.renderOceanFallback();
      return;
    }

    // Use liquid glass shader program
    const program = this.shaderManager.useProgram('liquidGlass');

    // Set matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time for animation
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    this.shaderManager.setUniform1f(program, 'u_time', currentTime);

    // Set resolution and aspect ratio
    this.shaderManager.setUniform2f(program, 'u_resolution', gl.canvas.width, gl.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', gl.canvas.width / gl.canvas.height);

    // Bind ocean texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

    // Set panel data
    this.applyPanelUniforms(program);

    // Set liquid glass parameters
    this.applyLiquidGlassUniforms(program);

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Render full-screen quad
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

    // Restore state
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * Apply panel uniforms to liquid glass shader
   */
  private applyPanelUniforms(program: ShaderProgram): void {
    const panelData = this.panelTracker.getPanelData();

    // Set panel count
    this.shaderManager.setUniform1i(program, 'u_panelCount', panelData.count);
    this.shaderManager.setUniform1i(program, 'u_liquidGlassEnabled', this.config.enabled ? 1 : 0);

    // Set panel bounds (vec4 array)
    for (let i = 0; i < 8; i++) {
      const offset = i * 4;
      this.shaderManager.setUniform4f(
        program,
        `u_panelBounds[${i}]`,
        panelData.bounds[offset] || 0,
        panelData.bounds[offset + 1] || 0,
        panelData.bounds[offset + 2] || 0,
        panelData.bounds[offset + 3] || 0
      );
    }

    // Set panel centers (vec2 array)
    for (let i = 0; i < 8; i++) {
      const offset = i * 2;
      this.shaderManager.setUniform2f(
        program,
        `u_panelCenters[${i}]`,
        panelData.centers[offset] || 0,
        panelData.centers[offset + 1] || 0
      );
    }

    // Set panel properties (float arrays)
    for (let i = 0; i < 8; i++) {
      this.shaderManager.setUniform1f(program, `u_panelDistortionStrength[${i}]`, panelData.distortionStrengths[i] || 0);
      this.shaderManager.setUniform1f(program, `u_panelStates[${i}]`, panelData.states[i] || 0);
    }
  }

  /**
   * Apply liquid glass configuration uniforms
   */
  private applyLiquidGlassUniforms(program: ShaderProgram): void {
    this.shaderManager.setUniform1f(program, 'u_liquidViscosity', this.config.viscosity);
    this.shaderManager.setUniform1f(program, 'u_surfaceTension', this.config.surfaceTension);
    this.shaderManager.setUniform1f(program, 'u_refractionIndex', this.config.refractionIndex);
    this.shaderManager.setUniform1f(program, 'u_chromaticStrength', this.config.chromaticStrength);
    this.shaderManager.setUniform1f(program, 'u_flowSpeed', this.config.flowSpeed);
  }

  /**
   * Fallback rendering - display ocean texture directly without distortion
   */
  private renderOceanFallback(): void {
    const gl = this.gl;

    // Try to use ocean shader as fallback
    try {
      const oceanProgram = this.shaderManager.useProgram('ocean');

      // Set basic uniforms for ocean shader
      const currentTime = (performance.now() - this.startTime) / 1000.0;
      this.shaderManager.setUniform1f(oceanProgram, 'u_time', currentTime);
      this.shaderManager.setUniform1f(oceanProgram, 'u_aspectRatio', gl.canvas.width / gl.canvas.height);
      this.shaderManager.setUniform2f(oceanProgram, 'u_resolution', gl.canvas.width, gl.canvas.height);
      this.shaderManager.setUniform1i(oceanProgram, 'u_debugMode', 0);

      // Set vessel uniforms to empty
      this.shaderManager.setUniform1i(oceanProgram, 'u_vesselCount', 0);
      this.shaderManager.setUniform1i(oceanProgram, 'u_wakesEnabled', 0);

      // Render full-screen quad with ocean shader
      this.bufferManager.bind();
      gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

      console.log('Rendered ocean fallback successfully');
    } catch (error) {
      console.error('Ocean fallback rendering failed:', error);

      // Last resort: render a simple colored quad
      this.renderColorFallback();
    }
  }

  /**
   * Last resort fallback - render a simple color
   */
  private renderColorFallback(): void {
    const gl = this.gl;

    // Clear with ocean blue color
    gl.clearColor(0.05, 0.15, 0.4, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    console.log('Rendered color fallback');
  }

  /**
   * Get liquid glass enabled state
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable/disable liquid glass effect
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Force update panel tracking
   */
  public forceUpdate(): void {
    this.panelTracker.forceUpdate();
  }

  /**
   * Get panel count
   */
  public getPanelCount(): number {
    return this.panelTracker.getPanelCount();
  }

  /**
   * Get panel tracker (for debugging)
   */
  public getPanelTracker(): PanelTracker {
    return this.panelTracker;
  }

  /**
   * Get ocean texture for external use
   */
  public getOceanTexture(): WebGLTexture | null {
    return this.oceanTexture;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    const gl = this.gl;

    // Clean up framebuffer
    if (this.oceanFramebuffer) {
      gl.deleteFramebuffer(this.oceanFramebuffer);
      this.oceanFramebuffer = null;
    }

    if (this.oceanTexture) {
      gl.deleteTexture(this.oceanTexture);
      this.oceanTexture = null;
    }

    if (this.depthBuffer) {
      gl.deleteRenderbuffer(this.depthBuffer);
      this.depthBuffer = null;
    }

    // Clean up geometry
    this.bufferManager.dispose();

    // Clean up panel tracker
    if (this.panelTracker) {
      this.panelTracker.dispose();
    }
  }
}
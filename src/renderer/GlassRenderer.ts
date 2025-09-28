/**
 * Glass Panel Renderer with WebGL Distortion Effects
 * Renders liquid glass panels that distort the ocean underneath
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';

export interface GlassPanelConfig {
  position: [number, number]; // Screen position in normalized coordinates
  size: [number, number];     // Size in normalized coordinates
  distortionStrength: number; // Strength of the distortion effect
  refractionIndex: number;    // Index of refraction for the glass
}

export class GlassRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private glassProgram: ShaderProgram | null = null;

  // Geometry for rendering glass panels
  private panelGeometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for ocean texture
  private oceanFramebuffer: WebGLFramebuffer | null = null;
  private oceanTexture: WebGLTexture | null = null;
  private depthBuffer: WebGLRenderbuffer | null = null;

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Panel configurations
  private panels: Map<string, GlassPanelConfig> = new Map();

  // Animation
  private startTime: number;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Initialize matrices
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();

    // Create geometry for rendering panels
    this.panelGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.panelGeometry);

    // Set up projection matrix for screen-space rendering
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Initialize framebuffer
    this.initializeFramebuffer();
  }

  /**
   * Initialize shaders for glass rendering
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define uniforms and attributes for glass shader
      const uniforms = [
        'u_projectionMatrix',
        'u_viewMatrix',
        'u_time',
        'u_aspectRatio',
        'u_resolution',
        'u_oceanTexture',
        'u_panelPosition',
        'u_panelSize',
        'u_distortionStrength',
        'u_refractionIndex'
      ];

      const attributes = [
        'a_position',
        'a_uv'
      ];

      // Create glass shader program
      this.glassProgram = this.shaderManager.createProgram(
        'glass',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes for glass rendering
      const positionLocation = this.glassProgram.attributeLocations.get('a_position');
      const uvLocation = this.glassProgram.attributeLocations.get('a_uv');

      if (positionLocation !== undefined && uvLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, uvLocation);
      }

      console.log('Glass shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize glass shaders:', error);
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
  }

  /**
   * Capture ocean scene to texture for glass distortion
   */
  public captureOceanScene(renderOceanCallback: () => void): void {
    const gl = this.gl;

    if (!this.oceanFramebuffer || !this.oceanTexture) {
      return;
    }

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind framebuffer for rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);

    // Set viewport to match framebuffer size
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render ocean scene to framebuffer
    renderOceanCallback();

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Restore viewport
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  }

  /**
   * Copy current screen contents to ocean texture (alternative method)
   */
  public copyScreenToTexture(): void {
    const gl = this.gl;

    if (!this.oceanTexture) {
      return;
    }

    // Bind the ocean texture
    gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);

    // Copy current framebuffer to texture
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, gl.canvas.width, gl.canvas.height, 0);

    // Unbind texture
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Add a glass panel configuration
   */
  public addPanel(id: string, config: GlassPanelConfig): void {
    this.panels.set(id, config);
  }

  /**
   * Remove a glass panel
   */
  public removePanel(id: string): void {
    this.panels.delete(id);
  }

  /**
   * Update panel configuration
   */
  public updatePanel(id: string, config: Partial<GlassPanelConfig>): void {
    const existingConfig = this.panels.get(id);
    if (existingConfig) {
      this.panels.set(id, { ...existingConfig, ...config });
    }
  }

  /**
   * Render all glass panels
   */
  public render(): void {
    const gl = this.gl;

    if (!this.glassProgram || !this.oceanTexture || this.panels.size === 0) {
      return;
    }

    // Update panel positions before rendering
    this.updatePanelPositions();

    // Use glass shader program
    const program = this.shaderManager.useProgram('glass');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time uniform for animation
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    this.shaderManager.setUniform1f(program, 'u_time', currentTime);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', gl.canvas.width, gl.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', gl.canvas.width / gl.canvas.height);

    // Bind ocean texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable depth testing for glass panels
    gl.disable(gl.DEPTH_TEST);

    // Render each visible panel
    this.panels.forEach((config, id) => {
      // Check if the corresponding HTML element is visible
      const element = document.getElementById(id === 'landing' ? 'landing-panel' : 'app-panel');
      if (element && !element.classList.contains('hidden')) {
        this.renderPanel(config, program);
      }
    });

    // Re-enable depth testing
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * Render a single glass panel
   */
  private renderPanel(config: GlassPanelConfig, program: ShaderProgram): void {
    const gl = this.gl;

    // Set panel-specific uniforms
    this.shaderManager.setUniform2f(program, 'u_panelPosition', config.position[0], config.position[1]);
    this.shaderManager.setUniform2f(program, 'u_panelSize', config.size[0], config.size[1]);
    this.shaderManager.setUniform1f(program, 'u_distortionStrength', config.distortionStrength);
    this.shaderManager.setUniform1f(program, 'u_refractionIndex', config.refractionIndex);

    // Bind geometry and render
    this.bufferManager.bind();
    gl.drawElements(gl.TRIANGLES, this.panelGeometry.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Set up default panel configurations
   */
  public setupDefaultPanels(): void {
    // Initialize with temporary values - will be updated dynamically
    this.addPanel('landing', {
      position: [0.0, 0.0],
      size: [0.4, 0.5],
      distortionStrength: 0.25, // Much stronger distortion for clear visibility
      refractionIndex: 1.52
    });

    this.addPanel('app', {
      position: [0.0, 0.0],
      size: [0.35, 0.3],
      distortionStrength: 0.2, // Strong distortion
      refractionIndex: 1.52
    });

    // Update positions immediately
    this.updatePanelPositions();
  }

  /**
   * Update panel positions based on HTML element positions
   */
  public updatePanelPositions(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    // Ensure canvas has valid dimensions
    if (canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('GlassRenderer: Canvas has invalid dimensions, skipping panel position update');
      return;
    }

    // Update landing panel position
    const landingElement = document.getElementById('landing-panel');
    if (landingElement && !landingElement.classList.contains('hidden')) {
      const rect = landingElement.getBoundingClientRect();

      // Only update if element is visible and has valid dimensions
      if (rect.width > 0 && rect.height > 0) {
        const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);
        this.updatePanel('landing', {
          position: normalizedPos.position,
          size: normalizedPos.size
        });
      }
    }

    // Update app panel position
    const appElement = document.getElementById('app-panel');
    if (appElement && !appElement.classList.contains('hidden')) {
      const rect = appElement.getBoundingClientRect();

      // Only update if element is visible and has valid dimensions
      if (rect.width > 0 && rect.height > 0) {
        const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);
        this.updatePanel('app', {
          position: normalizedPos.position,
          size: normalizedPos.size
        });
      }
    }
  }

  /**
   * Convert HTML element rect to normalized WebGL coordinates
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    // Ensure we have valid rectangles
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('GlassRenderer: Invalid rectangle dimensions detected');
      return { position: [0, 0], size: [0, 0] };
    }

    // Calculate center position in normalized coordinates (0 to 1)
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    // Convert to WebGL coordinates (-1 to 1, with Y flipped)
    const glX = centerX * 2.0 - 1.0;
    const glY = (1.0 - centerY) * 2.0 - 1.0; // Flip Y and convert to [-1,1]

    // Calculate size in normalized coordinates (as fraction of screen size * 2 for [-1,1] range)
    const width = (elementRect.width / canvasRect.width) * 2.0;
    const height = (elementRect.height / canvasRect.height) * 2.0;

    // Debug logging (can be removed in production)
    console.debug(`GlassRenderer Panel Mapping:
      Element: ${elementRect.width}x${elementRect.height} at (${elementRect.left}, ${elementRect.top})
      Canvas: ${canvasRect.width}x${canvasRect.height}
      WebGL Center: (${glX.toFixed(3)}, ${glY.toFixed(3)})
      WebGL Size: (${width.toFixed(3)}, ${height.toFixed(3)})`);

    return {
      position: [glX, glY],
      size: [width, height]
    };
  }

  /**
   * Enable/disable glass rendering for specific panels
   */
  public setPanelVisibility(_id: string, _visible: boolean): void {
    // Could implement per-panel visibility if needed
    // For now, panels are controlled by the panels Map
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

    // Clear panels
    this.panels.clear();
  }
}
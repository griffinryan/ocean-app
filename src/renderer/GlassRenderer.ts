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
  private oceanTextureOwned: boolean = true; // Track if we own the texture for cleanup
  private depthBuffer: WebGLRenderbuffer | null = null;

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Panel configurations
  private panels: Map<string, GlassPanelConfig> = new Map();

  // Animation
  private startTime: number;

  // Blur map texture reference (owned by TextRenderer)
  private blurMapTexture: WebGLTexture | null = null;

  // Blur effect control
  private blurMapEnabled: boolean = false;
  private blurOpacityBoost: number = 0.45; // How much to increase opacity in text regions (0.0-0.5)
  private blurDistortionBoost: number = 0.85; // How much to reduce distortion in text regions (0.0-1.0)

  private textPresence: number = 1.0;

  // PERFORMANCE: Position caching to avoid redundant getBoundingClientRect calls
  private positionsDirty: boolean = true;
  private resizeObserver: ResizeObserver | null = null;

  // PERFORMANCE: Smart capture caching - only recapture when ocean changes
  private oceanCaptureDirty: boolean = true;
  private lastOceanCaptureTime: number = 0;
  private oceanCaptureThrottleMs: number = 32; // Max 30fps ocean captures (30Hz = 33ms, using 32ms)

  // Transition tracking keeps panel UVs in sync with CSS transforms during panel slides and intro animations
  private transitionTracking: boolean = false;

  // Scroll tracking mode - continuous updates during scroll
  private isScrolling: boolean = false;

  // PERFORMANCE: Uniform caching to avoid redundant WebGL calls
  private uniformCache = {
    time: -1,
    resolution: new Float32Array([0, 0]),
    aspectRatio: -1,
    blurMapEnabled: -1,
    blurOpacityBoost: -1,
    blurDistortionBoost: -1,
    textPresence: -1
  };

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Setup resize observer to mark positions dirty only when needed
    this.setupResizeObserver();

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
        'u_refractionIndex',
        'u_blurMapTexture',
        'u_blurMapEnabled',
        'u_blurOpacityBoost',
        'u_blurDistortionBoost',
        'u_textPresence'
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
   * Mark ocean capture as dirty (forces recapture on next render)
   */
  public markOceanDirty(): void {
    this.oceanCaptureDirty = true;
  }

  /**
   * Capture ocean scene to texture for glass distortion
   * PERFORMANCE: Uses dirty flag + throttling to skip redundant captures
   */
  public captureOceanScene(renderOceanCallback: () => void): void {
    const gl = this.gl;

    if (!this.oceanFramebuffer || !this.oceanTexture) {
      return;
    }

    // PERFORMANCE: Skip capture if not dirty and within throttle window
    const currentTime = performance.now();
    if (!this.oceanCaptureDirty &&
        (currentTime - this.lastOceanCaptureTime) < this.oceanCaptureThrottleMs) {
      return; // Use cached ocean texture
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

    // Mark as clean and update timestamp
    this.oceanCaptureDirty = false;
    this.lastOceanCaptureTime = currentTime;
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

    // PERFORMANCE: Only update panel positions when marked dirty (resize, panel changes)
    // Enables continuous tracking during scroll and orchestrated transitions
    const shouldUpdatePositions = this.positionsDirty || this.isScrolling || this.transitionTracking;
    if (shouldUpdatePositions) {
      this.updatePanelPositions();
      this.positionsDirty = false;
    }

    // Use glass shader program
    const program = this.shaderManager.useProgram('glass');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // PERFORMANCE: Cache uniform updates - only set when values change
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    if (currentTime !== this.uniformCache.time) {
      this.shaderManager.setUniform1f(program, 'u_time', currentTime);
      this.uniformCache.time = currentTime;
    }

    // Set resolution (only if changed)
    const width = gl.canvas.width;
    const height = gl.canvas.height;
    if (width !== this.uniformCache.resolution[0] || height !== this.uniformCache.resolution[1]) {
      this.shaderManager.setUniform2f(program, 'u_resolution', width, height);
      this.uniformCache.resolution[0] = width;
      this.uniformCache.resolution[1] = height;

      const aspectRatio = width / height;
      this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspectRatio);
      this.uniformCache.aspectRatio = aspectRatio;
    }

    if (this.textPresence !== this.uniformCache.textPresence) {
      this.shaderManager.setUniform1f(program, 'u_textPresence', this.textPresence);
      this.uniformCache.textPresence = this.textPresence;
    }

    // Bind ocean texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
    this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

    // Bind blur map texture if enabled (cache blur state changes)
    const blurEnabled = this.blurMapEnabled && this.blurMapTexture ? 1 : 0;
    if (blurEnabled !== this.uniformCache.blurMapEnabled) {
      this.shaderManager.setUniform1i(program, 'u_blurMapEnabled', blurEnabled);
      this.uniformCache.blurMapEnabled = blurEnabled;
    }

    if (blurEnabled) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.blurMapTexture);
      this.shaderManager.setUniform1i(program, 'u_blurMapTexture', 1);

      // Only update blur params if changed
      if (this.blurOpacityBoost !== this.uniformCache.blurOpacityBoost) {
        this.shaderManager.setUniform1f(program, 'u_blurOpacityBoost', this.blurOpacityBoost);
        this.uniformCache.blurOpacityBoost = this.blurOpacityBoost;
      }

      if (this.blurDistortionBoost !== this.uniformCache.blurDistortionBoost) {
        this.shaderManager.setUniform1f(program, 'u_blurDistortionBoost', this.blurDistortionBoost);
        this.uniformCache.blurDistortionBoost = this.blurDistortionBoost;
      }
    }

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable depth testing for glass panels
    gl.disable(gl.DEPTH_TEST);

    // Render each visible panel
    this.panels.forEach((config, id) => {
      // Dynamically construct element ID: navbar stays as-is, everything else gets -panel suffix
      const elementId = (id === 'navbar') ? 'navbar' : `${id}-panel`;

      const element = document.getElementById(elementId);
      if (element && !element.classList.contains('hidden')) {
        // Check if parent scroll container is visible (for portfolio/resume panels)
        const parent = element.parentElement?.parentElement;
        const parentHidden = parent?.classList.contains('hidden') ?? false;

        if (!parentHidden) {
          this.renderPanel(config, program);
        }
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
      distortionStrength: 0.4,
      refractionIndex: 1.52
    });

    // Bio panel with medium distortion for readability
    this.addPanel('app-bio', {
      position: [0.0, 0.0],
      size: [0.6, 0.35],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    // Portfolio project panels
    this.addPanel('portfolio-lakehouse', {
      position: [0.0, 0.0],
      size: [0.4, 0.5],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('portfolio-encryption', {
      position: [0.0, 0.0],
      size: [0.38, 0.48],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('portfolio-dotereditor', {
      position: [0.0, 0.0],
      size: [0.4, 0.5],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('portfolio-dreamrequiem', {
      position: [0.0, 0.0],
      size: [0.38, 0.48],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('portfolio-greenlightgo', {
      position: [0.0, 0.0],
      size: [0.38, 0.48],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    // Resume card panels
    this.addPanel('resume-playember', {
      position: [0.0, 0.0],
      size: [0.45, 0.38],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('resume-meta', {
      position: [0.0, 0.0],
      size: [0.45, 0.38],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('resume-outlier', {
      position: [0.0, 0.0],
      size: [0.45, 0.38],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('resume-uwtutor', {
      position: [0.0, 0.0],
      size: [0.45, 0.32],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    this.addPanel('resume-uwedu', {
      position: [0.0, 0.0],
      size: [0.45, 0.32],
      distortionStrength: 0.35,
      refractionIndex: 1.52
    });

    // Navigation bar with minimal distortion for readability
    this.addPanel('navbar', {
      position: [0.0, 0.9],
      size: [2.0, 0.2],
      distortionStrength: 0.15,
      refractionIndex: 1.45
    });

    // Update positions immediately and mark dirty for first render
    this.positionsDirty = true;

    // CRITICAL FIX: Observe all panel elements for position/size changes
    // This ensures glass panels stay aligned during CSS transitions and layout changes
    this.observePanelElements();
  }

  /**
   * Setup resize observer to mark positions dirty when layout changes
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.positionsDirty = true;
    });

    // Observe canvas for size changes
    // Cast to Element since canvas is HTMLCanvasElement (which extends Element)
    this.resizeObserver.observe(this.gl.canvas as unknown as Element);
  }

  /**
   * Observe all panel elements for position/size changes
   * CRITICAL: Call this after setupDefaultPanels() to ensure glass aligns during transitions
   */
  private observePanelElements(): void {
    if (!this.resizeObserver) {
      console.warn('GlassRenderer: ResizeObserver not initialized, cannot observe panels');
      return;
    }

    // All panel IDs that glass should track
    const panelIds = [
      'landing',
      'app-bio',
      'navbar',
      'portfolio-lakehouse',
      'portfolio-encryption',
      'portfolio-dotereditor',
      'portfolio-dreamrequiem',
      'portfolio-greenlightgo',
      'resume-playember',
      'resume-meta',
      'resume-outlier',
      'resume-uwtutor',
      'resume-uwedu'
    ];

    panelIds.forEach(id => {
      // Construct element ID (navbar stays as-is, others get -panel suffix)
      const elementId = (id === 'navbar') ? 'navbar' : `${id}-panel`;
      const element = document.getElementById(elementId);

      if (element) {
        this.resizeObserver!.observe(element);
        console.debug(`GlassRenderer: Observing panel ${elementId} for position changes`);
      } else {
        console.warn(`GlassRenderer: Panel element ${elementId} not found, cannot observe`);
      }
    });

    console.log(`GlassRenderer: Observing ${panelIds.length} panel elements for position/size changes`);
  }

  /**
   * Mark panel positions as dirty (forces position recalculation on next render)
   * Call this when panels are added/removed or layout might have changed
   */
  public markPositionsDirty(): void {
    this.positionsDirty = true;
  }

  /**
   * Start transition mode - keep UVs in sync with CSS transforms during panel slides and intro animations
   * CRITICAL: Called when CSS transitions or keyframe animations start
   */
  public startTransitionMode(): void {
    if (this.transitionTracking) return; // Already tracking

    this.transitionTracking = true;
    this.positionsDirty = true;

    console.debug('GlassRenderer: Transition mode started - continuous position updates enabled');
  }

  /**
   * End transition mode - return to on-demand updates after transitions settle
   * CRITICAL: Called when all CSS transitions/animations complete
   */
  public endTransitionMode(): void {
    if (!this.transitionTracking) return;

    this.transitionTracking = false;
    this.positionsDirty = true;

    console.debug('GlassRenderer: Transition mode ended - returning to on-demand updates');
  }

  /**
   * Start scroll mode - enable continuous position updates
   * Called when user starts scrolling portfolio/resume containers
   */
  public startScrollMode(): void {
    if (this.isScrolling) return; // Already active

    this.isScrolling = true;
    console.debug('GlassRenderer: Scroll mode started - continuous position updates enabled');
  }

  /**
   * End scroll mode - disable continuous updates
   * Called when scroll stops (after cooldown)
   */
  public endScrollMode(): void {
    this.isScrolling = false;

    // One final update to ensure positions are correct
    this.positionsDirty = true;

    console.debug('GlassRenderer: Scroll mode ended - continuous position updates disabled');
  }

  /**
   * Check if currently in scroll mode
   */
  public isInScrollMode(): boolean {
    return this.isScrolling;
  }


  /**
   * Update panel positions based on HTML element positions
   * Dynamically updates all registered panels
   * PERFORMANCE: Only called when positionsDirty flag is set
   */
  public updatePanelPositions(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    // Ensure canvas has valid dimensions
    if (canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('GlassRenderer: Canvas has invalid dimensions, skipping panel position update');
      return;
    }

    // Dynamically update all registered panels
    this.panels.forEach((_config, id) => {
      // Construct element ID: navbar stays as-is, everything else gets -panel suffix
      const elementId = (id === 'navbar') ? 'navbar' : `${id}-panel`;

      const element = document.getElementById(elementId);
      if (element && !element.classList.contains('hidden')) {
        const rect = element.getBoundingClientRect();

        // Only update if element is visible and has valid dimensions
        if (rect.width > 0 && rect.height > 0) {
          const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);
          this.updatePanel(id, {
            position: normalizedPos.position,
            size: normalizedPos.size
          });
        }
      }
    });
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
   * Update quality settings (stub for future quality-based optimizations)
   */
  public updateQualitySettings(_settings: any): void {
    // Future: Adjust glass distortion quality based on settings
    // For now, resolution scaling is handled by OceanRenderer
  }

  /**
   * Set ocean texture from shared buffer
   * PERFORMANCE: Allows glass to use pre-rendered ocean instead of capturing
   */
  public setOceanTexture(texture: WebGLTexture | null): void {
    if (texture) {
      // Delete old texture if we own it (not shared)
      if (this.oceanTextureOwned && this.oceanTexture) {
        this.gl.deleteTexture(this.oceanTexture);
      }

      // Set new texture (shared, not owned by us)
      this.oceanTexture = texture;
      this.oceanTextureOwned = false;
    }
  }

  /**
   * Set blur map texture from TextRenderer
   */
  public setBlurMapTexture(texture: WebGLTexture | null): void {
    this.blurMapTexture = texture;
    this.blurMapEnabled = texture !== null;
  }

  /**
   * Set the current text presence factor (0 = hidden, 1 = fully visible)
   */
  public setTextPresence(presence: number): void {
    const clamped = Math.max(0, Math.min(1, presence));
    if (this.textPresence !== clamped) {
      this.textPresence = clamped;
      // Force uniform update next render
      this.uniformCache.textPresence = -1;
    }
  }

  /**
   * Enable/disable blur map effect
   */
  public setBlurMapEnabled(enabled: boolean): void {
    this.blurMapEnabled = enabled && this.blurMapTexture !== null;
  }

  /**
   * Get blur map enabled state
   */
  public getBlurMapEnabled(): boolean {
    return this.blurMapEnabled;
  }

  /**
   * Set blur opacity boost (how much to increase opacity in text regions)
   * @param boost - Value from 0.0 to 0.5 (0-50%)
   */
  public setBlurOpacityBoost(boost: number): void {
    this.blurOpacityBoost = Math.max(0, Math.min(0.5, boost));
  }

  /**
   * Get current blur opacity boost
   */
  public getBlurOpacityBoost(): number {
    return this.blurOpacityBoost;
  }

  /**
   * Set blur distortion boost (how much to reduce distortion in text regions)
   * @param boost - Value from 0.0 to 1.0 (0-100%)
   */
  public setBlurDistortionBoost(boost: number): void {
    this.blurDistortionBoost = Math.max(0, Math.min(1.0, boost));
  }

  /**
   * Get current blur distortion boost
   */
  public getBlurDistortionBoost(): number {
    return this.blurDistortionBoost;
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

    // Only delete texture if we own it (not shared from OceanRenderer)
    if (this.oceanTexture && this.oceanTextureOwned) {
      gl.deleteTexture(this.oceanTexture);
    }
    this.oceanTexture = null;
    this.oceanTextureOwned = true;

    if (this.depthBuffer) {
      gl.deleteRenderbuffer(this.depthBuffer);
      this.depthBuffer = null;
    }

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up geometry
    this.bufferManager.dispose();

    // Clear panels
    this.panels.clear();
  }
}

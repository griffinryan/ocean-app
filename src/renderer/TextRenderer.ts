/**
 * Text Renderer with Adaptive Color and WebGL Overlay Effects
 * Renders text elements with background-aware color adaptation
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { GeometryBuilder, BufferManager, GeometryData } from './Geometry';
import { Mat4 } from '../utils/math';

export interface TextElementConfig {
  position: [number, number]; // Screen position in normalized coordinates
  size: [number, number];     // Size in normalized coordinates
  content: string;            // Text content
  fontSize: number;           // Font size in pixels
  fontFamily: string;         // Font family
  fontWeight: string;         // Font weight (normal, bold, etc.)
  color: string;              // Fallback color for CSS compatibility
  textAlign: 'left' | 'center' | 'right'; // Text alignment
  lineHeight: number;         // Line height multiplier
  panelId: string;            // ID of the panel this text belongs to
  panelRelativePosition: [number, number]; // Position relative to panel [0,1]
}

export interface PanelTextData {
  panelId: string;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: WebGLTexture;
  needsUpdate: boolean;
  textElements: TextElementConfig[];
  // Panel position in WebGL coordinates
  position: [number, number];
  size: [number, number];
}

export class TextRenderer {
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private textProgram: ShaderProgram | null = null;

  // Geometry for rendering text quads
  private quadGeometry: GeometryData;
  private bufferManager: BufferManager;

  // Framebuffer for capturing combined ocean+glass scene
  private sceneFramebuffer: WebGLFramebuffer | null = null;
  private sceneTexture: WebGLTexture | null = null;
  private sceneDepthBuffer: WebGLRenderbuffer | null = null;

  // Canvas for text generation
  private textCanvas!: HTMLCanvasElement;
  private textContext!: CanvasRenderingContext2D;
  private textTexture: WebGLTexture | null = null;

  // Matrix uniforms
  private projectionMatrix: Mat4;
  private viewMatrix: Mat4;

  // Text element configurations organized by panel
  private textElements: Map<string, TextElementConfig> = new Map();

  // Per-panel text rendering data
  private panelTextData: Map<string, PanelTextData> = new Map();

  // Animation and state
  private startTime: number;

  // Scene texture caching for performance
  private sceneTextureDirty: boolean = true;
  private lastCaptureTime: number = 0;
  private captureThrottleMs: number = 16; // Max 60fps captures

  // Resize observer for responsive text positioning
  private resizeObserver: ResizeObserver | null = null;

  constructor(gl: WebGL2RenderingContext, shaderManager: ShaderManager) {
    this.gl = gl;
    this.shaderManager = shaderManager;
    this.startTime = performance.now();

    // Initialize matrices
    this.projectionMatrix = new Mat4();
    this.viewMatrix = new Mat4();

    // Create geometry for rendering text quads
    this.quadGeometry = GeometryBuilder.createFullScreenQuad();
    this.bufferManager = new BufferManager(gl, this.quadGeometry);

    // Set up projection matrix for screen-space rendering
    this.projectionMatrix.identity();
    this.viewMatrix.identity();

    // Initialize text canvas
    this.initializeTextCanvas();

    // Initialize framebuffer for scene capture
    this.initializeFramebuffer();

    // Initialize per-panel canvases
    this.initializePanelCanvases();
  }

  /**
   * Initialize HTML canvas for text generation with dynamic sizing
   */
  private initializeTextCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const gl = this.gl;

    this.textCanvas = document.createElement('canvas');
    // Match screen size with DPR for crisp text
    this.textCanvas.width = gl.canvas.width * dpr;
    this.textCanvas.height = gl.canvas.height * dpr;

    const context = this.textCanvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D context for text canvas');
    }

    this.textContext = context;
    // Scale for high-DPI displays
    this.textContext.scale(dpr, dpr);

    // Set up high-quality text rendering
    this.textContext.textBaseline = 'top';
    this.textContext.fillStyle = 'white';
    this.textContext.imageSmoothingEnabled = true;
    this.textContext.imageSmoothingQuality = 'high';
  }

  /**
   * Initialize per-panel canvases for precise text rendering
   */
  private initializePanelCanvases(): void {
    console.log('🎨 Initializing panel canvases...');
    const panels = ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel', 'navbar'];

    panels.forEach(panelId => {
      const element = document.getElementById(panelId);
      if (element) {
        const rect = element.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        console.log(`🖼️  Panel "${panelId}": ${rect.width}x${rect.height} (DPR: ${dpr})`);

        // Create canvas sized to panel
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(rect.width * dpr, 1); // Ensure minimum size
        canvas.height = Math.max(rect.height * dpr, 1);

        console.log(`🎯 Created canvas for "${panelId}": ${canvas.width}x${canvas.height}`);

        const context = canvas.getContext('2d');
        if (!context) {
          console.warn(`❌ Failed to get 2D context for panel ${panelId}`);
          return;
        }

        context.scale(dpr, dpr);

        // Set up high-quality text rendering
        context.textBaseline = 'top';
        context.fillStyle = 'white';
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

        // Create WebGL texture
        const texture = this.gl.createTexture();
        if (!texture) {
          console.warn(`❌ Failed to create texture for panel ${panelId}`);
          return;
        }

        this.panelTextData.set(panelId, {
          panelId,
          canvas,
          context,
          texture,
          needsUpdate: true,
          textElements: [],
          position: [0, 0],
          size: [0, 0]
        });

        console.log(`✅ Panel "${panelId}" initialized successfully`);

        // Debug: Add canvas to DOM for inspection
        canvas.style.position = 'fixed';
        canvas.style.top = `${10 + Object.keys(this.panelTextData).length * 110}px`;
        canvas.style.left = '10px';
        canvas.style.border = '2px solid red';
        canvas.style.zIndex = '10000';
        canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        canvas.title = `Debug Canvas: ${panelId}`;
        document.body.appendChild(canvas);
      } else {
        console.warn(`❌ Panel element "${panelId}" not found in DOM`);
      }
    });

    console.log(`🎉 Panel initialization complete! Created ${this.panelTextData.size} panel canvases`);
  }

  /**
   * Initialize framebuffer for scene texture capture
   */
  private initializeFramebuffer(): void {
    const gl = this.gl;

    // Create framebuffer
    this.sceneFramebuffer = gl.createFramebuffer();
    if (!this.sceneFramebuffer) {
      throw new Error('Failed to create scene framebuffer');
    }

    // Create texture for color attachment
    this.sceneTexture = gl.createTexture();
    if (!this.sceneTexture) {
      throw new Error('Failed to create scene texture');
    }

    // Create depth renderbuffer
    this.sceneDepthBuffer = gl.createRenderbuffer();
    if (!this.sceneDepthBuffer) {
      throw new Error('Failed to create scene depth buffer');
    }

    // Create text texture
    this.textTexture = gl.createTexture();
    if (!this.textTexture) {
      throw new Error('Failed to create text texture');
    }

    // Setup will be completed in resize method
    this.resizeFramebuffer(gl.canvas.width, gl.canvas.height);
  }

  /**
   * Initialize text shaders
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    try {
      // Define uniforms and attributes for text shader
      const uniforms = [
        'u_projectionMatrix',
        'u_viewMatrix',
        'u_time',
        'u_aspectRatio',
        'u_resolution',
        'u_textTexture',
        'u_adaptiveStrength',
        'u_panelPosition',
        'u_panelSize'
      ];

      const attributes = [
        'a_position',
        'a_uv'
      ];

      // Create text shader program
      this.textProgram = this.shaderManager.createProgram(
        'text',
        vertexShader,
        fragmentShader,
        uniforms,
        attributes
      );

      // Set up vertex attributes for text rendering
      const positionLocation = this.textProgram.attributeLocations.get('a_position');
      const uvLocation = this.textProgram.attributeLocations.get('a_uv');

      if (positionLocation !== undefined && uvLocation !== undefined) {
        this.bufferManager.setupAttributes(positionLocation, uvLocation);
      }

      console.log('Text shaders initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text shaders:', error);
      throw error;
    }
  }

  /**
   * Resize text canvas to match screen size
   */
  public resizeCanvas(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.textCanvas.width = width * dpr;
    this.textCanvas.height = height * dpr;
    this.textContext.scale(dpr, dpr);

    // Reset text rendering properties after resize
    this.textContext.textBaseline = 'top';
    this.textContext.fillStyle = 'white';
    this.textContext.imageSmoothingEnabled = true;
    this.textContext.imageSmoothingQuality = 'high';

    // Mark all panels as needing updates
    this.panelTextData.forEach(panelData => {
      panelData.needsUpdate = true;
    });
  }

  /**
   * Resize framebuffer to match canvas size
   */
  public resizeFramebuffer(width: number, height: number): void {
    const gl = this.gl;

    if (!this.sceneFramebuffer || !this.sceneTexture || !this.sceneDepthBuffer) {
      return;
    }

    // Bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);

    // Setup color texture
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach color texture
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);

    // Setup depth buffer
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthBuffer);

    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Text framebuffer incomplete:', status);
    }

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    // Resize text canvas to match
    this.resizeCanvas(width, height);

    // Mark scene as dirty after resize
    this.markSceneDirty();
  }

  /**
   * Capture current scene (ocean + glass) to texture for text background analysis
   * Now with caching to improve performance
   */
  public captureScene(renderSceneCallback: () => void): void {
    const gl = this.gl;
    const currentTime = performance.now();

    if (!this.sceneFramebuffer || !this.sceneTexture) {
      return;
    }

    // Skip capture if scene isn't dirty and we're within throttle window
    if (!this.sceneTextureDirty && (currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
      return;
    }

    // Store current viewport
    const viewport = gl.getParameter(gl.VIEWPORT);

    // Bind framebuffer for rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);

    // Set viewport to match framebuffer size
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear framebuffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render scene to framebuffer
    renderSceneCallback();

    // Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Restore viewport
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

    // Update cache state
    this.sceneTextureDirty = false;
    this.lastCaptureTime = currentTime;
  }

  /**
   * Mark scene texture as dirty to force recapture on next render
   */
  public markSceneDirty(): void {
    this.sceneTextureDirty = true;
  }


  /**
   * Add a text element configuration
   */
  public addTextElement(id: string, config: TextElementConfig): void {
    this.textElements.set(id, config);
  }

  /**
   * Remove a text element
   */
  public removeTextElement(id: string): void {
    this.textElements.delete(id);
  }

  /**
   * Update text element configuration
   */
  public updateTextElement(id: string, config: Partial<TextElementConfig>): void {
    const existingConfig = this.textElements.get(id);
    if (existingConfig) {
      this.textElements.set(id, { ...existingConfig, ...config });
    }
  }

  /**
   * Update individual panel texture
   */
  private updatePanelTexture(panelData: PanelTextData): void {
    const ctx = panelData.context;
    const canvas = panelData.canvas;
    const gl = this.gl;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Add debug background to verify canvas is working
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // Slight red tint for debugging
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render each text element in the panel
    panelData.textElements.forEach(textConfig => {
      console.log(`Rendering text: "${textConfig.content}" at panel relative pos:`, textConfig.panelRelativePosition);

      // Calculate canvas coordinates (canvas is already scaled by DPR in initialization)
      const canvasLogicalWidth = canvas.width / window.devicePixelRatio;
      const canvasLogicalHeight = canvas.height / window.devicePixelRatio;

      const x = textConfig.panelRelativePosition[0] * canvasLogicalWidth;
      const y = textConfig.panelRelativePosition[1] * canvasLogicalHeight;

      // Set font properties from CSS
      ctx.font = `${textConfig.fontWeight} ${textConfig.fontSize}px ${textConfig.fontFamily}`;
      ctx.fillStyle = 'white'; // Always white, shader handles adaptation
      ctx.textAlign = textConfig.textAlign;
      ctx.textBaseline = 'top';

      // Render text with proper line height
      const lines = textConfig.content.split('\n');
      const lineHeight = textConfig.fontSize * textConfig.lineHeight;

      lines.forEach((line, index) => {
        const adjustedY = y + (index * lineHeight);

        // Canvas 2D API handles text alignment internally
        ctx.fillText(line, x, adjustedY);

        console.log(`Drew line "${line}" at (${x}, ${adjustedY}) with alignment: ${textConfig.textAlign}`);
      });
    });

    // Update WebGL texture
    gl.bindTexture(gl.TEXTURE_2D, panelData.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    panelData.needsUpdate = false;
  }



  /**
   * Set up text element tracking from HTML elements
   */
  public setupDefaultTextElements(): void {
    // Scan and setup text elements from the HTML
    this.scanAndSetupTextElements();

    // Set up mutation observer for dynamic content changes
    this.setupMutationObserver();

    // Set up resize observer for responsive positioning
    this.setupResizeObserver();

    // Mark scene as dirty when text elements change
    this.markSceneDirty();
  }

  /**
   * Scan HTML and automatically setup text elements with exact CSS metrics
   */
  private scanAndSetupTextElements(): void {
    console.log('🔍 TextRenderer: Starting text element scan...');

    // Clear existing
    this.textElements.clear();
    this.panelTextData.forEach(data => data.textElements = []);

    // Define selectors for all text elements
    const textSelectors = [
      { selector: '#landing-panel h1', panelId: 'landing-panel' },
      { selector: '#landing-panel .subtitle', panelId: 'landing-panel' },
      { selector: '#app-panel h2', panelId: 'app-panel' },
      { selector: '#app-panel p', panelId: 'app-panel' },
      { selector: '#portfolio-panel h2', panelId: 'portfolio-panel' },
      { selector: '#portfolio-panel .project-detail h3', panelId: 'portfolio-panel' },
      { selector: '#portfolio-panel .project-detail p', panelId: 'portfolio-panel' },
      { selector: '#resume-panel h2', panelId: 'resume-panel' },
      { selector: '#resume-panel h3', panelId: 'resume-panel' },
      { selector: '#resume-panel h4', panelId: 'resume-panel' },
      { selector: '#resume-panel p', panelId: 'resume-panel' },
      { selector: '.brand-text', panelId: 'navbar' },
      { selector: '.nav-label', panelId: 'navbar' }
    ];

    console.log(`📝 Scanning ${textSelectors.length} text selectors...`);

    textSelectors.forEach(({ selector, panelId }) => {
      const elements = document.querySelectorAll(selector);
      console.log(`🎯 Selector "${selector}" found ${elements.length} elements`);

      elements.forEach((element, index) => {
        if (element instanceof HTMLElement) {
          const panelElement = document.getElementById(panelId);
          if (!panelElement) {
            console.warn(`❌ Panel element "${panelId}" not found for selector "${selector}"`);
            return;
          }

          const elementRect = element.getBoundingClientRect();
          const panelRect = panelElement.getBoundingClientRect();

          console.log(`📏 Element "${selector}[${index}]": ${elementRect.width}x${elementRect.height} at (${elementRect.left}, ${elementRect.top})`);
          console.log(`📏 Panel "${panelId}": ${panelRect.width}x${panelRect.height} at (${panelRect.left}, ${panelRect.top})`);

          // Skip elements with no dimensions
          if (elementRect.width === 0 || elementRect.height === 0) {
            console.warn(`⚠️  Skipping element with zero dimensions: "${selector}[${index}]"`);
            return;
          }

          // Calculate exact position relative to panel
          const relativeX = (elementRect.left - panelRect.left) / panelRect.width;
          const relativeY = (elementRect.top - panelRect.top) / panelRect.height;
          const relativeWidth = elementRect.width / panelRect.width;
          const relativeHeight = elementRect.height / panelRect.height;

          // Get computed styles
          const styles = window.getComputedStyle(element);

          const textConfig: TextElementConfig = {
            position: [0, 0], // Will be calculated in WebGL space
            size: [relativeWidth, relativeHeight],
            content: element.textContent?.trim() || '',
            fontSize: parseFloat(styles.fontSize),
            fontFamily: styles.fontFamily,
            fontWeight: styles.fontWeight,
            color: styles.color,
            textAlign: (styles.textAlign as 'left' | 'center' | 'right') || 'left',
            lineHeight: parseFloat(styles.lineHeight) / parseFloat(styles.fontSize) || 1.2,
            panelId: panelId,
            panelRelativePosition: [relativeX, relativeY]
          };

          const id = `${selector.replace(/[^a-zA-Z0-9]/g, '_')}-${index}`;
          this.textElements.set(id, textConfig);

          console.log(`✅ Added text element "${textConfig.content}" at relative pos (${relativeX.toFixed(3)}, ${relativeY.toFixed(3)}) in panel "${panelId}"`);

          // Add to panel data
          const panelData = this.panelTextData.get(panelId);
          if (panelData) {
            panelData.textElements.push(textConfig);
            panelData.needsUpdate = true;
            console.log(`📦 Added to panel data for "${panelId}", now has ${panelData.textElements.length} text elements`);
          } else {
            console.warn(`❌ No panel data found for "${panelId}"`);
          }
        }
      });
    });

    console.log(`🎉 Text scan complete! Found ${this.textElements.size} total text elements across ${this.panelTextData.size} panels`);
  }

  /**
   * Set up mutation observer to track content changes with per-panel updates
   */
  private setupMutationObserver(): void {
    const observer = new MutationObserver((mutations) => {
      let affectedPanels = new Set<string>();

      mutations.forEach((mutation) => {
        // Find which panel was affected
        let target = mutation.target as HTMLElement;
        while (target && target !== document.body) {
          if (target.classList.contains('glass-panel')) {
            affectedPanels.add(target.id);
            break;
          }
          target = target.parentElement!;
        }
      });

      // Update only affected panels
      affectedPanels.forEach(panelId => {
        const panelData = this.panelTextData.get(panelId);
        if (panelData) {
          panelData.needsUpdate = true;
          // Rescan text elements for this panel
          this.updatePanelTextElements(panelId);
        }
      });
    });

    // Observe all panels
    ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel', 'navbar'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }
    });
  }

  /**
   * Update text elements for a specific panel
   */
  private updatePanelTextElements(panelId: string): void {
    const panelData = this.panelTextData.get(panelId);
    if (!panelData) return;

    // Clear existing text elements for this panel
    panelData.textElements = [];

    // Define selectors for this specific panel
    const selectorMap: { [key: string]: string[] } = {
      'landing-panel': ['#landing-panel h1', '#landing-panel .subtitle'],
      'app-panel': ['#app-panel h2', '#app-panel p'],
      'portfolio-panel': [
        '#portfolio-panel h2',
        '#portfolio-panel .project-detail h3',
        '#portfolio-panel .project-detail p'
      ],
      'resume-panel': [
        '#resume-panel h2',
        '#resume-panel h3',
        '#resume-panel h4',
        '#resume-panel p'
      ],
      'navbar': ['.brand-text', '.nav-label']
    };

    const selectors = selectorMap[panelId] || [];

    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element, index) => {
        if (element instanceof HTMLElement) {
          const panelElement = document.getElementById(panelId);
          if (!panelElement) return;

          const elementRect = element.getBoundingClientRect();
          const panelRect = panelElement.getBoundingClientRect();

          // Skip elements with no dimensions
          if (elementRect.width === 0 || elementRect.height === 0) return;

          // Calculate exact position relative to panel
          const relativeX = (elementRect.left - panelRect.left) / panelRect.width;
          const relativeY = (elementRect.top - panelRect.top) / panelRect.height;
          const relativeWidth = elementRect.width / panelRect.width;
          const relativeHeight = elementRect.height / panelRect.height;

          // Get computed styles
          const styles = window.getComputedStyle(element);

          const textConfig: TextElementConfig = {
            position: [0, 0],
            size: [relativeWidth, relativeHeight],
            content: element.textContent?.trim() || '',
            fontSize: parseFloat(styles.fontSize),
            fontFamily: styles.fontFamily,
            fontWeight: styles.fontWeight,
            color: styles.color,
            textAlign: (styles.textAlign as 'left' | 'center' | 'right') || 'left',
            lineHeight: parseFloat(styles.lineHeight) / parseFloat(styles.fontSize) || 1.2,
            panelId: panelId,
            panelRelativePosition: [relativeX, relativeY]
          };

          panelData.textElements.push(textConfig);

          // Update main text elements map
          const id = `${selector.replace(/[^a-zA-Z0-9]/g, '_')}-${index}`;
          this.textElements.set(id, textConfig);
        }
      });
    });

    panelData.needsUpdate = true;
  }

  /**
   * Set up resize observer for responsive text positioning
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(entry => {
        const element = entry.target as HTMLElement;

        // Check if this is a panel that needs text updates
        if (element.classList.contains('glass-panel')) {
          const panelData = this.panelTextData.get(element.id);
          if (panelData) {
            // Resize panel canvas if needed
            const rect = element.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const newWidth = Math.max(rect.width * dpr, 1);
            const newHeight = Math.max(rect.height * dpr, 1);

            if (panelData.canvas.width !== newWidth || panelData.canvas.height !== newHeight) {
              panelData.canvas.width = newWidth;
              panelData.canvas.height = newHeight;
              panelData.context.scale(dpr, dpr);

              // Reset context properties
              panelData.context.textBaseline = 'top';
              panelData.context.fillStyle = 'white';
              panelData.context.imageSmoothingEnabled = true;
              panelData.context.imageSmoothingQuality = 'high';
            }

            // Update text elements for this panel
            this.updatePanelTextElements(element.id);
          }
        }
      });
    });

    // Observe the canvas for global resize
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.resizeObserver.observe(canvas);

    // Observe all panels
    ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel', 'navbar'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        this.resizeObserver!.observe(element);
      }
    });
  }


  /**
   * Convert HTML element rect to normalized WebGL coordinates
   * (Exact copy from GlassRenderer for consistent positioning)
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    // Ensure we have valid rectangles
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      console.warn('TextRenderer: Invalid rectangle dimensions detected');
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

    // Debug logging for positioning verification (remove after testing)
    console.debug(`TextRenderer Panel Mapping:
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
   * Render all text elements with per-panel rendering and adaptive coloring
   */
  public render(): void {
    const gl = this.gl;

    if (!this.textProgram) {
      console.warn('⚠️  TextRenderer: No text program available');
      return;
    }

    console.log('🚀 TextRenderer: Starting render...');

    // Use text shader program
    const program = this.shaderManager.useProgram('text');

    // Set up matrices
    this.shaderManager.setUniformMatrix4fv(program, 'u_projectionMatrix', this.projectionMatrix.data);
    this.shaderManager.setUniformMatrix4fv(program, 'u_viewMatrix', this.viewMatrix.data);

    // Set time uniform for animation
    const currentTime = (performance.now() - this.startTime) / 1000.0;
    this.shaderManager.setUniform1f(program, 'u_time', currentTime);

    // Set resolution
    this.shaderManager.setUniform2f(program, 'u_resolution', gl.canvas.width, gl.canvas.height);
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', gl.canvas.width / gl.canvas.height);

    // Set adaptive strength
    this.shaderManager.setUniform1f(program, 'u_adaptiveStrength', 1.0);

    // Configure for overlay rendering
    gl.enable(gl.BLEND);
    // Use premultiplied alpha for correct compositing
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );

    // Disable depth test so text always appears on top
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    // Render each panel's text individually
    let renderedPanels = 0;
    this.panelTextData.forEach((panelData, panelId) => {
      // Skip hidden panels
      const element = document.getElementById(panelId);
      if (!element || element.classList.contains('hidden')) {
        console.log(`⏭️  Skipping panel "${panelId}" (hidden or not found)`);
        return;
      }

      console.log(`🎯 Rendering panel "${panelId}" with ${panelData.textElements.length} text elements`);

      // Update texture if needed
      if (panelData.needsUpdate) {
        console.log(`🔄 Updating texture for panel "${panelId}"`);
        this.updatePanelTexture(panelData);
      }

      // Calculate panel position in WebGL space
      const rect = element.getBoundingClientRect();
      const canvasRect = (gl.canvas as HTMLCanvasElement).getBoundingClientRect();
      const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);

      console.log(`📍 Panel "${panelId}" WebGL position:`, normalizedPos.position, 'size:', normalizedPos.size);

      // Set panel-specific uniforms
      this.shaderManager.setUniform2f(program, 'u_panelPosition', normalizedPos.position[0], normalizedPos.position[1]);
      this.shaderManager.setUniform2f(program, 'u_panelSize', normalizedPos.size[0], normalizedPos.size[1]);

      // Bind panel texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, panelData.texture);
      this.shaderManager.setUniform1i(program, 'u_textTexture', 0);

      // Draw quad for this panel
      this.bufferManager.bind();
      gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);

      renderedPanels++;
      console.log(`✅ Rendered panel "${panelId}"`);
    });

    console.log(`🎉 TextRenderer: Rendered ${renderedPanels} panels`);

    // Restore state
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  /**
   * Get scene texture for external use
   */
  public getSceneTexture(): WebGLTexture | null {
    return this.sceneTexture;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    const gl = this.gl;

    // Clean up framebuffer
    if (this.sceneFramebuffer) {
      gl.deleteFramebuffer(this.sceneFramebuffer);
      this.sceneFramebuffer = null;
    }

    if (this.sceneTexture) {
      gl.deleteTexture(this.sceneTexture);
      this.sceneTexture = null;
    }

    if (this.sceneDepthBuffer) {
      gl.deleteRenderbuffer(this.sceneDepthBuffer);
      this.sceneDepthBuffer = null;
    }

    if (this.textTexture) {
      gl.deleteTexture(this.textTexture);
      this.textTexture = null;
    }

    // Clean up geometry
    this.bufferManager.dispose();

    // Clean up per-panel resources
    this.panelTextData.forEach(panelData => {
      if (panelData.texture) {
        gl.deleteTexture(panelData.texture);
      }
    });
    this.panelTextData.clear();

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear text elements
    this.textElements.clear();
  }
}
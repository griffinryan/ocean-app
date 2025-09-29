/**
 * Simplified Enhanced Text Renderer
 * Fallback implementation that works with existing TextRenderer
 * Focuses on position validation and DOM synchronization
 */

import { TextRenderer, TextElementConfig } from './TextRenderer';
import { ShaderManager } from './ShaderManager';
import { DOMPositionExtractor } from './DOMPositionExtractor';
import { PositionValidator, ValidationReport, WebGLPositionProvider, createPositionValidator, logValidationReport } from './PositionValidator';

export interface SimplifiedEnhancedConfig {
  enableDOMSync: boolean;
  debugMode: boolean;
  enableValidation: boolean;
  validationTolerance: number;
}

export class SimplifiedEnhancedTextRenderer implements WebGLPositionProvider {
  private originalRenderer: TextRenderer;
  private config: SimplifiedEnhancedConfig;

  // DOM position extraction for pixel-perfect alignment
  private domExtractor: DOMPositionExtractor;

  // Position validation for testing accuracy
  private positionValidator: PositionValidator | null = null;
  private validationEnabled: boolean = false;

  // Store actual text element positions for validation
  private textElementPositions = new Map<string, { x: number; y: number; width: number; height: number }>();

  constructor(
    gl: WebGL2RenderingContext,
    shaderManager: ShaderManager,
    config: Partial<SimplifiedEnhancedConfig> = {}
  ) {
    // Initialize original renderer
    this.originalRenderer = new TextRenderer(gl, shaderManager);

    // Initialize DOM position extractor
    const canvas = gl.canvas as HTMLCanvasElement;
    this.domExtractor = new DOMPositionExtractor(canvas);

    this.config = {
      enableDOMSync: true,
      debugMode: false,
      enableValidation: false,
      validationTolerance: 2,
      ...config
    };

    // Initialize position validator if enabled
    if (this.config.enableValidation) {
      this.positionValidator = createPositionValidator(canvas, this.config.validationTolerance);
      this.positionValidator.setWebGLPositionProvider(this);
      this.validationEnabled = true;
    }

    console.log('Simplified enhanced text renderer initialized');
  }

  /**
   * Initialize shaders - proxy to original renderer
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    await this.originalRenderer.initializeShaders(vertexShader, fragmentShader);
  }

  /**
   * Setup enhanced text elements using DOM position extraction
   */
  public setupEnhancedTextElements(): void {
    // Clear any existing positions
    this.textElementPositions.clear();

    // Update DOM extractor canvas rect
    this.domExtractor.updateCanvasRect();

    // Extract exact navbar positions
    this.extractNavbarPositions();

    // Extract exact landing panel positions
    this.extractLandingPanelPositions();

    // Setup the original text renderer with enhanced positioning
    this.setupOriginalRendererWithEnhancedPositions();

    console.log('Enhanced text elements setup with DOM position extraction');
  }

  /**
   * Extract navbar positions and convert to WebGL coordinates
   */
  private extractNavbarPositions(): void {
    const navbarFlexInfo = this.domExtractor.getNavbarFlexInfo();

    // Store brand position
    if (navbarFlexInfo.brand) {
      const coords = this.domExtractor.toLayoutCoordinates(navbarFlexInfo.brand);
      this.textElementPositions.set('navbar-brand', coords.bounds);
      this.textElementPositions.set('nav-brand', coords.bounds); // Alternative ID
    }

    // Store nav item positions
    navbarFlexInfo.items.forEach((itemPosition, index) => {
      const coords = this.domExtractor.toLayoutCoordinates(itemPosition);
      this.textElementPositions.set(`navbar-item-${index}`, coords.bounds);
      this.textElementPositions.set(`nav-item-${index}`, coords.bounds); // Alternative ID
    });

    if (this.config.debugMode) {
      console.log('Extracted navbar positions:', navbarFlexInfo);
    }
  }

  /**
   * Extract landing panel positions
   */
  private extractLandingPanelPositions(): void {
    const landingPositions = this.domExtractor.getLandingTextPositions();

    // Store title position
    if (landingPositions.title) {
      const coords = this.domExtractor.toLayoutCoordinates(landingPositions.title);
      this.textElementPositions.set('landing-title', coords.bounds);
    }

    // Store subtitle position
    if (landingPositions.subtitle) {
      const coords = this.domExtractor.toLayoutCoordinates(landingPositions.subtitle);
      this.textElementPositions.set('landing-subtitle', coords.bounds);
    }

    if (this.config.debugMode) {
      console.log('Extracted landing positions:', landingPositions);
    }
  }

  /**
   * Setup original renderer with enhanced positions extracted from DOM
   */
  private setupOriginalRendererWithEnhancedPositions(): void {
    // Convert DOM positions to TextRenderer's coordinate system
    const canvas = (this.originalRenderer as any).gl.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();

    const enhancedTextElements: TextElementConfig[] = [];

    // Convert navbar brand
    const brandPosition = this.textElementPositions.get('navbar-brand');
    if (brandPosition) {
      const relativeX = (brandPosition.x + brandPosition.width / 2) / canvasRect.width;
      const relativeY = (brandPosition.y + brandPosition.height / 2) / canvasRect.height;

      enhancedTextElements.push({
        text: this.getElementText('.brand-text') || 'Griffin Ryan',
        panelRelativePosition: [relativeX, relativeY],
        panel: 'navbar',
        adaptiveColoring: true,
        fontSize: 20
      });
    }

    // Convert navbar items
    for (let i = 0; i < 3; i++) {
      const itemPosition = this.textElementPositions.get(`navbar-item-${i}`);
      if (itemPosition) {
        const relativeX = (itemPosition.x + itemPosition.width / 2) / canvasRect.width;
        const relativeY = (itemPosition.y + itemPosition.height / 2) / canvasRect.height;

        enhancedTextElements.push({
          text: this.getElementText(`.nav-label:nth-child(${i + 1})`) || `Item ${i + 1}`,
          panelRelativePosition: [relativeX, relativeY],
          panel: 'navbar',
          adaptiveColoring: true,
          fontSize: 16
        });
      }
    }

    // Convert landing title
    const titlePosition = this.textElementPositions.get('landing-title');
    if (titlePosition) {
      const relativeX = (titlePosition.x + titlePosition.width / 2) / canvasRect.width;
      const relativeY = (titlePosition.y + titlePosition.height / 2) / canvasRect.height;

      enhancedTextElements.push({
        text: this.getElementText('#landing-panel h1') || '',
        panelRelativePosition: [relativeX, relativeY],
        panel: 'landing-panel',
        adaptiveColoring: true,
        fontSize: 48
      });
    }

    // Convert landing subtitle
    const subtitlePosition = this.textElementPositions.get('landing-subtitle');
    if (subtitlePosition) {
      const relativeX = (subtitlePosition.x + subtitlePosition.width / 2) / canvasRect.width;
      const relativeY = (subtitlePosition.y + subtitlePosition.height / 2) / canvasRect.height;

      enhancedTextElements.push({
        text: this.getElementText('#landing-panel .subtitle') || '',
        panelRelativePosition: [relativeX, relativeY],
        panel: 'landing-panel',
        adaptiveColoring: true,
        fontSize: 22
      });
    }

    // Set the enhanced text elements on the original renderer
    if (enhancedTextElements.length > 0) {
      (this.originalRenderer as any).textElements = enhancedTextElements;
      console.log(`Enhanced positioning applied to ${enhancedTextElements.length} text elements`);
    } else {
      // Fallback to default setup
      this.originalRenderer.setupDefaultTextElements();
      console.log('Fallback to default text element positioning');
    }
  }

  /**
   * Get text content from DOM element
   */
  private getElementText(selector: string): string | null {
    const element = document.querySelector(selector);
    return element?.textContent?.trim() || null;
  }

  /**
   * Render using original renderer
   */
  public render(): void {
    this.originalRenderer.render();
  }

  /**
   * Capture scene for background analysis
   */
  public captureScene(renderSceneCallback: () => void): void {
    this.originalRenderer.captureScene(renderSceneCallback);
  }

  /**
   * Resize framebuffer
   */
  public resizeFramebuffer(width: number, height: number): void {
    this.originalRenderer.resizeFramebuffer(width, height);
  }

  /**
   * Mark scene as dirty
   */
  public markSceneDirty(): void {
    this.originalRenderer.markSceneDirty();
  }

  /**
   * Get original renderer for compatibility
   */
  public getOriginalRenderer(): TextRenderer {
    return this.originalRenderer;
  }

  // ========== WebGLPositionProvider Implementation ==========

  /**
   * Get WebGL position for a specific element
   */
  public getElementWebGLPosition(elementId: string): { x: number; y: number; width: number; height: number } | null {
    // Return the cached position from our extraction
    return this.textElementPositions.get(elementId) || null;
  }

  /**
   * Get all element WebGL positions
   */
  public getAllElementWebGLPositions(): Map<string, { x: number; y: number; width: number; height: number }> {
    return new Map(this.textElementPositions);
  }

  /**
   * Enable validation mode for debugging
   */
  public enableValidation(tolerance: number = 2): void {
    const canvas = (this.originalRenderer as any).gl.canvas as HTMLCanvasElement;
    this.positionValidator = createPositionValidator(canvas, tolerance);
    this.positionValidator.setWebGLPositionProvider(this);
    this.validationEnabled = true;
    this.config.enableValidation = true;
    this.config.validationTolerance = tolerance;
    console.log(`Position validation enabled with ${tolerance}px tolerance`);
  }

  /**
   * Disable validation mode
   */
  public disableValidation(): void {
    this.positionValidator = null;
    this.validationEnabled = false;
    this.config.enableValidation = false;
    console.log('Position validation disabled');
  }

  /**
   * Run validation and return detailed report
   */
  public validatePositions(): ValidationReport | null {
    if (!this.positionValidator) {
      console.warn('Position validation not enabled');
      return null;
    }

    const report = this.positionValidator.validateAllPositions();

    if (this.config.debugMode) {
      logValidationReport(report);
    }

    return report;
  }

  /**
   * Test positioning accuracy and log results
   */
  public testPositioning(): void {
    console.group('🎯 Simplified Enhanced Text Renderer - Position Testing');

    // Test DOM extraction
    console.log('Testing DOM position extraction...');
    const navbar = this.domExtractor.extractNavbarLayout();
    const landing = this.domExtractor.getLandingTextPositions();

    if (navbar) {
      console.log(`✅ Navbar: Found ${navbar.elements.size} text elements`);
    } else {
      console.warn('❌ Navbar: No elements found');
    }

    if (landing.title || landing.subtitle) {
      console.log(`✅ Landing: Found ${[landing.title, landing.subtitle].filter(Boolean).length} text elements`);
    } else {
      console.warn('❌ Landing: No elements found');
    }

    // Test our position cache
    console.log(`✅ Position Cache: Stored ${this.textElementPositions.size} element positions`);
    this.textElementPositions.forEach((position, elementId) => {
      console.log(`   ${elementId}: ${position.width.toFixed(1)}×${position.height.toFixed(1)} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
    });

    // Test validation if enabled
    if (this.validationEnabled) {
      const validationReport = this.validatePositions();
      if (validationReport) {
        console.log(`✅ Validation: ${validationReport.overallAccuracy.toFixed(1)}% accuracy`);
        console.log(`   Elements: ${validationReport.summary.accurateElements}/${validationReport.summary.totalElements} accurate`);
        console.log(`   Average error: ${validationReport.summary.averageError.toFixed(2)}px`);
      }
    } else {
      console.log('ℹ️ Validation: Disabled (enable with enableValidation())');
    }

    console.log('✅ Position testing complete!');
    console.groupEnd();
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.originalRenderer.dispose();
  }
}
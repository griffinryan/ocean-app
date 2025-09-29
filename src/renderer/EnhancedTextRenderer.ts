/**
 * Enhanced Text Renderer Bridge
 * Seamlessly integrates our new CSS-like text layout system with existing TextRenderer
 * Replaces hard-coded positioning with intelligent HTML/CSS synchronization
 */

import { TextRenderer, TextElementConfig } from './TextRenderer';
import { ShaderManager } from './ShaderManager';
import { WebGLTextLayoutSystem, createWebGLTextLayout } from './text-layout';
import { DeclarativeLayoutBuilder, LayoutComponent } from './text-layout/DeclarativeAPI';
import { DOMPositionExtractor, ExtractedPosition, PanelLayout } from './DOMPositionExtractor';
import { PositionValidator, ValidationReport, WebGLPositionProvider, createPositionValidator, logValidationReport } from './PositionValidator';

export interface EnhancedTextConfig {
  enableLayoutSystem: boolean;
  enableDOMSync: boolean;
  enableResponsive: boolean;
  debugMode: boolean;
  fallbackToOriginal: boolean;
  enableValidation: boolean;
  validationTolerance: number;
}

export class EnhancedTextRenderer implements WebGLPositionProvider {
  private originalRenderer: TextRenderer;
  private layoutSystem: WebGLTextLayoutSystem | null = null;
  private builder: DeclarativeLayoutBuilder | null = null;
  private config: EnhancedTextConfig;

  // DOM synchronization
  private domSyncInterval: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  // Panel mapping - exact CSS structure reproduction
  private panelLayouts = new Map<string, LayoutComponent>();

  // DOM position extraction for pixel-perfect alignment
  private domExtractor: DOMPositionExtractor;

  // Position validation for testing accuracy
  private positionValidator: PositionValidator | null = null;
  private validationEnabled: boolean = false;

  constructor(
    gl: WebGL2RenderingContext,
    shaderManager: ShaderManager,
    config: Partial<EnhancedTextConfig> = {}
  ) {
    // Initialize original renderer
    this.originalRenderer = new TextRenderer(gl, shaderManager);

    // Initialize DOM position extractor
    const canvas = gl.canvas as HTMLCanvasElement;
    this.domExtractor = new DOMPositionExtractor(canvas);

    this.config = {
      enableLayoutSystem: true,
      enableDOMSync: true,
      enableResponsive: true,
      debugMode: false,
      fallbackToOriginal: false,
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

    if (this.config.enableLayoutSystem) {
      this.initializeLayoutSystem();
    }
  }

  /**
   * Initialize the new layout system
   */
  private initializeLayoutSystem(): void {
    try {
      // Create WebGL text layout system
      this.layoutSystem = createWebGLTextLayout(this.originalRenderer, {
        enableResponsive: this.config.enableResponsive,
        enableFlexbox: true,
        debug: this.config.debugMode
      });

      this.builder = this.layoutSystem.builder;

      // Setup responsive breakpoints matching CSS
      this.setupResponsiveBreakpoints();

      // Setup styles matching liquid-glass.css
      this.setupGlobalStyles();

      console.log('Enhanced text renderer initialized successfully!');

    } catch (error) {
      console.error('Failed to initialize layout system:', error);
      if (!this.config.fallbackToOriginal) {
        throw error;
      }
    }
  }

  /**
   * Setup responsive breakpoints matching CSS media queries exactly
   */
  private setupResponsiveBreakpoints(): void {
    if (!this.layoutSystem) return;

    // Match exact breakpoints from liquid-glass.css
    this.layoutSystem.addBreakpoint('mobile', { maxWidth: 768 });
    this.layoutSystem.addBreakpoint('tablet', { minWidth: 769, maxWidth: 1024 });
    this.layoutSystem.addBreakpoint('desktop', { minWidth: 1025 });

    // Mobile-specific adjustments matching CSS @media (max-width: 768px)
    this.layoutSystem.addMediaQuery('mobile-navbar', 'max-width: 768px', {
      '.navbar-panel': {
        top: '10px',
        left: '10px',
        right: '10px',
        width: 'calc(100% - 20px)',
        borderRadius: '12px'
      },
      '.navbar-content': {
        padding: '0 1rem'
      },
      '.brand-text': {
        fontSize: '1.1rem'
      },
      '.nav-item': {
        fontSize: '0.85rem',
        padding: '0 0.75rem'
      },
      '.app-panel': {
        top: '100px',
        left: '1rem',
        right: '1rem',
        width: 'auto'
      },
      '.landing-title': {
        fontSize: 'clamp(28px, 8vw, 48px)'
      },
      '.landing-subtitle': {
        fontSize: 'clamp(18px, 4vw, 22px)'
      }
    });

    // Tablet adjustments
    this.layoutSystem.addMediaQuery('tablet-layout', 'min-width: 769px and max-width: 1024px', {
      '.navbar-panel': {
        top: '15px',
        left: '15px',
        right: '15px'
      },
      '.navbar-content': {
        padding: '0 1.5rem'
      },
      '.landing-title': {
        fontSize: 'clamp(36px, 6vw, 48px)'
      }
    });

    // Desktop and wide screen optimizations
    this.layoutSystem.addMediaQuery('desktop-layout', 'min-width: 1025px', {
      '.navbar-panel': {
        top: '20px',
        left: '20px',
        right: '20px',
        maxWidth: '1400px',
        margin: '0 auto'
      },
      '.navbar-content': {
        maxWidth: '1200px',
        padding: '0 2rem'
      },
      '.landing-title': {
        fontSize: '48px'
      },
      '.landing-subtitle': {
        fontSize: '22px'
      }
    });

    // High DPI display adjustments
    this.layoutSystem.addMediaQuery('retina-display', 'min-resolution: 2dppx', {
      '.brand-text': {
        fontWeight: '600' // Slightly bolder on retina
      },
      '.nav-item': {
        fontWeight: '500'
      }
    });

    console.log('Responsive breakpoints and media queries setup complete');
  }

  /**
   * Setup global styles matching liquid-glass.css
   */
  private setupGlobalStyles(): void {
    if (!this.builder) return;

    this.builder.setStyleSheet({
      // Base styles
      '.panel-container': {
        position: 'absolute',
        padding: '2rem',
        borderRadius: '20px',
        backdropFilter: 'blur(20px)'
      },

      // Navbar styles - exact match to CSS
      '.navbar-panel': {
        position: 'fixed',
        top: '20px',
        left: '20px',
        right: '20px',
        width: 'calc(100% - 40px)',
        maxWidth: '1400px',
        height: '60px',
        margin: '0 auto',
        borderRadius: '16px',
        display: 'flex',
        alignItems: 'center'
      },

      '.navbar-content': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '100%',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 2rem',
        width: '100%'
      },

      '.nav-brand': {
        cursor: 'pointer'
      },

      '.brand-text': {
        fontSize: '1.2rem',
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.95)',
        letterSpacing: '-0.02em'
      },

      '.nav-items': {
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      },

      '.nav-item': {
        display: 'flex',
        alignItems: 'center',
        height: '36px',
        padding: '0 1rem',
        fontSize: '0.9rem',
        fontWeight: '500',
        color: 'rgba(255, 255, 255, 0.9)',
        borderRadius: '8px',
        cursor: 'pointer'
      },

      // Panel text styles
      '.landing-panel': {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '400px',
        textAlign: 'center'
      },

      '.landing-title': {
        fontSize: '48px',
        fontWeight: '200',
        lineHeight: 1.2,
        marginBottom: '1rem'
      },

      '.landing-subtitle': {
        fontSize: '22px',
        fontWeight: '400',
        lineHeight: 1.2,
        opacity: 0.9
      },

      '.app-panel': {
        position: 'absolute',
        top: '90px',
        left: '2rem',
        width: '320px'
      },

      '.panel-title': {
        fontSize: '36px',
        fontWeight: '500',
        lineHeight: 1.3,
        marginBottom: '1rem'
      },

      '.panel-text': {
        fontSize: '18px',
        fontWeight: '400',
        lineHeight: 1.5,
        opacity: 0.9
      }
    });
  }

  /**
   * Initialize shaders - proxy to original renderer
   */
  async initializeShaders(vertexShader: string, fragmentShader: string): Promise<void> {
    await this.originalRenderer.initializeShaders(vertexShader, fragmentShader);
  }

  /**
   * Setup enhanced text elements using layout system
   */
  public setupEnhancedTextElements(): void {
    if (!this.layoutSystem || !this.builder) {
      console.log('Layout system not available, falling back to original setup');
      this.originalRenderer.setupDefaultTextElements();
      return;
    }

    // Clear any existing layouts
    this.builder.clear();

    // Create layouts for each panel
    this.createNavbarLayout();
    this.createLandingPanelLayout();
    this.createAppPanelLayout();
    this.createPortfolioPanelLayout();
    this.createResumePanelLayout();

    // Setup DOM synchronization
    if (this.config.enableDOMSync) {
      this.setupDOMSync();
    }

    console.log('Enhanced text elements setup complete!');
  }

  /**
   * Create navbar layout using exact DOM positions
   */
  private createNavbarLayout(): void {
    if (!this.builder) return;

    const navbarElement = document.getElementById('navbar');
    if (!navbarElement || navbarElement.classList.contains('hidden')) return;

    // Update DOM extractor canvas rect
    this.domExtractor.updateCanvasRect();

    // Extract exact flexbox positions from HTML
    const navbarFlexInfo = this.domExtractor.getNavbarFlexInfo();

    if (this.config.debugMode) {
      this.domExtractor.debugLogPositions('navbar');
    }

    // Create brand text with exact position
    if (navbarFlexInfo.brand) {
      const brandPosition = navbarFlexInfo.brand;
      const brandCoords = this.domExtractor.toLayoutCoordinates(brandPosition);
      const brandElement = document.querySelector('.brand-text');
      const brandText = brandElement?.textContent?.trim() || 'Griffin Ryan';

      this.builder.create({
        id: 'navbar-brand',
        tag: 'span',
        text: brandText,
        style: {
          ...brandCoords.style,
          webglPanel: 'navbar',
          webglAdaptiveColor: true
        }
      });
    }

    // Create nav items with exact positions
    navbarFlexInfo.items.forEach((itemPosition, index) => {
      const itemCoords = this.domExtractor.toLayoutCoordinates(itemPosition);
      const navItem = document.querySelectorAll('.nav-label')[index];
      const itemText = navItem?.textContent?.trim() || `Item ${index + 1}`;

      this.builder.create({
        id: `navbar-item-${index}`,
        tag: 'span',
        text: itemText,
        style: {
          ...itemCoords.style,
          webglPanel: 'navbar',
          webglAdaptiveColor: true
        }
      });
    });

    console.log(`Navbar layout created with ${navbarFlexInfo.items.length} items using exact DOM positions`);
  }

  /**
   * Create landing panel layout using exact DOM positions
   */
  private createLandingPanelLayout(): void {
    if (!this.builder) return;

    const landingElement = document.getElementById('landing-panel');
    if (!landingElement || landingElement.classList.contains('hidden')) return;

    // Extract exact positions for landing text elements
    const landingPositions = this.domExtractor.getLandingTextPositions();

    if (this.config.debugMode) {
      this.domExtractor.debugLogPositions('landing-panel');
    }

    // Create title with exact position
    if (landingPositions.title) {
      const titlePosition = landingPositions.title;
      const titleCoords = this.domExtractor.toLayoutCoordinates(titlePosition);
      const titleElement = document.querySelector('#landing-panel h1');
      const titleText = titleElement?.textContent?.trim() || '';

      this.builder.create({
        id: 'landing-title',
        tag: 'h1',
        text: titleText,
        style: {
          ...titleCoords.style,
          webglPanel: 'landing-panel',
          webglAdaptiveColor: true
        }
      });
    }

    // Create subtitle with exact position
    if (landingPositions.subtitle) {
      const subtitlePosition = landingPositions.subtitle;
      const subtitleCoords = this.domExtractor.toLayoutCoordinates(subtitlePosition);
      const subtitleElement = document.querySelector('#landing-panel .subtitle');
      const subtitleText = subtitleElement?.textContent?.trim() || '';

      this.builder.create({
        id: 'landing-subtitle',
        tag: 'p',
        text: subtitleText,
        style: {
          ...subtitleCoords.style,
          webglPanel: 'landing-panel',
          webglAdaptiveColor: true
        }
      });
    }

    console.log('Landing panel layout created using exact DOM positions');
  }

  /**
   * Create app panel layout
   */
  private createAppPanelLayout(): void {
    if (!this.builder) return;

    const appElement = document.getElementById('app-panel');
    if (!appElement || appElement.classList.contains('hidden')) return;

    const titleElement = appElement.querySelector('h2');
    const textElement = appElement.querySelector('p');

    const title = titleElement?.textContent?.trim() || '';
    const text = textElement?.textContent?.trim() || '';

    this.builder.create({
      id: 'app-layout',
      tag: 'div',
      className: 'app-panel',
      style: {
        webglPanel: 'app-panel'
      },
      children: [
        {
          tag: 'h2',
          text: title,
          className: 'panel-title'
        },
        {
          tag: 'p',
          text: text,
          className: 'panel-text'
        }
      ]
    });
  }

  /**
   * Create portfolio panel layout
   */
  private createPortfolioPanelLayout(): void {
    if (!this.builder) return;

    const portfolioElement = document.getElementById('portfolio-panel');
    if (!portfolioElement || portfolioElement.classList.contains('hidden')) return;

    const titleElement = portfolioElement.querySelector('h2');
    const title = titleElement?.textContent?.trim() || '';

    this.builder.create({
      id: 'portfolio-layout',
      tag: 'div',
      className: 'app-panel',
      style: {
        webglPanel: 'portfolio-panel'
      },
      children: [
        {
          tag: 'h2',
          text: title,
          className: 'panel-title'
        }
      ]
    });
  }

  /**
   * Create resume panel layout
   */
  private createResumePanelLayout(): void {
    if (!this.builder) return;

    const resumeElement = document.getElementById('resume-panel');
    if (!resumeElement || resumeElement.classList.contains('hidden')) return;

    const titleElement = resumeElement.querySelector('h2');
    const title = titleElement?.textContent?.trim() || '';

    this.builder.create({
      id: 'resume-layout',
      tag: 'div',
      className: 'app-panel',
      style: {
        webglPanel: 'resume-panel'
      },
      children: [
        {
          tag: 'h2',
          text: title,
          className: 'panel-title'
        }
      ]
    });
  }

  /**
   * Setup DOM synchronization for real-time position updates
   */
  private setupDOMSync(): void {
    // Setup resize observer with debouncing
    let resizeTimeout: number | null = null;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(() => {
        // Update DOM extractor canvas rect
        this.domExtractor.updateCanvasRect();

        // Check which elements have changed
        let needsFullUpdate = false;

        entries.forEach(entry => {
          if (entry.target.tagName === 'CANVAS') {
            needsFullUpdate = true; // Canvas resize affects all elements
          }
        });

        if (needsFullUpdate) {
          this.setupEnhancedTextElements();
        } else {
          this.updateSpecificElements(entries);
        }
      }, 16); // Debounce to ~60fps
    });

    // Observe canvas and panels
    const canvas = (this.originalRenderer as any).gl.canvas as HTMLCanvasElement;
    this.resizeObserver.observe(canvas);

    const panels = ['#navbar', '#landing-panel', '#app-panel', '#portfolio-panel', '#resume-panel'];
    panels.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        this.resizeObserver!.observe(element);
      }
    });

    // Setup mutation observer for content and style changes
    let mutationTimeout: number | null = null;
    this.mutationObserver = new MutationObserver((mutations) => {
      if (mutationTimeout) {
        clearTimeout(mutationTimeout);
      }

      let needsUpdate = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' ||
            mutation.type === 'characterData' ||
            (mutation.type === 'attributes' &&
             ['class', 'style', 'hidden'].includes(mutation.attributeName || ''))) {
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        mutationTimeout = window.setTimeout(() => {
          this.setupEnhancedTextElements();
        }, 50); // Slight delay for stability
      }
    });

    panels.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        this.mutationObserver!.observe(element, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden']
        });
      }
    });

    // Setup animation frame observer for smooth updates
    this.setupAnimationFrameSync();

    console.log('Advanced DOM synchronization setup complete');
  }

  /**
   * Setup animation frame synchronization for smooth real-time updates
   */
  private setupAnimationFrameSync(): void {
    let lastSyncTime = 0;
    const syncInterval = 100; // Update every 100ms when needed

    const animationSync = () => {
      const currentTime = performance.now();

      if (currentTime - lastSyncTime > syncInterval) {
        // Check if any panels have moved or changed
        if (this.checkForPositionChanges()) {
          this.updateLayoutPositions();
          lastSyncTime = currentTime;
        }
      }

      // Continue the loop
      requestAnimationFrame(animationSync);
    };

    requestAnimationFrame(animationSync);
  }

  /**
   * Check if any panel positions have changed
   */
  private checkForPositionChanges(): boolean {
    // Simple change detection - could be enhanced
    const navbar = document.getElementById('navbar');
    const landing = document.getElementById('landing-panel');

    if (!navbar || !landing) return false;

    // Check if elements are in different positions than last time
    // This is a simplified check - could store previous positions for comparison
    const navbarRect = navbar.getBoundingClientRect();
    const landingRect = landing.getBoundingClientRect();

    // For now, return false to avoid excessive updates
    // In a production system, you'd compare against stored previous positions
    return false;
  }

  /**
   * Update specific elements that have changed
   */
  private updateSpecificElements(entries: ResizeObserverEntry[]): void {
    entries.forEach(entry => {
      const element = entry.target as HTMLElement;

      if (element.id === 'navbar') {
        this.createNavbarLayout();
      } else if (element.id === 'landing-panel') {
        this.createLandingPanelLayout();
      } else if (element.id === 'app-panel') {
        this.createAppPanelLayout();
      } else if (element.id === 'portfolio-panel') {
        this.createPortfolioPanelLayout();
      } else if (element.id === 'resume-panel') {
        this.createResumePanelLayout();
      }
    });

    // Schedule layout update
    this.updateLayoutPositions();
  }

  /**
   * Update layout positions based on current DOM state
   */
  private updateLayoutPositions(): void {
    if (!this.layoutSystem) return;

    // Force layout update
    this.layoutSystem.getLayoutEngine().scheduleLayout();
  }

  /**
   * Render using enhanced system or fallback to original
   */
  public render(): void {
    if (this.layoutSystem && this.config.enableLayoutSystem) {
      try {
        this.layoutSystem.render();
      } catch (error) {
        console.error('Enhanced render failed:', error);
        if (this.config.fallbackToOriginal) {
          this.originalRenderer.render();
        }
      }
    } else {
      this.originalRenderer.render();
    }
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

    // Update layout viewport
    if (this.layoutSystem) {
      this.layoutSystem.getLayoutEngine().setViewport({ width, height });
    }
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

  /**
   * Get layout system for direct access
   */
  public getLayoutSystem(): WebGLTextLayoutSystem | null {
    return this.layoutSystem;
  }

  /**
   * Enable/disable enhanced mode
   */
  public setEnhancedMode(enabled: boolean): void {
    this.config.enableLayoutSystem = enabled;
    if (enabled && !this.layoutSystem) {
      this.initializeLayoutSystem();
    }
  }

  /**
   * Get performance stats
   */
  public getStats(): any {
    const baseStats = this.layoutSystem ? this.layoutSystem.getStats() : { enhanced: false };

    if (this.validationEnabled && this.positionValidator) {
      const validationReport = this.positionValidator.validateAllPositions();
      return {
        ...baseStats,
        validation: {
          enabled: true,
          accuracy: validationReport.overallAccuracy,
          elements: validationReport.summary.totalElements,
          accurate: validationReport.summary.accurateElements,
          averageError: validationReport.summary.averageError,
          maxError: validationReport.summary.maxError
        }
      };
    }

    return baseStats;
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
    console.group('🎯 Enhanced Text Renderer - Position Testing');

    // Test DOM extraction
    console.log('Testing DOM position extraction...');
    const navbar = this.domExtractor.extractNavbarLayout();
    const landing = this.domExtractor.getLandingTextPositions();

    if (navbar) {
      console.log(`✅ Navbar: Found ${navbar.elements.size} text elements`);
      if (this.config.debugMode) {
        this.domExtractor.debugLogPositions('navbar');
      }
    } else {
      console.warn('❌ Navbar: No elements found');
    }

    if (landing.title || landing.subtitle) {
      console.log(`✅ Landing: Found ${[landing.title, landing.subtitle].filter(Boolean).length} text elements`);
      if (this.config.debugMode) {
        this.domExtractor.debugLogPositions('landing-panel');
      }
    } else {
      console.warn('❌ Landing: No elements found');
    }

    // Test layout system
    if (this.layoutSystem) {
      const layoutStats = this.layoutSystem.getStats();
      console.log(`✅ Layout System: ${JSON.stringify(layoutStats)}`);
    } else {
      console.warn('❌ Layout System: Not initialized');
    }

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

    // Test responsive features
    if (this.config.enableResponsive && this.layoutSystem) {
      const viewport = this.layoutSystem.getLayoutEngine().getViewport();
      console.log(`✅ Responsive: Viewport ${viewport.width}×${viewport.height}`);
    }

    console.log('✅ Position testing complete!');
    console.groupEnd();
  }

  // ========== WebGLPositionProvider Implementation ==========

  /**
   * Get WebGL position for a specific element
   */
  public getElementWebGLPosition(elementId: string): { x: number; y: number; width: number; height: number } | null {
    if (!this.layoutSystem) {
      return null;
    }

    try {
      // Query the layout system for the element's computed position
      const layoutEngine = this.layoutSystem.getLayoutEngine();
      const elementBounds = layoutEngine.getElementBounds(elementId);

      if (!elementBounds) {
        // Try alternative element IDs for common elements
        const alternativeIds = this.getAlternativeElementIds(elementId);
        for (const altId of alternativeIds) {
          const altBounds = layoutEngine.getElementBounds(altId);
          if (altBounds) {
            return this.convertLayoutBoundsToScreenPosition(altBounds);
          }
        }
        return null;
      }

      return this.convertLayoutBoundsToScreenPosition(elementBounds);
    } catch (error) {
      console.warn(`Failed to get WebGL position for element ${elementId}:`, error);
      return null;
    }
  }

  /**
   * Get all element WebGL positions
   */
  public getAllElementWebGLPositions(): Map<string, { x: number; y: number; width: number; height: number }> {
    const positions = new Map<string, { x: number; y: number; width: number; height: number }>();

    if (!this.layoutSystem) {
      return positions;
    }

    try {
      const layoutEngine = this.layoutSystem.getLayoutEngine();
      const allElementIds = layoutEngine.getAllElementIds();

      allElementIds.forEach(elementId => {
        const position = this.getElementWebGLPosition(elementId);
        if (position) {
          positions.set(elementId, position);
        }
      });
    } catch (error) {
      console.warn('Failed to get all WebGL positions:', error);
    }

    return positions;
  }

  /**
   * Convert layout bounds to screen coordinates
   */
  private convertLayoutBoundsToScreenPosition(bounds: any): { x: number; y: number; width: number; height: number } {
    // The bounds from layout system should already be in screen coordinates
    // But we might need to convert coordinate systems if needed
    return {
      x: bounds.x || 0,
      y: bounds.y || 0,
      width: bounds.width || 0,
      height: bounds.height || 0
    };
  }

  /**
   * Get alternative element IDs to try if the primary ID doesn't work
   */
  private getAlternativeElementIds(elementId: string): string[] {
    const alternatives: string[] = [];

    // Map common element IDs to their alternatives
    const idMappings = new Map([
      ['navbar-brand', ['nav-brand']],
      ['nav-brand', ['navbar-brand']],
      ['navbar-item-0', ['nav-item-0']],
      ['navbar-item-1', ['nav-item-1']],
      ['navbar-item-2', ['nav-item-2']],
      ['landing-title', ['landing-panel-title']],
      ['landing-subtitle', ['landing-panel-subtitle']]
    ]);

    if (idMappings.has(elementId)) {
      alternatives.push(...idMappings.get(elementId)!);
    }

    // Try panel-prefixed versions
    if (!elementId.includes('-')) {
      alternatives.push(`navbar-${elementId}`, `landing-${elementId}`, `app-${elementId}`);
    }

    return alternatives;
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    if (this.domSyncInterval) {
      clearInterval(this.domSyncInterval);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    if (this.layoutSystem) {
      this.layoutSystem.dispose();
    }

    this.originalRenderer.dispose();
  }
}
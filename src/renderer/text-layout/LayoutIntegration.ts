/**
 * Integration layer between new text layout system and existing TextRenderer
 * Bridges CSS-like layout with WebGL rendering pipeline
 */

import { TextRenderer, TextElementConfig } from '../TextRenderer';
import { TextLayoutEngine, LayoutResult, LayoutViewport } from './TextLayoutEngine';
import { TextElement, LayoutContext } from './TextElement';
import { TextStyle, ComputedTextStyle } from './TextStyle';
import { FlexboxLayout } from './FlexboxLayout';
import { unitConverter, ConversionContext } from './UnitConverter';
import { textBreaker } from './TextBreaking';

// ===== INTEGRATION TYPES =====

export interface LayoutRendererConfig {
  enableNewLayout: boolean;
  fallbackToOldSystem: boolean;
  debugMode: boolean;
  performanceMonitoring: boolean;
}

export interface RenderableElement {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  textContent: string;
  style: ComputedTextStyle;
  panelId: string;
  zIndex: number;
  isVisible: boolean;
}

// ===== LAYOUT RENDERER INTEGRATION =====

export class LayoutRendererIntegration {
  private textRenderer: TextRenderer;
  private layoutEngine: TextLayoutEngine;
  private config: LayoutRendererConfig;
  private rootElement: TextElement | null = null;

  // Performance tracking
  private layoutStats = {
    layoutTime: 0,
    renderTime: 0,
    elementCount: 0,
    frameCount: 0
  };

  constructor(
    textRenderer: TextRenderer,
    config: Partial<LayoutRendererConfig> = {}
  ) {
    this.textRenderer = textRenderer;
    this.config = {
      enableNewLayout: true,
      fallbackToOldSystem: true,
      debugMode: false,
      performanceMonitoring: false,
      ...config
    };

    // Initialize layout engine with viewport from canvas
    const canvas = (textRenderer as any).gl.canvas as HTMLCanvasElement;
    const viewport: LayoutViewport = {
      width: canvas.width,
      height: canvas.height,
      x: 0,
      y: 0,
      dpr: window.devicePixelRatio || 1
    };

    this.layoutEngine = new TextLayoutEngine(viewport);

    // Register flexbox layout algorithm
    this.layoutEngine.registerLayoutAlgorithm(new FlexboxLayout());

    // Set up viewport updates
    this.setupViewportUpdates();
  }

  // ===== LAYOUT SYSTEM INTEGRATION =====

  /**
   * Replace existing text system with new layout engine
   */
  enableLayoutSystem(): void {
    if (!this.config.enableNewLayout) return;

    // Create root element from existing HTML structure
    this.createRootElementFromHTML();

    // Set up automatic layout updates
    this.setupAutomaticUpdates();

    console.log('New layout system enabled');
  }

  /**
   * Create root layout element from existing HTML structure
   */
  private createRootElementFromHTML(): void {
    // Create root container
    this.rootElement = new TextElement('div', '', {
      display: 'block',
      width: '100vw',
      height: '100vh',
      position: 'relative'
    });

    // Scan existing HTML panels and convert to layout elements
    this.scanAndConvertHTMLPanels();

    // Set root element in layout engine
    this.layoutEngine.setRootElement(this.rootElement);
  }

  /**
   * Scan HTML panels and convert to layout elements
   */
  private scanAndConvertHTMLPanels(): void {
    if (!this.rootElement) return;

    const panelSelectors = [
      '#landing-panel',
      '#app-panel',
      '#portfolio-panel',
      '#resume-panel',
      '#navbar'
    ];

    panelSelectors.forEach(selector => {
      const htmlElement = document.querySelector(selector);
      if (htmlElement && !htmlElement.classList.contains('hidden')) {
        const layoutElement = this.convertHTMLToLayoutElement(htmlElement);
        if (layoutElement) {
          this.rootElement!.appendChild(layoutElement);
        }
      }
    });
  }

  /**
   * Convert HTML element to layout element
   */
  private convertHTMLToLayoutElement(htmlElement: Element): TextElement | null {
    const computedStyle = window.getComputedStyle(htmlElement);
    const rect = htmlElement.getBoundingClientRect();

    // Create layout element
    const element = new TextElement('div', '', {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      padding: computedStyle.padding,
      margin: computedStyle.margin,
      fontSize: computedStyle.fontSize,
      fontFamily: computedStyle.fontFamily,
      fontWeight: computedStyle.fontWeight,
      color: computedStyle.color,
      textAlign: computedStyle.textAlign as any,
      webglPanel: htmlElement.id
    });

    // Process text content and child elements
    this.processHTMLContent(htmlElement, element);

    return element;
  }

  /**
   * Process HTML content and children
   */
  private processHTMLContent(htmlElement: Element, layoutElement: TextElement): void {
    for (const child of htmlElement.children) {
      if (child.tagName.toLowerCase() === 'h1' ||
          child.tagName.toLowerCase() === 'h2' ||
          child.tagName.toLowerCase() === 'h3' ||
          child.tagName.toLowerCase() === 'p' ||
          child.tagName.toLowerCase() === 'span') {

        const textContent = child.textContent?.trim() || '';
        if (textContent) {
          const textElement = new TextElement(
            child.tagName.toLowerCase() as any,
            textContent,
            this.extractStyleFromElement(child)
          );
          layoutElement.appendChild(textElement);
        }
      }
    }
  }

  /**
   * Extract relevant styles from HTML element
   */
  private extractStyleFromElement(element: Element): TextStyle {
    const computedStyle = window.getComputedStyle(element);

    return {
      fontSize: computedStyle.fontSize,
      fontFamily: computedStyle.fontFamily,
      fontWeight: computedStyle.fontWeight,
      fontStyle: computedStyle.fontStyle,
      color: computedStyle.color,
      textAlign: computedStyle.textAlign as any,
      lineHeight: computedStyle.lineHeight,
      margin: computedStyle.margin,
      padding: computedStyle.padding,
      display: 'block'
    };
  }

  // ===== RENDERING INTEGRATION =====

  /**
   * Render using new layout system
   */
  renderWithLayoutSystem(): void {
    if (!this.config.enableNewLayout || !this.rootElement) {
      this.fallbackRender();
      return;
    }

    const startTime = this.config.performanceMonitoring ? performance.now() : 0;

    try {
      // Perform layout
      const renderQueue = this.layoutEngine.forceLayout();

      // Convert layout results to renderable elements
      const renderableElements = this.convertToRenderableElements(renderQueue);

      // Update text renderer with new elements
      this.updateTextRenderer(renderableElements);

      // Track performance
      if (this.config.performanceMonitoring) {
        this.layoutStats.layoutTime = performance.now() - startTime;
        this.layoutStats.elementCount = renderableElements.length;
        this.layoutStats.frameCount++;
      }

    } catch (error) {
      console.error('Layout system error:', error);

      if (this.config.fallbackToOldSystem) {
        this.fallbackRender();
      }
    }
  }

  /**
   * Convert layout results to renderable elements
   */
  private convertToRenderableElements(renderQueue: LayoutResult[]): RenderableElement[] {
    const renderableElements: RenderableElement[] = [];

    renderQueue.forEach(result => {
      if (result.element.textContent && result.element.computedStyle) {
        const style = result.element.computedStyle;

        // Convert WebGL coordinates to screen coordinates for text renderer
        const bounds = this.convertWebGLToScreenCoords(result.bounds);

        const renderable: RenderableElement = {
          id: result.element.id,
          bounds,
          textContent: result.element.textContent,
          style,
          panelId: style.webglPanel || '',
          zIndex: style.zIndex,
          isVisible: style.visibility === 'visible' && style.opacity > 0
        };

        renderableElements.push(renderable);
      }
    });

    return renderableElements;
  }

  /**
   * Convert WebGL coordinates to screen coordinates
   */
  private convertWebGLToScreenCoords(bounds: any): { x: number; y: number; width: number; height: number } {
    const viewport = this.layoutEngine.getViewport();

    return {
      x: bounds.x / viewport.width,
      y: bounds.y / viewport.height,
      width: bounds.width / viewport.width,
      height: bounds.height / viewport.height
    };
  }

  /**
   * Update text renderer with new elements
   */
  private updateTextRenderer(elements: RenderableElement[]): void {
    // Clear existing text elements
    this.clearExistingTextElements();

    // Add new elements
    elements.forEach(element => {
      if (element.isVisible) {
        const config: TextElementConfig = {
          position: [element.bounds.x, element.bounds.y],
          size: [element.bounds.width, element.bounds.height],
          content: element.textContent,
          fontSize: element.style.fontSize,
          fontFamily: element.style.fontFamily,
          fontWeight: element.style.fontWeight.toString(),
          color: this.rgbaToString(element.style.color),
          textAlign: element.style.textAlign,
          lineHeight: element.style.lineHeight / element.style.fontSize,
          panelId: element.panelId,
          panelRelativePosition: [element.bounds.x, element.bounds.y]
        };

        this.textRenderer.addTextElement(element.id, config);
      }
    });
  }

  /**
   * Clear existing text elements from renderer
   */
  private clearExistingTextElements(): void {
    // Access private textElements map and clear it
    const textElements = (this.textRenderer as any).textElements;
    if (textElements && textElements.clear) {
      textElements.clear();
    }
  }

  /**
   * Convert RGBA array to CSS string
   */
  private rgbaToString(rgba: [number, number, number, number]): string {
    return `rgba(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)}, ${rgba[3]})`;
  }

  /**
   * Fallback to original rendering system
   */
  private fallbackRender(): void {
    // Use original text renderer setup
    (this.textRenderer as any).setupDefaultTextElements?.();
  }

  // ===== VIEWPORT AND UPDATES =====

  /**
   * Set up viewport updates
   */
  private setupViewportUpdates(): void {
    const canvas = (this.textRenderer as any).gl.canvas as HTMLCanvasElement;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.layoutEngine.setViewport({
          width,
          height,
          dpr: window.devicePixelRatio || 1
        });
      }
    });

    resizeObserver.observe(canvas);
  }

  /**
   * Set up automatic layout updates
   */
  private setupAutomaticUpdates(): void {
    // Update layout when DOM changes
    const mutationObserver = new MutationObserver(() => {
      if (this.config.enableNewLayout) {
        this.layoutEngine.scheduleLayout();
      }
    });

    document.querySelectorAll('.glass-panel').forEach(panel => {
      mutationObserver.observe(panel, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    });
  }

  // ===== DECLARATIVE API =====

  /**
   * Add element using declarative syntax
   */
  addElement(definition: {
    tag?: string;
    text?: string;
    style?: TextStyle;
    children?: any[];
    parent?: string;
  }): string {
    const element = new TextElement(
      definition.tag as any || 'div',
      definition.text || '',
      definition.style || {}
    );

    // Add children if specified
    if (definition.children) {
      definition.children.forEach(childDef => {
        const childId = this.addElement(childDef);
        const childElement = this.findElementById(childId);
        if (childElement) {
          element.appendChild(childElement);
        }
      });
    }

    // Add to parent or root
    if (definition.parent) {
      const parentElement = this.findElementById(definition.parent);
      if (parentElement) {
        parentElement.appendChild(element);
      }
    } else if (this.rootElement) {
      this.rootElement.appendChild(element);
    }

    this.layoutEngine.scheduleLayout();
    return element.id;
  }

  /**
   * Find element by ID
   */
  private findElementById(id: string): TextElement | null {
    return this.rootElement?.findById(id) || null;
  }

  // ===== CONFIGURATION =====

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LayoutRendererConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get performance stats
   */
  getPerformanceStats(): typeof this.layoutStats {
    return { ...this.layoutStats };
  }

  /**
   * Enable debug mode
   */
  enableDebug(): void {
    this.config.debugMode = true;
    console.log('Layout debug mode enabled');
  }

  /**
   * Disable debug mode
   */
  disableDebug(): void {
    this.config.debugMode = false;
  }

  /**
   * Get layout engine for direct access
   */
  getLayoutEngine(): TextLayoutEngine {
    return this.layoutEngine;
  }

  /**
   * Get root element for direct manipulation
   */
  getRootElement(): TextElement | null {
    return this.rootElement;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.layoutEngine.dispose();
    this.rootElement?.dispose();
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Create layout integration for existing TextRenderer
 */
export function createLayoutIntegration(
  textRenderer: TextRenderer,
  config?: Partial<LayoutRendererConfig>
): LayoutRendererIntegration {
  return new LayoutRendererIntegration(textRenderer, config);
}

/**
 * Enhance TextRenderer with layout capabilities
 */
export function enhanceTextRenderer(
  textRenderer: TextRenderer,
  config?: Partial<LayoutRendererConfig>
): LayoutRendererIntegration {
  const integration = new LayoutRendererIntegration(textRenderer, config);
  integration.enableLayoutSystem();
  return integration;
}
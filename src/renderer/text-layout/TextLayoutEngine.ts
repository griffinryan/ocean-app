/**
 * Core layout engine for WebGL text rendering system
 * Handles CSS-like layout computation, style resolution, and rendering coordination
 */

import { TextElement, LayoutContext, ElementBounds } from './TextElement';
import { TextStyle, ComputedTextStyle } from './TextStyle';

// ===== LAYOUT RESULT =====

export interface LayoutResult {
  element: TextElement;
  bounds: ElementBounds;
  children: LayoutResult[];
  renderOrder: number;
}

export interface LayoutViewport {
  width: number;
  height: number;
  x: number;
  y: number;
  dpr: number;
}

// ===== LAYOUT ALGORITHM INTERFACE =====

export interface LayoutAlgorithm {
  name: string;
  layout(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): ElementBounds;
}

// ===== LAYOUT ENGINE =====

export class TextLayoutEngine {
  private viewport: LayoutViewport;
  private rootElement: TextElement | null = null;
  private layoutAlgorithms = new Map<string, LayoutAlgorithm>();
  private measurementCanvas: CanvasRenderingContext2D;
  private renderQueue: LayoutResult[] = [];

  // Layout state
  private layoutInProgress = false;
  private frameId: number | null = null;

  // Performance tracking
  private lastLayoutTime = 0;
  private layoutCount = 0;

  constructor(viewport: LayoutViewport) {
    this.viewport = viewport;

    // Create measurement canvas for text metrics
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    this.measurementCanvas = canvas.getContext('2d')!;

    // Register built-in layout algorithms
    this.registerDefaultAlgorithms();
  }

  // ===== VIEWPORT MANAGEMENT =====

  /**
   * Update viewport dimensions
   */
  setViewport(viewport: Partial<LayoutViewport>): void {
    this.viewport = { ...this.viewport, ...viewport };
    this.scheduleLayout();
  }

  /**
   * Get current viewport
   */
  getViewport(): LayoutViewport {
    return { ...this.viewport };
  }

  // ===== ROOT ELEMENT MANAGEMENT =====

  /**
   * Set the root element for layout
   */
  setRootElement(element: TextElement): void {
    this.rootElement = element;
    this.scheduleLayout();
  }

  /**
   * Get the root element
   */
  getRootElement(): TextElement | null {
    return this.rootElement;
  }

  // ===== LAYOUT ALGORITHM REGISTRATION =====

  /**
   * Register a layout algorithm
   */
  registerLayoutAlgorithm(algorithm: LayoutAlgorithm): void {
    this.layoutAlgorithms.set(algorithm.name, algorithm);
  }

  /**
   * Get layout algorithm by name
   */
  getLayoutAlgorithm(name: string): LayoutAlgorithm | undefined {
    return this.layoutAlgorithms.get(name);
  }

  /**
   * Register default layout algorithms
   */
  private registerDefaultAlgorithms(): void {
    // Block layout (default)
    this.registerLayoutAlgorithm(new BlockLayoutAlgorithm());

    // Inline layout
    this.registerLayoutAlgorithm(new InlineLayoutAlgorithm());

    // Flex layout (basic implementation)
    this.registerLayoutAlgorithm(new FlexLayoutAlgorithm());
  }

  // ===== LAYOUT SCHEDULING =====

  /**
   * Schedule layout for next frame
   */
  scheduleLayout(): void {
    if (this.layoutInProgress || this.frameId !== null) {
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.performLayout();
    });
  }

  /**
   * Force immediate layout
   */
  forceLayout(): LayoutResult[] {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    return this.performLayout();
  }

  /**
   * Perform the actual layout computation
   */
  private performLayout(): LayoutResult[] {
    if (this.layoutInProgress || !this.rootElement) {
      return [];
    }

    const startTime = performance.now();
    this.layoutInProgress = true;

    try {
      // Clear render queue
      this.renderQueue = [];

      // Create layout context
      const context: LayoutContext = {
        parentWidth: this.viewport.width,
        parentHeight: this.viewport.height,
        rootFontSize: 16, // Default root font size
        viewportWidth: this.viewport.width,
        viewportHeight: this.viewport.height,
        dpr: this.viewport.dpr
      };

      // Compute styles recursively
      this.computeStyles(this.rootElement, context);

      // Perform layout
      const result = this.layoutElement(this.rootElement, context);

      // Build render queue
      this.buildRenderQueue(result, 0);

      // Performance tracking
      this.lastLayoutTime = performance.now() - startTime;
      this.layoutCount++;

      return this.renderQueue;

    } finally {
      this.layoutInProgress = false;
    }
  }

  // ===== STYLE COMPUTATION =====

  /**
   * Compute styles for element tree
   */
  private computeStyles(element: TextElement, context: LayoutContext): void {
    // Compute this element's style
    const computedStyle = element.computeStyle(context);

    // Update context with computed font size for children
    if (computedStyle.fontSize !== context.rootFontSize) {
      context = {
        ...context,
        rootFontSize: computedStyle.fontSize
      };
    }

    // Recursively compute children styles
    element.children.forEach(child => {
      this.computeStyles(child, {
        ...context,
        parentWidth: computedStyle.width > 0 ? computedStyle.width : context.parentWidth,
        parentHeight: computedStyle.height > 0 ? computedStyle.height : context.parentHeight
      });
    });
  }

  // ===== LAYOUT COMPUTATION =====

  /**
   * Layout an element and its children
   */
  private layoutElement(element: TextElement, context: LayoutContext): LayoutResult {
    if (!element.computedStyle) {
      throw new Error('Element style must be computed before layout');
    }

    const style = element.computedStyle;

    // Determine layout algorithm
    const algorithmName = this.getLayoutAlgorithmName(style);
    const algorithm = this.layoutAlgorithms.get(algorithmName);

    if (!algorithm) {
      throw new Error(`Unknown layout algorithm: ${algorithmName}`);
    }

    // Calculate available space
    const availableWidth = context.parentWidth - style.marginLeft - style.marginRight;
    const availableHeight = context.parentHeight - style.marginTop - style.marginBottom;

    // Perform layout
    const bounds = algorithm.layout(element, availableWidth, availableHeight, context);

    // Apply margins and positioning
    bounds.x += style.marginLeft;
    bounds.y += style.marginTop;

    // Handle absolute positioning
    if (style.position === 'absolute' || style.position === 'fixed') {
      bounds.x = style.left;
      bounds.y = style.top;
    }

    // Store bounds on element
    element.bounds = bounds;
    element.needsLayout = false;

    // Layout children
    const childResults: LayoutResult[] = [];

    if (element.children.length > 0) {
      const childContext: LayoutContext = {
        ...context,
        parentWidth: bounds.width - style.paddingLeft - style.paddingRight,
        parentHeight: bounds.height - style.paddingTop - style.paddingBottom
      };

      element.children.forEach(child => {
        const childResult = this.layoutElement(child, childContext);

        // Adjust child position relative to parent
        childResult.bounds.x += bounds.x + style.paddingLeft;
        childResult.bounds.y += bounds.y + style.paddingTop;

        childResults.push(childResult);
      });
    }

    return {
      element,
      bounds,
      children: childResults,
      renderOrder: style.zIndex
    };
  }

  /**
   * Determine which layout algorithm to use
   */
  private getLayoutAlgorithmName(style: ComputedTextStyle): string {
    if (style.display === 'flex' || style.display === 'inline-flex') {
      return 'flex';
    }

    if (style.display === 'inline' || style.display === 'inline-block') {
      return 'inline';
    }

    return 'block'; // Default
  }

  // ===== RENDER QUEUE =====

  /**
   * Build render queue with z-index ordering
   */
  private buildRenderQueue(result: LayoutResult, depth: number): void {
    // Add this element to render queue
    result.renderOrder = result.element.computedStyle?.zIndex || 0;
    this.renderQueue.push(result);

    // Add children
    result.children.forEach(child => {
      this.buildRenderQueue(child, depth + 1);
    });

    // Sort by z-index (stable sort to preserve document order for same z-index)
    this.renderQueue.sort((a, b) => a.renderOrder - b.renderOrder);
  }

  /**
   * Get render queue
   */
  getRenderQueue(): LayoutResult[] {
    return [...this.renderQueue];
  }

  // ===== TEXT MEASUREMENT =====

  /**
   * Measure text with current measurement canvas
   */
  measureText(element: TextElement, maxWidth?: number): void {
    if (element.textContent) {
      element.measureText(maxWidth, this.measurementCanvas);
    }
  }

  // ===== UTILITIES =====

  /**
   * Get performance stats
   */
  getStats(): { lastLayoutTime: number; layoutCount: number } {
    return {
      lastLayoutTime: this.lastLayoutTime,
      layoutCount: this.layoutCount
    };
  }

  /**
   * Force layout of specific element subtree
   */
  layoutSubtree(element: TextElement): LayoutResult | null {
    if (!element.computedStyle || !this.rootElement) {
      return null;
    }

    const context: LayoutContext = {
      parentWidth: this.viewport.width,
      parentHeight: this.viewport.height,
      rootFontSize: 16,
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
      dpr: this.viewport.dpr
    };

    return this.layoutElement(element, context);
  }

  /**
   * Find element by coordinate
   */
  elementFromPoint(x: number, y: number): TextElement | null {
    for (const result of this.renderQueue) {
      const bounds = result.bounds;
      if (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height
      ) {
        return result.element;
      }
    }
    return null;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
    }
    this.renderQueue = [];
    this.layoutAlgorithms.clear();
  }
}

// ===== BUILT-IN LAYOUT ALGORITHMS =====

/**
 * Block layout algorithm (default CSS block layout)
 */
class BlockLayoutAlgorithm implements LayoutAlgorithm {
  name = 'block';

  layout(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): ElementBounds {
    const style = element.computedStyle!;

    // Calculate content size
    let width = style.width > 0 ? style.width : availableWidth;
    let height = style.height > 0 ? style.height : 0;

    // Measure text content if present
    if (element.textContent) {
      element.measureText(width - style.paddingLeft - style.paddingRight);
      const metrics = element.textMetrics!;

      if (height <= 0) {
        height = metrics.height + style.paddingTop + style.paddingBottom;
      }
    }

    // Auto-size based on children if no explicit height
    if (height <= 0 && element.children.length > 0) {
      // This would be computed during child layout
      height = availableHeight;
    }

    return {
      x: 0,
      y: 0,
      width: Math.min(width, availableWidth),
      height: Math.min(height, availableHeight)
    };
  }
}

/**
 * Inline layout algorithm
 */
class InlineLayoutAlgorithm implements LayoutAlgorithm {
  name = 'inline';

  layout(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): ElementBounds {
    const style = element.computedStyle!;

    // Inline elements size to their content
    let width = 0;
    let height = style.fontSize;

    if (element.textContent) {
      element.measureText(availableWidth);
      const metrics = element.textMetrics!;
      width = metrics.width;
      height = metrics.height;
    }

    return {
      x: 0,
      y: 0,
      width: Math.min(width + style.paddingLeft + style.paddingRight, availableWidth),
      height: Math.min(height + style.paddingTop + style.paddingBottom, availableHeight)
    };
  }
}

/**
 * Basic flex layout algorithm
 */
class FlexLayoutAlgorithm implements LayoutAlgorithm {
  name = 'flex';

  layout(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): ElementBounds {
    const style = element.computedStyle!;

    // For now, just implement basic flex container sizing
    let width = style.width > 0 ? style.width : availableWidth;
    let height = style.height > 0 ? style.height : availableHeight;

    // Basic implementation - will be enhanced
    return {
      x: 0,
      y: 0,
      width: Math.min(width, availableWidth),
      height: Math.min(height, availableHeight)
    };
  }
}
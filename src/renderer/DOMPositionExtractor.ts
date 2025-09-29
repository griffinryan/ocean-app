/**
 * DOM Position Extractor
 * Extracts exact positions and layout information from HTML elements
 * to replicate them perfectly in WebGL text rendering
 */

export interface ExtractedPosition {
  // Absolute positioning
  x: number;                // Left position in pixels
  y: number;                // Top position in pixels
  width: number;            // Element width in pixels
  height: number;           // Element height in pixels

  // Relative positioning (within parent panel)
  relativeX: number;        // X position relative to panel [0-1]
  relativeY: number;        // Y position relative to panel [0-1]
  relativeWidth: number;    // Width relative to panel [0-1]
  relativeHeight: number;   // Height relative to panel [0-1]

  // WebGL normalized coordinates [-1, 1]
  webglX: number;           // WebGL X coordinate
  webglY: number;           // WebGL Y coordinate
  webglWidth: number;       // WebGL width
  webglHeight: number;      // WebGL height

  // Text alignment info
  textAlign: string;        // Computed text alignment
  lineHeight: number;       // Computed line height
  fontSize: number;         // Computed font size
  fontFamily: string;       // Computed font family
  fontWeight: string;       // Computed font weight

  // Layout context
  isFlexChild: boolean;     // Is this element a flex child?
  flexDirection: string;    // Parent's flex direction
  justifyContent: string;   // Parent's justify-content
  alignItems: string;       // Parent's align-items
  gap: number;              // Parent's gap in pixels
}

export interface PanelLayout {
  panelId: string;
  elements: Map<string, ExtractedPosition>;
  panelRect: DOMRect;
  panelStyle: CSSStyleDeclaration;
}

export class DOMPositionExtractor {
  private canvas: HTMLCanvasElement;
  private canvasRect: DOMRect;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvasRect = canvas.getBoundingClientRect();
  }

  /**
   * Update canvas rect for coordinate calculations
   */
  updateCanvasRect(): void {
    this.canvasRect = this.canvas.getBoundingClientRect();
  }

  /**
   * Extract positions for all text elements in a panel
   */
  extractPanelLayout(panelId: string): PanelLayout | null {
    const panelElement = document.getElementById(panelId);
    if (!panelElement || panelElement.classList.contains('hidden')) {
      return null;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const panelStyle = getComputedStyle(panelElement);

    const layout: PanelLayout = {
      panelId,
      elements: new Map(),
      panelRect,
      panelStyle
    };

    // Extract all text-containing elements
    const textElements = this.findTextElements(panelElement);

    textElements.forEach((element, index) => {
      const position = this.extractElementPosition(element, panelElement);
      if (position) {
        const elementId = element.id || `${panelId}-text-${index}`;
        layout.elements.set(elementId, position);
      }
    });

    return layout;
  }

  /**
   * Find all text-containing elements in a panel
   */
  private findTextElements(panelElement: Element): Element[] {
    const textElements: Element[] = [];

    // Define text element selectors
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'span', 'div', 'a',
      '.brand-text', '.nav-label', '.subtitle'
    ];

    selectors.forEach(selector => {
      const elements = panelElement.querySelectorAll(selector);
      elements.forEach(element => {
        if (this.hasTextContent(element)) {
          textElements.push(element);
        }
      });
    });

    return textElements;
  }

  /**
   * Check if element has meaningful text content
   */
  private hasTextContent(element: Element): boolean {
    const text = element.textContent?.trim();
    return !!(text && text.length > 0 &&
              !element.querySelector('canvas') && // Exclude canvas elements
              !element.querySelector('svg'));      // Exclude SVG elements
  }

  /**
   * Extract detailed position information for an element
   */
  extractElementPosition(
    element: Element,
    panelElement: Element
  ): ExtractedPosition | null {
    const elementRect = element.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    const elementStyle = getComputedStyle(element);
    const parentStyle = getComputedStyle(element.parentElement || panelElement);

    // Skip if element has no size
    if (elementRect.width === 0 || elementRect.height === 0) {
      return null;
    }

    // Calculate absolute positions
    const x = elementRect.left;
    const y = elementRect.top;
    const width = elementRect.width;
    const height = elementRect.height;

    // Calculate relative positions within panel
    const relativeX = (elementRect.left - panelRect.left) / panelRect.width;
    const relativeY = (elementRect.top - panelRect.top) / panelRect.height;
    const relativeWidth = elementRect.width / panelRect.width;
    const relativeHeight = elementRect.height / panelRect.height;

    // Calculate WebGL normalized coordinates
    const webglX = ((elementRect.left + elementRect.width / 2) - this.canvasRect.left) / this.canvasRect.width * 2 - 1;
    const webglY = (1 - ((elementRect.top + elementRect.height / 2) - this.canvasRect.top) / this.canvasRect.height) * 2 - 1;
    const webglWidth = elementRect.width / this.canvasRect.width * 2;
    const webglHeight = elementRect.height / this.canvasRect.height * 2;

    // Extract typography information
    const fontSize = parseFloat(elementStyle.fontSize) || 16;
    const lineHeight = elementStyle.lineHeight === 'normal' ? 1.2 : parseFloat(elementStyle.lineHeight) || 1.2;

    // Extract layout context
    const isFlexChild = parentStyle.display.includes('flex');
    const flexDirection = parentStyle.flexDirection || 'row';
    const justifyContent = parentStyle.justifyContent || 'flex-start';
    const alignItems = parentStyle.alignItems || 'stretch';
    const gap = parseFloat(parentStyle.gap) || 0;

    return {
      x, y, width, height,
      relativeX, relativeY, relativeWidth, relativeHeight,
      webglX, webglY, webglWidth, webglHeight,
      textAlign: elementStyle.textAlign || 'left',
      lineHeight: typeof lineHeight === 'number' ? lineHeight : lineHeight * fontSize,
      fontSize,
      fontFamily: elementStyle.fontFamily || 'inherit',
      fontWeight: elementStyle.fontWeight || 'normal',
      isFlexChild,
      flexDirection,
      justifyContent,
      alignItems,
      gap
    };
  }

  /**
   * Extract navbar layout with flexbox information
   */
  extractNavbarLayout(): PanelLayout | null {
    const navbar = document.getElementById('navbar');
    if (!navbar || navbar.classList.contains('hidden')) {
      return null;
    }

    const layout = this.extractPanelLayout('navbar');
    if (!layout) return null;

    // Add specific navbar elements
    const brandElement = navbar.querySelector('.brand-text');
    const navItems = navbar.querySelectorAll('.nav-label');

    if (brandElement) {
      const brandPosition = this.extractElementPosition(brandElement, navbar);
      if (brandPosition) {
        layout.elements.set('nav-brand', brandPosition);
      }
    }

    navItems.forEach((item, index) => {
      const itemPosition = this.extractElementPosition(item, navbar);
      if (itemPosition) {
        layout.elements.set(`nav-item-${index}`, itemPosition);
      }
    });

    return layout;
  }

  /**
   * Get flexbox layout information for navbar
   */
  getNavbarFlexInfo(): {
    container: ExtractedPosition | null;
    brand: ExtractedPosition | null;
    items: ExtractedPosition[];
  } {
    const navbar = document.getElementById('navbar');
    const navbarContent = navbar?.querySelector('.navbar-content');
    const brandElement = navbar?.querySelector('.brand-text');
    const navItems = Array.from(navbar?.querySelectorAll('.nav-label') || []);

    return {
      container: navbarContent ? this.extractElementPosition(navbarContent, navbar!) : null,
      brand: brandElement ? this.extractElementPosition(brandElement, navbar!) : null,
      items: navItems.map(item => this.extractElementPosition(item, navbar!)).filter(Boolean) as ExtractedPosition[]
    };
  }

  /**
   * Get exact text positions for landing panel
   */
  getLandingTextPositions(): {
    title: ExtractedPosition | null;
    subtitle: ExtractedPosition | null;
  } {
    const landing = document.getElementById('landing-panel');
    if (!landing) return { title: null, subtitle: null };

    const titleElement = landing.querySelector('h1');
    const subtitleElement = landing.querySelector('.subtitle');

    return {
      title: titleElement ? this.extractElementPosition(titleElement, landing) : null,
      subtitle: subtitleElement ? this.extractElementPosition(subtitleElement, landing) : null
    };
  }

  /**
   * Debug: Log extracted positions
   */
  debugLogPositions(panelId: string): void {
    const layout = this.extractPanelLayout(panelId);
    if (!layout) {
      console.log(`No layout found for panel: ${panelId}`);
      return;
    }

    console.group(`DOM Position Extraction - ${panelId}`);
    console.log('Panel rect:', layout.panelRect);

    layout.elements.forEach((position, elementId) => {
      console.log(`Element: ${elementId}`);
      console.log(`  Absolute: (${position.x.toFixed(1)}, ${position.y.toFixed(1)}) ${position.width.toFixed(1)}x${position.height.toFixed(1)}`);
      console.log(`  Relative: (${position.relativeX.toFixed(3)}, ${position.relativeY.toFixed(3)}) ${position.relativeWidth.toFixed(3)}x${position.relativeHeight.toFixed(3)}`);
      console.log(`  WebGL: (${position.webglX.toFixed(3)}, ${position.webglY.toFixed(3)}) ${position.webglWidth.toFixed(3)}x${position.webglHeight.toFixed(3)}`);
      console.log(`  Flex: ${position.isFlexChild ? 'YES' : 'NO'} | Direction: ${position.flexDirection} | Justify: ${position.justifyContent}`);
    });

    console.groupEnd();
  }

  /**
   * Convert extracted position to layout system coordinates
   */
  toLayoutCoordinates(position: ExtractedPosition): {
    style: any;
    bounds: { x: number; y: number; width: number; height: number };
  } {
    return {
      style: {
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        fontSize: `${position.fontSize}px`,
        fontFamily: position.fontFamily,
        fontWeight: position.fontWeight,
        textAlign: position.textAlign,
        lineHeight: position.lineHeight / position.fontSize
      },
      bounds: {
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height
      }
    };
  }
}
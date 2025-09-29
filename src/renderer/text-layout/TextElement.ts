/**
 * Virtual DOM-like text element for WebGL text layout system
 * Manages hierarchical text content with CSS-like styling
 */

import { TextStyle, ComputedTextStyle, DEFAULT_STYLE, INHERITED_PROPERTIES } from './TextStyle';

// ===== ELEMENT TYPES =====

export type TextElementTag =
  | 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'section' | 'article' | 'header' | 'footer' | 'nav' | 'aside'
  | 'ul' | 'ol' | 'li' | 'strong' | 'em' | 'code' | 'pre'
  | 'text';  // Special type for text nodes

export interface ElementBounds {
  x: number;      // Left position in WebGL coordinates
  y: number;      // Top position in WebGL coordinates
  width: number;  // Width in pixels
  height: number; // Height in pixels
}

export interface TextMetrics {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  lineCount: number;
  lines: TextLineMetrics[];
}

export interface TextLineMetrics {
  text: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

// ===== LAYOUT CONTEXT =====

export interface LayoutContext {
  parentWidth: number;
  parentHeight: number;
  rootFontSize: number;  // For rem calculations
  viewportWidth: number;  // For vw calculations
  viewportHeight: number; // For vh calculations
  dpr: number;           // Device pixel ratio
}

// ===== TEXT ELEMENT CLASS =====

export class TextElement {
  // Core properties
  public readonly id: string;
  public readonly tag: TextElementTag;
  public textContent: string;

  // Hierarchy
  public parent: TextElement | null = null;
  public children: TextElement[] = [];

  // Styling
  public style: TextStyle = {};
  public computedStyle: ComputedTextStyle | null = null;

  // Layout results
  public bounds: ElementBounds = { x: 0, y: 0, width: 0, height: 0 };
  public textMetrics: TextMetrics | null = null;
  public needsLayout = true;
  public needsRerender = true;

  // Internal state
  private static nextId = 1;
  private measurementCache = new Map<string, TextMetrics>();

  constructor(tag: TextElementTag = 'div', textContent = '', style: TextStyle = {}) {
    this.id = `text-element-${TextElement.nextId++}`;
    this.tag = tag;
    this.textContent = textContent;
    this.style = style;
  }

  // ===== HIERARCHY MANAGEMENT =====

  /**
   * Add a child element
   */
  appendChild(child: TextElement): void {
    if (child.parent) {
      child.parent.removeChild(child);
    }

    child.parent = this;
    this.children.push(child);
    this.markLayoutDirty();
  }

  /**
   * Remove a child element
   */
  removeChild(child: TextElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parent = null;
      this.markLayoutDirty();
    }
  }

  /**
   * Insert child at specific index
   */
  insertChild(child: TextElement, index: number): void {
    if (child.parent) {
      child.parent.removeChild(child);
    }

    child.parent = this;
    this.children.splice(index, 0, child);
    this.markLayoutDirty();
  }

  /**
   * Remove all children
   */
  clearChildren(): void {
    this.children.forEach(child => {
      child.parent = null;
    });
    this.children = [];
    this.markLayoutDirty();
  }

  // ===== STYLING =====

  /**
   * Update element style
   */
  setStyle(newStyle: Partial<TextStyle>): void {
    this.style = { ...this.style, ...newStyle };
    this.markLayoutDirty();
  }

  /**
   * Get computed style value for property
   */
  getComputedStyleProperty<K extends keyof ComputedTextStyle>(
    property: K
  ): ComputedTextStyle[K] | undefined {
    return this.computedStyle?.[property];
  }

  /**
   * Compute inherited and cascaded styles
   */
  computeStyle(context: LayoutContext): ComputedTextStyle {
    // Start with default values
    const computed = { ...DEFAULT_STYLE } as ComputedTextStyle;

    // Apply inherited values from parent
    if (this.parent?.computedStyle) {
      for (const property of INHERITED_PROPERTIES) {
        const key = property as keyof ComputedTextStyle;
        if (this.parent.computedStyle[key] !== undefined) {
          (computed as any)[key] = this.parent.computedStyle[key];
        }
      }
    }

    // Apply element's own styles
    this.applyStyleToComputed(this.style, computed, context);

    // Apply tag-specific defaults
    this.applyTagDefaults(computed);

    this.computedStyle = computed;
    return computed;
  }

  /**
   * Apply tag-specific style defaults
   */
  private applyTagDefaults(computed: ComputedTextStyle): void {
    switch (this.tag) {
      case 'h1':
        computed.fontSize = computed.fontSize * 2.0;
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 0.67;
        computed.marginBottom = computed.fontSize * 0.67;
        break;
      case 'h2':
        computed.fontSize = computed.fontSize * 1.5;
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 0.75;
        computed.marginBottom = computed.fontSize * 0.75;
        break;
      case 'h3':
        computed.fontSize = computed.fontSize * 1.17;
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 0.83;
        computed.marginBottom = computed.fontSize * 0.83;
        break;
      case 'h4':
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 1.12;
        computed.marginBottom = computed.fontSize * 1.12;
        break;
      case 'h5':
        computed.fontSize = computed.fontSize * 0.83;
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 1.5;
        computed.marginBottom = computed.fontSize * 1.5;
        break;
      case 'h6':
        computed.fontSize = computed.fontSize * 0.75;
        computed.fontWeight = 600;
        computed.marginTop = computed.fontSize * 1.67;
        computed.marginBottom = computed.fontSize * 1.67;
        break;
      case 'p':
        computed.marginTop = computed.fontSize * 1.0;
        computed.marginBottom = computed.fontSize * 1.0;
        break;
      case 'strong':
        computed.fontWeight = 700;
        break;
      case 'em':
        computed.fontStyle = 'italic';
        break;
      case 'code':
        computed.fontFamily = 'Monaco, Consolas, "Courier New", monospace';
        computed.backgroundColor = [0.1, 0.1, 0.1, 0.8];
        computed.paddingLeft = 4;
        computed.paddingRight = 4;
        computed.paddingTop = 2;
        computed.paddingBottom = 2;
        break;
      case 'pre':
        computed.fontFamily = 'Monaco, Consolas, "Courier New", monospace';
        computed.whiteSpace = 'pre';
        computed.backgroundColor = [0.05, 0.05, 0.05, 0.9];
        computed.paddingTop = 12;
        computed.paddingRight = 16;
        computed.paddingBottom = 12;
        computed.paddingLeft = 16;
        break;
    }
  }

  /**
   * Apply style properties to computed style with unit conversion
   */
  private applyStyleToComputed(
    style: TextStyle,
    computed: ComputedTextStyle,
    context: LayoutContext
  ): void {
    // This would be implemented with the unit conversion system
    // For now, we'll implement basic pixel values
    Object.entries(style).forEach(([key, value]) => {
      if (value !== undefined) {
        (computed as any)[key] = this.convertStyleValue(key, value, computed, context);
      }
    });
  }

  /**
   * Convert style value to computed value (will be enhanced with unit system)
   */
  private convertStyleValue(
    property: string,
    value: any,
    computed: ComputedTextStyle,
    context: LayoutContext
  ): any {
    // Basic implementation - will be enhanced with full unit conversion
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      // Handle CSS units (basic implementation)
      if (value.endsWith('px')) {
        return parseFloat(value);
      }
      if (value.endsWith('%')) {
        const percentage = parseFloat(value) / 100;
        // Apply percentage based on property type
        if (property.includes('width') || property.includes('Left') || property.includes('Right')) {
          return context.parentWidth * percentage;
        }
        if (property.includes('height') || property.includes('Top') || property.includes('Bottom')) {
          return context.parentHeight * percentage;
        }
        if (property === 'fontSize') {
          return computed.fontSize * percentage;
        }
      }
      if (value.endsWith('em')) {
        return parseFloat(value) * computed.fontSize;
      }
      if (value.endsWith('rem')) {
        return parseFloat(value) * context.rootFontSize;
      }
      if (value.endsWith('vw')) {
        return parseFloat(value) * context.viewportWidth / 100;
      }
      if (value.endsWith('vh')) {
        return parseFloat(value) * context.viewportHeight / 100;
      }
    }

    return value;
  }

  // ===== LAYOUT STATE =====

  /**
   * Mark this element and descendants as needing layout
   */
  markLayoutDirty(): void {
    this.needsLayout = true;
    this.needsRerender = true;
    this.computedStyle = null;

    // Mark children dirty too
    this.children.forEach(child => child.markLayoutDirty());

    // Mark parent chain for re-measurement
    let parent = this.parent;
    while (parent) {
      parent.needsLayout = true;
      parent.needsRerender = true;
      parent = parent.parent;
    }
  }

  /**
   * Mark for rerender without full layout
   */
  markRenderDirty(): void {
    this.needsRerender = true;
    this.children.forEach(child => child.markRenderDirty());
  }

  // ===== TEXT MEASUREMENT =====

  /**
   * Measure text content using canvas
   */
  measureText(
    maxWidth: number = Infinity,
    measurementCanvas?: CanvasRenderingContext2D
  ): TextMetrics {
    if (!this.computedStyle) {
      throw new Error('Cannot measure text without computed style');
    }

    // Create cache key
    const cacheKey = `${this.textContent}-${this.computedStyle.fontSize}-${this.computedStyle.fontFamily}-${this.computedStyle.fontWeight}-${maxWidth}`;

    if (this.measurementCache.has(cacheKey)) {
      return this.measurementCache.get(cacheKey)!;
    }

    // Create or use provided canvas context for measurement
    let ctx = measurementCanvas;
    let shouldCleanup = false;

    if (!ctx) {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d')!;
      shouldCleanup = true;
    }

    // Setup font for measurement
    const { fontSize, fontFamily, fontWeight, fontStyle } = this.computedStyle;
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

    const lines = this.wrapText(this.textContent, maxWidth, ctx);

    const lineHeight = this.computedStyle.lineHeight * fontSize;
    const totalHeight = lines.length * lineHeight;

    let maxLineWidth = 0;
    const lineMetrics: TextLineMetrics[] = lines.map((line, index) => {
      const width = ctx!.measureText(line).width;
      maxLineWidth = Math.max(maxLineWidth, width);

      return {
        text: line,
        width,
        height: lineHeight,
        x: 0, // Will be set during layout based on text-align
        y: index * lineHeight
      };
    });

    const metrics: TextMetrics = {
      width: Math.min(maxLineWidth, maxWidth),
      height: totalHeight,
      ascent: fontSize * 0.8, // Approximation
      descent: fontSize * 0.2, // Approximation
      lineHeight,
      lineCount: lines.length,
      lines: lineMetrics
    };

    this.measurementCache.set(cacheKey, metrics);
    this.textMetrics = metrics;

    return metrics;
  }

  /**
   * Wrap text to fit within max width
   */
  private wrapText(text: string, maxWidth: number, ctx: CanvasRenderingContext2D): string[] {
    if (!this.computedStyle) return [text];

    const { whiteSpace, wordBreak, wordWrap } = this.computedStyle;

    // Handle different white-space values
    if (whiteSpace === 'nowrap') {
      return [text];
    }

    if (whiteSpace === 'pre') {
      return text.split('\n');
    }

    // Basic word wrapping implementation
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          // Word is longer than max width
          if (wordBreak === 'break-all' || wordWrap === 'break-word') {
            // Break the word
            const chars = word.split('');
            let charLine = '';
            for (const char of chars) {
              const testCharLine = charLine + char;
              if (ctx.measureText(testCharLine).width <= maxWidth) {
                charLine = testCharLine;
              } else {
                if (charLine) lines.push(charLine);
                charLine = char;
              }
            }
            currentLine = charLine;
          } else {
            currentLine = word;
          }
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  // ===== UTILITIES =====

  /**
   * Find element by ID in tree
   */
  findById(id: string): TextElement | null {
    if (this.id === id) return this;

    for (const child of this.children) {
      const found = child.findById(id);
      if (found) return found;
    }

    return null;
  }

  /**
   * Get all text content recursively
   */
  getTextContent(): string {
    let content = this.textContent;
    for (const child of this.children) {
      content += child.getTextContent();
    }
    return content;
  }

  /**
   * Get element depth in tree
   */
  getDepth(): number {
    let depth = 0;
    let parent = this.parent;
    while (parent) {
      depth++;
      parent = parent.parent;
    }
    return depth;
  }

  /**
   * Check if element is ancestor of another
   */
  isAncestorOf(element: TextElement): boolean {
    let current = element.parent;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Traverse element tree with callback
   */
  traverse(callback: (element: TextElement, depth: number) => void, depth = 0): void {
    callback(this, depth);
    this.children.forEach(child => child.traverse(callback, depth + 1));
  }

  /**
   * Clone element and optionally its children
   */
  clone(deep = false): TextElement {
    const cloned = new TextElement(this.tag, this.textContent, { ...this.style });

    if (deep) {
      this.children.forEach(child => {
        cloned.appendChild(child.clone(true));
      });
    }

    return cloned;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.measurementCache.clear();
    this.children.forEach(child => child.dispose());
    this.clearChildren();
  }

  /**
   * Debug representation
   */
  toString(indent = 0): string {
    const spaces = '  '.repeat(indent);
    const style = Object.keys(this.style).length > 0 ? ` style={${Object.keys(this.style).join(',')}}` : '';
    const content = this.textContent ? ` "${this.textContent}"` : '';

    let result = `${spaces}<${this.tag}${style}>${content}`;

    if (this.children.length > 0) {
      result += '\n';
      this.children.forEach(child => {
        result += child.toString(indent + 1) + '\n';
      });
      result += `${spaces}</${this.tag}>`;
    } else {
      result += `</${this.tag}>`;
    }

    return result;
  }
}
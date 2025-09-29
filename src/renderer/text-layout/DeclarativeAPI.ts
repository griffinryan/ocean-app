/**
 * Declarative API for WebGL Text Layout System
 * Provides intuitive, CSS-like interface for defining text layouts
 */

import { TextElement } from './TextElement';
import { TextStyle } from './TextStyle';
import { TextLayoutEngine } from './TextLayoutEngine';
import { LayoutRendererIntegration } from './LayoutIntegration';

// ===== DECLARATIVE TYPES =====

export interface LayoutComponent {
  tag?: keyof HTMLElementTagNameMap | 'text';
  text?: string;
  style?: TextStyle;
  children?: LayoutComponent[];
  id?: string;
  className?: string;
  onClick?: (element: TextElement) => void;
  onHover?: (element: TextElement) => void;
}

export interface LayoutProps {
  [key: string]: any;
}

export interface StyleSheet {
  [selector: string]: TextStyle;
}

export interface MediaQuery {
  condition: string;
  styles: StyleSheet;
}

export interface ResponsiveConfig {
  breakpoints: {
    mobile: number;
    tablet: number;
    desktop: number;
    wide: number;
  };
  mediaQueries: MediaQuery[];
}

// ===== DECLARATIVE LAYOUT BUILDER =====

export class DeclarativeLayoutBuilder {
  private integration: LayoutRendererIntegration;
  private stylesheet: StyleSheet = {};
  private responsiveConfig: ResponsiveConfig | null = null;
  private componentRegistry = new Map<string, LayoutComponent>();

  // Event handling
  private eventHandlers = new Map<string, { onClick?: Function; onHover?: Function }>();

  constructor(integration: LayoutRendererIntegration) {
    this.integration = integration;
    this.setupBuiltinComponents();
  }

  // ===== COMPONENT DEFINITION =====

  /**
   * Create a layout using component syntax
   */
  create(component: LayoutComponent): string {
    const element = this.buildElement(component);
    const rootElement = this.integration.getRootElement();

    if (rootElement) {
      rootElement.appendChild(element);
      this.integration.getLayoutEngine().scheduleLayout();
    }

    return element.id;
  }

  /**
   * Create multiple components at once
   */
  createMany(components: LayoutComponent[]): string[] {
    return components.map(component => this.create(component));
  }

  /**
   * Build element from component definition
   */
  private buildElement(component: LayoutComponent): TextElement {
    const {
      tag = 'div',
      text = '',
      style = {},
      children = [],
      id,
      className,
      onClick,
      onHover
    } = component;

    // Apply stylesheet styles
    const computedStyle = this.computeStyle(style, className);

    // Create element
    const element = new TextElement(tag as any, text, computedStyle);

    // Set custom ID if provided
    if (id) {
      (element as any).customId = id;
    }

    // Register event handlers
    if (onClick || onHover) {
      this.eventHandlers.set(element.id, { onClick, onHover });
    }

    // Add children
    children.forEach(child => {
      const childElement = this.buildElement(child);
      element.appendChild(childElement);
    });

    return element;
  }

  // ===== STYLING SYSTEM =====

  /**
   * Define stylesheet for reusable styles
   */
  setStyleSheet(stylesheet: StyleSheet): void {
    this.stylesheet = { ...this.stylesheet, ...stylesheet };
  }

  /**
   * Add individual style rule
   */
  addStyle(selector: string, style: TextStyle): void {
    this.stylesheet[selector] = { ...this.stylesheet[selector], ...style };
  }

  /**
   * Compute final style from base style and class names
   */
  private computeStyle(baseStyle: TextStyle, className?: string): TextStyle {
    let computedStyle = { ...baseStyle };

    if (className) {
      const classNames = className.split(' ');
      classNames.forEach(cls => {
        const classStyle = this.stylesheet[`.${cls}`];
        if (classStyle) {
          computedStyle = { ...computedStyle, ...classStyle };
        }
      });
    }

    // Apply responsive styles if configured
    if (this.responsiveConfig) {
      computedStyle = this.applyResponsiveStyles(computedStyle);
    }

    return computedStyle;
  }

  // ===== RESPONSIVE DESIGN =====

  /**
   * Configure responsive breakpoints and media queries
   */
  setResponsiveConfig(config: ResponsiveConfig): void {
    this.responsiveConfig = config;
  }

  /**
   * Apply responsive styles based on current viewport
   */
  private applyResponsiveStyles(style: TextStyle): TextStyle {
    if (!this.responsiveConfig) return style;

    const viewport = this.integration.getLayoutEngine().getViewport();
    let responsiveStyle = { ...style };

    // Apply media queries
    this.responsiveConfig.mediaQueries.forEach(query => {
      if (this.matchesMediaQuery(query.condition, viewport.width)) {
        Object.entries(query.styles).forEach(([selector, queryStyle]) => {
          // For now, apply all query styles (could be enhanced with selector matching)
          responsiveStyle = { ...responsiveStyle, ...queryStyle };
        });
      }
    });

    return responsiveStyle;
  }

  /**
   * Check if viewport matches media query condition
   */
  private matchesMediaQuery(condition: string, viewportWidth: number): boolean {
    // Simple media query parsing (could be enhanced)
    if (condition.includes('max-width')) {
      const maxWidth = parseInt(condition.match(/max-width:\s*(\d+)px/)?.[1] || '0');
      return viewportWidth <= maxWidth;
    }

    if (condition.includes('min-width')) {
      const minWidth = parseInt(condition.match(/min-width:\s*(\d+)px/)?.[1] || '0');
      return viewportWidth >= minWidth;
    }

    return false;
  }

  // ===== COMPONENT REGISTRY =====

  /**
   * Register reusable component
   */
  registerComponent(name: string, component: LayoutComponent): void {
    this.componentRegistry.set(name, component);
  }

  /**
   * Use registered component
   */
  useComponent(name: string, props: LayoutProps = {}): LayoutComponent {
    const baseComponent = this.componentRegistry.get(name);
    if (!baseComponent) {
      throw new Error(`Component '${name}' not found`);
    }

    // Merge props into component (simple implementation)
    return {
      ...baseComponent,
      style: { ...baseComponent.style, ...props.style },
      text: props.text || baseComponent.text,
      children: props.children || baseComponent.children
    };
  }

  /**
   * Set up built-in components
   */
  private setupBuiltinComponents(): void {
    // Button component
    this.registerComponent('Button', {
      tag: 'div',
      style: {
        display: 'inline-block',
        padding: '12px 24px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: '500',
        textAlign: 'center',
        cursor: 'pointer'
      }
    });

    // Card component
    this.registerComponent('Card', {
      tag: 'div',
      style: {
        display: 'block',
        padding: '24px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        marginBottom: '16px'
      }
    });

    // Flex container
    this.registerComponent('Flex', {
      tag: 'div',
      style: {
        display: 'flex',
        gap: '16px'
      }
    });

    // Text component
    this.registerComponent('Text', {
      tag: 'span',
      style: {
        display: 'inline',
        fontSize: '16px',
        lineHeight: 1.5
      }
    });

    // Heading component
    this.registerComponent('Heading', {
      tag: 'h2',
      style: {
        display: 'block',
        fontSize: '24px',
        fontWeight: '600',
        marginBottom: '16px'
      }
    });
  }

  // ===== LAYOUT HELPERS =====

  /**
   * Create flexbox layout
   */
  flex(direction: 'row' | 'column' = 'row', children: LayoutComponent[] = []): LayoutComponent {
    return {
      tag: 'div',
      style: {
        display: 'flex',
        flexDirection: direction,
        gap: '16px'
      },
      children
    };
  }

  /**
   * Create grid layout
   */
  grid(columns: number, children: LayoutComponent[] = []): LayoutComponent {
    return {
      tag: 'div',
      style: {
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '16px'
      },
      children
    };
  }

  /**
   * Create centered layout
   */
  center(child: LayoutComponent): LayoutComponent {
    return {
      tag: 'div',
      style: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%'
      },
      children: [child]
    };
  }

  /**
   * Create spacing component
   */
  spacer(size: string | number = 16): LayoutComponent {
    return {
      tag: 'div',
      style: {
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        flexShrink: 0
      }
    };
  }

  // ===== ANIMATION HELPERS =====

  /**
   * Add animation to component
   */
  animate(component: LayoutComponent, animation: string): LayoutComponent {
    return {
      ...component,
      style: {
        ...component.style,
        animation
      }
    };
  }

  /**
   * Add transition to component
   */
  transition(component: LayoutComponent, properties: string, duration = '0.3s'): LayoutComponent {
    return {
      ...component,
      style: {
        ...component.style,
        transition: `${properties} ${duration} ease`
      }
    };
  }

  // ===== EVENT HANDLING =====

  /**
   * Handle click events (simplified)
   */
  handleClick(x: number, y: number): void {
    const element = this.integration.getLayoutEngine().elementFromPoint(x, y);
    if (element) {
      const handlers = this.eventHandlers.get(element.id);
      if (handlers?.onClick) {
        handlers.onClick(element);
      }
    }
  }

  /**
   * Handle hover events (simplified)
   */
  handleHover(x: number, y: number): void {
    const element = this.integration.getLayoutEngine().elementFromPoint(x, y);
    if (element) {
      const handlers = this.eventHandlers.get(element.id);
      if (handlers?.onHover) {
        handlers.onHover(element);
      }
    }
  }

  // ===== UTILITIES =====

  /**
   * Find element by custom ID
   */
  findElement(customId: string): TextElement | null {
    const rootElement = this.integration.getRootElement();
    if (!rootElement) return null;

    let found: TextElement | null = null;
    rootElement.traverse(element => {
      if ((element as any).customId === customId) {
        found = element;
      }
    });

    return found;
  }

  /**
   * Update element style
   */
  updateElementStyle(customId: string, style: Partial<TextStyle>): void {
    const element = this.findElement(customId);
    if (element) {
      element.setStyle(style);
      this.integration.getLayoutEngine().scheduleLayout();
    }
  }

  /**
   * Remove element
   */
  removeElement(customId: string): void {
    const element = this.findElement(customId);
    if (element && element.parent) {
      element.parent.removeChild(element);
      this.integration.getLayoutEngine().scheduleLayout();
    }
  }

  /**
   * Clear all elements
   */
  clear(): void {
    const rootElement = this.integration.getRootElement();
    if (rootElement) {
      rootElement.clearChildren();
      this.integration.getLayoutEngine().scheduleLayout();
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): any {
    return {
      layoutStats: this.integration.getPerformanceStats(),
      engineStats: this.integration.getLayoutEngine().getStats(),
      elementCount: this.eventHandlers.size
    };
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Create declarative layout builder
 */
export function createLayoutBuilder(integration: LayoutRendererIntegration): DeclarativeLayoutBuilder {
  return new DeclarativeLayoutBuilder(integration);
}

/**
 * Quick component creation helpers
 */
export const Components = {
  div: (props: LayoutProps & { children?: LayoutComponent[] }): LayoutComponent => ({
    tag: 'div',
    ...props
  }),

  span: (props: LayoutProps): LayoutComponent => ({
    tag: 'span',
    ...props
  }),

  h1: (props: LayoutProps): LayoutComponent => ({
    tag: 'h1',
    ...props
  }),

  h2: (props: LayoutProps): LayoutComponent => ({
    tag: 'h2',
    ...props
  }),

  h3: (props: LayoutProps): LayoutComponent => ({
    tag: 'h3',
    ...props
  }),

  p: (props: LayoutProps): LayoutComponent => ({
    tag: 'p',
    ...props
  }),

  text: (content: string, style?: TextStyle): LayoutComponent => ({
    tag: 'text',
    text: content,
    style
  })
};

/**
 * Common style presets
 */
export const Styles = {
  flex: {
    row: { display: 'flex' as const, flexDirection: 'row' as const },
    column: { display: 'flex' as const, flexDirection: 'column' as const },
    center: { display: 'flex' as const, justifyContent: 'center' as const, alignItems: 'center' as const }
  },

  text: {
    heading: { fontSize: '24px', fontWeight: '600' },
    body: { fontSize: '16px', lineHeight: 1.5 },
    small: { fontSize: '14px', opacity: 0.8 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' as const }
  },

  spacing: {
    xs: { padding: '4px' },
    sm: { padding: '8px' },
    md: { padding: '16px' },
    lg: { padding: '24px' },
    xl: { padding: '32px' }
  },

  colors: {
    primary: { color: 'rgba(66, 165, 245, 1)' },
    secondary: { color: 'rgba(156, 39, 176, 1)' },
    success: { color: 'rgba(76, 175, 80, 1)' },
    warning: { color: 'rgba(255, 193, 7, 1)' },
    error: { color: 'rgba(244, 67, 54, 1)' }
  }
};
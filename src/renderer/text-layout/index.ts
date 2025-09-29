/**
 * WebGL Text Layout Abstraction System
 * Complete CSS-like text layout and styling for WebGL rendering
 *
 * This system provides a comprehensive abstraction that allows developers to position
 * and style WebGL text using familiar CSS concepts like flexbox, grid, responsive design,
 * and modern layout techniques.
 */

// ===== CORE EXPORTS =====

// Types and interfaces
export type {
  TextStyle,
  ComputedTextStyle,
  CSSUnit,
  CSSLength,
  CSSSpacing,
  CSSSize,
  CSSTypography,
  CSSColors,
  CSSPosition,
  CSSDisplay,
  CSSFlexbox,
  CSSGrid,
  CSSEffects
} from './TextStyle';

export type {
  TextElement,
  LayoutContext,
  ElementBounds,
  TextMetrics,
  TextLineMetrics
} from './TextElement';

export type {
  LayoutResult,
  LayoutViewport,
  LayoutAlgorithm
} from './TextLayoutEngine';

// Core classes
export { TextElement } from './TextElement';
export { TextLayoutEngine } from './TextLayoutEngine';
export { TextStyle, DEFAULT_STYLE, INHERITED_PROPERTIES } from './TextStyle';

// ===== LAYOUT ALGORITHMS =====

export { FlexboxLayout, isFlexContainer, isFlexItem } from './FlexboxLayout';

// ===== UTILITIES =====

export {
  UnitConverter,
  unitConverter,
  convertToPixels,
  convertSpacing,
  parseUnit,
  needsConversion
} from './UnitConverter';

export type {
  ParsedUnit,
  ConversionContext
} from './UnitConverter';

export {
  BoxModelCalculator,
  BoxModelUtils,
  MarginCollapseCalculator,
  boxModelCalculator,
  calculateBoxModel,
  getAvailableSpace,
  getIntrinsicSize
} from './BoxModel';

export type {
  BoxDimensions,
  BoxModelValues,
  ContentBox,
  PaddingBox,
  BorderBox,
  MarginBox,
  BoxModelGeometry
} from './BoxModel';

export {
  TextBreaker,
  textBreaker,
  breakText,
  measureLine,
  needsLineBreaking,
  getOptimalLineCount
} from './TextBreaking';

export type {
  BreakOpportunity,
  BreakType,
  TextLine,
  TextWord,
  LineBreakResult
} from './TextBreaking';

// ===== INTEGRATION =====

export {
  LayoutRendererIntegration,
  createLayoutIntegration,
  enhanceTextRenderer
} from './LayoutIntegration';

export type {
  LayoutRendererConfig,
  RenderableElement
} from './LayoutIntegration';

// ===== DECLARATIVE API =====

export {
  DeclarativeLayoutBuilder,
  createLayoutBuilder,
  Components,
  Styles
} from './DeclarativeAPI';

export type {
  LayoutComponent,
  LayoutProps,
  StyleSheet,
  MediaQuery
} from './DeclarativeAPI';

// ===== RESPONSIVE SYSTEM =====

export {
  ResponsiveManager,
  ResponsiveUnitConverter,
  createResponsiveManager,
  ResponsiveHelpers
} from './ResponsiveSystem';

export type {
  ResponsiveBreakpoint,
  ResponsiveValue,
  AdaptiveLayoutConfig
} from './ResponsiveSystem';

// ===== HIGH-LEVEL API =====

import { TextRenderer } from '../TextRenderer';
import { TextLayoutEngine, LayoutViewport } from './TextLayoutEngine';
import { LayoutRendererIntegration } from './LayoutIntegration';
import { DeclarativeLayoutBuilder } from './DeclarativeAPI';
import { ResponsiveManager } from './ResponsiveSystem';
import { FlexboxLayout } from './FlexboxLayout';

/**
 * Complete WebGL Text Layout System
 * High-level API that combines all components
 */
export class WebGLTextLayoutSystem {
  public readonly layoutEngine: TextLayoutEngine;
  public readonly integration: LayoutRendererIntegration;
  public readonly builder: DeclarativeLayoutBuilder;
  public readonly responsive: ResponsiveManager;

  constructor(
    textRenderer: TextRenderer,
    config: {
      viewport?: Partial<LayoutViewport>;
      enableResponsive?: boolean;
      enableFlexbox?: boolean;
      debug?: boolean;
    } = {}
  ) {
    // Get canvas for viewport setup
    const canvas = (textRenderer as any).gl.canvas as HTMLCanvasElement;
    const viewport: LayoutViewport = {
      width: canvas.width,
      height: canvas.height,
      x: 0,
      y: 0,
      dpr: window.devicePixelRatio || 1,
      ...config.viewport
    };

    // Initialize layout engine
    this.layoutEngine = new TextLayoutEngine(viewport);

    // Register flexbox if enabled
    if (config.enableFlexbox !== false) {
      this.layoutEngine.registerLayoutAlgorithm(new FlexboxLayout());
    }

    // Initialize integration layer
    this.integration = new LayoutRendererIntegration(textRenderer, {
      enableNewLayout: true,
      debugMode: config.debug || false
    });

    // Initialize declarative builder
    this.builder = new DeclarativeLayoutBuilder(this.integration);

    // Initialize responsive system if enabled
    if (config.enableResponsive !== false) {
      this.responsive = new ResponsiveManager(this.layoutEngine);
    } else {
      // Create minimal responsive manager for API consistency
      this.responsive = new ResponsiveManager(this.layoutEngine, {
        enableFluidTypography: false,
        enableResponsiveSpacing: false,
        enableViewportAwareUnits: false
      });
    }

    // Enable the layout system
    this.integration.enableLayoutSystem();
  }

  /**
   * Create layout using component syntax
   */
  create(component: any) {
    return this.builder.create(component);
  }

  /**
   * Set global stylesheet
   */
  setStyles(styles: any) {
    return this.builder.setStyleSheet(styles);
  }

  /**
   * Add responsive breakpoints
   */
  addBreakpoint(name: string, breakpoint: any) {
    return this.responsive.registerBreakpoint(name, breakpoint);
  }

  /**
   * Add media query
   */
  addMediaQuery(id: string, query: string, styles: any) {
    return this.responsive.createMediaQuery(id, query, styles);
  }

  /**
   * Render the layout
   */
  render() {
    return this.integration.renderWithLayoutSystem();
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      layout: this.integration.getPerformanceStats(),
      engine: this.layoutEngine.getStats(),
      viewport: this.responsive.getViewportInfo()
    };
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.layoutEngine.dispose();
    this.integration.dispose();
    this.responsive.dispose();
  }
}

/**
 * Factory function to create the complete layout system
 */
export function createWebGLTextLayout(
  textRenderer: TextRenderer,
  config?: Parameters<typeof WebGLTextLayoutSystem.prototype.constructor>[1]
): WebGLTextLayoutSystem {
  return new WebGLTextLayoutSystem(textRenderer, config);
}

// ===== QUICK START HELPERS =====

/**
 * Quick setup for common use cases
 */
export const QuickStart = {
  /**
   * Enable CSS-like layout for existing TextRenderer
   */
  enableCSS: (textRenderer: TextRenderer) => {
    return createWebGLTextLayout(textRenderer, {
      enableResponsive: true,
      enableFlexbox: true
    });
  },

  /**
   * Create simple text layout
   */
  simpleLayout: (textRenderer: TextRenderer) => {
    const layout = QuickStart.enableCSS(textRenderer);

    // Helper methods for common layouts
    return {
      ...layout,

      // Create centered text
      centerText: (text: string, style?: any) => layout.create({
        tag: 'div',
        style: {
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100vw',
          height: '100vh',
          ...style
        },
        children: [{ tag: 'text', text, style: { fontSize: '24px', ...style?.textStyle } }]
      }),

      // Create flex layout
      flexRow: (children: any[], style?: any) => layout.create({
        tag: 'div',
        style: { display: 'flex', flexDirection: 'row', gap: '16px', ...style },
        children
      }),

      // Create flex column
      flexColumn: (children: any[], style?: any) => layout.create({
        tag: 'div',
        style: { display: 'flex', flexDirection: 'column', gap: '16px', ...style },
        children
      })
    };
  }
};

// ===== DEFAULT EXPORT =====

export default {
  WebGLTextLayoutSystem,
  createWebGLTextLayout,
  QuickStart
};
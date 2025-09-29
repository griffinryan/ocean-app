/**
 * Responsive Design System for WebGL Text Layout
 * Implements CSS media queries, responsive breakpoints, and adaptive layouts
 */

import { TextElement, LayoutContext } from './TextElement';
import { TextStyle, ComputedTextStyle } from './TextStyle';
import { TextLayoutEngine, LayoutViewport } from './TextLayoutEngine';
import { unitConverter, ConversionContext } from './UnitConverter';
import { DeclarativeLayoutBuilder, LayoutComponent } from './DeclarativeAPI';

// ===== RESPONSIVE TYPES =====

export interface ResponsiveBreakpoint {
  name: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  orientation?: 'portrait' | 'landscape';
  pixelRatio?: number;
}

export interface MediaQuery {
  id: string;
  query: string;
  breakpoint?: ResponsiveBreakpoint;
  customCondition?: (viewport: LayoutViewport) => boolean;
  styles: Record<string, TextStyle>;
  active: boolean;
}

export interface ResponsiveValue<T> {
  default: T;
  mobile?: T;
  tablet?: T;
  desktop?: T;
  wide?: T;
  [breakpoint: string]: T | undefined;
}

export interface AdaptiveLayoutConfig {
  enableFluidTypography: boolean;
  enableResponsiveSpacing: boolean;
  enableViewportAwareUnits: boolean;
  enableContainerQueries: boolean;
  minFontSize: number;
  maxFontSize: number;
  fontScaleRatio: number;
}

// ===== RESPONSIVE MANAGER =====

export class ResponsiveManager {
  private layoutEngine: TextLayoutEngine;
  private mediaQueries: Map<string, MediaQuery> = new Map();
  private breakpoints: Map<string, ResponsiveBreakpoint> = new Map();
  private adaptiveConfig: AdaptiveLayoutConfig;

  // Viewport tracking
  private currentViewport: LayoutViewport;
  private viewportChangeHandlers: Array<(viewport: LayoutViewport) => void> = [];

  // Performance optimization
  private mediaQueryCache = new Map<string, boolean>();
  private lastUpdateTime = 0;
  private updateThrottleMs = 16; // ~60fps

  constructor(
    layoutEngine: TextLayoutEngine,
    config: Partial<AdaptiveLayoutConfig> = {}
  ) {
    this.layoutEngine = layoutEngine;
    this.currentViewport = layoutEngine.getViewport();

    this.adaptiveConfig = {
      enableFluidTypography: true,
      enableResponsiveSpacing: true,
      enableViewportAwareUnits: true,
      enableContainerQueries: false, // Future feature
      minFontSize: 12,
      maxFontSize: 24,
      fontScaleRatio: 1.2,
      ...config
    };

    this.setupDefaultBreakpoints();
    this.setupViewportTracking();
  }

  // ===== BREAKPOINT MANAGEMENT =====

  /**
   * Register responsive breakpoint
   */
  registerBreakpoint(name: string, breakpoint: ResponsiveBreakpoint): void {
    this.breakpoints.set(name, { ...breakpoint, name });
    this.invalidateCache();
  }

  /**
   * Setup default CSS-like breakpoints
   */
  private setupDefaultBreakpoints(): void {
    this.registerBreakpoint('mobile', {
      name: 'mobile',
      maxWidth: 767
    });

    this.registerBreakpoint('tablet', {
      name: 'tablet',
      minWidth: 768,
      maxWidth: 1023
    });

    this.registerBreakpoint('desktop', {
      name: 'desktop',
      minWidth: 1024,
      maxWidth: 1439
    });

    this.registerBreakpoint('wide', {
      name: 'wide',
      minWidth: 1440
    });

    // Common device-specific breakpoints
    this.registerBreakpoint('phone-portrait', {
      name: 'phone-portrait',
      maxWidth: 479,
      orientation: 'portrait'
    });

    this.registerBreakpoint('phone-landscape', {
      name: 'phone-landscape',
      maxWidth: 767,
      orientation: 'landscape'
    });

    this.registerBreakpoint('retina', {
      name: 'retina',
      pixelRatio: 2
    });
  }

  /**
   * Get current active breakpoints
   */
  getActiveBreakpoints(): ResponsiveBreakpoint[] {
    return Array.from(this.breakpoints.values()).filter(bp =>
      this.matchesBreakpoint(bp, this.currentViewport)
    );
  }

  /**
   * Check if viewport matches breakpoint
   */
  private matchesBreakpoint(breakpoint: ResponsiveBreakpoint, viewport: LayoutViewport): boolean {
    const { width, height, dpr } = viewport;

    // Check width constraints
    if (breakpoint.minWidth && width < breakpoint.minWidth) return false;
    if (breakpoint.maxWidth && width > breakpoint.maxWidth) return false;

    // Check height constraints
    if (breakpoint.minHeight && height < breakpoint.minHeight) return false;
    if (breakpoint.maxHeight && height > breakpoint.maxHeight) return false;

    // Check orientation
    if (breakpoint.orientation) {
      const isPortrait = height > width;
      if (breakpoint.orientation === 'portrait' && !isPortrait) return false;
      if (breakpoint.orientation === 'landscape' && isPortrait) return false;
    }

    // Check pixel ratio
    if (breakpoint.pixelRatio && dpr < breakpoint.pixelRatio) return false;

    return true;
  }

  // ===== MEDIA QUERY SYSTEM =====

  /**
   * Register media query
   */
  registerMediaQuery(query: MediaQuery): void {
    this.mediaQueries.set(query.id, query);
    this.evaluateMediaQuery(query);
  }

  /**
   * Create media query from CSS-like syntax
   */
  createMediaQuery(
    id: string,
    queryString: string,
    styles: Record<string, TextStyle>
  ): MediaQuery {
    const query: MediaQuery = {
      id,
      query: queryString,
      styles,
      active: false
    };

    // Parse query string to create condition
    query.customCondition = this.parseMediaQueryString(queryString);

    this.registerMediaQuery(query);
    return query;
  }

  /**
   * Parse CSS media query string
   */
  private parseMediaQueryString(queryString: string): (viewport: LayoutViewport) => boolean {
    // Simplified media query parser
    return (viewport: LayoutViewport) => {
      const { width, height, dpr } = viewport;

      // Handle common patterns
      if (queryString.includes('max-width')) {
        const match = queryString.match(/max-width:\s*(\d+)px/);
        if (match) return width <= parseInt(match[1]);
      }

      if (queryString.includes('min-width')) {
        const match = queryString.match(/min-width:\s*(\d+)px/);
        if (match) return width >= parseInt(match[1]);
      }

      if (queryString.includes('max-height')) {
        const match = queryString.match(/max-height:\s*(\d+)px/);
        if (match) return height <= parseInt(match[1]);
      }

      if (queryString.includes('min-height')) {
        const match = queryString.match(/min-height:\s*(\d+)px/);
        if (match) return height >= parseInt(match[1]);
      }

      if (queryString.includes('orientation: portrait')) {
        return height > width;
      }

      if (queryString.includes('orientation: landscape')) {
        return width > height;
      }

      if (queryString.includes('min-resolution')) {
        const match = queryString.match(/min-resolution:\s*(\d+(?:\.\d+)?)dppx/);
        if (match) return dpr >= parseFloat(match[1]);
      }

      return false;
    };
  }

  /**
   * Evaluate media query against current viewport
   */
  private evaluateMediaQuery(query: MediaQuery): void {
    const cacheKey = `${query.id}-${this.currentViewport.width}-${this.currentViewport.height}`;

    if (this.mediaQueryCache.has(cacheKey)) {
      query.active = this.mediaQueryCache.get(cacheKey)!;
      return;
    }

    let matches = false;

    if (query.breakpoint) {
      matches = this.matchesBreakpoint(query.breakpoint, this.currentViewport);
    } else if (query.customCondition) {
      matches = query.customCondition(this.currentViewport);
    }

    query.active = matches;
    this.mediaQueryCache.set(cacheKey, matches);
  }

  /**
   * Get active media queries
   */
  getActiveMediaQueries(): MediaQuery[] {
    return Array.from(this.mediaQueries.values()).filter(q => q.active);
  }

  // ===== RESPONSIVE VALUES =====

  /**
   * Resolve responsive value based on current viewport
   */
  resolveResponsiveValue<T>(responsiveValue: ResponsiveValue<T>): T {
    const activeBreakpoints = this.getActiveBreakpoints();

    // Check specific breakpoints in order of preference
    for (const breakpoint of activeBreakpoints) {
      const value = responsiveValue[breakpoint.name];
      if (value !== undefined) {
        return value;
      }
    }

    // Fallback to common breakpoints
    if (this.currentViewport.width <= 767 && responsiveValue.mobile !== undefined) {
      return responsiveValue.mobile;
    }

    if (this.currentViewport.width <= 1023 && responsiveValue.tablet !== undefined) {
      return responsiveValue.tablet;
    }

    if (this.currentViewport.width <= 1439 && responsiveValue.desktop !== undefined) {
      return responsiveValue.desktop;
    }

    if (responsiveValue.wide !== undefined) {
      return responsiveValue.wide;
    }

    return responsiveValue.default;
  }

  /**
   * Create responsive value helper
   */
  responsive<T>(values: Partial<ResponsiveValue<T>> & { default: T }): ResponsiveValue<T> {
    return values as ResponsiveValue<T>;
  }

  // ===== FLUID TYPOGRAPHY =====

  /**
   * Calculate fluid font size based on viewport
   */
  calculateFluidFontSize(
    minSize: number,
    maxSize: number,
    minViewport: number = 320,
    maxViewport: number = 1200
  ): number {
    if (!this.adaptiveConfig.enableFluidTypography) {
      return minSize;
    }

    const { width } = this.currentViewport;

    if (width <= minViewport) return minSize;
    if (width >= maxViewport) return maxSize;

    // Linear interpolation
    const ratio = (width - minViewport) / (maxViewport - minViewport);
    return minSize + (maxSize - minSize) * ratio;
  }

  /**
   * Generate modular scale for typography
   */
  generateTypographyScale(steps: number = 6): number[] {
    const baseSize = 16;
    const scale: number[] = [];

    for (let i = -2; i < steps; i++) {
      scale.push(baseSize * Math.pow(this.adaptiveConfig.fontScaleRatio, i));
    }

    return scale;
  }

  // ===== ADAPTIVE SPACING =====

  /**
   * Calculate adaptive spacing based on viewport
   */
  calculateAdaptiveSpacing(baseSpacing: number): number {
    if (!this.adaptiveConfig.enableResponsiveSpacing) {
      return baseSpacing;
    }

    const { width } = this.currentViewport;

    // Scale spacing based on viewport width
    if (width <= 767) {
      return baseSpacing * 0.8; // Smaller spacing on mobile
    }

    if (width >= 1440) {
      return baseSpacing * 1.2; // Larger spacing on wide screens
    }

    return baseSpacing;
  }

  // ===== VIEWPORT TRACKING =====

  /**
   * Setup viewport change tracking
   */
  private setupViewportTracking(): void {
    // Listen to layout engine viewport changes
    const originalSetViewport = this.layoutEngine.setViewport.bind(this.layoutEngine);

    this.layoutEngine.setViewport = (viewport: Partial<LayoutViewport>) => {
      const newViewport = { ...this.currentViewport, ...viewport };
      this.handleViewportChange(newViewport);
      return originalSetViewport(viewport);
    };
  }

  /**
   * Handle viewport changes
   */
  private handleViewportChange(newViewport: LayoutViewport): void {
    const currentTime = performance.now();

    // Throttle updates for performance
    if (currentTime - this.lastUpdateTime < this.updateThrottleMs) {
      return;
    }

    const oldViewport = this.currentViewport;
    this.currentViewport = newViewport;

    // Check if any media queries need re-evaluation
    this.invalidateCache();
    this.evaluateAllMediaQueries();

    // Notify handlers
    this.viewportChangeHandlers.forEach(handler => {
      try {
        handler(newViewport);
      } catch (error) {
        console.error('Viewport change handler error:', error);
      }
    });

    this.lastUpdateTime = currentTime;
  }

  /**
   * Add viewport change handler
   */
  onViewportChange(handler: (viewport: LayoutViewport) => void): () => void {
    this.viewportChangeHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.viewportChangeHandlers.indexOf(handler);
      if (index > -1) {
        this.viewportChangeHandlers.splice(index, 1);
      }
    };
  }

  // ===== CACHE MANAGEMENT =====

  /**
   * Invalidate media query cache
   */
  private invalidateCache(): void {
    this.mediaQueryCache.clear();
  }

  /**
   * Evaluate all registered media queries
   */
  private evaluateAllMediaQueries(): void {
    this.mediaQueries.forEach(query => {
      this.evaluateMediaQuery(query);
    });
  }

  // ===== UTILITIES =====

  /**
   * Get current viewport info
   */
  getViewportInfo(): {
    width: number;
    height: number;
    aspectRatio: number;
    orientation: 'portrait' | 'landscape';
    breakpoints: string[];
    pixelRatio: number;
  } {
    const { width, height, dpr } = this.currentViewport;

    return {
      width,
      height,
      aspectRatio: width / height,
      orientation: height > width ? 'portrait' : 'landscape',
      breakpoints: this.getActiveBreakpoints().map(bp => bp.name),
      pixelRatio: dpr
    };
  }

  /**
   * Check if viewport matches media query
   */
  matchesMediaQuery(queryString: string): boolean {
    const condition = this.parseMediaQueryString(queryString);
    return condition(this.currentViewport);
  }

  /**
   * Get configuration
   */
  getConfig(): AdaptiveLayoutConfig {
    return { ...this.adaptiveConfig };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AdaptiveLayoutConfig>): void {
    this.adaptiveConfig = { ...this.adaptiveConfig, ...config };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.viewportChangeHandlers = [];
    this.mediaQueries.clear();
    this.breakpoints.clear();
    this.mediaQueryCache.clear();
  }
}

// ===== RESPONSIVE EXTENSIONS =====

/**
 * Enhanced unit converter with responsive capabilities
 */
export class ResponsiveUnitConverter {
  private responsiveManager: ResponsiveManager;

  constructor(responsiveManager: ResponsiveManager) {
    this.responsiveManager = responsiveManager;
  }

  /**
   * Convert responsive CSS units with viewport awareness
   */
  convertResponsiveUnit(
    value: string | number,
    context: ConversionContext,
    property?: string
  ): number {
    if (typeof value === 'number') return value;

    // Handle responsive viewport units
    if (value.includes('vw') || value.includes('vh') || value.includes('vmin') || value.includes('vmax')) {
      return this.convertViewportUnit(value, context);
    }

    // Handle container query units (future feature)
    if (value.includes('cqw') || value.includes('cqh')) {
      return this.convertContainerUnit(value, context);
    }

    // Fallback to standard conversion
    return unitConverter.toPixels(value as any, context, property);
  }

  /**
   * Convert viewport-relative units with responsive adjustments
   */
  private convertViewportUnit(value: string, context: ConversionContext): number {
    const viewport = this.responsiveManager.getViewportInfo();
    const match = value.match(/^(-?\d*\.?\d+)(vw|vh|vmin|vmax)$/);

    if (!match) return 0;

    const numValue = parseFloat(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'vw':
        return (numValue * viewport.width) / 100;
      case 'vh':
        return (numValue * viewport.height) / 100;
      case 'vmin':
        return (numValue * Math.min(viewport.width, viewport.height)) / 100;
      case 'vmax':
        return (numValue * Math.max(viewport.width, viewport.height)) / 100;
      default:
        return 0;
    }
  }

  /**
   * Convert container query units (future CSS feature)
   */
  private convertContainerUnit(value: string, context: ConversionContext): number {
    // Placeholder for container query implementation
    const match = value.match(/^(-?\d*\.?\d+)(cqw|cqh)$/);
    if (!match) return 0;

    const numValue = parseFloat(match[1]);
    const unit = match[2];

    // For now, treat as viewport units
    switch (unit) {
      case 'cqw':
        return (numValue * context.containerWidth) / 100;
      case 'cqh':
        return (numValue * context.containerHeight) / 100;
      default:
        return 0;
    }
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Create responsive manager for layout engine
 */
export function createResponsiveManager(
  layoutEngine: TextLayoutEngine,
  config?: Partial<AdaptiveLayoutConfig>
): ResponsiveManager {
  return new ResponsiveManager(layoutEngine, config);
}

/**
 * Common responsive value helpers
 */
export const ResponsiveHelpers = {
  /**
   * Create mobile-first responsive value
   */
  mobileFirst: <T>(mobile: T, tablet?: T, desktop?: T, wide?: T): ResponsiveValue<T> => ({
    default: mobile,
    mobile,
    tablet: tablet || mobile,
    desktop: desktop || tablet || mobile,
    wide: wide || desktop || tablet || mobile
  }),

  /**
   * Create desktop-first responsive value
   */
  desktopFirst: <T>(desktop: T, tablet?: T, mobile?: T): ResponsiveValue<T> => ({
    default: desktop,
    desktop,
    tablet: tablet || desktop,
    mobile: mobile || tablet || desktop
  }),

  /**
   * Create fluid spacing scale
   */
  fluidSpacing: (min: number, max: number): ResponsiveValue<string> => ({
    default: `clamp(${min}px, ${min + (max - min) * 0.5}px, ${max}px)`,
    mobile: `${min}px`,
    tablet: `${min + (max - min) * 0.3}px`,
    desktop: `${min + (max - min) * 0.7}px`,
    wide: `${max}px`
  }),

  /**
   * Create fluid typography scale
   */
  fluidText: (minSize: number, maxSize: number): ResponsiveValue<string> => ({
    default: `clamp(${minSize}px, ${minSize + (maxSize - minSize) * 0.5}px, ${maxSize}px)`,
    mobile: `${minSize}px`,
    wide: `${maxSize}px`
  })
};
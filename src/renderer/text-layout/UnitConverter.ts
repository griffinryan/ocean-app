/**
 * CSS Unit Conversion System for WebGL Text Layout
 * Handles conversion of all CSS units to pixel values
 */

import { CSSUnit, CSSLength } from './TextStyle';
import { LayoutContext } from './TextElement';

// ===== UNIT PARSING =====

export interface ParsedUnit {
  value: number;
  unit: string;
  isRelative: boolean;
  isViewportRelative: boolean;
  isFontRelative: boolean;
  isPercentage: boolean;
}

export interface ConversionContext extends LayoutContext {
  containerWidth: number;
  containerHeight: number;
  fontSize: number;          // Current element's font size
  parentFontSize: number;    // Parent element's font size
  lineHeight: number;        // Current element's line height
}

// ===== UNIT CONVERTER CLASS =====

export class UnitConverter {
  // Cache for parsed units to avoid repeated parsing
  private parseCache = new Map<string, ParsedUnit>();

  // Default values
  private static readonly DEFAULT_FONT_SIZE = 16;
  private static readonly DEFAULT_LINE_HEIGHT = 1.2;
  private static readonly DEFAULT_DPR = 1;

  /**
   * Parse a CSS unit value
   */
  parseUnit(value: CSSUnit): ParsedUnit {
    if (typeof value === 'number') {
      return {
        value,
        unit: 'px',
        isRelative: false,
        isViewportRelative: false,
        isFontRelative: false,
        isPercentage: false
      };
    }

    if (value === 'auto') {
      return {
        value: -1, // Special value for auto
        unit: 'auto',
        isRelative: true,
        isViewportRelative: false,
        isFontRelative: false,
        isPercentage: false
      };
    }

    // Check cache first
    const cached = this.parseCache.get(value);
    if (cached) {
      return cached;
    }

    const parsed = this.doParse(value);
    this.parseCache.set(value, parsed);
    return parsed;
  }

  /**
   * Internal parsing logic
   */
  private doParse(value: string): ParsedUnit {
    // Match number and unit
    const match = value.match(/^(-?\d*\.?\d+)(.*)$/);
    if (!match) {
      throw new Error(`Invalid CSS unit: ${value}`);
    }

    const numValue = parseFloat(match[1]);
    const unit = match[2].trim() || 'px';

    const result: ParsedUnit = {
      value: numValue,
      unit,
      isRelative: false,
      isViewportRelative: false,
      isFontRelative: false,
      isPercentage: false
    };

    // Categorize unit types
    switch (unit) {
      // Absolute units
      case 'px':
      case 'pt':
      case 'pc':
      case 'in':
      case 'cm':
      case 'mm':
      case 'q':
        result.isRelative = false;
        break;

      // Font-relative units
      case 'em':
      case 'rem':
      case 'ex':
      case 'ch':
      case 'lh':
        result.isRelative = true;
        result.isFontRelative = true;
        break;

      // Viewport-relative units
      case 'vw':
      case 'vh':
      case 'vmin':
      case 'vmax':
      case 'vi':
      case 'vb':
        result.isRelative = true;
        result.isViewportRelative = true;
        break;

      // Percentage
      case '%':
        result.isRelative = true;
        result.isPercentage = true;
        break;

      default:
        throw new Error(`Unsupported CSS unit: ${unit}`);
    }

    return result;
  }

  /**
   * Convert CSS unit to pixels
   */
  toPixels(
    value: CSSUnit,
    context: ConversionContext,
    property?: string
  ): number {
    const parsed = this.parseUnit(value);

    if (parsed.unit === 'auto') {
      return this.resolveAuto(property, context);
    }

    return this.convertToPixels(parsed, context, property);
  }

  /**
   * Convert parsed unit to pixels
   */
  private convertToPixels(
    parsed: ParsedUnit,
    context: ConversionContext,
    property?: string
  ): number {
    const { value, unit } = parsed;

    switch (unit) {
      // Absolute units
      case 'px':
        return value * context.dpr;

      case 'pt':
        return value * 96 / 72 * context.dpr; // 1pt = 1/72 inch, 96 DPI

      case 'pc':
        return value * 96 / 6 * context.dpr; // 1pc = 12pt

      case 'in':
        return value * 96 * context.dpr; // 96 DPI

      case 'cm':
        return value * 96 / 2.54 * context.dpr; // 1in = 2.54cm

      case 'mm':
        return value * 96 / 25.4 * context.dpr; // 1in = 25.4mm

      case 'q':
        return value * 96 / 101.6 * context.dpr; // 1q = 1/4mm

      // Font-relative units
      case 'em':
        return value * context.fontSize;

      case 'rem':
        return value * context.rootFontSize;

      case 'ex':
        return value * context.fontSize * 0.5; // Approximation: x-height ≈ 0.5em

      case 'ch':
        return value * context.fontSize * 0.5; // Approximation: character width ≈ 0.5em

      case 'lh':
        return value * context.lineHeight;

      // Viewport-relative units
      case 'vw':
        return value * context.viewportWidth / 100;

      case 'vh':
        return value * context.viewportHeight / 100;

      case 'vmin':
        return value * Math.min(context.viewportWidth, context.viewportHeight) / 100;

      case 'vmax':
        return value * Math.max(context.viewportWidth, context.viewportHeight) / 100;

      case 'vi':
        // Inline viewport size (width in horizontal writing mode)
        return value * context.viewportWidth / 100;

      case 'vb':
        // Block viewport size (height in horizontal writing mode)
        return value * context.viewportHeight / 100;

      // Percentage
      case '%':
        return this.resolvePercentage(value, property, context);

      default:
        throw new Error(`Cannot convert unit: ${unit}`);
    }
  }

  /**
   * Resolve percentage values based on property type
   */
  private resolvePercentage(
    percentage: number,
    property: string | undefined,
    context: ConversionContext
  ): number {
    const factor = percentage / 100;

    if (!property) {
      return factor * context.containerWidth; // Default to width
    }

    // Width-based properties
    if (this.isWidthProperty(property)) {
      return factor * context.containerWidth;
    }

    // Height-based properties
    if (this.isHeightProperty(property)) {
      return factor * context.containerHeight;
    }

    // Font-based properties
    if (this.isFontProperty(property)) {
      return factor * context.fontSize;
    }

    // Line-height special case
    if (property === 'lineHeight') {
      return factor * context.fontSize;
    }

    // Default to width-based
    return factor * context.containerWidth;
  }

  /**
   * Resolve auto values
   */
  private resolveAuto(
    property: string | undefined,
    context: ConversionContext
  ): number {
    if (!property) return 0;

    switch (property) {
      case 'width':
        return context.containerWidth;
      case 'height':
        return -1; // Special marker for content-based height
      case 'marginLeft':
      case 'marginRight':
        return 0; // Auto margins resolve to 0 for now
      case 'marginTop':
      case 'marginBottom':
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Check if property is width-related
   */
  private isWidthProperty(property: string): boolean {
    return property.includes('width') ||
           property.includes('Left') ||
           property.includes('Right') ||
           property === 'x' ||
           property === 'left' ||
           property === 'right';
  }

  /**
   * Check if property is height-related
   */
  private isHeightProperty(property: string): boolean {
    return property.includes('height') ||
           property.includes('Top') ||
           property.includes('Bottom') ||
           property === 'y' ||
           property === 'top' ||
           property === 'bottom';
  }

  /**
   * Check if property is font-related
   */
  private isFontProperty(property: string): boolean {
    return property.includes('font') ||
           property.includes('text') ||
           property === 'letterSpacing' ||
           property === 'wordSpacing';
  }

  // ===== BATCH CONVERSION =====

  /**
   * Convert multiple values at once for performance
   */
  convertValues(
    values: Record<string, CSSUnit>,
    context: ConversionContext
  ): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [property, value] of Object.entries(values)) {
      result[property] = this.toPixels(value, context, property);
    }

    return result;
  }

  /**
   * Convert box model values (margin, padding, border)
   */
  convertBoxModel(
    value: CSSUnit | { top?: CSSUnit; right?: CSSUnit; bottom?: CSSUnit; left?: CSSUnit },
    context: ConversionContext,
    propertyPrefix: string
  ): { top: number; right: number; bottom: number; left: number } {
    if (typeof value === 'object' && value !== null && 'top' in value) {
      // Object form
      return {
        top: value.top ? this.toPixels(value.top, context, `${propertyPrefix}Top`) : 0,
        right: value.right ? this.toPixels(value.right, context, `${propertyPrefix}Right`) : 0,
        bottom: value.bottom ? this.toPixels(value.bottom, context, `${propertyPrefix}Bottom`) : 0,
        left: value.left ? this.toPixels(value.left, context, `${propertyPrefix}Left`) : 0
      };
    } else {
      // Single value form
      const pixels = this.toPixels(value as CSSUnit, context, propertyPrefix);
      return {
        top: pixels,
        right: pixels,
        bottom: pixels,
        left: pixels
      };
    }
  }

  // ===== UTILITIES =====

  /**
   * Create conversion context from layout context
   */
  static createConversionContext(
    layoutContext: LayoutContext,
    fontSize: number = UnitConverter.DEFAULT_FONT_SIZE,
    parentFontSize: number = UnitConverter.DEFAULT_FONT_SIZE,
    lineHeight: number = UnitConverter.DEFAULT_LINE_HEIGHT
  ): ConversionContext {
    return {
      ...layoutContext,
      containerWidth: layoutContext.parentWidth,
      containerHeight: layoutContext.parentHeight,
      fontSize,
      parentFontSize,
      lineHeight: lineHeight * fontSize
    };
  }

  /**
   * Check if unit is relative
   */
  isRelativeUnit(value: CSSUnit): boolean {
    const parsed = this.parseUnit(value);
    return parsed.isRelative;
  }

  /**
   * Check if unit requires parent context
   */
  requiresParentContext(value: CSSUnit): boolean {
    const parsed = this.parseUnit(value);
    return parsed.isPercentage || parsed.unit === 'em';
  }

  /**
   * Get unit type for debugging
   */
  getUnitInfo(value: CSSUnit): ParsedUnit {
    return this.parseUnit(value);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.parseCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.parseCache.size,
      keys: Array.from(this.parseCache.keys())
    };
  }
}

// ===== GLOBAL INSTANCE =====

/**
 * Global unit converter instance for performance
 */
export const unitConverter = new UnitConverter();

// ===== UTILITY FUNCTIONS =====

/**
 * Quick conversion function for common use cases
 */
export function convertToPixels(
  value: CSSUnit,
  context: ConversionContext,
  property?: string
): number {
  return unitConverter.toPixels(value, context, property);
}

/**
 * Convert CSS spacing (margin/padding) to pixels
 */
export function convertSpacing(
  value: CSSUnit | { top?: CSSUnit; right?: CSSUnit; bottom?: CSSUnit; left?: CSSUnit },
  context: ConversionContext,
  propertyPrefix = 'margin'
): { top: number; right: number; bottom: number; left: number } {
  return unitConverter.convertBoxModel(value, context, propertyPrefix);
}

/**
 * Parse and validate CSS unit
 */
export function parseUnit(value: CSSUnit): ParsedUnit {
  return unitConverter.parseUnit(value);
}

/**
 * Check if value needs runtime conversion
 */
export function needsConversion(value: CSSUnit): boolean {
  if (typeof value === 'number') return false;
  if (value === 'auto') return true;

  const parsed = unitConverter.parseUnit(value);
  return parsed.isRelative || parsed.unit !== 'px';
}
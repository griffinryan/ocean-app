/**
 * CSS Box Model Implementation for WebGL Text Layout
 * Handles content, padding, border, and margin calculations
 */

import { CSSUnit, CSSLength, ComputedTextStyle } from './TextStyle';
import { unitConverter, ConversionContext, convertSpacing } from './UnitConverter';
import { ElementBounds } from './TextElement';

// ===== BOX MODEL TYPES =====

export interface BoxDimensions {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxModelValues {
  margin: BoxDimensions;
  border: BoxDimensions;
  padding: BoxDimensions;
}

export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaddingBox extends ContentBox {}
export interface BorderBox extends ContentBox {}
export interface MarginBox extends ContentBox {}

export interface BoxModelGeometry {
  content: ContentBox;
  padding: PaddingBox;
  border: BorderBox;
  margin: MarginBox;
  totalWidth: number;
  totalHeight: number;
}

// ===== BOX MODEL CALCULATOR =====

export class BoxModelCalculator {
  /**
   * Calculate complete box model geometry
   */
  calculateBoxModel(
    contentWidth: number,
    contentHeight: number,
    style: ComputedTextStyle,
    context: ConversionContext
  ): BoxModelGeometry {
    // Convert all box model values to pixels
    const margin = this.calculateMargin(style, context);
    const border = this.calculateBorder(style, context);
    const padding = this.calculatePadding(style, context);

    // Calculate boxes from inside out
    const content: ContentBox = {
      x: 0,
      y: 0,
      width: contentWidth,
      height: contentHeight
    };

    const paddingBox: PaddingBox = {
      x: content.x - padding.left,
      y: content.y - padding.top,
      width: content.width + padding.left + padding.right,
      height: content.height + padding.top + padding.bottom
    };

    const borderBox: BorderBox = {
      x: paddingBox.x - border.left,
      y: paddingBox.y - border.top,
      width: paddingBox.width + border.left + border.right,
      height: paddingBox.height + border.top + border.bottom
    };

    const marginBox: MarginBox = {
      x: borderBox.x - margin.left,
      y: borderBox.y - margin.top,
      width: borderBox.width + margin.left + margin.right,
      height: borderBox.height + margin.top + margin.bottom
    };

    return {
      content,
      padding: paddingBox,
      border: borderBox,
      margin: marginBox,
      totalWidth: marginBox.width,
      totalHeight: marginBox.height
    };
  }

  /**
   * Calculate margin dimensions
   */
  private calculateMargin(style: ComputedTextStyle, context: ConversionContext): BoxDimensions {
    return {
      top: style.marginTop,
      right: style.marginRight,
      bottom: style.marginBottom,
      left: style.marginLeft
    };
  }

  /**
   * Calculate border dimensions
   */
  private calculateBorder(style: ComputedTextStyle, context: ConversionContext): BoxDimensions {
    return {
      top: style.borderTopWidth,
      right: style.borderRightWidth,
      bottom: style.borderBottomWidth,
      left: style.borderLeftWidth
    };
  }

  /**
   * Calculate padding dimensions
   */
  private calculatePadding(style: ComputedTextStyle, context: ConversionContext): BoxDimensions {
    return {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft
    };
  }

  /**
   * Calculate available space for content given container constraints
   */
  calculateAvailableSpace(
    containerWidth: number,
    containerHeight: number,
    style: ComputedTextStyle,
    context: ConversionContext
  ): { width: number; height: number } {
    const margin = this.calculateMargin(style, context);
    const border = this.calculateBorder(style, context);
    const padding = this.calculatePadding(style, context);

    const reservedWidth = margin.left + margin.right + border.left + border.right + padding.left + padding.right;
    const reservedHeight = margin.top + margin.bottom + border.top + border.bottom + padding.top + padding.bottom;

    return {
      width: Math.max(0, containerWidth - reservedWidth),
      height: Math.max(0, containerHeight - reservedHeight)
    };
  }

  /**
   * Calculate intrinsic size including box model
   */
  calculateIntrinsicSize(
    contentWidth: number,
    contentHeight: number,
    style: ComputedTextStyle,
    context: ConversionContext
  ): { width: number; height: number } {
    const boxModel = this.calculateBoxModel(contentWidth, contentHeight, style, context);

    // Return border box size (CSS box-sizing: border-box behavior)
    if (style.boxSizing === 'border-box') {
      return {
        width: boxModel.border.width,
        height: boxModel.border.height
      };
    }

    // Default content-box behavior
    return {
      width: boxModel.totalWidth,
      height: boxModel.totalHeight
    };
  }

  /**
   * Resolve auto margins for centering
   */
  resolveAutoMargins(
    elementWidth: number,
    containerWidth: number,
    marginLeft: number,
    marginRight: number
  ): { left: number; right: number } {
    // If both margins are auto, center the element
    if (marginLeft === -1 && marginRight === -1) {
      const remainingSpace = Math.max(0, containerWidth - elementWidth);
      const autoMargin = remainingSpace / 2;
      return { left: autoMargin, right: autoMargin };
    }

    // If only left margin is auto
    if (marginLeft === -1) {
      const remainingSpace = Math.max(0, containerWidth - elementWidth - marginRight);
      return { left: remainingSpace, right: marginRight };
    }

    // If only right margin is auto
    if (marginRight === -1) {
      const remainingSpace = Math.max(0, containerWidth - elementWidth - marginLeft);
      return { left: marginLeft, right: remainingSpace };
    }

    // Neither margin is auto
    return { left: marginLeft, right: marginRight };
  }
}

// ===== BOX MODEL UTILITIES =====

export class BoxModelUtils {
  /**
   * Check if element fits within container
   */
  static fitsInContainer(
    elementBox: BoxModelGeometry,
    containerWidth: number,
    containerHeight: number
  ): boolean {
    return (
      elementBox.totalWidth <= containerWidth &&
      elementBox.totalHeight <= containerHeight
    );
  }

  /**
   * Calculate overflow amounts
   */
  static calculateOverflow(
    elementBox: BoxModelGeometry,
    containerWidth: number,
    containerHeight: number
  ): { width: number; height: number } {
    return {
      width: Math.max(0, elementBox.totalWidth - containerWidth),
      height: Math.max(0, elementBox.totalHeight - containerHeight)
    };
  }

  /**
   * Get content rectangle from element bounds
   */
  static getContentRect(
    bounds: ElementBounds,
    boxModel: BoxModelGeometry
  ): ContentBox {
    return {
      x: bounds.x + boxModel.margin.padding.x - boxModel.content.x,
      y: bounds.y + boxModel.margin.padding.y - boxModel.content.y,
      width: boxModel.content.width,
      height: boxModel.content.height
    };
  }

  /**
   * Check if point is inside element's content area
   */
  static pointInContent(
    x: number,
    y: number,
    bounds: ElementBounds,
    boxModel: BoxModelGeometry
  ): boolean {
    const content = this.getContentRect(bounds, boxModel);
    return (
      x >= content.x &&
      x <= content.x + content.width &&
      y >= content.y &&
      y <= content.y + content.height
    );
  }

  /**
   * Check if point is inside element's padding area
   */
  static pointInPadding(
    x: number,
    y: number,
    bounds: ElementBounds,
    boxModel: BoxModelGeometry
  ): boolean {
    const padding = {
      x: bounds.x + boxModel.margin.border.x - boxModel.padding.x,
      y: bounds.y + boxModel.margin.border.y - boxModel.padding.y,
      width: boxModel.padding.width,
      height: boxModel.padding.height
    };

    return (
      x >= padding.x &&
      x <= padding.x + padding.width &&
      y >= padding.y &&
      y <= padding.y + padding.height
    );
  }

  /**
   * Check if point is inside element's border area
   */
  static pointInBorder(
    x: number,
    y: number,
    bounds: ElementBounds,
    boxModel: BoxModelGeometry
  ): boolean {
    const border = {
      x: bounds.x + boxModel.margin.margin.x - boxModel.border.x,
      y: bounds.y + boxModel.margin.margin.y - boxModel.border.y,
      width: boxModel.border.width,
      height: boxModel.border.height
    };

    return (
      x >= border.x &&
      x <= border.x + border.width &&
      y >= border.y &&
      y <= border.y + border.height
    );
  }

  /**
   * Calculate element's visual bounds (excluding margins)
   */
  static getVisualBounds(
    bounds: ElementBounds,
    boxModel: BoxModelGeometry
  ): ElementBounds {
    return {
      x: bounds.x + boxModel.margin.left,
      y: bounds.y + boxModel.margin.top,
      width: boxModel.border.width,
      height: boxModel.border.height
    };
  }

  /**
   * Calculate spacing between two elements
   */
  static calculateSpacing(
    element1: BoxModelGeometry,
    element2: BoxModelGeometry
  ): { horizontal: number; vertical: number } {
    const horizontalSpacing = Math.abs(
      (element1.margin.x + element1.totalWidth) - element2.margin.x
    );

    const verticalSpacing = Math.abs(
      (element1.margin.y + element1.totalHeight) - element2.margin.y
    );

    return {
      horizontal: horizontalSpacing,
      vertical: verticalSpacing
    };
  }
}

// ===== MARGIN COLLAPSE CALCULATOR =====

export class MarginCollapseCalculator {
  /**
   * Calculate margin collapse between adjacent block elements
   */
  static calculateVerticalMarginCollapse(
    topElementMarginBottom: number,
    bottomElementMarginTop: number
  ): number {
    // Basic margin collapse: use the larger of the two margins
    return Math.max(topElementMarginBottom, bottomElementMarginTop);
  }

  /**
   * Calculate margin collapse for parent-child relationship
   */
  static calculateParentChildMarginCollapse(
    parentMarginTop: number,
    childMarginTop: number,
    hasBorderOrPadding: boolean
  ): number {
    // If parent has border or padding, no collapse occurs
    if (hasBorderOrPadding) {
      return parentMarginTop + childMarginTop;
    }

    // Otherwise, margins collapse
    return Math.max(parentMarginTop, childMarginTop);
  }

  /**
   * Calculate margin collapse for empty elements
   */
  static calculateEmptyElementMarginCollapse(
    marginTop: number,
    marginBottom: number,
    hasBorderOrPadding: boolean,
    hasContent: boolean
  ): number {
    // If element has border, padding, or content, no collapse
    if (hasBorderOrPadding || hasContent) {
      return marginTop + marginBottom;
    }

    // Empty element with no border/padding: margins collapse
    return Math.max(marginTop, marginBottom);
  }
}

// ===== GLOBAL CALCULATOR INSTANCE =====

export const boxModelCalculator = new BoxModelCalculator();

// ===== UTILITY FUNCTIONS =====

/**
 * Quick box model calculation
 */
export function calculateBoxModel(
  contentWidth: number,
  contentHeight: number,
  style: ComputedTextStyle,
  context: ConversionContext
): BoxModelGeometry {
  return boxModelCalculator.calculateBoxModel(contentWidth, contentHeight, style, context);
}

/**
 * Calculate available content space
 */
export function getAvailableSpace(
  containerWidth: number,
  containerHeight: number,
  style: ComputedTextStyle,
  context: ConversionContext
): { width: number; height: number } {
  return boxModelCalculator.calculateAvailableSpace(containerWidth, containerHeight, style, context);
}

/**
 * Calculate element's intrinsic size including box model
 */
export function getIntrinsicSize(
  contentWidth: number,
  contentHeight: number,
  style: ComputedTextStyle,
  context: ConversionContext
): { width: number; height: number } {
  return boxModelCalculator.calculateIntrinsicSize(contentWidth, contentHeight, style, context);
}
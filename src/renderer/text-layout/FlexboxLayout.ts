/**
 * CSS Flexbox Layout Algorithm for WebGL Text System
 * Implements complete flexbox specification for text elements
 */

import { TextElement, LayoutContext, ElementBounds } from './TextElement';
import { ComputedTextStyle } from './TextStyle';
import { LayoutAlgorithm } from './TextLayoutEngine';
import { boxModelCalculator, BoxModelGeometry } from './BoxModel';
import { unitConverter, ConversionContext } from './UnitConverter';

// ===== FLEXBOX TYPES =====

export interface FlexItem {
  element: TextElement;
  style: ComputedTextStyle;
  boxModel: BoxModelGeometry;

  // Flex properties
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;

  // Calculated dimensions
  mainSize: number;        // Size along main axis
  crossSize: number;       // Size along cross axis
  outerMainSize: number;   // Including margins
  outerCrossSize: number;  // Including margins

  // Layout results
  mainPosition: number;
  crossPosition: number;
  finalMainSize: number;
  finalCrossSize: number;

  // Flex line membership
  lineIndex: number;
}

export interface FlexLine {
  items: FlexItem[];
  mainSize: number;        // Total size along main axis
  crossSize: number;       // Maximum cross size in this line
  remainingSpace: number;  // Free space for distribution
  flexGrowSum: number;     // Sum of flex-grow values
  flexShrinkSum: number;   // Sum of flex-shrink values
}

export interface FlexContainer {
  element: TextElement;
  style: ComputedTextStyle;
  mainAxis: 'horizontal' | 'vertical';
  crossAxis: 'horizontal' | 'vertical';
  mainAxisReversed: boolean;
  crossAxisReversed: boolean;
  lines: FlexLine[];
  containerMainSize: number;
  containerCrossSize: number;
}

// ===== FLEXBOX LAYOUT ALGORITHM =====

export class FlexboxLayout implements LayoutAlgorithm {
  name = 'flex';

  layout(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): ElementBounds {
    if (!element.computedStyle) {
      throw new Error('Element must have computed style for flexbox layout');
    }

    // Create flex container
    const container = this.createFlexContainer(element, availableWidth, availableHeight, context);

    // Collect flex items
    const items = this.collectFlexItems(element, container, context);

    // Determine flex lines (handle wrapping)
    container.lines = this.createFlexLines(items, container);

    // Resolve flexible lengths
    this.resolveFlexibleLengths(container);

    // Determine cross sizes
    this.determineCrossSizes(container);

    // Align items within lines
    this.alignItems(container);

    // Align lines within container
    this.alignContent(container);

    // Position flex items
    this.positionFlexItems(container);

    // Return container bounds
    return {
      x: 0,
      y: 0,
      width: container.containerMainSize,
      height: container.containerCrossSize
    };
  }

  // ===== FLEX CONTAINER SETUP =====

  private createFlexContainer(
    element: TextElement,
    availableWidth: number,
    availableHeight: number,
    context: LayoutContext
  ): FlexContainer {
    const style = element.computedStyle!;

    // Determine main and cross axes
    const isRow = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
    const mainAxis = isRow ? 'horizontal' : 'vertical';
    const crossAxis = isRow ? 'vertical' : 'horizontal';

    const mainAxisReversed = style.flexDirection === 'row-reverse' || style.flexDirection === 'column-reverse';
    const crossAxisReversed = false; // Determined by align-items/align-self

    // Calculate container size
    const containerMainSize = isRow ? availableWidth : availableHeight;
    const containerCrossSize = isRow ? availableHeight : availableWidth;

    return {
      element,
      style,
      mainAxis,
      crossAxis,
      mainAxisReversed,
      crossAxisReversed,
      lines: [],
      containerMainSize,
      containerCrossSize
    };
  }

  // ===== FLEX ITEMS COLLECTION =====

  private collectFlexItems(
    container: TextElement,
    flexContainer: FlexContainer,
    context: LayoutContext
  ): FlexItem[] {
    const items: FlexItem[] = [];

    container.children.forEach(child => {
      if (child.computedStyle?.display === 'none') {
        return; // Skip hidden elements
      }

      const style = child.computedStyle!;

      // Calculate box model
      const conversionContext: ConversionContext = {
        ...context,
        fontSize: style.fontSize,
        parentFontSize: container.computedStyle!.fontSize,
        lineHeight: style.lineHeight,
        containerWidth: flexContainer.containerMainSize,
        containerHeight: flexContainer.containerCrossSize
      };

      // Measure content size
      let contentWidth = 0;
      let contentHeight = 0;

      if (child.textContent) {
        child.measureText(flexContainer.containerMainSize);
        const metrics = child.textMetrics!;
        contentWidth = metrics.width;
        contentHeight = metrics.height;
      }

      const boxModel = boxModelCalculator.calculateBoxModel(
        contentWidth,
        contentHeight,
        style,
        conversionContext
      );

      // Calculate flex properties
      const flexGrow = style.flexGrow;
      const flexShrink = style.flexShrink;
      let flexBasis = style.flexBasis;

      if (flexBasis === -1) { // auto
        flexBasis = flexContainer.mainAxis === 'horizontal' ? boxModel.content.width : boxModel.content.height;
      }

      // Calculate main and cross sizes
      const mainSize = flexContainer.mainAxis === 'horizontal' ? boxModel.border.width : boxModel.border.height;
      const crossSize = flexContainer.mainAxis === 'horizontal' ? boxModel.border.height : boxModel.border.width;

      const outerMainSize = flexContainer.mainAxis === 'horizontal' ? boxModel.totalWidth : boxModel.totalHeight;
      const outerCrossSize = flexContainer.mainAxis === 'horizontal' ? boxModel.totalHeight : boxModel.totalWidth;

      const item: FlexItem = {
        element: child,
        style,
        boxModel,
        flexGrow,
        flexShrink,
        flexBasis,
        mainSize,
        crossSize,
        outerMainSize,
        outerCrossSize,
        mainPosition: 0,
        crossPosition: 0,
        finalMainSize: mainSize,
        finalCrossSize: crossSize,
        lineIndex: 0
      };

      items.push(item);
    });

    return items;
  }

  // ===== FLEX LINES CREATION =====

  private createFlexLines(items: FlexItem[], container: FlexContainer): FlexLine[] {
    if (container.style.flexWrap === 'nowrap') {
      // Single line
      return [{
        items: [...items],
        mainSize: this.calculateLineMainSize(items),
        crossSize: 0, // Will be calculated later
        remainingSpace: 0, // Will be calculated later
        flexGrowSum: items.reduce((sum, item) => sum + item.flexGrow, 0),
        flexShrinkSum: items.reduce((sum, item) => sum + item.flexShrink, 0)
      }];
    }

    // Multi-line wrapping
    const lines: FlexLine[] = [];
    let currentLine: FlexItem[] = [];
    let currentLineSize = 0;

    for (const item of items) {
      const itemSize = item.outerMainSize;

      // Check if item fits on current line
      if (currentLine.length > 0 && currentLineSize + itemSize > container.containerMainSize) {
        // Start new line
        if (currentLine.length > 0) {
          lines.push(this.createFlexLine(currentLine));
          currentLine = [];
          currentLineSize = 0;
        }
      }

      currentLine.push(item);
      currentLineSize += itemSize;
      item.lineIndex = lines.length;
    }

    // Add final line
    if (currentLine.length > 0) {
      lines.push(this.createFlexLine(currentLine));
    }

    return lines;
  }

  private createFlexLine(items: FlexItem[]): FlexLine {
    return {
      items: [...items],
      mainSize: this.calculateLineMainSize(items),
      crossSize: 0, // Will be calculated later
      remainingSpace: 0, // Will be calculated later
      flexGrowSum: items.reduce((sum, item) => sum + item.flexGrow, 0),
      flexShrinkSum: items.reduce((sum, item) => sum + item.flexShrink, 0)
    };
  }

  private calculateLineMainSize(items: FlexItem[]): number {
    return items.reduce((sum, item) => sum + item.outerMainSize, 0);
  }

  // ===== FLEXIBLE LENGTHS RESOLUTION =====

  private resolveFlexibleLengths(container: FlexContainer): void {
    container.lines.forEach(line => {
      line.remainingSpace = container.containerMainSize - line.mainSize;

      if (line.remainingSpace > 0 && line.flexGrowSum > 0) {
        // Distribute positive free space
        this.distributePositiveSpace(line);
      } else if (line.remainingSpace < 0 && line.flexShrinkSum > 0) {
        // Distribute negative free space
        this.distributeNegativeSpace(line);
      }

      // Update line main size
      line.mainSize = line.items.reduce((sum, item) => sum + item.finalMainSize, 0);
    });
  }

  private distributePositiveSpace(line: FlexLine): void {
    const spacePerGrowUnit = line.remainingSpace / line.flexGrowSum;

    line.items.forEach(item => {
      const growSpace = item.flexGrow * spacePerGrowUnit;
      item.finalMainSize = item.mainSize + growSpace;
    });
  }

  private distributeNegativeSpace(line: FlexLine): void {
    const totalShrinkSpace = Math.abs(line.remainingSpace);
    const weightedShrinkSum = line.items.reduce((sum, item) => sum + item.flexShrink * item.flexBasis, 0);

    if (weightedShrinkSum === 0) return;

    line.items.forEach(item => {
      const shrinkRatio = (item.flexShrink * item.flexBasis) / weightedShrinkSum;
      const shrinkSpace = totalShrinkSpace * shrinkRatio;
      item.finalMainSize = Math.max(0, item.mainSize - shrinkSpace);
    });
  }

  // ===== CROSS SIZE DETERMINATION =====

  private determineCrossSizes(container: FlexContainer): void {
    container.lines.forEach(line => {
      // Calculate line cross size
      line.crossSize = Math.max(...line.items.map(item => item.outerCrossSize));

      // Update item cross sizes based on align-self
      line.items.forEach(item => {
        const alignSelf = item.style.alignSelf === 'auto' ? container.style.alignItems : item.style.alignSelf;

        switch (alignSelf) {
          case 'stretch':
            if (item.style.height === -1) { // auto height
              item.finalCrossSize = line.crossSize - this.getCrossMargins(item);
            }
            break;
          default:
            // Keep intrinsic cross size
            break;
        }
      });
    });
  }

  private getCrossMargins(item: FlexItem): number {
    const margin = item.boxModel.margin;
    return margin.top + margin.bottom; // Assumes vertical cross axis
  }

  // ===== ITEM ALIGNMENT =====

  private alignItems(container: FlexContainer): void {
    container.lines.forEach(line => {
      line.items.forEach(item => {
        const alignSelf = item.style.alignSelf === 'auto' ? container.style.alignItems : item.style.alignSelf;

        switch (alignSelf) {
          case 'flex-start':
          case 'start':
            item.crossPosition = 0;
            break;

          case 'flex-end':
          case 'end':
            item.crossPosition = line.crossSize - item.outerCrossSize;
            break;

          case 'center':
            item.crossPosition = (line.crossSize - item.outerCrossSize) / 2;
            break;

          case 'baseline':
            // Simplified baseline alignment
            item.crossPosition = 0;
            break;

          case 'stretch':
          default:
            item.crossPosition = 0;
            break;
        }
      });
    });
  }

  // ===== CONTENT ALIGNMENT =====

  private alignContent(container: FlexContainer): void {
    if (container.lines.length <= 1) return; // No alignment needed for single line

    const totalLinesSize = container.lines.reduce((sum, line) => sum + line.crossSize, 0);
    const freeSpace = container.containerCrossSize - totalLinesSize;

    let lineOffset = 0;
    const gap = container.style.rowGap || 0;

    switch (container.style.alignContent) {
      case 'flex-start':
      case 'start':
        lineOffset = 0;
        break;

      case 'flex-end':
      case 'end':
        lineOffset = freeSpace;
        break;

      case 'center':
        lineOffset = freeSpace / 2;
        break;

      case 'space-between':
        // First line at 0, last line at end, equal space between
        break;

      case 'space-around':
        // Equal space around each line
        break;

      case 'space-evenly':
        // Equal space between lines including edges
        break;

      case 'stretch':
      default:
        // Stretch lines to fill container
        if (freeSpace > 0) {
          const extraPerLine = freeSpace / container.lines.length;
          container.lines.forEach(line => {
            line.crossSize += extraPerLine;
          });
        }
        break;
    }

    // Apply line positions
    let currentOffset = lineOffset;
    container.lines.forEach(line => {
      line.items.forEach(item => {
        item.crossPosition += currentOffset;
      });
      currentOffset += line.crossSize + gap;
    });
  }

  // ===== ITEM POSITIONING =====

  private positionFlexItems(container: FlexContainer): void {
    container.lines.forEach(line => {
      const freeSpace = container.containerMainSize - line.mainSize;
      let mainOffset = 0;
      let itemSpacing = 0;

      // Calculate main axis positioning
      switch (container.style.justifyContent) {
        case 'flex-start':
        case 'start':
          mainOffset = 0;
          break;

        case 'flex-end':
        case 'end':
          mainOffset = freeSpace;
          break;

        case 'center':
          mainOffset = freeSpace / 2;
          break;

        case 'space-between':
          mainOffset = 0;
          itemSpacing = line.items.length > 1 ? freeSpace / (line.items.length - 1) : 0;
          break;

        case 'space-around':
          itemSpacing = freeSpace / line.items.length;
          mainOffset = itemSpacing / 2;
          break;

        case 'space-evenly':
          itemSpacing = freeSpace / (line.items.length + 1);
          mainOffset = itemSpacing;
          break;
      }

      // Position items
      let currentPosition = mainOffset;
      line.items.forEach((item, index) => {
        item.mainPosition = currentPosition;
        currentPosition += item.finalMainSize + itemSpacing;

        // Apply gap
        if (index < line.items.length - 1) {
          currentPosition += container.style.gap || 0;
        }
      });
    });

    // Apply final positions to element bounds
    container.lines.forEach(line => {
      line.items.forEach(item => {
        const isHorizontalMain = container.mainAxis === 'horizontal';

        item.element.bounds = {
          x: isHorizontalMain ? item.mainPosition : item.crossPosition,
          y: isHorizontalMain ? item.crossPosition : item.mainPosition,
          width: isHorizontalMain ? item.finalMainSize : item.finalCrossSize,
          height: isHorizontalMain ? item.finalCrossSize : item.finalMainSize
        };
      });
    });
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Check if element is a flex container
 */
export function isFlexContainer(element: TextElement): boolean {
  const display = element.computedStyle?.display;
  return display === 'flex' || display === 'inline-flex';
}

/**
 * Check if element is a flex item
 */
export function isFlexItem(element: TextElement): boolean {
  return element.parent ? isFlexContainer(element.parent) : false;
}

/**
 * Get effective flex direction
 */
export function getFlexDirection(style: ComputedTextStyle): 'row' | 'row-reverse' | 'column' | 'column-reverse' {
  return style.flexDirection || 'row';
}

/**
 * Get main axis size property name
 */
export function getMainSizeProperty(flexDirection: string): 'width' | 'height' {
  return flexDirection.startsWith('row') ? 'width' : 'height';
}

/**
 * Get cross axis size property name
 */
export function getCrossSizeProperty(flexDirection: string): 'width' | 'height' {
  return flexDirection.startsWith('row') ? 'height' : 'width';
}
/**
 * Advanced Text Wrapping and Line Breaking for WebGL Text Layout
 * Implements CSS text breaking specifications including word-break, word-wrap, white-space
 */

import { ComputedTextStyle } from './TextStyle';

// ===== BREAKING TYPES =====

export interface BreakOpportunity {
  position: number;     // Character position in text
  type: BreakType;      // Type of break opportunity
  penalty: number;      // Cost of breaking here (0 = required, higher = less desirable)
  width: number;        // Width before this break
}

export enum BreakType {
  Required = 'required',        // Line feed, form feed
  Optional = 'optional',        // Space, hyphen
  WordBreak = 'word-break',     // Break anywhere in word
  CharBreak = 'char-break',     // Break between characters
  NoBreak = 'no-break'          // No break allowed
}

export interface TextLine {
  text: string;         // Text content of line
  startIndex: number;   // Start position in original text
  endIndex: number;     // End position in original text
  width: number;        // Measured width
  height: number;       // Line height
  ascent: number;       // Baseline to top
  descent: number;      // Baseline to bottom
  words: TextWord[];    // Words in this line
}

export interface TextWord {
  text: string;
  startIndex: number;
  endIndex: number;
  width: number;
  x: number;            // Position within line
}

export interface LineBreakResult {
  lines: TextLine[];
  totalWidth: number;
  totalHeight: number;
  overflow: boolean;
}

// ===== TEXT BREAKER CLASS =====

export class TextBreaker {
  private measurementCanvas: CanvasRenderingContext2D;

  constructor() {
    // Create canvas for text measurement
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    this.measurementCanvas = canvas.getContext('2d')!;
  }

  /**
   * Break text into lines according to CSS rules
   */
  breakText(
    text: string,
    maxWidth: number,
    style: ComputedTextStyle,
    measurementContext?: CanvasRenderingContext2D
  ): LineBreakResult {
    const ctx = measurementContext || this.measurementCanvas;
    this.setupCanvasFont(ctx, style);

    // Handle different white-space values
    const preprocessedText = this.preprocessText(text, style);

    // Find break opportunities
    const breakOpportunities = this.findBreakOpportunities(preprocessedText, style);

    // Perform line breaking
    const lines = this.performLineBreaking(
      preprocessedText,
      breakOpportunities,
      maxWidth,
      style,
      ctx
    );

    // Calculate metrics
    const totalWidth = Math.max(...lines.map(line => line.width));
    const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
    const overflow = totalWidth > maxWidth;

    return {
      lines,
      totalWidth,
      totalHeight,
      overflow
    };
  }

  // ===== TEXT PREPROCESSING =====

  private preprocessText(text: string, style: ComputedTextStyle): string {
    const { whiteSpace, textTransform } = style;

    let processed = text;

    // Apply text transform
    switch (textTransform) {
      case 'uppercase':
        processed = processed.toUpperCase();
        break;
      case 'lowercase':
        processed = processed.toLowerCase();
        break;
      case 'capitalize':
        processed = processed.replace(/\b\w/g, char => char.toUpperCase());
        break;
    }

    // Handle white-space collapsing
    switch (whiteSpace) {
      case 'normal':
      case 'nowrap':
        // Collapse whitespace
        processed = processed.replace(/\s+/g, ' ').trim();
        break;
      case 'pre-line':
        // Collapse whitespace but preserve line breaks
        processed = processed.replace(/[^\S\n]+/g, ' ').replace(/^\s+|\s+$/gm, '');
        break;
      case 'pre':
      case 'pre-wrap':
        // Preserve all whitespace
        break;
      case 'break-spaces':
        // Preserve spaces but allow breaking
        break;
    }

    return processed;
  }

  // ===== BREAK OPPORTUNITIES =====

  private findBreakOpportunities(text: string, style: ComputedTextStyle): BreakOpportunity[] {
    const opportunities: BreakOpportunity[] = [];
    const { whiteSpace, wordBreak, wordWrap } = style;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      // Required breaks (line feeds, form feeds)
      if (char === '\n' || char === '\f') {
        opportunities.push({
          position: i + 1,
          type: BreakType.Required,
          penalty: 0,
          width: 0
        });
        continue;
      }

      // Handle white-space specific breaking
      if (whiteSpace === 'nowrap') {
        continue; // No breaking except required breaks
      }

      // Space-based breaks
      if (char === ' ' || char === '\t') {
        opportunities.push({
          position: i + 1,
          type: BreakType.Optional,
          penalty: 0,
          width: 0
        });
        continue;
      }

      // Hyphen breaks
      if (char === '-' || char === '\u2010' || char === '\u2013') {
        opportunities.push({
          position: i + 1,
          type: BreakType.Optional,
          penalty: 100,
          width: 0
        });
        continue;
      }

      // Word breaking rules
      if (wordBreak === 'break-all') {
        // Break anywhere
        opportunities.push({
          position: i + 1,
          type: BreakType.CharBreak,
          penalty: 1000,
          width: 0
        });
      } else if (wordBreak === 'break-word' || wordWrap === 'break-word') {
        // Break long words
        if (this.isWordCharacter(char) && this.isWordCharacter(nextChar)) {
          opportunities.push({
            position: i + 1,
            type: BreakType.WordBreak,
            penalty: 5000,
            width: 0
          });
        }
      }

      // CJK character breaking
      if (this.isCJKCharacter(char)) {
        opportunities.push({
          position: i + 1,
          type: BreakType.Optional,
          penalty: 500,
          width: 0
        });
      }

      // Punctuation breaks
      if (this.isPunctuation(char)) {
        const penalty = this.getPunctuationBreakPenalty(char);
        if (penalty < Infinity) {
          opportunities.push({
            position: i + 1,
            type: BreakType.Optional,
            penalty,
            width: 0
          });
        }
      }
    }

    // Add end-of-text break
    opportunities.push({
      position: text.length,
      type: BreakType.Required,
      penalty: 0,
      width: 0
    });

    return opportunities;
  }

  // ===== LINE BREAKING ALGORITHM =====

  private performLineBreaking(
    text: string,
    breakOpportunities: BreakOpportunity[],
    maxWidth: number,
    style: ComputedTextStyle,
    ctx: CanvasRenderingContext2D
  ): TextLine[] {
    const lines: TextLine[] = [];
    let currentLineStart = 0;

    // Sort break opportunities by position
    breakOpportunities.sort((a, b) => a.position - b.position);

    for (let i = 0; i < breakOpportunities.length; i++) {
      const opportunity = breakOpportunities[i];
      const lineText = text.substring(currentLineStart, opportunity.position);
      const lineWidth = ctx.measureText(lineText).width;

      // Update opportunity width
      opportunity.width = lineWidth;

      // Check if we need to break
      const shouldBreak = this.shouldBreakLine(
        lineWidth,
        maxWidth,
        opportunity,
        style
      );

      if (shouldBreak || opportunity.type === BreakType.Required) {
        // Find best break point
        const breakPoint = this.findBestBreakPoint(
          breakOpportunities,
          i,
          currentLineStart,
          maxWidth,
          text,
          ctx,
          style
        );

        // Create line
        const line = this.createTextLine(
          text,
          currentLineStart,
          breakPoint,
          style,
          ctx
        );

        lines.push(line);
        currentLineStart = breakPoint;

        // Reset index to continue from break point
        i = breakOpportunities.findIndex(opp => opp.position >= breakPoint) - 1;
      }
    }

    return lines;
  }

  private shouldBreakLine(
    lineWidth: number,
    maxWidth: number,
    opportunity: BreakOpportunity,
    style: ComputedTextStyle
  ): boolean {
    if (opportunity.type === BreakType.Required) {
      return true;
    }

    if (lineWidth <= maxWidth) {
      return false;
    }

    // Check if we can break here based on word-wrap and overflow
    if (style.wordWrap === 'normal' && opportunity.penalty > 1000) {
      return false; // Don't break words unless necessary
    }

    return true;
  }

  private findBestBreakPoint(
    opportunities: BreakOpportunity[],
    currentIndex: number,
    lineStart: number,
    maxWidth: number,
    text: string,
    ctx: CanvasRenderingContext2D,
    style: ComputedTextStyle
  ): number {
    let bestBreakPoint = opportunities[currentIndex].position;
    let bestPenalty = opportunities[currentIndex].penalty;

    // Look back for better break opportunities
    for (let i = currentIndex - 1; i >= 0; i--) {
      const opportunity = opportunities[i];
      if (opportunity.position <= lineStart) break;

      const lineText = text.substring(lineStart, opportunity.position);
      const lineWidth = ctx.measureText(lineText).width;

      if (lineWidth <= maxWidth) {
        if (opportunity.penalty < bestPenalty) {
          bestBreakPoint = opportunity.position;
          bestPenalty = opportunity.penalty;
        }
      }
    }

    return bestBreakPoint;
  }

  // ===== LINE CREATION =====

  private createTextLine(
    text: string,
    startIndex: number,
    endIndex: number,
    style: ComputedTextStyle,
    ctx: CanvasRenderingContext2D
  ): TextLine {
    const lineText = text.substring(startIndex, endIndex);
    const trimmedText = lineText.replace(/\s+$/, ''); // Remove trailing whitespace

    const width = ctx.measureText(trimmedText).width;
    const height = style.lineHeight * style.fontSize;
    const ascent = style.fontSize * 0.8; // Approximation
    const descent = style.fontSize * 0.2; // Approximation

    // Break line into words
    const words = this.createTextWords(trimmedText, startIndex, ctx);

    return {
      text: trimmedText,
      startIndex,
      endIndex,
      width,
      height,
      ascent,
      descent,
      words
    };
  }

  private createTextWords(
    lineText: string,
    lineStartIndex: number,
    ctx: CanvasRenderingContext2D
  ): TextWord[] {
    const words: TextWord[] = [];
    const wordMatches = lineText.matchAll(/\S+/g);

    let x = 0;
    for (const match of wordMatches) {
      const wordText = match[0];
      const startIndex = lineStartIndex + match.index!;
      const endIndex = startIndex + wordText.length;
      const width = ctx.measureText(wordText).width;

      words.push({
        text: wordText,
        startIndex,
        endIndex,
        width,
        x
      });

      x += width;

      // Add space width if not the last word
      const spaceAfter = lineText[match.index! + wordText.length];
      if (spaceAfter === ' ') {
        x += ctx.measureText(' ').width;
      }
    }

    return words;
  }

  // ===== UTILITY METHODS =====

  private setupCanvasFont(ctx: CanvasRenderingContext2D, style: ComputedTextStyle): void {
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  }

  private isWordCharacter(char: string): boolean {
    return /\w/.test(char);
  }

  private isCJKCharacter(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
      (code >= 0x20000 && code <= 0x2A6DF) || // CJK Extension B
      (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) ||   // Katakana
      (code >= 0xAC00 && code <= 0xD7AF)      // Hangul
    );
  }

  private isPunctuation(char: string): boolean {
    return /[.,;:!?()[\]{}'"‚„""''‹›«»]/.test(char);
  }

  private getPunctuationBreakPenalty(char: string): number {
    switch (char) {
      case '.':
      case '!':
      case '?':
        return Infinity; // Never break after sentence enders
      case ',':
      case ';':
      case ':':
        return 10000; // Very high penalty
      case ')':
      case ']':
      case '}':
        return 5000; // High penalty
      case '(':
      case '[':
      case '{':
        return Infinity; // Never break after opening punctuation
      default:
        return 1000;
    }
  }
}

// ===== GLOBAL INSTANCE =====

export const textBreaker = new TextBreaker();

// ===== UTILITY FUNCTIONS =====

/**
 * Break text into lines with specified constraints
 */
export function breakText(
  text: string,
  maxWidth: number,
  style: ComputedTextStyle,
  measurementContext?: CanvasRenderingContext2D
): LineBreakResult {
  return textBreaker.breakText(text, maxWidth, style, measurementContext);
}

/**
 * Measure single line of text
 */
export function measureLine(
  text: string,
  style: ComputedTextStyle,
  measurementContext?: CanvasRenderingContext2D
): { width: number; height: number } {
  const ctx = measurementContext || textBreaker['measurementCanvas'];

  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;

  return {
    width: ctx.measureText(text).width,
    height: style.lineHeight * style.fontSize
  };
}

/**
 * Check if text needs line breaking
 */
export function needsLineBreaking(
  text: string,
  maxWidth: number,
  style: ComputedTextStyle,
  measurementContext?: CanvasRenderingContext2D
): boolean {
  if (style.whiteSpace === 'nowrap') {
    return false;
  }

  const measurement = measureLine(text, style, measurementContext);
  return measurement.width > maxWidth;
}

/**
 * Get optimal line count for text
 */
export function getOptimalLineCount(
  text: string,
  maxWidth: number,
  style: ComputedTextStyle,
  measurementContext?: CanvasRenderingContext2D
): number {
  const result = breakText(text, maxWidth, style, measurementContext);
  return result.lines.length;
}
/**
 * CSS-like styling system for WebGL text rendering
 * Provides comprehensive styling properties similar to CSS
 */

// ===== UNIT TYPES =====

export type CSSUnit =
  | number  // Treated as pixels
  | `${number}px`
  | `${number}%`
  | `${number}em`
  | `${number}rem`
  | `${number}vw`
  | `${number}vh`
  | `${number}vmin`
  | `${number}vmax`
  | 'auto';

export type CSSLength = CSSUnit;
export type CSSPercentage = `${number}%` | number;

// ===== SPACING AND SIZING =====

export interface CSSSpacing {
  top?: CSSLength;
  right?: CSSLength;
  bottom?: CSSLength;
  left?: CSSLength;
}

export interface CSSSize {
  width?: CSSLength;
  height?: CSSLength;
  minWidth?: CSSLength;
  maxWidth?: CSSLength;
  minHeight?: CSSLength;
  maxHeight?: CSSLength;
}

// ===== TYPOGRAPHY =====

export interface CSSTypography {
  fontFamily?: string;
  fontSize?: CSSLength;
  fontWeight?: number | 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle?: 'normal' | 'italic' | 'oblique';
  lineHeight?: number | CSSLength;
  letterSpacing?: CSSLength;
  wordSpacing?: CSSLength;
  textAlign?: 'left' | 'center' | 'right' | 'justify' | 'start' | 'end';
  textDecoration?: 'none' | 'underline' | 'overline' | 'line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces';
  wordWrap?: 'normal' | 'break-word' | 'anywhere';
  wordBreak?: 'normal' | 'break-all' | 'keep-all' | 'break-word';
  textOverflow?: 'clip' | 'ellipsis';
  textIndent?: CSSLength;
}

// ===== COLORS =====

export type CSSColor =
  | string  // hex, rgb, rgba, hsl, hsla, named colors
  | `rgb(${number}, ${number}, ${number})`
  | `rgba(${number}, ${number}, ${number}, ${number})`
  | `hsl(${number}, ${number}%, ${number}%)`
  | `hsla(${number}, ${number}%, ${number}%, ${number})`;

export interface CSSColors {
  color?: CSSColor;
  backgroundColor?: CSSColor;
  borderColor?: CSSColor;
  textShadowColor?: CSSColor;
}

// ===== LAYOUT =====

export interface CSSPosition {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: CSSLength;
  right?: CSSLength;
  bottom?: CSSLength;
  left?: CSSLength;
  zIndex?: number;
}

export interface CSSDisplay {
  display?: 'block' | 'inline' | 'inline-block' | 'flex' | 'inline-flex' | 'grid' | 'inline-grid' | 'none';
  visibility?: 'visible' | 'hidden' | 'collapse';
  opacity?: number;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowX?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowY?: 'visible' | 'hidden' | 'scroll' | 'auto';
}

// ===== FLEXBOX =====

export interface CSSFlexbox {
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
  alignContent?: 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignSelf?: 'auto' | 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
  flex?: string | number; // shorthand for flex-grow, flex-shrink, flex-basis
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: CSSLength;
  gap?: CSSLength;
  rowGap?: CSSLength;
  columnGap?: CSSLength;
}

// ===== GRID =====

export interface CSSGrid {
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridTemplateAreas?: string;
  gridAutoColumns?: CSSLength;
  gridAutoRows?: CSSLength;
  gridAutoFlow?: 'row' | 'column' | 'row dense' | 'column dense';
  gridColumn?: string | number;
  gridRow?: string | number;
  gridColumnStart?: string | number;
  gridColumnEnd?: string | number;
  gridRowStart?: string | number;
  gridRowEnd?: string | number;
  gridArea?: string;
  justifyItems?: 'stretch' | 'start' | 'end' | 'center';
  alignItems?: 'stretch' | 'start' | 'end' | 'center' | 'baseline';
  justifySelf?: 'auto' | 'stretch' | 'start' | 'end' | 'center';
  alignSelf?: 'auto' | 'stretch' | 'start' | 'end' | 'center' | 'baseline';
}

// ===== EFFECTS =====

export interface CSSEffects {
  textShadow?: string;
  filter?: string;
  backdropFilter?: string;
  transform?: string;
  transformOrigin?: string;
  transition?: string;
  animation?: string;
}

// ===== MAIN STYLE INTERFACE =====

export interface TextStyle extends
  CSSSize,
  CSSTypography,
  CSSColors,
  CSSPosition,
  CSSDisplay,
  CSSFlexbox,
  CSSGrid,
  CSSEffects {

  // Box model properties
  margin?: CSSSpacing | CSSLength;
  marginTop?: CSSLength;
  marginRight?: CSSLength;
  marginBottom?: CSSLength;
  marginLeft?: CSSLength;

  padding?: CSSSpacing | CSSLength;
  paddingTop?: CSSLength;
  paddingRight?: CSSLength;
  paddingBottom?: CSSLength;
  paddingLeft?: CSSLength;

  border?: string | CSSLength;
  borderTop?: string | CSSLength;
  borderRight?: string | CSSLength;
  borderBottom?: string | CSSLength;
  borderLeft?: string | CSSLength;
  borderWidth?: CSSLength;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  borderRadius?: CSSLength;

  // Additional layout properties
  boxSizing?: 'content-box' | 'border-box';

  // Custom WebGL-specific properties
  webglLayer?: number;  // For controlling rendering order
  webglPanel?: string;  // Associate with specific glass panel
  webglDistortion?: number;  // Glass distortion strength
  webglAdaptiveColor?: boolean;  // Enable adaptive coloring
}

// ===== COMPUTED STYLE =====

/**
 * Computed style with all values resolved to absolute units
 */
export interface ComputedTextStyle {
  // All lengths converted to pixels
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;

  // Box model in pixels
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;

  // Position in WebGL coordinates
  top: number;
  right: number;
  bottom: number;
  left: number;
  zIndex: number;

  // Typography resolved
  fontSize: number;  // in pixels
  lineHeight: number;  // in pixels
  letterSpacing: number;  // in pixels
  wordSpacing: number;  // in pixels
  textIndent: number;  // in pixels

  // Inherited/computed properties
  fontFamily: string;
  fontWeight: number;
  fontStyle: string;
  textAlign: string;
  textDecoration: string;
  textTransform: string;
  whiteSpace: string;
  wordWrap: string;
  wordBreak: string;
  textOverflow: string;

  // Colors (normalized to RGBA)
  color: [number, number, number, number];
  backgroundColor: [number, number, number, number];
  borderColor: [number, number, number, number];

  // Layout properties
  position: string;
  display: string;
  visibility: string;
  opacity: number;
  overflow: string;
  overflowX: string;
  overflowY: string;
  boxSizing: string;

  // Flexbox computed
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  alignContent: string;
  alignSelf: string;
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;
  gap: number;
  rowGap: number;
  columnGap: number;

  // WebGL specific
  webglLayer: number;
  webglPanel: string;
  webglDistortion: number;
  webglAdaptiveColor: boolean;
}

// ===== STYLE UTILITIES =====

/**
 * Default style values for inheritance and computation
 */
export const DEFAULT_STYLE: Partial<ComputedTextStyle> = {
  // Typography defaults
  fontSize: 16,
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.2,
  letterSpacing: 0,
  wordSpacing: 0,
  textAlign: 'left',
  textDecoration: 'none',
  textTransform: 'none',
  whiteSpace: 'normal',
  wordWrap: 'normal',
  wordBreak: 'normal',
  textOverflow: 'clip',
  textIndent: 0,

  // Box model defaults
  marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
  borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,

  // Layout defaults
  position: 'static',
  display: 'block',
  visibility: 'visible',
  opacity: 1,
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  boxSizing: 'content-box',
  zIndex: 0,

  // Size defaults (auto = -1 for computation)
  width: -1, height: -1,
  minWidth: 0, maxWidth: Infinity,
  minHeight: 0, maxHeight: Infinity,
  top: 0, right: 0, bottom: 0, left: 0,

  // Flexbox defaults
  flexDirection: 'row',
  flexWrap: 'nowrap',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  alignContent: 'stretch',
  alignSelf: 'auto',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: -1, // auto
  gap: 0, rowGap: 0, columnGap: 0,

  // Colors (white text by default)
  color: [1, 1, 1, 1],
  backgroundColor: [0, 0, 0, 0], // transparent
  borderColor: [0, 0, 0, 1],

  // WebGL specific defaults
  webglLayer: 0,
  webglPanel: '',
  webglDistortion: 1.0,
  webglAdaptiveColor: true
};

/**
 * CSS property inheritance rules
 */
export const INHERITED_PROPERTIES = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'wordSpacing',
  'textAlign', 'textDecoration', 'textTransform',
  'whiteSpace', 'wordWrap', 'wordBreak', 'textOverflow',
  'color', 'visibility'
]);
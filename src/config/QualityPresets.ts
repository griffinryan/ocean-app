/**
 * Quality Presets Configuration
 * Defines resolution scaling and feature settings for different performance tiers
 */

export interface QualitySettings {
  // Resolution scale factors (0.0 - 1.0)
  oceanBaseResolution: number;      // Base ocean render resolution
  oceanCaptureResolution: number;   // Ocean captures for glass/text
  wakeResolution: number;           // Wake texture resolution (independent scaling)
  glassResolution: number;          // Glass distortion resolution
  textCanvasResolution: number;     // Canvas2D text resolution (fixed pixels)
  blurMapResolution: number;        // Blur map distance field resolution
  finalPassResolution: number;      // Final composite resolution

  // Feature quality settings
  oceanWaveCount: number;           // Number of sine waves (2-8)
  fbmOctaves: number;              // Noise octaves (1-3)
  causticLayers: number;           // Caustic layers (0-2)
  wakeWaveComponents: number;      // Wake wave components per arm (1-2)
  glassDistortionQuality: number;  // Glass distortion detail (0.5-1.0)

  // Effect toggles
  enableCaustics: boolean;
  enableGlassDistortion: boolean;
  enableBlurMap: boolean;
  enableWaveReactivity: boolean;

  // Upscaling settings
  upscaleSharpness: number;        // Sharpening strength (0.0-1.0)
  upscaleMethod: 'bilinear' | 'bicubic' | 'fsr' | 'lanczos';
}

export type QualityPreset = 'ultra' | 'high' | 'medium' | 'low' | 'potato' | 'custom';

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  // Ultra: Maximum quality, no compromises
  ultra: {
    oceanBaseResolution: 1.0,
    oceanCaptureResolution: 1.0,
    wakeResolution: 0.75, // High quality wakes with slight performance optimization
    glassResolution: 1.0,
    textCanvasResolution: 2160, // 4K text
    blurMapResolution: 0.5,
    finalPassResolution: 1.0,

    oceanWaveCount: 8,
    fbmOctaves: 3,
    causticLayers: 2,
    wakeWaveComponents: 2,
    glassDistortionQuality: 1.0,

    enableCaustics: true,
    enableGlassDistortion: true,
    enableBlurMap: true,
    enableWaveReactivity: true,

    upscaleSharpness: 0.0,
    upscaleMethod: 'bilinear'
  },

  // High: Balanced quality with good performance
  high: {
    oceanBaseResolution: 0.75,
    oceanCaptureResolution: 0.5,
    wakeResolution: 0.5, // 50% wake resolution, upscaled with FSR
    glassResolution: 0.75,
    textCanvasResolution: 1920, // Fixed 1080p text
    blurMapResolution: 0.33,
    finalPassResolution: 0.75,

    oceanWaveCount: 8,
    fbmOctaves: 3,
    causticLayers: 2,
    wakeWaveComponents: 2,
    glassDistortionQuality: 0.85,

    enableCaustics: true,
    enableGlassDistortion: true,
    enableBlurMap: true,
    enableWaveReactivity: true,

    upscaleSharpness: 0.3,
    upscaleMethod: 'fsr'
  },

  // Medium: Optimized for smooth 60fps on mid-range hardware
  medium: {
    oceanBaseResolution: 0.5,
    oceanCaptureResolution: 0.33,
    wakeResolution: 0.4, // 40% wake resolution for performance
    glassResolution: 0.5,
    textCanvasResolution: 1920,
    blurMapResolution: 0.25,
    finalPassResolution: 0.66,

    oceanWaveCount: 6,
    fbmOctaves: 2,
    causticLayers: 1,
    wakeWaveComponents: 1,
    glassDistortionQuality: 0.7,

    enableCaustics: true,
    enableGlassDistortion: true,
    enableBlurMap: true,
    enableWaveReactivity: false,

    upscaleSharpness: 0.5,
    upscaleMethod: 'fsr'
  },

  // Low: Maximum performance for 60fps on low-end hardware
  low: {
    oceanBaseResolution: 0.33,
    oceanCaptureResolution: 0.25,
    wakeResolution: 0.33, // 33% wake resolution
    glassResolution: 0.33,
    textCanvasResolution: 1280,
    blurMapResolution: 0.25,
    finalPassResolution: 0.5,

    oceanWaveCount: 4,
    fbmOctaves: 1,
    causticLayers: 0,
    wakeWaveComponents: 1,
    glassDistortionQuality: 0.5,

    enableCaustics: false,
    enableGlassDistortion: true,
    enableBlurMap: false,
    enableWaveReactivity: false,

    upscaleSharpness: 0.7,
    upscaleMethod: 'fsr'
  },

  // Potato: Absolute minimum for ancient hardware
  potato: {
    oceanBaseResolution: 0.25,
    oceanCaptureResolution: 0.25,
    wakeResolution: 0.25, // Minimum wake resolution (huge performance gain)
    glassResolution: 0.25,
    textCanvasResolution: 1280,
    blurMapResolution: 0.25,
    finalPassResolution: 0.33,

    oceanWaveCount: 3,
    fbmOctaves: 1,
    causticLayers: 0,
    wakeWaveComponents: 1,
    glassDistortionQuality: 0.5,

    enableCaustics: false,
    enableGlassDistortion: false,
    enableBlurMap: false,
    enableWaveReactivity: false,

    upscaleSharpness: 0.8,
    upscaleMethod: 'bilinear'
  },

  // Custom: User-defined settings
  custom: {
    oceanBaseResolution: 0.66,
    oceanCaptureResolution: 0.5,
    wakeResolution: 0.5, // Balanced wake resolution
    glassResolution: 0.66,
    textCanvasResolution: 1920,
    blurMapResolution: 0.33,
    finalPassResolution: 0.75,

    oceanWaveCount: 6,
    fbmOctaves: 2,
    causticLayers: 1,
    wakeWaveComponents: 2,
    glassDistortionQuality: 0.75,

    enableCaustics: true,
    enableGlassDistortion: true,
    enableBlurMap: true,
    enableWaveReactivity: true,

    upscaleSharpness: 0.4,
    upscaleMethod: 'fsr'
  }
};

/**
 * Detect optimal quality preset based on device capabilities
 */
export function detectOptimalQuality(): QualityPreset {
  // Get device pixel ratio and screen size
  const dpr = window.devicePixelRatio || 1;
  const screenPixels = window.innerWidth * window.innerHeight * dpr * dpr;

  // Detect GPU tier (rough heuristic)
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

  if (!gl) {
    return 'low'; // No WebGL2 support
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

  // High-end GPUs
  if (renderer.includes('RTX') ||
      renderer.includes('RX 6') ||
      renderer.includes('RX 7') ||
      renderer.includes('M1') ||
      renderer.includes('M2') ||
      renderer.includes('M3')) {
    return screenPixels > 8000000 ? 'high' : 'ultra'; // 4K+ screens use 'high'
  }

  // Mid-range GPUs
  if (renderer.includes('GTX') ||
      renderer.includes('RX 5') ||
      renderer.includes('Intel Iris')) {
    return 'medium';
  }

  // Low-end or unknown GPUs
  if (renderer.includes('Intel HD') || renderer.includes('Intel UHD')) {
    return 'low';
  }

  // Default fallback based on screen resolution
  if (screenPixels > 8000000) return 'medium';  // 4K
  if (screenPixels > 2000000) return 'high';    // 1080p
  return 'medium';
}

/**
 * Quality Settings Manager
 */
export class QualityManager {
  private currentPreset: QualityPreset;
  private currentSettings: QualitySettings;
  private listeners: Set<(settings: QualitySettings) => void> = new Set();

  constructor(initialPreset?: QualityPreset) {
    this.currentPreset = initialPreset || detectOptimalQuality();
    this.currentSettings = { ...QUALITY_PRESETS[this.currentPreset] };

    console.log(`QualityManager: Detected optimal quality preset: ${this.currentPreset}`);
  }

  /**
   * Get current quality preset
   */
  getPreset(): QualityPreset {
    return this.currentPreset;
  }

  /**
   * Get current quality settings
   */
  getSettings(): QualitySettings {
    return { ...this.currentSettings };
  }

  /**
   * Set quality preset
   */
  setPreset(preset: QualityPreset): void {
    this.currentPreset = preset;
    this.currentSettings = { ...QUALITY_PRESETS[preset] };
    this.notifyListeners();

    console.log(`QualityManager: Quality preset changed to ${preset}`);
  }

  /**
   * Update custom settings
   */
  updateSettings(settings: Partial<QualitySettings>): void {
    this.currentPreset = 'custom';
    this.currentSettings = { ...this.currentSettings, ...settings };
    this.notifyListeners();
  }

  /**
   * Listen for quality changes
   */
  onChange(callback: (settings: QualitySettings) => void): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of settings change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.currentSettings));
  }

  /**
   * Get resolution scale for a given base resolution
   */
  getScaledResolution(baseWidth: number, baseHeight: number, scale: number): { width: number; height: number } {
    return {
      width: Math.round(baseWidth * scale),
      height: Math.round(baseHeight * scale)
    };
  }
}

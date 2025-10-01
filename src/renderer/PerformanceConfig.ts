/**
 * Performance Configuration
 * Defines quality presets and performance settings for adaptive rendering
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'auto';

export interface PerformanceSettings {
  // Resolution scaling
  resolutionScale: number;          // Multiplier for canvas resolution (0.25 - 1.0)
  framebufferScale: number;         // Multiplier for framebuffer resolution (0.25 - 1.0)

  // Rendering pipeline
  enableGlass: boolean;             // Enable glass panel rendering
  enableTextGlow: boolean;          // Enable text glow effect
  enableWakes: boolean;             // Enable vessel wake system
  maxVessels: number;               // Maximum active vessels (1-5)

  // Shader quality levels
  glowSampleRings: number;          // Number of sampling rings for text glow (1-3)
  wakeComponents: number;           // Wave components per wake arm (1-2)
  glassNoiseOctaves: number;        // Noise octaves for glass distortion (1-3)
  enableChromaticAberration: boolean; // Chromatic aberration in glass

  // Performance thresholds
  targetFPS: number;                // Target framerate for this quality level
  minFPS: number;                   // Minimum acceptable FPS before downgrade
}

/**
 * Quality preset configurations
 */
export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'auto'>, PerformanceSettings> = {
  low: {
    // Resolution - aggressive scaling for battery mode
    resolutionScale: 0.5,
    framebufferScale: 0.5,

    // Features - minimal for maximum performance
    enableGlass: true,              // Keep glass but simplified
    enableTextGlow: false,          // Disable expensive glow (huge savings)
    enableWakes: true,
    maxVessels: 2,                  // Reduce vessel count

    // Shader quality - minimum complexity
    glowSampleRings: 1,             // 8 samples total (vs 24)
    wakeComponents: 1,              // 1 component per arm (vs 2)
    glassNoiseOctaves: 1,           // Single octave (vs 3)
    enableChromaticAberration: false, // Disable for performance

    // Performance targets
    targetFPS: 30,
    minFPS: 24
  },

  medium: {
    // Resolution - balanced scaling
    resolutionScale: 0.75,
    framebufferScale: 0.75,

    // Features - balanced
    enableGlass: true,
    enableTextGlow: true,
    enableWakes: true,
    maxVessels: 3,

    // Shader quality - moderate
    glowSampleRings: 2,             // 16 samples total
    wakeComponents: 2,              // Full wake detail
    glassNoiseOctaves: 2,           // 2 octaves
    enableChromaticAberration: true,

    // Performance targets
    targetFPS: 45,
    minFPS: 35
  },

  high: {
    // Resolution - near full quality
    resolutionScale: 1.0,
    framebufferScale: 0.85,         // Slight framebuffer optimization

    // Features - all enabled
    enableGlass: true,
    enableTextGlow: true,
    enableWakes: true,
    maxVessels: 5,

    // Shader quality - high detail
    glowSampleRings: 3,             // 24 samples total
    wakeComponents: 2,
    glassNoiseOctaves: 3,           // Full detail
    enableChromaticAberration: true,

    // Performance targets
    targetFPS: 55,
    minFPS: 45
  },

  ultra: {
    // Resolution - maximum quality (current default)
    resolutionScale: 1.0,
    framebufferScale: 1.0,

    // Features - everything enabled
    enableGlass: true,
    enableTextGlow: true,
    enableWakes: true,
    maxVessels: 5,

    // Shader quality - maximum
    glowSampleRings: 3,
    wakeComponents: 2,
    glassNoiseOctaves: 3,
    enableChromaticAberration: true,

    // Performance targets
    targetFPS: 60,
    minFPS: 50
  }
};

/**
 * GPU Tier Detection Heuristics
 * Based on WebGL renderer string patterns
 */
export interface GPUTier {
  tier: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  renderer: string;
}

/**
 * Detect GPU tier from WebGL renderer string
 */
export function detectGPUTier(gl: WebGL2RenderingContext): GPUTier {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (!debugInfo) {
    return { tier: 'medium', confidence: 'low', renderer: 'unknown' };
  }

  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();

  // Low-tier patterns (integrated graphics, old GPUs)
  const lowTierPatterns = [
    /intel.*hd graphics [2-5]\d{2}/,  // Intel HD 200-599
    /intel.*uhd graphics/,              // Intel UHD (integrated)
    /apple m[1-2]/,                     // Apple M1/M2 on battery (integrated mode)
    /mali/,                             // ARM Mali (mobile)
    /adreno [3-5]\d{2}/,               // Qualcomm Adreno 300-599
    /powervr/,                          // PowerVR (mobile)
  ];

  // High-tier patterns (dedicated GPUs, recent integrated)
  const highTierPatterns = [
    /nvidia.*rtx/,                      // NVIDIA RTX series
    /nvidia.*gtx [1-2]\d{3}/,          // NVIDIA GTX 1000-2000+
    /amd.*radeon.*rx [5-7]\d{3}/,      // AMD RX 5000-7000+
    /apple m[1-3].*pro/,               // Apple M1/M2/M3 Pro (dedicated mode)
    /apple m[1-3].*max/,               // Apple M1/M2/M3 Max (dedicated mode)
    /intel.*arc/,                       // Intel Arc (dedicated)
  ];

  for (const pattern of lowTierPatterns) {
    if (pattern.test(renderer)) {
      return { tier: 'low', confidence: 'high', renderer };
    }
  }

  for (const pattern of highTierPatterns) {
    if (pattern.test(renderer)) {
      return { tier: 'high', confidence: 'high', renderer };
    }
  }

  // Default to medium if no pattern matches
  return { tier: 'medium', confidence: 'low', renderer };
}

/**
 * Recommended quality based on device capabilities
 */
export function getRecommendedQuality(
  gpuTier: GPUTier,
  isBatteryPowered: boolean,
  batteryLevel: number
): Exclude<QualityPreset, 'auto'> {
  // Battery mode always goes low on laptops
  if (isBatteryPowered && batteryLevel < 0.8) {
    return 'low';
  }

  // GPU tier based recommendations
  switch (gpuTier.tier) {
    case 'low':
      return isBatteryPowered ? 'low' : 'medium';
    case 'medium':
      return isBatteryPowered ? 'medium' : 'high';
    case 'high':
      return isBatteryPowered ? 'high' : 'ultra';
    default:
      return 'medium';
  }
}

/**
 * FPS-based quality adjustment thresholds
 */
export const FPS_THRESHOLDS = {
  // Consecutive frames below minFPS to trigger downgrade
  downgradeFrameCount: 120,        // ~2 seconds at 60fps

  // Consecutive frames above upgrade threshold to trigger upgrade
  upgradeFrameCount: 600,          // ~10 seconds at 60fps

  // FPS must be this much above targetFPS to consider upgrade
  upgradeMargin: 10,

  // Minimum time between quality changes (ms)
  cooldownPeriod: 5000
};

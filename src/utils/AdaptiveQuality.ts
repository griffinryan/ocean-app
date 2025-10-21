import { PerformanceMetrics } from './PerformanceMonitor';
import { WorkPriority } from './FrameBudget';

export type QualityTier = 'high' | 'balanced' | 'low';

export interface QualityProfile {
  tier: QualityTier;
  label: string;
  finalPassScale: number;
  oceanCaptureScale: number;
  glassCaptureScale: number;
  textCaptureScale: number;
  textCaptureThrottleMs: number;
  textBatchSize: number;
  textBlurRadius: number;
  textBlurFalloff: number;
  blurEnabled: boolean;
  blurOpacityBoost: number;
  blurDistortionBoost: number;
  wakesEnabled: boolean;
  wakeMaxVessels: number;
  wakeSpawnInterval: number;
  wakeTrailLength: number;
  wakeResolutionScale: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    label: 'High',
    finalPassScale: 1.0,
    oceanCaptureScale: 1.0,
    glassCaptureScale: 1.0,
    textCaptureScale: 1.0,
    textCaptureThrottleMs: 33,
    textBatchSize: 15,
    textBlurRadius: 60,
    textBlurFalloff: 2.5,
    blurEnabled: true,
    blurOpacityBoost: 0.45,
    blurDistortionBoost: 0.85,
    wakesEnabled: true,
    wakeMaxVessels: 3,
    wakeSpawnInterval: 8000,
    wakeTrailLength: 150,
    wakeResolutionScale: 0.75
  },
  balanced: {
    tier: 'balanced',
    label: 'Balanced',
    finalPassScale: 0.82,
    oceanCaptureScale: 0.82,
    glassCaptureScale: 0.72,
    textCaptureScale: 0.66,
    textCaptureThrottleMs: 50,
    textBatchSize: 12,
    textBlurRadius: 52,
    textBlurFalloff: 2.35,
    blurEnabled: true,
    blurOpacityBoost: 0.38,
    blurDistortionBoost: 0.78,
    wakesEnabled: true,
    wakeMaxVessels: 2,
    wakeSpawnInterval: 12000,
    wakeTrailLength: 135,
    wakeResolutionScale: 0.62
  },
  low: {
    tier: 'low',
    label: 'Low',
    finalPassScale: 0.6,
    oceanCaptureScale: 0.6,
    glassCaptureScale: 0.5,
    textCaptureScale: 0.5,
    textCaptureThrottleMs: 85,
    textBatchSize: 8,
    textBlurRadius: 42,
    textBlurFalloff: 2.2,
    blurEnabled: false,
    blurOpacityBoost: 0.32,
    blurDistortionBoost: 0.7,
    wakesEnabled: true,
    wakeMaxVessels: 1,
    wakeSpawnInterval: 18000,
    wakeTrailLength: 110,
    wakeResolutionScale: 0.5
  }
};

export interface AdaptiveQualityOptions {
  initialTier?: QualityTier;
  degradeCooldownMs?: number;
  upgradeCooldownMs?: number;
  degradeFrameTimeThresholdMs?: number;
  severeFrameTimeThresholdMs?: number;
  degradeWindowFrames?: number;
  severeWindowFrames?: number;
  upgradeFrameTimeThresholdMs?: number;
  upgradeWindowFrames?: number;
  frameBudgetSkipPriority?: WorkPriority;
  frameBudgetWindowFrames?: number;
  onQualityChange?: (profile: QualityProfile, previous: QualityProfile) => void;
}

const DEFAULT_OPTIONS: Required<Omit<AdaptiveQualityOptions, 'initialTier' | 'onQualityChange'>> = {
  degradeCooldownMs: 4000,
  upgradeCooldownMs: 8000,
  degradeFrameTimeThresholdMs: 21.5, // ≈46 FPS
  severeFrameTimeThresholdMs: 32.0,  // ≈31 FPS (throttle detection)
  degradeWindowFrames: 45,
  severeWindowFrames: 12,
  upgradeFrameTimeThresholdMs: 17.5, // ≈57 FPS
  upgradeWindowFrames: 360,
  frameBudgetSkipPriority: WorkPriority.MEDIUM,
  frameBudgetWindowFrames: 90
};

export function detectInitialTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = navigator.userAgent.toLowerCase();
  const deviceMemory = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const isMobile = /android|iphone|ipad|ipod|mobile/.test(ua);
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  if (isMobile) {
    if (deviceMemory >= 6 && cores >= 6) {
      return 'balanced';
    }
    return 'low';
  }

  if (deviceMemory <= 4 || cores <= 4) {
    return 'balanced';
  }

  if (prefersReducedMotion) {
    return 'balanced';
  }

  if (deviceMemory >= 12 && cores >= 8) {
    return 'high';
  }

  return 'high';
}

export class AdaptiveQualityManager {
  private currentTier: QualityTier;
  private options: typeof DEFAULT_OPTIONS;
  private onQualityChange?: (profile: QualityProfile, previous: QualityProfile) => void;

  private slowFrameCounter = 0;
  private severeFrameCounter = 0;
  private stableFrameCounter = 0;
  private skipPriorityCounter = 0;
  private lastChangeTimestamp = performance.now();

  constructor(options: AdaptiveQualityOptions = {}) {
    const {
      initialTier,
      onQualityChange,
      ...rest
    } = options;

    this.currentTier = initialTier ?? detectInitialTier();

    const sanitizedOptions: Partial<typeof DEFAULT_OPTIONS> = {};
    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined) {
        (sanitizedOptions as Record<string, unknown>)[key] = value;
      }
    });

    this.options = { ...DEFAULT_OPTIONS, ...sanitizedOptions };
    this.onQualityChange = onQualityChange;
  }

  getCurrentProfile(): QualityProfile {
    return QUALITY_PROFILES[this.currentTier];
  }

  setQualityTier(tier: QualityTier): void {
    if (this.currentTier === tier) {
      return;
    }

    const previous = QUALITY_PROFILES[this.currentTier];
    this.currentTier = tier;
    this.lastChangeTimestamp = performance.now();
    this.resetCounters();

    if (this.onQualityChange) {
      this.onQualityChange(QUALITY_PROFILES[tier], previous);
    }
  }

  evaluateFrame(metrics: PerformanceMetrics, frameBudgetStats: { currentSkipPriority: WorkPriority | null }): void {
    const now = performance.now();

    // Slow frame detection (steady drops)
    if (metrics.frameTime > this.options.degradeFrameTimeThresholdMs || metrics.fps < (1000 / this.options.degradeFrameTimeThresholdMs)) {
      this.slowFrameCounter++;
    } else if (this.slowFrameCounter > 0) {
      this.slowFrameCounter--;
    }

    // Severe slowdown (browser throttle / heavy contention)
    if (metrics.frameTime > this.options.severeFrameTimeThresholdMs || metrics.fps <= 30) {
      this.severeFrameCounter++;
    } else {
      this.severeFrameCounter = Math.max(0, this.severeFrameCounter - 1);
    }

    // Frame budget skips
    if (frameBudgetStats.currentSkipPriority !== null && frameBudgetStats.currentSkipPriority <= this.options.frameBudgetSkipPriority) {
      this.skipPriorityCounter++;
    } else if (this.skipPriorityCounter > 0) {
      this.skipPriorityCounter--;
    }

    // Stable frames for recovery
    if (
      metrics.frameTime <= this.options.upgradeFrameTimeThresholdMs &&
      metrics.fps >= (1000 / this.options.upgradeFrameTimeThresholdMs) &&
      (frameBudgetStats.currentSkipPriority === null || frameBudgetStats.currentSkipPriority > WorkPriority.MEDIUM)
    ) {
      this.stableFrameCounter++;
    } else {
      this.stableFrameCounter = Math.max(0, this.stableFrameCounter - 2);
    }

    // Degrade conditions
    if (this.canDegrade(now)) {
      if (this.severeFrameCounter >= this.options.severeWindowFrames) {
        this.degradeQuality('low');
        return;
      }

      if (this.skipPriorityCounter >= this.options.frameBudgetWindowFrames) {
        this.degradeQuality();
        return;
      }

      if (this.slowFrameCounter >= this.options.degradeWindowFrames) {
        this.degradeQuality();
        return;
      }
    }

    // Upgrade conditions
    if (this.canUpgrade(now) && this.stableFrameCounter >= this.options.upgradeWindowFrames) {
      this.upgradeQuality();
    }
  }

  private resetCounters(): void {
    this.slowFrameCounter = 0;
    this.severeFrameCounter = 0;
    this.stableFrameCounter = 0;
    this.skipPriorityCounter = 0;
  }

  private degradeQuality(targetTier?: QualityTier): void {
    const currentIndex = this.order().indexOf(this.currentTier);
    const targetIndex = targetTier ? this.order().indexOf(targetTier) : Math.min(this.order().length - 1, currentIndex + 1);

    if (targetIndex <= currentIndex) {
      // Already at or below requested tier
      return;
    }

    const newTier = this.order()[targetIndex];
    this.setQualityTier(newTier);
  }

  private upgradeQuality(): void {
    const currentIndex = this.order().indexOf(this.currentTier);
    if (currentIndex <= 0) {
      return;
    }

    const newTier = this.order()[currentIndex - 1];
    this.setQualityTier(newTier);
  }

  private canDegrade(now: number): boolean {
    if (this.currentTier === 'low') {
      return false;
    }
    return (now - this.lastChangeTimestamp) >= this.options.degradeCooldownMs;
  }

  private canUpgrade(now: number): boolean {
    if (this.currentTier === 'high') {
      return false;
    }
    return (now - this.lastChangeTimestamp) >= this.options.upgradeCooldownMs;
  }

  private order(): QualityTier[] {
    return ['high', 'balanced', 'low'];
  }
}

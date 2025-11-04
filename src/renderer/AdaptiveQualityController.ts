/**
 * Adaptive Quality Controller
 * Maintains 60fps target by adjusting render scales and effect toggles.
 *
 * Monitors frame-time metrics from PerformanceMonitor and degradation state from FrameBudgetManager.
 * Applies stepped quality profiles to OceanRenderer and dependent subsystems.
 */

import type { OceanRenderer } from './OceanRenderer';
import type { PerformanceMonitor } from '../utils/PerformanceMonitor';
import { FrameBudgetManager, WorkPriority } from '../utils/FrameBudget';

export enum QualityTier {
  High = 0,
  Balanced = 1,
  Performance = 2
}

interface QualityProfile {
  finalPassScale: number;
  oceanCaptureScale: number;
  glassCaptureScale: number;
  textCaptureScale: number;
  wakeResolutionScale: number;
  textCaptureThrottleMs: number;
  blurEnabled: boolean;
  wakesEnabled: boolean;
}

const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  [QualityTier.High]: {
    finalPassScale: 1.0,
    oceanCaptureScale: 1.0,
    glassCaptureScale: 1.0,
    textCaptureScale: 1.0,
    wakeResolutionScale: 0.75,
    textCaptureThrottleMs: 33,
    blurEnabled: true,
    wakesEnabled: true
  },
  [QualityTier.Balanced]: {
    finalPassScale: 0.85,
    oceanCaptureScale: 0.9,
    glassCaptureScale: 0.85,
    textCaptureScale: 0.9,
    wakeResolutionScale: 0.6,
    textCaptureThrottleMs: 50,
    blurEnabled: true,
    wakesEnabled: true
  },
  [QualityTier.Performance]: {
    finalPassScale: 0.7,
    oceanCaptureScale: 0.7,
    glassCaptureScale: 0.7,
    textCaptureScale: 0.75,
    wakeResolutionScale: 0.45,
    textCaptureThrottleMs: 75,
    blurEnabled: false,
    wakesEnabled: false
  }
};

interface AdaptiveQualityConfig {
  targetFrameTimeMs: number;
  downgradeThreshold: number;
  upgradeFramesStable: number;
  downgradeFrames: number;
}

const DEFAULT_CONFIG: AdaptiveQualityConfig = {
  targetFrameTimeMs: 16.67,
  downgradeThreshold: 18.0,
  upgradeFramesStable: 300,
  downgradeFrames: 6
};

export class AdaptiveQualityController {
  private renderer: OceanRenderer;
  private performanceMonitor: PerformanceMonitor;
  private frameBudget: FrameBudgetManager;
  private config: AdaptiveQualityConfig;

  private currentTier: QualityTier = QualityTier.High;
  private consecutiveSlowFrames: number = 0;
  private stableFrameCounter: number = 0;
  private lastLoggedTier: QualityTier | null = null;

  constructor(
    renderer: OceanRenderer,
    performanceMonitor: PerformanceMonitor,
    frameBudget: FrameBudgetManager,
    config?: Partial<AdaptiveQualityConfig>
  ) {
    this.renderer = renderer;
    this.performanceMonitor = performanceMonitor;
    this.frameBudget = frameBudget;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update quality tier based on most recent frame metrics.
   * Call once per frame after PerformanceMonitor.endFrame().
   */
  update(): void {
    const metrics = this.performanceMonitor.getMetrics();
    const frameTime = metrics.frameTime;
    const budgetStats = this.frameBudget.getStats();
    const skipPriority = budgetStats.currentSkipPriority;

    // Track slow frames
    if (frameTime > this.config.downgradeThreshold || (skipPriority !== null && skipPriority <= WorkPriority.MEDIUM)) {
      this.consecutiveSlowFrames++;
      this.stableFrameCounter = 0;
    } else {
      this.consecutiveSlowFrames = Math.max(0, this.consecutiveSlowFrames - 1);
      this.stableFrameCounter++;
    }

    // Decide tier transitions
    if (this.consecutiveSlowFrames >= this.config.downgradeFrames) {
      this.downgradeTier(frameTime, skipPriority);
      this.consecutiveSlowFrames = 0;
      this.stableFrameCounter = 0;
    } else if (
      this.stableFrameCounter >= this.config.upgradeFramesStable &&
      frameTime < this.config.targetFrameTimeMs &&
      (skipPriority === null || skipPriority > WorkPriority.MEDIUM)
    ) {
      this.upgradeTier(frameTime, skipPriority);
      this.stableFrameCounter = 0;
    }
  }

  getCurrentTier(): QualityTier {
    return this.currentTier;
  }

  forceTier(tier: QualityTier): void {
    if (tier === this.currentTier) {
      return;
    }
    this.currentTier = tier;
    this.applyCurrentProfile();
    this.logTierChange('forced', 0, null);
  }

  private downgradeTier(frameTime: number, skipPriority: WorkPriority | null): void {
    if (this.currentTier === QualityTier.Performance) {
      return;
    }
    this.currentTier = (this.currentTier + 1) as QualityTier;
    this.applyCurrentProfile();
    this.logTierChange('downgrade', frameTime, skipPriority);
  }

  private upgradeTier(frameTime: number, skipPriority: WorkPriority | null): void {
    if (this.currentTier === QualityTier.High) {
      return;
    }
    this.currentTier = (this.currentTier - 1) as QualityTier;
    this.applyCurrentProfile();
    this.logTierChange('upgrade', frameTime, skipPriority);
  }

  private applyCurrentProfile(): void {
    const profile = QUALITY_PROFILES[this.currentTier];
    this.renderer.applyQualityProfile(profile);
  }

  private logTierChange(
    reason: 'downgrade' | 'upgrade' | 'forced',
    frameTime: number,
    skipPriority: WorkPriority | null
  ): void {
    if (this.lastLoggedTier === this.currentTier) {
      return;
    }
    this.lastLoggedTier = this.currentTier;

    const tierName = QualityTier[this.currentTier];
    const parts = [`[AdaptiveQuality] Tier -> ${tierName}`, `reason=${reason}`];
    if (frameTime > 0) {
      parts.push(`frame=${frameTime.toFixed(2)}ms`);
    }
    if (skipPriority !== null) {
      parts.push(`skip>=${WorkPriority[skipPriority]}`);
    }
    console.info(parts.join(' | '));
  }
}

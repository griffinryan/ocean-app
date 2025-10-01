/**
 * Performance Manager
 * Handles adaptive performance optimization based on battery status, FPS, and GPU capabilities
 */

import {
  QualityPreset,
  PerformanceSettings,
  QUALITY_PRESETS,
  GPUTier,
  detectGPUTier,
  getRecommendedQuality,
  FPS_THRESHOLDS
} from './PerformanceConfig';

export type PerformanceChangeCallback = (settings: PerformanceSettings, preset: QualityPreset) => void;

export class PerformanceManager {
  private currentPreset: QualityPreset = 'auto';
  private currentSettings: PerformanceSettings;

  // GPU detection
  private gpuTier: GPUTier;

  // Battery status
  private batteryManager: any = null;  // BatteryManager type not in all TypeScript versions
  private isCharging: boolean = true;
  private batteryLevel: number = 1.0;

  // FPS monitoring
  private fpsHistory: number[] = [];
  private readonly FPS_HISTORY_SIZE = 120;  // 2 seconds at 60fps
  private lastQualityChange: number = 0;
  private consecutiveLowFrames: number = 0;
  private consecutiveHighFrames: number = 0;

  // Callbacks
  private changeCallbacks: PerformanceChangeCallback[] = [];

  // User override
  private userOverride: QualityPreset | null = null;

  // Local storage key
  private readonly STORAGE_KEY = 'ocean-app-quality-preference';

  constructor(gl: WebGL2RenderingContext) {
    // Detect GPU tier
    this.gpuTier = detectGPUTier(gl);
    console.log(`PerformanceManager: GPU detected - ${this.gpuTier.renderer} (tier: ${this.gpuTier.tier}, confidence: ${this.gpuTier.confidence})`);

    // Load user preference from localStorage
    this.loadUserPreference();

    // Set initial quality
    this.currentSettings = this.determineInitialQuality();

    // Initialize battery monitoring
    this.initializeBatteryMonitoring();
  }

  /**
   * Load user quality preference from localStorage
   */
  private loadUserPreference(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored && this.isValidPreset(stored)) {
        this.userOverride = stored as QualityPreset;
        console.log(`PerformanceManager: Loaded user preference - ${this.userOverride}`);
      }
    } catch (error) {
      console.warn('PerformanceManager: Failed to load user preference:', error);
    }
  }

  /**
   * Save user quality preference to localStorage
   */
  private saveUserPreference(preset: QualityPreset): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, preset);
    } catch (error) {
      console.warn('PerformanceManager: Failed to save user preference:', error);
    }
  }

  /**
   * Validate quality preset string
   */
  private isValidPreset(preset: string): boolean {
    return ['auto', 'low', 'high'].includes(preset);
  }

  /**
   * Determine initial quality based on device capabilities and user preference
   */
  private determineInitialQuality(): PerformanceSettings {
    // User override takes precedence
    if (this.userOverride && this.userOverride !== 'auto') {
      console.log(`PerformanceManager: Using user override - ${this.userOverride}`);
      this.currentPreset = this.userOverride;
      return QUALITY_PRESETS[this.userOverride];
    }

    // Auto mode - determine best quality
    this.currentPreset = 'auto';
    const recommended = getRecommendedQuality(this.gpuTier, !this.isCharging, this.batteryLevel);
    console.log(`PerformanceManager: Auto mode selected - ${recommended} quality`);
    console.log(`  - GPU Tier: ${this.gpuTier.tier}`);
    console.log(`  - Battery: ${this.isCharging ? 'Charging' : 'On Battery'} (${Math.round(this.batteryLevel * 100)}%)`);

    return QUALITY_PRESETS[recommended];
  }

  /**
   * Initialize battery status monitoring
   */
  private async initializeBatteryMonitoring(): Promise<void> {
    // Check if Battery API is available
    if (!('getBattery' in navigator)) {
      console.warn('PerformanceManager: Battery API not available, assuming AC power');
      return;
    }

    try {
      this.batteryManager = await (navigator as any).getBattery();

      // Get initial status
      this.isCharging = this.batteryManager.charging;
      this.batteryLevel = this.batteryManager.level;

      console.log(`PerformanceManager: Battery status - ${this.isCharging ? 'Charging' : 'On Battery'} (${Math.round(this.batteryLevel * 100)}%)`);

      // Listen for battery changes
      this.batteryManager.addEventListener('chargingchange', () => {
        this.onBatteryStatusChange();
      });

      this.batteryManager.addEventListener('levelchange', () => {
        this.onBatteryStatusChange();
      });

      // If on battery and in auto mode, immediately adjust
      if (!this.isCharging && this.currentPreset === 'auto') {
        this.currentSettings = this.determineInitialQuality();
        this.notifyChange();
      }

    } catch (error) {
      console.warn('PerformanceManager: Failed to initialize battery monitoring:', error);
    }
  }

  /**
   * Handle battery status changes
   */
  private onBatteryStatusChange(): void {
    if (!this.batteryManager) return;

    this.isCharging = this.batteryManager.charging;
    this.batteryLevel = this.batteryManager.level;

    console.log(`PerformanceManager: Battery status changed - ${this.isCharging ? 'Charging' : 'On Battery'} (${Math.round(this.batteryLevel * 100)}%)`);

    // Only auto-adjust if in auto mode
    if (this.currentPreset === 'auto') {
      const recommended = getRecommendedQuality(this.gpuTier, !this.isCharging, this.batteryLevel);
      const newSettings = QUALITY_PRESETS[recommended];

      // Check if settings actually changed
      if (JSON.stringify(newSettings) !== JSON.stringify(this.currentSettings)) {
        console.log(`PerformanceManager: Auto-adjusting quality due to battery change - ${recommended}`);
        this.currentSettings = newSettings;
        this.notifyChange();
      }
    }
  }

  /**
   * Update FPS and check for quality adjustments
   * Should be called every frame from the render loop
   */
  updateFPS(fps: number): void {
    // Add to history
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.FPS_HISTORY_SIZE) {
      this.fpsHistory.shift();
    }

    // Only auto-adjust if in auto mode and enough history
    if (this.currentPreset !== 'auto' || this.fpsHistory.length < 60) {
      return;
    }

    // Check for cooldown period
    const now = performance.now();
    if (now - this.lastQualityChange < FPS_THRESHOLDS.cooldownPeriod) {
      return;
    }

    // Check if we should downgrade
    if (fps < this.currentSettings.minFPS) {
      this.consecutiveLowFrames++;
      this.consecutiveHighFrames = 0;

      if (this.consecutiveLowFrames >= FPS_THRESHOLDS.downgradeFrameCount) {
        this.downgradeQuality();
        this.consecutiveLowFrames = 0;
      }
    }
    // Check if we should upgrade
    else if (fps > this.currentSettings.targetFPS + FPS_THRESHOLDS.upgradeMargin) {
      this.consecutiveHighFrames++;
      this.consecutiveLowFrames = 0;

      if (this.consecutiveHighFrames >= FPS_THRESHOLDS.upgradeFrameCount) {
        this.upgradeQuality();
        this.consecutiveHighFrames = 0;
      }
    }
    // Reset counters if FPS is in acceptable range
    else {
      this.consecutiveLowFrames = 0;
      this.consecutiveHighFrames = 0;
    }
  }

  /**
   * Downgrade quality by one level
   */
  private downgradeQuality(): void {
    const currentQuality = this.getActualQuality();
    const qualityLevels: Array<Exclude<QualityPreset, 'auto'>> = ['low', 'high'];
    const currentIndex = qualityLevels.indexOf(currentQuality);

    if (currentIndex > 0) {
      const newQuality = qualityLevels[currentIndex - 1];
      console.log(`PerformanceManager: FPS too low, downgrading ${currentQuality} -> ${newQuality}`);
      this.currentSettings = QUALITY_PRESETS[newQuality];
      this.lastQualityChange = performance.now();
      this.notifyChange();
    } else {
      console.warn('PerformanceManager: Already at lowest quality, cannot downgrade further');
    }
  }

  /**
   * Upgrade quality by one level
   */
  private upgradeQuality(): void {
    const currentQuality = this.getActualQuality();
    const qualityLevels: Array<Exclude<QualityPreset, 'auto'>> = ['low', 'high'];
    const currentIndex = qualityLevels.indexOf(currentQuality);

    if (currentIndex < qualityLevels.length - 1) {
      const newQuality = qualityLevels[currentIndex + 1];
      console.log(`PerformanceManager: FPS stable, upgrading ${currentQuality} -> ${newQuality}`);
      this.currentSettings = QUALITY_PRESETS[newQuality];
      this.lastQualityChange = performance.now();
      this.notifyChange();
    }
  }

  /**
   * Get the actual quality level (resolves 'auto' to concrete level)
   */
  private getActualQuality(): Exclude<QualityPreset, 'auto'> {
    if (this.currentPreset === 'auto') {
      // Find which preset matches current settings
      for (const [preset, settings] of Object.entries(QUALITY_PRESETS)) {
        if (JSON.stringify(settings) === JSON.stringify(this.currentSettings)) {
          return preset as Exclude<QualityPreset, 'auto'>;
        }
      }
      return 'high'; // Fallback to high quality
    }
    return this.currentPreset as Exclude<QualityPreset, 'auto'>;
  }

  /**
   * Manually set quality preset (user override)
   */
  setQuality(preset: QualityPreset): void {
    if (!this.isValidPreset(preset)) {
      console.warn(`PerformanceManager: Invalid quality preset - ${preset}`);
      return;
    }

    console.log(`PerformanceManager: User set quality to ${preset}`);

    this.userOverride = preset;
    this.currentPreset = preset;
    this.saveUserPreference(preset);

    // Reset FPS counters
    this.consecutiveLowFrames = 0;
    this.consecutiveHighFrames = 0;

    if (preset === 'auto') {
      // Re-determine quality based on current conditions
      const recommended = getRecommendedQuality(this.gpuTier, !this.isCharging, this.batteryLevel);
      this.currentSettings = QUALITY_PRESETS[recommended];
      console.log(`PerformanceManager: Auto mode - selected ${recommended} quality`);
    } else {
      this.currentSettings = QUALITY_PRESETS[preset];
    }

    this.notifyChange();
  }

  /**
   * Cycle to next quality preset (for keyboard shortcut)
   */
  cycleQuality(): QualityPreset {
    const presets: QualityPreset[] = ['auto', 'low', 'high'];
    const currentIndex = presets.indexOf(this.currentPreset);
    const nextIndex = (currentIndex + 1) % presets.length;
    const nextPreset = presets[nextIndex];

    this.setQuality(nextPreset);
    return nextPreset;
  }

  /**
   * Get current quality preset
   */
  getCurrentPreset(): QualityPreset {
    return this.currentPreset;
  }

  /**
   * Get current performance settings
   */
  getCurrentSettings(): PerformanceSettings {
    return { ...this.currentSettings };
  }

  /**
   * Get GPU tier information
   */
  getGPUTier(): GPUTier {
    return { ...this.gpuTier };
  }

  /**
   * Get battery status
   */
  getBatteryStatus(): { charging: boolean; level: number } {
    return {
      charging: this.isCharging,
      level: this.batteryLevel
    };
  }

  /**
   * Get average FPS from recent history
   */
  getAverageFPS(): number {
    if (this.fpsHistory.length === 0) return 0;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return sum / this.fpsHistory.length;
  }

  /**
   * Register callback for performance changes
   */
  onChange(callback: PerformanceChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Notify all callbacks of settings change
   */
  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      callback(this.currentSettings, this.currentPreset);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Remove battery event listeners
    if (this.batteryManager) {
      try {
        this.batteryManager.removeEventListener('chargingchange', this.onBatteryStatusChange);
        this.batteryManager.removeEventListener('levelchange', this.onBatteryStatusChange);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    this.changeCallbacks = [];
  }
}

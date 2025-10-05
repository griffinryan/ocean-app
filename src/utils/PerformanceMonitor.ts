/**
 * Performance Monitoring and Dynamic Quality Adjustment
 * Tracks FPS and automatically adjusts quality settings to maintain target framerate
 */

import { QualityManager, QualityPreset } from '../config/QualityPresets';

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;        // ms
  averageFps: number;
  minFps: number;
  maxFps: number;
  gpuTime?: number;         // ms (if available)
  memoryUsage?: number;     // MB (if available)
}

export interface PerformanceConfig {
  targetFps: number;        // Target framerate (default: 60)
  minFps: number;           // Minimum acceptable FPS (default: 30)
  sampleWindow: number;     // Number of frames to average (default: 60)
  adjustmentThreshold: number; // FPS threshold for quality adjustment (default: 5)
  adjustmentCooldown: number;  // Cooldown between adjustments (ms, default: 2000)
  enableDynamicQuality: boolean; // Enable automatic quality adjustment
}

const DEFAULT_CONFIG: PerformanceConfig = {
  targetFps: 60,
  minFps: 30,
  sampleWindow: 60,
  adjustmentThreshold: 5,
  adjustmentCooldown: 2000,
  enableDynamicQuality: false // Disabled by default
};

/**
 * Performance Monitor with Dynamic Quality Scaling
 */
export class PerformanceMonitor {
  private config: PerformanceConfig;
  private qualityManager: QualityManager;

  // Frame timing
  private frameCount: number = 0;
  private lastFrameTime: number = performance.now();
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];

  // Metrics
  private currentFps: number = 60;
  private currentFrameTime: number = 16.67;
  private averageFps: number = 60;
  private minFps: number = 60;
  private maxFps: number = 60;

  // Dynamic quality adjustment
  private lastAdjustmentTime: number = 0;
  private qualityAdjustmentHistory: QualityPreset[] = [];
  private consecutiveLowFps: number = 0;
  private consecutiveHighFps: number = 0;

  // GPU timing (if available)
  private gl: WebGL2RenderingContext | null = null;
  private timerQuery: WebGLQuery | null = null;
  private timerExtension: any = null;

  constructor(qualityManager: QualityManager, config?: Partial<PerformanceConfig>) {
    this.qualityManager = qualityManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    console.log(`PerformanceMonitor: Initialized with target FPS ${this.config.targetFps}`);
  }

  /**
   * Initialize GPU timing (optional, for advanced metrics)
   */
  initializeGPUTiming(gl: WebGL2RenderingContext): void {
    this.gl = gl;

    // Try to get EXT_disjoint_timer_query_webgl2
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) {
      this.timerExtension = ext;
      this.timerQuery = gl.createQuery();
      console.log('PerformanceMonitor: GPU timing enabled');
    } else {
      console.warn('PerformanceMonitor: GPU timing not available');
    }
  }

  /**
   * Begin frame timing
   */
  beginFrame(): void {
    // Start GPU timer query (if available)
    if (this.gl && this.timerExtension && this.timerQuery) {
      this.gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT, this.timerQuery);
    }
  }

  /**
   * End frame timing and update metrics
   */
  endFrame(): void {
    const currentTime = performance.now();
    const frameTime = currentTime - this.lastFrameTime;
    const fps = 1000 / frameTime;

    // End GPU timer query (if available)
    if (this.gl && this.timerExtension && this.timerQuery) {
      this.gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);
    }

    // Update frame timing history
    this.frameTimes.push(frameTime);
    this.fpsHistory.push(fps);

    // Keep only recent samples
    if (this.frameTimes.length > this.config.sampleWindow) {
      this.frameTimes.shift();
      this.fpsHistory.shift();
    }

    // Calculate metrics
    this.currentFps = fps;
    this.currentFrameTime = frameTime;
    this.averageFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    this.minFps = Math.min(...this.fpsHistory);
    this.maxFps = Math.max(...this.fpsHistory);

    // Dynamic quality adjustment
    if (this.config.enableDynamicQuality) {
      this.adjustQualityIfNeeded(currentTime);
    }

    this.lastFrameTime = currentTime;
    this.frameCount++;
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const metrics: PerformanceMetrics = {
      fps: Math.round(this.currentFps),
      frameTime: parseFloat(this.currentFrameTime.toFixed(2)),
      averageFps: Math.round(this.averageFps),
      minFps: Math.round(this.minFps),
      maxFps: Math.round(this.maxFps)
    };

    // Add GPU timing if available
    if (this.gl && this.timerQuery) {
      const available = this.gl.getQueryParameter(this.timerQuery, this.gl.QUERY_RESULT_AVAILABLE);
      if (available) {
        const timeNs = this.gl.getQueryParameter(this.timerQuery, this.gl.QUERY_RESULT);
        metrics.gpuTime = parseFloat((timeNs / 1000000).toFixed(2)); // Convert to ms
      }
    }

    // Add memory usage if available
    if ((performance as any).memory) {
      metrics.memoryUsage = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
    }

    return metrics;
  }

  /**
   * Adjust quality settings based on performance
   */
  private adjustQualityIfNeeded(currentTime: number): void {
    // Check cooldown
    if (currentTime - this.lastAdjustmentTime < this.config.adjustmentCooldown) {
      return;
    }

    const targetFps = this.config.targetFps;
    const threshold = this.config.adjustmentThreshold;

    // Count consecutive low/high FPS frames
    if (this.averageFps < targetFps - threshold) {
      this.consecutiveLowFps++;
      this.consecutiveHighFps = 0;
    } else if (this.averageFps > targetFps + threshold) {
      this.consecutiveHighFps++;
      this.consecutiveLowFps = 0;
    } else {
      this.consecutiveLowFps = 0;
      this.consecutiveHighFps = 0;
      return;
    }

    // Require multiple consecutive frames before adjusting
    const requiredConsecutiveFrames = 30; // ~0.5 seconds at 60fps

    // Performance is too low - decrease quality
    if (this.consecutiveLowFps >= requiredConsecutiveFrames) {
      this.decreaseQuality();
      this.lastAdjustmentTime = currentTime;
      this.consecutiveLowFps = 0;
    }

    // Performance is good - try increasing quality
    else if (this.consecutiveHighFps >= requiredConsecutiveFrames * 2) { // Be more conservative when increasing
      this.increaseQuality();
      this.lastAdjustmentTime = currentTime;
      this.consecutiveHighFps = 0;
    }
  }

  /**
   * Decrease quality preset
   */
  private decreaseQuality(): void {
    const currentPreset = this.qualityManager.getPreset();
    const presets: QualityPreset[] = ['ultra', 'high', 'medium', 'low', 'potato'];
    const currentIndex = presets.indexOf(currentPreset);

    if (currentIndex < presets.length - 1) {
      const newPreset = presets[currentIndex + 1];
      this.qualityManager.setPreset(newPreset);
      this.qualityAdjustmentHistory.push(newPreset);

      console.warn(`PerformanceMonitor: Quality decreased to ${newPreset} (avg FPS: ${Math.round(this.averageFps)})`);
    } else {
      console.warn(`PerformanceMonitor: Already at lowest quality preset (avg FPS: ${Math.round(this.averageFps)})`);
    }
  }

  /**
   * Increase quality preset
   */
  private increaseQuality(): void {
    const currentPreset = this.qualityManager.getPreset();
    const presets: QualityPreset[] = ['ultra', 'high', 'medium', 'low', 'potato'];
    const currentIndex = presets.indexOf(currentPreset);

    if (currentIndex > 0) {
      const newPreset = presets[currentIndex - 1];
      this.qualityManager.setPreset(newPreset);
      this.qualityAdjustmentHistory.push(newPreset);

      console.log(`PerformanceMonitor: Quality increased to ${newPreset} (avg FPS: ${Math.round(this.averageFps)})`);
    }
  }

  /**
   * Enable/disable dynamic quality adjustment
   */
  setDynamicQuality(enabled: boolean): void {
    this.config.enableDynamicQuality = enabled;
    console.log(`PerformanceMonitor: Dynamic quality ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set target FPS
   */
  setTargetFPS(targetFps: number): void {
    this.config.targetFps = targetFps;
    console.log(`PerformanceMonitor: Target FPS set to ${targetFps}`);
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.frameCount = 0;
    this.frameTimes = [];
    this.fpsHistory = [];
    this.consecutiveLowFps = 0;
    this.consecutiveHighFps = 0;
    this.qualityAdjustmentHistory = [];

    console.log('PerformanceMonitor: Metrics reset');
  }

  /**
   * Get quality adjustment history
   */
  getAdjustmentHistory(): QualityPreset[] {
    return [...this.qualityAdjustmentHistory];
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const metrics = this.getMetrics();
    const preset = this.qualityManager.getPreset();
    const settings = this.qualityManager.getSettings();

    return `
=== Performance Report ===
FPS: ${metrics.fps} (avg: ${metrics.averageFps}, min: ${metrics.minFps}, max: ${metrics.maxFps})
Frame Time: ${metrics.frameTime}ms${metrics.gpuTime ? ` (GPU: ${metrics.gpuTime}ms)` : ''}
${metrics.memoryUsage ? `Memory: ${metrics.memoryUsage}MB` : ''}

Quality Preset: ${preset}
Resolution Scales:
  - Ocean Base: ${(settings.oceanBaseResolution * 100).toFixed(0)}%
  - Ocean Capture: ${(settings.oceanCaptureResolution * 100).toFixed(0)}%
  - Glass: ${(settings.glassResolution * 100).toFixed(0)}%
  - Blur Map: ${(settings.blurMapResolution * 100).toFixed(0)}%
  - Final Pass: ${(settings.finalPassResolution * 100).toFixed(0)}%

Effects:
  - Ocean Waves: ${settings.oceanWaveCount}
  - FBM Octaves: ${settings.fbmOctaves}
  - Caustic Layers: ${settings.causticLayers}
  - Caustics: ${settings.enableCaustics ? 'ON' : 'OFF'}
  - Glass Distortion: ${settings.enableGlassDistortion ? 'ON' : 'OFF'}
  - Blur Map: ${settings.enableBlurMap ? 'ON' : 'OFF'}

Adjustments: ${this.qualityAdjustmentHistory.length}
${this.qualityAdjustmentHistory.length > 0 ? `History: ${this.qualityAdjustmentHistory.join(' → ')}` : ''}
========================
    `.trim();
  }
}

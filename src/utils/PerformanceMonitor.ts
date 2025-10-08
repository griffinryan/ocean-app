/**
 * Lightweight performance monitor.
 * Tracks frame timing and optional GPU timing without any quality-management logic.
 */

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
  sampleWindow: number; // Number of frames to keep in the rolling average
}

const DEFAULT_CONFIG: PerformanceConfig = {
  sampleWindow: 120
};

export class PerformanceMonitor {
  private config: PerformanceConfig;

  // Frame timing
  private lastFrameTime: number = performance.now();
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];

  // Metrics
  private currentFps: number = 0;
  private currentFrameTime: number = 0;
  private averageFps: number = 0;
  private minFps: number = 0;
  private maxFps: number = 0;

  // GPU timing (optional)
  private gl: WebGL2RenderingContext | null = null;
  private timerQuery: WebGLQuery | null = null;
  private timerExtension: any = null;

  constructor(config?: Partial<PerformanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(`PerformanceMonitor: Tracking frame metrics with window ${this.config.sampleWindow}`);
  }

  /**
   * Initialize GPU timing (if EXT_disjoint_timer_query_webgl2 is available).
   */
  initializeGPUTiming(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) {
      this.timerExtension = ext;
      this.timerQuery = gl.createQuery();
      console.log('PerformanceMonitor: GPU timing enabled');
    } else {
      console.warn('PerformanceMonitor: GPU timing not available');
    }
  }

  beginFrame(): void {
    if (this.gl && this.timerExtension && this.timerQuery) {
      this.gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT, this.timerQuery);
    }
  }

  endFrame(): void {
    const currentTime = performance.now();
    const frameTime = currentTime - this.lastFrameTime;
    const fps = 1000 / frameTime;

    if (this.gl && this.timerExtension && this.timerQuery) {
      this.gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);
    }

    this.frameTimes.push(frameTime);
    this.fpsHistory.push(fps);

    const { sampleWindow } = this.config;
    if (this.frameTimes.length > sampleWindow) {
      this.frameTimes.shift();
      this.fpsHistory.shift();
    }

    this.currentFrameTime = frameTime;
    this.currentFps = fps;
    this.averageFps = this.fpsHistory.reduce((sum, value) => sum + value, 0) / this.fpsHistory.length;
    this.minFps = Math.min(...this.fpsHistory);
    this.maxFps = Math.max(...this.fpsHistory);

    this.lastFrameTime = currentTime;
  }

  getMetrics(): PerformanceMetrics {
    const metrics: PerformanceMetrics = {
      fps: Math.round(this.currentFps),
      frameTime: parseFloat(this.currentFrameTime.toFixed(2)),
      averageFps: Math.round(this.averageFps),
      minFps: Math.round(this.minFps),
      maxFps: Math.round(this.maxFps)
    };

    if (this.gl && this.timerQuery) {
      const available = this.gl.getQueryParameter(this.timerQuery, this.gl.QUERY_RESULT_AVAILABLE);
      if (available) {
        const timeNs = this.gl.getQueryParameter(this.timerQuery, this.gl.QUERY_RESULT);
        metrics.gpuTime = parseFloat((timeNs / 1_000_000).toFixed(2));
      }
    }

    if ((performance as any).memory) {
      metrics.memoryUsage = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
    }

    return metrics;
  }

  reset(): void {
    this.frameTimes = [];
    this.fpsHistory = [];
    this.currentFps = 0;
    this.currentFrameTime = 0;
    this.averageFps = 0;
    this.minFps = 0;
    this.maxFps = 0;
    this.lastFrameTime = performance.now();
    console.log('PerformanceMonitor: Metrics reset');
  }
}

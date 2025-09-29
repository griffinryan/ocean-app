/**
 * BrightnessAnalyzer - Samples ocean framebuffer to determine brightness values for adaptive text
 */

export interface BrightnessData {
  averageLuminance: number;  // 0-1, where 1 is brightest
  samples: number[];         // Individual sample points
  timestamp: number;         // When this measurement was taken
}

export interface SampleRegion {
  x: number;                 // Screen position X (0-1)
  y: number;                 // Screen position Y (0-1)
  width: number;             // Region width (0-1)
  height: number;            // Region height (0-1)
  elementId?: string;        // Associated HTML element ID
}

export class BrightnessAnalyzer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  // Sampling configuration
  private readonly SAMPLE_GRID_SIZE = 3;  // 3x3 grid per region
  private readonly THROTTLE_MS = 16;      // ~60fps max sampling rate
  private readonly LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722]; // ITU-R BT.709

  // Performance tracking
  private lastSampleTime = 0;
  private frameBuffer: Uint8Array;
  private cachedBrightness = new Map<string, BrightnessData>();

  // Debug mode
  private debugMode = false;
  private debugStats = {
    totalSamples: 0,
    lastBrightnessValues: new Map<string, number>(),
    averageBrightness: 0,
    lastSampleTime: 0
  };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.canvas = gl.canvas as HTMLCanvasElement;

    // Pre-allocate pixel buffer for efficiency
    this.frameBuffer = new Uint8Array(4); // RGBA
  }

  /**
   * Sample brightness data for a specific screen region
   */
  public sampleRegion(region: SampleRegion): BrightnessData {
    const now = performance.now();

    // Throttle sampling for performance
    if (now - this.lastSampleTime < this.THROTTLE_MS && region.elementId) {
      const cached = this.cachedBrightness.get(region.elementId);
      if (cached) {
        return cached;
      }
    }

    const samples = this.sampleGridPoints(region);
    const averageLuminance = this.calculateAverageLuminance(samples);

    const brightnessData: BrightnessData = {
      averageLuminance,
      samples,
      timestamp: now
    };

    // Cache the result
    if (region.elementId) {
      this.cachedBrightness.set(region.elementId, brightnessData);
    }

    this.lastSampleTime = now;
    return brightnessData;
  }

  /**
   * Sample multiple regions efficiently in a single pass
   */
  public sampleMultipleRegions(regions: SampleRegion[]): Map<string, BrightnessData> {
    const results = new Map<string, BrightnessData>();
    const now = performance.now();

    // Check if we need to throttle
    if (now - this.lastSampleTime < this.THROTTLE_MS) {
      // Return cached results if available
      regions.forEach(region => {
        if (region.elementId) {
          const cached = this.cachedBrightness.get(region.elementId);
          if (cached) {
            results.set(region.elementId, cached);
          }
        }
      });

      if (results.size === regions.length) {
        return results;
      }
    }

    // Sample all regions
    regions.forEach(region => {
      const brightnessData = this.sampleRegion(region);
      if (region.elementId) {
        results.set(region.elementId, brightnessData);
      }
    });

    return results;
  }

  /**
   * Convert HTML element bounds to sampling region
   */
  public elementToRegion(element: HTMLElement): SampleRegion {
    const rect = element.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    // Convert to normalized coordinates (0-1)
    const x = (rect.left - canvasRect.left) / canvasRect.width;
    const y = (rect.top - canvasRect.top) / canvasRect.height;
    const width = rect.width / canvasRect.width;
    const height = rect.height / canvasRect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0, Math.min(1, width)),
      height: Math.max(0, Math.min(1, height)),
      elementId: element.id || undefined
    };
  }

  /**
   * Sample brightness for common text elements automatically
   */
  public sampleTextElements(): Map<string, BrightnessData> {
    const textElements = [
      'landing-panel',
      'app-panel',
      'portfolio-panel',
      'resume-panel',
      'navbar'
    ];

    const regions: SampleRegion[] = [];

    textElements.forEach(id => {
      const element = document.getElementById(id);
      if (element && !element.classList.contains('hidden')) {
        regions.push(this.elementToRegion(element));
      }
    });

    return this.sampleMultipleRegions(regions);
  }

  /**
   * Immediate brightness sampling (no throttling) for real-time updates
   */
  public sampleTextElementsImmediate(): Map<string, BrightnessData> {
    const now = performance.now();
    const textElements = [
      'landing-panel',
      'app-panel',
      'portfolio-panel',
      'resume-panel',
      'navbar'
    ];

    const results = new Map<string, BrightnessData>();

    textElements.forEach(id => {
      const element = document.getElementById(id);
      if (element && !element.classList.contains('hidden')) {
        const region = this.elementToRegion(element);
        const samples = this.sampleGridPoints(region);
        const averageLuminance = this.calculateAverageLuminance(samples);

        const brightnessData: BrightnessData = {
          averageLuminance,
          samples,
          timestamp: now
        };

        results.set(id, brightnessData);

        // Update debug stats
        this.updateDebugStats(id, averageLuminance);
      }
    });

    return results;
  }

  /**
   * Enable/disable debug mode
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (enabled) {
      console.log('BrightnessAnalyzer: Debug mode enabled');
    }
  }

  /**
   * Update debug statistics
   */
  private updateDebugStats(elementId: string, luminance: number): void {
    if (!this.debugMode) return;

    this.debugStats.totalSamples++;
    this.debugStats.lastBrightnessValues.set(elementId, luminance);
    this.debugStats.lastSampleTime = performance.now();

    // Calculate average brightness across all elements
    let total = 0;
    this.debugStats.lastBrightnessValues.forEach(value => total += value);
    this.debugStats.averageBrightness = total / this.debugStats.lastBrightnessValues.size;

    // Log debug info occasionally
    if (this.debugStats.totalSamples % 60 === 0) { // Every 60 samples (roughly 1 second at 60fps)
      console.log('BrightnessAnalyzer Debug:', {
        elementId,
        luminance: luminance.toFixed(3),
        averageAll: this.debugStats.averageBrightness.toFixed(3),
        totalSamples: this.debugStats.totalSamples
      });
    }
  }

  /**
   * Sample a grid of points within the region
   */
  private sampleGridPoints(region: SampleRegion): number[] {
    const samples: number[] = [];
    const gridSize = this.SAMPLE_GRID_SIZE;

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        // Calculate sample position within region
        const offsetX = (i + 0.5) / gridSize;  // Center of grid cell
        const offsetY = (j + 0.5) / gridSize;

        const sampleX = region.x + region.width * offsetX;
        const sampleY = region.y + region.height * offsetY;

        // Clamp to valid range
        const clampedX = Math.max(0, Math.min(1, sampleX));
        const clampedY = Math.max(0, Math.min(1, sampleY));

        const luminance = this.samplePixelLuminance(clampedX, clampedY);
        samples.push(luminance);
      }
    }

    return samples;
  }

  /**
   * Sample a single pixel's luminance at normalized coordinates
   */
  private samplePixelLuminance(normalizedX: number, normalizedY: number): number {
    const canvasWidth = this.gl.canvas.width;
    const canvasHeight = this.gl.canvas.height;

    // Convert normalized coordinates to pixel coordinates
    // Note: WebGL Y is flipped compared to screen coordinates
    const pixelX = Math.floor(normalizedX * canvasWidth);
    const pixelY = Math.floor((1.0 - normalizedY) * canvasHeight);

    // Ensure pixel coordinates are within bounds
    const clampedX = Math.max(0, Math.min(canvasWidth - 1, pixelX));
    const clampedY = Math.max(0, Math.min(canvasHeight - 1, pixelY));

    try {
      // Read pixel data from framebuffer
      this.gl.readPixels(
        clampedX, clampedY, 1, 1,
        this.gl.RGBA, this.gl.UNSIGNED_BYTE,
        this.frameBuffer
      );

      // Convert to 0-1 range
      const r = this.frameBuffer[0] / 255.0;
      const g = this.frameBuffer[1] / 255.0;
      const b = this.frameBuffer[2] / 255.0;

      // Calculate perceptual luminance (ITU-R BT.709)
      return this.LUMINANCE_WEIGHTS[0] * r +
             this.LUMINANCE_WEIGHTS[1] * g +
             this.LUMINANCE_WEIGHTS[2] * b;

    } catch (error) {
      console.warn('BrightnessAnalyzer: Failed to read pixel data:', error);
      return 0.5; // Return neutral luminance on error
    }
  }

  /**
   * Calculate weighted average luminance from samples
   */
  private calculateAverageLuminance(samples: number[]): number {
    if (samples.length === 0) return 0.5;

    // Use weighted average - center samples get more weight
    const gridSize = this.SAMPLE_GRID_SIZE;
    let totalLuminance = 0;
    let totalWeight = 0;

    for (let i = 0; i < samples.length; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;

      // Give center samples more weight
      const distanceFromCenter = Math.abs(row - 1) + Math.abs(col - 1);
      const weight = distanceFromCenter === 0 ? 2.0 : 1.0;

      totalLuminance += samples[i] * weight;
      totalWeight += weight;
    }

    return totalLuminance / totalWeight;
  }

  /**
   * Clear cached brightness data
   */
  public clearCache(): void {
    this.cachedBrightness.clear();
  }

  /**
   * Get performance statistics
   */
  public getStats(): {
    cacheSize: number;
    lastSampleTime: number;
    debugMode: boolean;
    totalSamples: number;
    averageBrightness: number;
  } {
    return {
      cacheSize: this.cachedBrightness.size,
      lastSampleTime: this.lastSampleTime,
      debugMode: this.debugMode,
      totalSamples: this.debugStats.totalSamples,
      averageBrightness: this.debugStats.averageBrightness
    };
  }

  /**
   * Get debug brightness values for all elements
   */
  public getDebugBrightnessValues(): Map<string, number> {
    return new Map(this.debugStats.lastBrightnessValues);
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.clearCache();
  }
}
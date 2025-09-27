/**
 * WaveSystemManager handles the coordination of multiple wave patterns
 * and their dynamic blending for the ocean simulation
 */

export interface WavePattern {
  name: string;
  weight: number;
  enabled: boolean;
}

export interface WaveSystemConfig {
  // Wave pattern weights (should sum to <= 1.0)
  gerstnerWeight: number;
  phillipsWeight: number;
  caWeight: number;

  // Gerstner wave parameters
  gerstnerSteepness: number;

  // Phillips spectrum parameters
  windSpeed: number;
  windDirection: number; // In radians

  // Quality settings
  waveQuality: number; // 0 = low, 1 = medium, 2 = high

  // Animation parameters
  animationSpeed: number;
  timeScale: number;
}

export class WaveSystemManager {
  private config: WaveSystemConfig;
  private patterns: Map<string, WavePattern> = new Map();

  constructor(initialConfig?: Partial<WaveSystemConfig>) {
    // Default configuration
    this.config = {
      gerstnerWeight: 0.3,
      phillipsWeight: 0.2,
      caWeight: 0.2,
      gerstnerSteepness: 0.5,
      windSpeed: 10.0, // m/s
      windDirection: 0.0, // radians
      waveQuality: 1.0, // medium quality
      animationSpeed: 1.0,
      timeScale: 1.0,
      ...initialConfig
    };

    this.initializePatterns();
    this.validateWeights();
  }

  /**
   * Initialize available wave patterns
   */
  private initializePatterns(): void {
    this.patterns.set('original', {
      name: 'Original Sine Waves',
      weight: 1.0 - (this.config.gerstnerWeight + this.config.phillipsWeight + this.config.caWeight),
      enabled: true
    });

    this.patterns.set('gerstner', {
      name: 'Gerstner Waves',
      weight: this.config.gerstnerWeight,
      enabled: this.config.gerstnerWeight > 0
    });

    this.patterns.set('phillips', {
      name: 'Phillips Spectrum',
      weight: this.config.phillipsWeight,
      enabled: this.config.phillipsWeight > 0
    });

    this.patterns.set('cellularAutomaton', {
      name: 'Cellular Automaton',
      weight: this.config.caWeight,
      enabled: this.config.caWeight > 0
    });
  }

  /**
   * Validate that wave weights don't exceed 1.0 total
   */
  private validateWeights(): void {
    const totalWeight = this.config.gerstnerWeight + this.config.phillipsWeight + this.config.caWeight;

    if (totalWeight > 1.0) {
      console.warn(`Wave weights exceed 1.0 (${totalWeight}). Normalizing...`);

      // Normalize weights proportionally
      const scale = 1.0 / totalWeight;
      this.config.gerstnerWeight *= scale;
      this.config.phillipsWeight *= scale;
      this.config.caWeight *= scale;
    }

    // Update pattern weights
    this.patterns.get('gerstner')!.weight = this.config.gerstnerWeight;
    this.patterns.get('phillips')!.weight = this.config.phillipsWeight;
    this.patterns.get('cellularAutomaton')!.weight = this.config.caWeight;
    this.patterns.get('original')!.weight = Math.max(0, 1.0 - (this.config.gerstnerWeight + this.config.phillipsWeight + this.config.caWeight));
  }

  /**
   * Update wave pattern weight
   */
  setPatternWeight(patternName: string, weight: number): void {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      console.warn(`Unknown wave pattern: ${patternName}`);
      return;
    }

    pattern.weight = Math.max(0, Math.min(1, weight));
    pattern.enabled = weight > 0;

    // Update config based on pattern
    switch (patternName) {
      case 'gerstner':
        this.config.gerstnerWeight = weight;
        break;
      case 'phillips':
        this.config.phillipsWeight = weight;
        break;
      case 'cellularAutomaton':
        this.config.caWeight = weight;
        break;
    }

    this.validateWeights();
  }

  /**
   * Get current pattern weight
   */
  getPatternWeight(patternName: string): number {
    const pattern = this.patterns.get(patternName);
    return pattern ? pattern.weight : 0;
  }

  /**
   * Enable/disable a wave pattern
   */
  setPatternEnabled(patternName: string, enabled: boolean): void {
    const pattern = this.patterns.get(patternName);
    if (pattern) {
      pattern.enabled = enabled;
      if (!enabled) {
        this.setPatternWeight(patternName, 0);
      }
    }
  }

  /**
   * Set Gerstner wave steepness
   */
  setGerstnerSteepness(steepness: number): void {
    this.config.gerstnerSteepness = Math.max(0, Math.min(1, steepness));
  }

  /**
   * Set wind parameters for Phillips spectrum
   */
  setWindParameters(speed: number, direction: number): void {
    this.config.windSpeed = Math.max(0, speed);
    this.config.windDirection = direction;
  }

  /**
   * Set rendering quality
   */
  setQuality(quality: number): void {
    this.config.waveQuality = Math.max(0, Math.min(2, quality));
  }

  /**
   * Set animation parameters
   */
  setAnimationParameters(speed: number, timeScale: number): void {
    this.config.animationSpeed = Math.max(0, speed);
    this.config.timeScale = Math.max(0, timeScale);
  }

  /**
   * Get current configuration
   */
  getConfig(): WaveSystemConfig {
    return { ...this.config };
  }

  /**
   * Get all patterns info
   */
  getPatterns(): Map<string, WavePattern> {
    return new Map(this.patterns);
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = {
      gerstnerWeight: 0.3,
      phillipsWeight: 0.2,
      caWeight: 0.2,
      gerstnerSteepness: 0.5,
      windSpeed: 10.0,
      windDirection: 0.0,
      waveQuality: 1.0,
      animationSpeed: 1.0,
      timeScale: 1.0
    };

    this.initializePatterns();
    this.validateWeights();
  }

  /**
   * Create preset configurations
   */
  applyPreset(presetName: string): void {
    switch (presetName) {
      case 'calm':
        this.config.gerstnerWeight = 0.1;
        this.config.phillipsWeight = 0.3;
        this.config.caWeight = 0.1;
        this.config.windSpeed = 5.0;
        this.config.gerstnerSteepness = 0.2;
        break;

      case 'moderate':
        this.config.gerstnerWeight = 0.3;
        this.config.phillipsWeight = 0.2;
        this.config.caWeight = 0.2;
        this.config.windSpeed = 10.0;
        this.config.gerstnerSteepness = 0.5;
        break;

      case 'rough':
        this.config.gerstnerWeight = 0.4;
        this.config.phillipsWeight = 0.1;
        this.config.caWeight = 0.3;
        this.config.windSpeed = 20.0;
        this.config.gerstnerSteepness = 0.8;
        break;

      case 'chaotic':
        this.config.gerstnerWeight = 0.25;
        this.config.phillipsWeight = 0.25;
        this.config.caWeight = 0.4;
        this.config.windSpeed = 15.0;
        this.config.gerstnerSteepness = 0.6;
        break;

      default:
        console.warn(`Unknown preset: ${presetName}`);
        return;
    }

    this.initializePatterns();
    this.validateWeights();
  }

  /**
   * Animate wave parameters over time for dynamic effects
   */
  updateDynamicParameters(time: number): void {
    // Slowly vary wind direction for natural movement
    const windVariation = Math.sin(time * 0.1) * 0.3;
    this.config.windDirection = windVariation;

    // Subtle variation in Gerstner steepness
    const steepnessBase = 0.5;
    const steepnessVariation = Math.sin(time * 0.05) * 0.2;
    this.config.gerstnerSteepness = Math.max(0.1, Math.min(0.9, steepnessBase + steepnessVariation));

    // Optional: gradually shift pattern weights for organic variation
    const weightVariation = Math.sin(time * 0.02) * 0.1;

    if (this.config.gerstnerWeight > 0) {
      this.config.gerstnerWeight = Math.max(0.1, Math.min(0.5, 0.3 + weightVariation));
    }

    if (this.config.phillipsWeight > 0) {
      this.config.phillipsWeight = Math.max(0.1, Math.min(0.4, 0.2 - weightVariation * 0.5));
    }

    this.validateWeights();
  }
}
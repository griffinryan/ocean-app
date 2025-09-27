/**
 * WavePatternManager handles dynamic wave patterns and their interactions
 */

import { Vec3 } from '../utils/math';

export interface GerstnerWave {
  amplitude: number;
  wavelength: number;
  speed: number;
  direction: Vec3;
  steepness: number;
  phaseOffset: number;
}

export interface SwellSystem {
  centerDirection: Vec3;
  spreadAngle: number;
  baseWavelength: number;
  amplitude: number;
  speed: number;
  origin: Vec3;
  waves: GerstnerWave[];
}

export interface ChoppyWaveLayer {
  windDirection: Vec3;
  windSpeed: number;
  frequency: number;
  amplitude: number;
  modulation: number;
}

export interface WavePattern {
  name: string;
  primaryWaves: GerstnerWave[];
  swellSystems: SwellSystem[];
  choppyLayer: ChoppyWaveLayer;
  foamThreshold: number;
  waveScale: number;
}

export enum WavePatternType {
  CALM = 0,
  GENTLE = 1,
  MODERATE = 2,
  ROUGH = 3,
  STORM = 4,
  SWELL_NORTH = 5,
  SWELL_SOUTH = 6,
  CROSSING_SEAS = 7
}

export class WavePatternManager {
  private currentPattern: WavePattern;
  private targetPattern: WavePattern;
  private transitionProgress: number = 1.0;
  private transitionDuration: number = 3.0; // seconds
  private transitionStartTime: number = 0;

  // Wave pattern presets
  private patterns: Map<WavePatternType, WavePattern> = new Map();

  // Dynamic parameters
  private globalWindDirection: Vec3 = new Vec3(1, 0, 0);
  private globalWindSpeed: number = 5.0;
  private waveEnergyMultiplier: number = 1.0;

  constructor() {
    this.initializePatterns();
    this.currentPattern = this.patterns.get(WavePatternType.GENTLE)!;
    this.targetPattern = this.currentPattern;
  }

  /**
   * Initialize all wave pattern presets
   */
  private initializePatterns(): void {
    // CALM - Very gentle, almost flat
    this.patterns.set(WavePatternType.CALM, {
      name: "Calm Waters",
      primaryWaves: [
        this.createGerstnerWave(0.08, 12.0, 0.8, 0, 0.1),
        this.createGerstnerWave(0.06, 18.0, 1.0, 45, 0.1),
        this.createGerstnerWave(0.04, 25.0, 0.6, 90, 0.05)
      ],
      swellSystems: [],
      choppyLayer: {
        windDirection: new Vec3(1, 0, 0),
        windSpeed: 2.0,
        frequency: 15.0,
        amplitude: 0.02,
        modulation: 0.5
      },
      foamThreshold: 0.15,
      waveScale: 1.0
    });

    // GENTLE - Pleasant sailing conditions
    this.patterns.set(WavePatternType.GENTLE, {
      name: "Gentle Breeze",
      primaryWaves: [
        this.createGerstnerWave(0.15, 8.0, 1.2, 0, 0.3),
        this.createGerstnerWave(0.12, 12.0, 1.0, 30, 0.25),
        this.createGerstnerWave(0.10, 16.0, 0.8, 60, 0.2),
        this.createGerstnerWave(0.08, 6.0, 1.5, 15, 0.35)
      ],
      swellSystems: [],
      choppyLayer: {
        windDirection: new Vec3(1, 0, 0),
        windSpeed: 5.0,
        frequency: 12.0,
        amplitude: 0.04,
        modulation: 0.7
      },
      foamThreshold: 0.18,
      waveScale: 1.0
    });

    // MODERATE - Active wave conditions
    this.patterns.set(WavePatternType.MODERATE, {
      name: "Moderate Seas",
      primaryWaves: [
        this.createGerstnerWave(0.25, 6.0, 1.5, 0, 0.4),
        this.createGerstnerWave(0.22, 8.0, 1.3, 25, 0.35),
        this.createGerstnerWave(0.18, 10.0, 1.1, 50, 0.3),
        this.createGerstnerWave(0.15, 12.0, 0.9, 75, 0.25),
        this.createGerstnerWave(0.12, 4.0, 1.8, 10, 0.45)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0.8, 0, 0.6), 30, 20.0, 0.2, 0.7)
      ],
      choppyLayer: {
        windDirection: new Vec3(1, 0, 0),
        windSpeed: 8.0,
        frequency: 10.0,
        amplitude: 0.06,
        modulation: 0.8
      },
      foamThreshold: 0.22,
      waveScale: 1.0
    });

    // ROUGH - Challenging conditions
    this.patterns.set(WavePatternType.ROUGH, {
      name: "Rough Seas",
      primaryWaves: [
        this.createGerstnerWave(0.35, 5.0, 1.8, 0, 0.5),
        this.createGerstnerWave(0.30, 7.0, 1.6, 20, 0.45),
        this.createGerstnerWave(0.25, 9.0, 1.4, 40, 0.4),
        this.createGerstnerWave(0.20, 11.0, 1.2, 60, 0.35),
        this.createGerstnerWave(0.18, 3.5, 2.2, 5, 0.55),
        this.createGerstnerWave(0.15, 4.5, 2.0, 15, 0.5)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0.9, 0, 0.436), 25, 18.0, 0.3, 0.8),
        this.createSwellSystem(new Vec3(0.5, 0, 0.866), 35, 22.0, 0.25, 0.6)
      ],
      choppyLayer: {
        windDirection: new Vec3(1, 0, 0),
        windSpeed: 12.0,
        frequency: 8.0,
        amplitude: 0.08,
        modulation: 0.9
      },
      foamThreshold: 0.28,
      waveScale: 1.0
    });

    // STORM - Extreme conditions
    this.patterns.set(WavePatternType.STORM, {
      name: "Storm Seas",
      primaryWaves: [
        this.createGerstnerWave(0.45, 4.0, 2.2, 0, 0.6),
        this.createGerstnerWave(0.40, 5.5, 2.0, 15, 0.55),
        this.createGerstnerWave(0.35, 7.0, 1.8, 30, 0.5),
        this.createGerstnerWave(0.30, 8.5, 1.6, 45, 0.45),
        this.createGerstnerWave(0.25, 3.0, 2.5, 8, 0.65),
        this.createGerstnerWave(0.22, 10.0, 1.4, 60, 0.4),
        this.createGerstnerWave(0.20, 2.5, 2.8, 22, 0.7)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0.866, 0, 0.5), 20, 16.0, 0.4, 1.0),
        this.createSwellSystem(new Vec3(0.7, 0, 0.714), 30, 20.0, 0.35, 0.8),
        this.createSwellSystem(new Vec3(0.2, 0, 0.98), 40, 25.0, 0.3, 0.6)
      ],
      choppyLayer: {
        windDirection: new Vec3(1, 0, 0),
        windSpeed: 18.0,
        frequency: 6.0,
        amplitude: 0.12,
        modulation: 1.0
      },
      foamThreshold: 0.35,
      waveScale: 1.0
    });

    // SWELL_NORTH - Long period swell from north
    this.patterns.set(WavePatternType.SWELL_NORTH, {
      name: "Northern Swell",
      primaryWaves: [
        this.createGerstnerWave(0.12, 10.0, 1.0, 15, 0.2),
        this.createGerstnerWave(0.08, 14.0, 0.8, 30, 0.15)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0, 0, 1), 15, 35.0, 0.4, 0.5),
        this.createSwellSystem(new Vec3(0.259, 0, 0.966), 20, 40.0, 0.35, 0.4)
      ],
      choppyLayer: {
        windDirection: new Vec3(0.7, 0, 0.714),
        windSpeed: 6.0,
        frequency: 12.0,
        amplitude: 0.03,
        modulation: 0.6
      },
      foamThreshold: 0.20,
      waveScale: 1.0
    });

    // SWELL_SOUTH - Long period swell from south
    this.patterns.set(WavePatternType.SWELL_SOUTH, {
      name: "Southern Swell",
      primaryWaves: [
        this.createGerstnerWave(0.14, 12.0, 0.9, 165, 0.25),
        this.createGerstnerWave(0.10, 16.0, 0.7, 180, 0.2)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0, 0, -1), 18, 38.0, 0.45, 0.6),
        this.createSwellSystem(new Vec3(-0.259, 0, -0.966), 25, 42.0, 0.4, 0.45)
      ],
      choppyLayer: {
        windDirection: new Vec3(0.5, 0, -0.866),
        windSpeed: 7.0,
        frequency: 11.0,
        amplitude: 0.04,
        modulation: 0.65
      },
      foamThreshold: 0.22,
      waveScale: 1.0
    });

    // CROSSING_SEAS - Multiple swell systems intersecting
    this.patterns.set(WavePatternType.CROSSING_SEAS, {
      name: "Crossing Seas",
      primaryWaves: [
        this.createGerstnerWave(0.18, 8.0, 1.2, 45, 0.3),
        this.createGerstnerWave(0.15, 10.0, 1.0, 135, 0.25),
        this.createGerstnerWave(0.12, 12.0, 0.8, 0, 0.2)
      ],
      swellSystems: [
        this.createSwellSystem(new Vec3(0.707, 0, 0.707), 20, 25.0, 0.3, 0.7),
        this.createSwellSystem(new Vec3(-0.707, 0, 0.707), 20, 28.0, 0.35, 0.6),
        this.createSwellSystem(new Vec3(0.866, 0, -0.5), 30, 32.0, 0.25, 0.5)
      ],
      choppyLayer: {
        windDirection: new Vec3(0.8, 0, 0.6),
        windSpeed: 9.0,
        frequency: 9.0,
        amplitude: 0.07,
        modulation: 0.85
      },
      foamThreshold: 0.25,
      waveScale: 1.0
    });
  }

  /**
   * Create a Gerstner wave with specified parameters
   */
  private createGerstnerWave(
    amplitude: number,
    wavelength: number,
    speed: number,
    directionDegrees: number,
    steepness: number
  ): GerstnerWave {
    const rad = directionDegrees * Math.PI / 180;
    return {
      amplitude,
      wavelength,
      speed,
      direction: new Vec3(Math.cos(rad), 0, Math.sin(rad)),
      steepness: Math.min(steepness, 0.9), // Prevent loops
      phaseOffset: Math.random() * Math.PI * 2
    };
  }

  /**
   * Create a swell system with multiple coherent waves
   */
  private createSwellSystem(
    centerDirection: Vec3,
    spreadAngle: number,
    baseWavelength: number,
    amplitude: number,
    speed: number
  ): SwellSystem {
    const waves: GerstnerWave[] = [];
    const numWaves = 4;

    for (let i = 0; i < numWaves; i++) {
      const angleOffset = (spreadAngle * (i - numWaves/2) / numWaves) * Math.PI / 180;
      const baseAngle = Math.atan2(centerDirection.z, centerDirection.x);
      const waveAngle = baseAngle + angleOffset;

      waves.push({
        amplitude: amplitude * (0.7 + Math.random() * 0.3),
        wavelength: baseWavelength * (0.8 + Math.random() * 0.4),
        speed: speed * (0.9 + Math.random() * 0.2),
        direction: new Vec3(Math.cos(waveAngle), 0, Math.sin(waveAngle)),
        steepness: 0.15 + Math.random() * 0.1,
        phaseOffset: Math.random() * Math.PI * 2
      });
    }

    return {
      centerDirection,
      spreadAngle,
      baseWavelength,
      amplitude,
      speed,
      origin: new Vec3(0, 0, 0),
      waves
    };
  }

  /**
   * Switch to a new wave pattern with smooth transition
   */
  switchPattern(patternType: WavePatternType, transitionDuration: number = 3.0): void {
    const newPattern = this.patterns.get(patternType);
    if (!newPattern || newPattern === this.targetPattern) return;

    this.targetPattern = newPattern;
    this.transitionDuration = transitionDuration;
    this.transitionProgress = 0.0;
    this.transitionStartTime = performance.now() / 1000;
  }

  /**
   * Update wave patterns and handle transitions
   */
  update(currentTime: number): void {
    // Handle pattern transitions
    if (this.transitionProgress < 1.0) {
      const elapsed = currentTime - this.transitionStartTime;
      this.transitionProgress = Math.min(elapsed / this.transitionDuration, 1.0);

      // Smooth transition curve
      const t = this.smoothStep(this.transitionProgress);

      if (t >= 1.0) {
        this.currentPattern = this.targetPattern;
        this.transitionProgress = 1.0;
      }
    }

    // Update dynamic wave properties based on global conditions
    this.updateDynamicProperties(currentTime);
  }

  /**
   * Update dynamic wave properties
   */
  private updateDynamicProperties(time: number): void {
    // Add time-varying elements to make waves more organic
    const slowOscillation = Math.sin(time * 0.1) * 0.1;
    const fastOscillation = Math.sin(time * 0.3) * 0.05;

    // Update wind direction slightly over time
    const windAngle = time * 0.05 + slowOscillation;
    this.globalWindDirection = new Vec3(Math.cos(windAngle), 0, Math.sin(windAngle));

    // Update wind speed with some variation
    this.globalWindSpeed = 5.0 + slowOscillation * 2.0 + fastOscillation;

    // Update wave energy with natural variation
    this.waveEnergyMultiplier = 1.0 + slowOscillation * 0.2 + fastOscillation * 0.1;
  }

  /**
   * Smooth step interpolation
   */
  private smoothStep(t: number): number {
    return t * t * (3.0 - 2.0 * t);
  }

  /**
   * Get current interpolated wave pattern for rendering
   */
  getCurrentWaveData(): {
    primaryWaves: GerstnerWave[];
    swellSystems: SwellSystem[];
    choppyLayer: ChoppyWaveLayer;
    foamThreshold: number;
    waveScale: number;
    transitionFactor: number;
  } {
    if (this.transitionProgress >= 1.0) {
      return {
        primaryWaves: this.currentPattern.primaryWaves,
        swellSystems: this.currentPattern.swellSystems,
        choppyLayer: this.currentPattern.choppyLayer,
        foamThreshold: this.currentPattern.foamThreshold,
        waveScale: this.currentPattern.waveScale * this.waveEnergyMultiplier,
        transitionFactor: 1.0
      };
    }

    // Return interpolated values during transition
    const t = this.smoothStep(this.transitionProgress);
    return {
      primaryWaves: this.interpolateWaves(this.currentPattern.primaryWaves, this.targetPattern.primaryWaves, t),
      swellSystems: this.interpolateSwellSystems(this.currentPattern.swellSystems, this.targetPattern.swellSystems, t),
      choppyLayer: this.interpolateChoppyLayer(this.currentPattern.choppyLayer, this.targetPattern.choppyLayer, t),
      foamThreshold: this.lerp(this.currentPattern.foamThreshold, this.targetPattern.foamThreshold, t),
      waveScale: this.lerp(this.currentPattern.waveScale, this.targetPattern.waveScale, t) * this.waveEnergyMultiplier,
      transitionFactor: t
    };
  }

  /**
   * Interpolate between two wave arrays
   */
  private interpolateWaves(waves1: GerstnerWave[], waves2: GerstnerWave[], t: number): GerstnerWave[] {
    const maxLength = Math.max(waves1.length, waves2.length);
    const result: GerstnerWave[] = [];

    for (let i = 0; i < maxLength; i++) {
      const wave1 = waves1[i] || this.createDefaultWave();
      const wave2 = waves2[i] || this.createDefaultWave();

      result.push({
        amplitude: this.lerp(wave1.amplitude, wave2.amplitude, t),
        wavelength: this.lerp(wave1.wavelength, wave2.wavelength, t),
        speed: this.lerp(wave1.speed, wave2.speed, t),
        direction: this.lerpVec3(wave1.direction, wave2.direction, t),
        steepness: this.lerp(wave1.steepness, wave2.steepness, t),
        phaseOffset: this.lerpAngle(wave1.phaseOffset, wave2.phaseOffset, t)
      });
    }

    return result;
  }

  /**
   * Interpolate between swell systems
   */
  private interpolateSwellSystems(systems1: SwellSystem[], systems2: SwellSystem[], t: number): SwellSystem[] {
    // For simplicity, use the target system's structure during transition
    // In a more advanced implementation, you could interpolate individual swell properties
    return t < 0.5 ? systems1 : systems2;
  }

  /**
   * Interpolate choppy layer properties
   */
  private interpolateChoppyLayer(layer1: ChoppyWaveLayer, layer2: ChoppyWaveLayer, t: number): ChoppyWaveLayer {
    return {
      windDirection: this.lerpVec3(layer1.windDirection, layer2.windDirection, t),
      windSpeed: this.lerp(layer1.windSpeed, layer2.windSpeed, t),
      frequency: this.lerp(layer1.frequency, layer2.frequency, t),
      amplitude: this.lerp(layer1.amplitude, layer2.amplitude, t),
      modulation: this.lerp(layer1.modulation, layer2.modulation, t)
    };
  }

  /**
   * Create a default wave for interpolation padding
   */
  private createDefaultWave(): GerstnerWave {
    return {
      amplitude: 0,
      wavelength: 10,
      speed: 1,
      direction: new Vec3(1, 0, 0),
      steepness: 0,
      phaseOffset: 0
    };
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Vector3 interpolation
   */
  private lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
    return new Vec3(
      this.lerp(a.x, b.x, t),
      this.lerp(a.y, b.y, t),
      this.lerp(a.z, b.z, t)
    );
  }

  /**
   * Angle interpolation (handles wrapping)
   */
  private lerpAngle(a: number, b: number, t: number): number {
    const diff = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
    return a + diff * t;
  }

  /**
   * Get current pattern type
   */
  getCurrentPatternType(): WavePatternType {
    for (const [type, pattern] of this.patterns) {
      if (pattern === this.currentPattern) {
        return type;
      }
    }
    return WavePatternType.GENTLE;
  }

  /**
   * Get pattern name for display
   */
  getCurrentPatternName(): string {
    return this.currentPattern.name;
  }

  /**
   * Get global wind properties
   */
  getWindProperties(): { direction: Vec3; speed: number } {
    return {
      direction: this.globalWindDirection,
      speed: this.globalWindSpeed
    };
  }

  /**
   * Set manual wind override
   */
  setWindProperties(direction: Vec3, speed: number): void {
    this.globalWindDirection = direction;
    this.globalWindSpeed = speed;
  }
}
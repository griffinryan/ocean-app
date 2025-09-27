/**
 * WavePatternManager handles dynamic wave patterns and their interactions
 * Enhanced with physics-based wave dynamics and natural evolution
 */

import { Vec3 } from '../utils/math';
import { WaveDynamics } from './WaveDynamics';

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
  turbulenceStrength: number;
  foamPersistence: number;
}

export interface DynamicWaveProperties {
  baseEnergy: number;
  coherenceLength: number;
  temporalStability: number;
  crossWaveInteraction: number;
  breakingThreshold: number;
  dissipationRate: number;
}

export interface WavePattern {
  name: string;
  primaryWaves: GerstnerWave[];
  swellSystems: SwellSystem[];
  choppyLayer: ChoppyWaveLayer;
  foamThreshold: number;
  waveScale: number;
  dynamicProperties: DynamicWaveProperties;
  naturalVariation: number;
  environmentalResponse: number;
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

  // Enhanced wave dynamics system
  private waveDynamics: WaveDynamics;
  private dynamicWaveGeneration: boolean = true;

  // Dynamic parameters
  private globalWindDirection: Vec3 = new Vec3(1, 0, 0);
  private globalWindSpeed: number = 5.0;
  private waveEnergyMultiplier: number = 1.0;
  private environmentalInfluence: number = 0.8;
  private memoryDecay: number = 0.95;

  constructor() {
    this.waveDynamics = new WaveDynamics();
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
        modulation: 0.5,
        turbulenceStrength: 0.1,
        foamPersistence: 0.3
      },
      foamThreshold: 0.15,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.2,
        coherenceLength: 50.0,
        temporalStability: 0.9,
        crossWaveInteraction: 0.1,
        breakingThreshold: 0.3,
        dissipationRate: 0.02
      },
      naturalVariation: 0.2,
      environmentalResponse: 0.5
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
        modulation: 0.7,
        turbulenceStrength: 0.2,
        foamPersistence: 0.4
      },
      foamThreshold: 0.18,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.4,
        coherenceLength: 40.0,
        temporalStability: 0.8,
        crossWaveInteraction: 0.2,
        breakingThreshold: 0.35,
        dissipationRate: 0.03
      },
      naturalVariation: 0.3,
      environmentalResponse: 0.6
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
        modulation: 0.8,
        turbulenceStrength: 0.4,
        foamPersistence: 0.5
      },
      foamThreshold: 0.22,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.6,
        coherenceLength: 30.0,
        temporalStability: 0.7,
        crossWaveInteraction: 0.3,
        breakingThreshold: 0.4,
        dissipationRate: 0.04
      },
      naturalVariation: 0.4,
      environmentalResponse: 0.7
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
        modulation: 0.9,
        turbulenceStrength: 0.6,
        foamPersistence: 0.6
      },
      foamThreshold: 0.28,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.8,
        coherenceLength: 25.0,
        temporalStability: 0.6,
        crossWaveInteraction: 0.4,
        breakingThreshold: 0.45,
        dissipationRate: 0.05
      },
      naturalVariation: 0.5,
      environmentalResponse: 0.8
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
        modulation: 1.0,
        turbulenceStrength: 0.8,
        foamPersistence: 0.8
      },
      foamThreshold: 0.35,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 1.0,
        coherenceLength: 20.0,
        temporalStability: 0.5,
        crossWaveInteraction: 0.5,
        breakingThreshold: 0.5,
        dissipationRate: 0.06
      },
      naturalVariation: 0.6,
      environmentalResponse: 0.9
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
        modulation: 0.6,
        turbulenceStrength: 0.15,
        foamPersistence: 0.3
      },
      foamThreshold: 0.20,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.5,
        coherenceLength: 80.0,
        temporalStability: 0.9,
        crossWaveInteraction: 0.1,
        breakingThreshold: 0.25,
        dissipationRate: 0.01
      },
      naturalVariation: 0.2,
      environmentalResponse: 0.4
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
        modulation: 0.65,
        turbulenceStrength: 0.18,
        foamPersistence: 0.35
      },
      foamThreshold: 0.22,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.55,
        coherenceLength: 75.0,
        temporalStability: 0.85,
        crossWaveInteraction: 0.15,
        breakingThreshold: 0.28,
        dissipationRate: 0.015
      },
      naturalVariation: 0.25,
      environmentalResponse: 0.45
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
        modulation: 0.85,
        turbulenceStrength: 0.5,
        foamPersistence: 0.7
      },
      foamThreshold: 0.25,
      waveScale: 1.0,
      dynamicProperties: {
        baseEnergy: 0.7,
        coherenceLength: 35.0,
        temporalStability: 0.6,
        crossWaveInteraction: 0.6,
        breakingThreshold: 0.35,
        dissipationRate: 0.08
      },
      naturalVariation: 0.7,
      environmentalResponse: 0.8
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
   * Update wave patterns and handle transitions with enhanced dynamics
   */
  update(currentTime: number): void {
    // Update the underlying wave dynamics system
    const deltaTime = currentTime - (this.lastUpdateTime || currentTime);
    this.waveDynamics.update(deltaTime);
    this.lastUpdateTime = currentTime;

    // Handle pattern transitions
    if (this.transitionProgress < 1.0) {
      const elapsed = currentTime - this.transitionStartTime;
      this.transitionProgress = Math.min(elapsed / this.transitionDuration, 1.0);

      // Smooth transition curve
      const t = this.smoothStep(this.transitionProgress);

      if (t >= 1.0) {
        this.currentPattern = this.targetPattern;
        this.transitionProgress = 1.0;
        this.syncDynamicsWithPattern();
      }
    }

    // Update dynamic wave properties based on global conditions
    this.updateDynamicProperties(currentTime);

    // Update wind conditions in dynamics system
    this.updateWindConditions(currentTime);
  }

  private lastUpdateTime: number = 0;

  /**
   * Update dynamic wave properties with enhanced natural variation
   */
  private updateDynamicProperties(time: number): void {
    const pattern = this.currentPattern;
    const dynamics = pattern.dynamicProperties;

    // Multi-scale temporal variation for more organic behavior
    const ultraSlowOscillation = Math.sin(time * 0.02) * 0.05; // Weather-scale changes
    const slowOscillation = Math.sin(time * 0.1) * 0.1; // Swell evolution
    const mediumOscillation = Math.sin(time * 0.3) * 0.05; // Wave groups
    const fastOscillation = Math.sin(time * 0.8) * 0.02; // Individual wave variation

    // Natural wind direction evolution with memory
    const naturalShift = ultraSlowOscillation + slowOscillation * 0.5;
    const currentAngle = Math.atan2(this.globalWindDirection.z, this.globalWindDirection.x);
    const targetAngle = currentAngle + naturalShift * pattern.naturalVariation;

    // Apply memory decay for smooth transitions
    const memoryFactor = this.memoryDecay;
    const newAngle = currentAngle * memoryFactor + targetAngle * (1 - memoryFactor);
    this.globalWindDirection = new Vec3(Math.cos(newAngle), 0, Math.sin(newAngle));

    // Enhanced wind speed variation with environmental response
    const baseSpeed = 5.0 + pattern.dynamicProperties.baseEnergy * 8.0;
    const speedVariation = slowOscillation * 3.0 + mediumOscillation * 1.5 + fastOscillation * 0.8;
    const environmentalFactor = 1.0 + ultraSlowOscillation * pattern.environmentalResponse;

    this.globalWindSpeed = (baseSpeed + speedVariation) * environmentalFactor;
    this.globalWindSpeed = Math.max(1.0, Math.min(25.0, this.globalWindSpeed));

    // Dynamic wave energy with temporal coherence
    const energyVariation = slowOscillation * 0.3 + mediumOscillation * 0.15 + fastOscillation * 0.1;
    this.waveEnergyMultiplier = 1.0 + energyVariation * dynamics.temporalStability;

    // Environmental influence factor
    this.environmentalInfluence = 0.5 + ultraSlowOscillation * 0.3 + slowOscillation * 0.2;
  }

  /**
   * Update wind conditions in the dynamics system
   */
  private updateWindConditions(_time: number): void {
    const pattern = this.currentPattern;

    // Blend current pattern wind with global wind evolution
    const patternWind = pattern.choppyLayer.windDirection;
    const blendFactor = this.environmentalInfluence * pattern.environmentalResponse;

    const blendedDirection = patternWind.multiplyScalar(1 - blendFactor)
      .add(this.globalWindDirection.multiplyScalar(blendFactor))
      .normalize();

    const blendedSpeed = pattern.choppyLayer.windSpeed * (1 - blendFactor) +
                        this.globalWindSpeed * blendFactor;

    this.waveDynamics.setWindCondition(
      blendedDirection,
      blendedSpeed,
      pattern.naturalVariation
    );
  }

  /**
   * Synchronize dynamics system with current pattern
   */
  private syncDynamicsWithPattern(): void {
    const pattern = this.currentPattern;
    this.waveDynamics.setWindCondition(
      pattern.choppyLayer.windDirection,
      pattern.choppyLayer.windSpeed,
      pattern.naturalVariation
    );
  }

  /**
   * Smooth step interpolation
   */
  private smoothStep(t: number): number {
    return t * t * (3.0 - 2.0 * t);
  }

  /**
   * Get current interpolated wave pattern for rendering with enhanced dynamics
   */
  getCurrentWaveData(): {
    primaryWaves: GerstnerWave[];
    swellSystems: SwellSystem[];
    choppyLayer: ChoppyWaveLayer;
    foamThreshold: number;
    waveScale: number;
    transitionFactor: number;
    dynamicWaves: GerstnerWave[];
    turbulenceMap: Map<string, Vec3>;
    foamMap: Map<string, number>;
  } {
    let primaryWaves: GerstnerWave[];
    let swellSystems: SwellSystem[];
    let choppyLayer: ChoppyWaveLayer;
    let foamThreshold: number;
    let waveScale: number;
    let transitionFactor: number;

    if (this.transitionProgress >= 1.0) {
      primaryWaves = this.currentPattern.primaryWaves;
      swellSystems = this.currentPattern.swellSystems;
      choppyLayer = this.currentPattern.choppyLayer;
      foamThreshold = this.currentPattern.foamThreshold;
      waveScale = this.currentPattern.waveScale * this.waveEnergyMultiplier;
      transitionFactor = 1.0;
    } else {
      // Return interpolated values during transition
      const t = this.smoothStep(this.transitionProgress);
      primaryWaves = this.interpolateWaves(this.currentPattern.primaryWaves, this.targetPattern.primaryWaves, t);
      swellSystems = this.interpolateSwellSystems(this.currentPattern.swellSystems, this.targetPattern.swellSystems, t);
      choppyLayer = this.interpolateChoppyLayer(this.currentPattern.choppyLayer, this.targetPattern.choppyLayer, t);
      foamThreshold = this.lerp(this.currentPattern.foamThreshold, this.targetPattern.foamThreshold, t);
      waveScale = this.lerp(this.currentPattern.waveScale, this.targetPattern.waveScale, t) * this.waveEnergyMultiplier;
      transitionFactor = t;
    }

    // Get dynamic waves from physics simulation
    let dynamicWaves: GerstnerWave[] = [];
    if (this.dynamicWaveGeneration) {
      dynamicWaves = this.waveDynamics.getGerstnerWaves();

      // Blend with pattern waves based on environmental influence
      const blendFactor = this.environmentalInfluence;
      for (let i = 0; i < Math.min(primaryWaves.length, dynamicWaves.length); i++) {
        const patternWave = primaryWaves[i];
        const dynamicWave = dynamicWaves[i];

        // Blend amplitudes and directions
        primaryWaves[i].amplitude = this.lerp(
          patternWave.amplitude,
          dynamicWave.amplitude,
          blendFactor
        );

        primaryWaves[i].direction = this.lerpVec3(
          patternWave.direction,
          dynamicWave.direction,
          blendFactor * 0.3 // Reduce direction blending for stability
        ).normalize();
      }
    }

    // Generate turbulence and foam maps for shader
    const turbulenceMap = new Map<string, Vec3>();
    const foamMap = new Map<string, number>();

    // Sample turbulence and foam at grid points for shader interpolation
    const gridSize = 16;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const worldPos = new Vec3(
          (x - gridSize/2) * 10,
          0,
          (z - gridSize/2) * 10
        );

        const key = `${x}_${z}`;
        turbulenceMap.set(key, this.waveDynamics.getTurbulenceAt(worldPos));
        foamMap.set(key, this.waveDynamics.getFoamAt(worldPos));
      }
    }

    return {
      primaryWaves,
      swellSystems,
      choppyLayer,
      foamThreshold,
      waveScale,
      transitionFactor,
      dynamicWaves,
      turbulenceMap,
      foamMap
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
      modulation: this.lerp(layer1.modulation, layer2.modulation, t),
      turbulenceStrength: this.lerp(layer1.turbulenceStrength, layer2.turbulenceStrength, t),
      foamPersistence: this.lerp(layer1.foamPersistence, layer2.foamPersistence, t)
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
   * Set manual wind override and update dynamics
   */
  setWindProperties(direction: Vec3, speed: number): void {
    this.globalWindDirection = direction.normalize();
    this.globalWindSpeed = Math.max(1.0, Math.min(25.0, speed));

    // Update dynamics system
    this.waveDynamics.setWindCondition(
      this.globalWindDirection,
      this.globalWindSpeed,
      this.currentPattern.naturalVariation
    );
  }

  /**
   * Enable/disable dynamic wave generation
   */
  setDynamicWaveGeneration(enabled: boolean): void {
    this.dynamicWaveGeneration = enabled;
  }


  /**
   * Get wave dynamics system for advanced control
   */
  getWaveDynamics(): WaveDynamics {
    return this.waveDynamics;
  }

  /**
   * Set environmental influence factor
   */
  setEnvironmentalInfluence(factor: number): void {
    this.environmentalInfluence = Math.max(0.0, Math.min(1.0, factor));
  }

  /**
   * Get current environmental conditions
   */
  getEnvironmentalConditions() {
    return {
      wind: this.waveDynamics.getWindCondition(),
      weather: this.waveDynamics.getWeatherSystem(),
      influence: this.environmentalInfluence,
      energy: this.waveEnergyMultiplier
    };
  }
}
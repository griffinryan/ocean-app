/**
 * Advanced wave dynamics system for physics-based ocean simulation
 * Implements Phillips spectrum, wave energy cascade, and natural wave behaviors
 */

import { Vec3 } from '../utils/math';
import { GerstnerWave } from './WavePatternManager';

export interface WaveSpectrum {
  amplitude: number;
  wavelength: number;
  frequency: number;
  direction: Vec3;
  energy: number;
  age: number;
  birthTime: number;
}

export interface TurbulenceField {
  position: Vec3;
  strength: number;
  radius: number;
  vorticity: Vec3;
  lifetime: number;
  age: number;
}

export interface FoamPersistence {
  position: Vec3;
  intensity: number;
  velocity: Vec3;
  lifetime: number;
  age: number;
}

export interface WindCondition {
  direction: Vec3;
  speed: number;
  gustiness: number;
  stability: number;
}

export class WaveDynamics {
  private waveSpectrum: WaveSpectrum[] = [];
  private turbulenceFields: TurbulenceField[] = [];
  private foamPersistence: FoamPersistence[] = [];

  private windCondition: WindCondition;
  private currentTime: number = 0;

  // Wave generation parameters
  private readonly gravityConstant = 9.81;
  private readonly phillipsConstant = 0.0081;
  private readonly capillaryConstant = 0.074;

  // Energy cascade parameters
  private readonly dissipationRate = 0.05;
  private readonly nonlinearCoupling = 0.12;

  // Natural variation parameters
  private weatherSystem: {
    pressure: number;
    temperature: number;
    humidity: number;
    stability: number;
  };

  constructor() {
    this.windCondition = {
      direction: new Vec3(1, 0, 0),
      speed: 8.0,
      gustiness: 0.3,
      stability: 0.7
    };

    this.weatherSystem = {
      pressure: 1013.25, // Standard atmospheric pressure
      temperature: 15.0,  // Celsius
      humidity: 0.65,
      stability: 0.8
    };

    this.initializeWaveSpectrum();
  }

  /**
   * Initialize wave spectrum using Phillips model
   */
  private initializeWaveSpectrum(): void {
    this.waveSpectrum = [];

    const windSpeed = this.windCondition.speed;
    const windDirection = this.windCondition.direction.clone().normalize();

    // Generate waves across frequency spectrum
    for (let i = 0; i < 32; i++) {
      const frequency = 0.1 + i * 0.15; // 0.1 to 4.75 Hz
      const wavelength = (this.gravityConstant / (2 * Math.PI)) / (frequency * frequency);

      // Phillips spectrum calculation
      const phillipsAmplitude = this.calculatePhillipsAmplitude(frequency, windSpeed, windDirection);

      // Add directional spread
      const spreadAngle = 60 * Math.PI / 180; // 60 degrees spread
      const numDirections = 8;

      for (let j = 0; j < numDirections; j++) {
        const angleOffset = (j - numDirections/2) * spreadAngle / numDirections;
        const waveDirection = this.rotateVector(windDirection, angleOffset);

        // Directional distribution (cosine squared)
        const directionalFactor = Math.pow(Math.cos(angleOffset), 2);

        const wave: WaveSpectrum = {
          amplitude: phillipsAmplitude * directionalFactor,
          wavelength: wavelength * (0.9 + Math.random() * 0.2), // Add natural variation
          frequency: frequency,
          direction: waveDirection,
          energy: phillipsAmplitude * phillipsAmplitude,
          age: 0,
          birthTime: this.currentTime
        };

        this.waveSpectrum.push(wave);
      }
    }
  }

  /**
   * Calculate Phillips spectrum amplitude
   */
  private calculatePhillipsAmplitude(frequency: number, windSpeed: number, windDirection: Vec3): number {
    const omega = 2 * Math.PI * frequency;
    const k = omega * omega / this.gravityConstant;

    // Phillips spectrum with gravity and capillary effects
    const gravityTerm = this.phillipsConstant * (windSpeed * windSpeed) / (omega * omega * omega * omega);
    const capillaryTerm = this.capillaryConstant * k * k;

    // Wind alignment factor
    const windAlignment = Math.max(0, Math.pow(windDirection.dot(new Vec3(1, 0, 0)), 2));

    // Age factor (fully developed vs developing seas)
    const dimensionlessFetch = this.gravityConstant * 1000 / (windSpeed * windSpeed); // Assume 1km fetch
    const ageFactor = Math.min(1.0, dimensionlessFetch / 22000);

    return Math.sqrt(gravityTerm * windAlignment * ageFactor) * (1 + capillaryTerm);
  }

  /**
   * Rotate vector around Y axis
   */
  private rotateVector(vector: Vec3, angle: number): Vec3 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vec3(
      vector.x * cos - vector.z * sin,
      vector.y,
      vector.x * sin + vector.z * cos
    );
  }

  /**
   * Update wave dynamics with time evolution
   */
  update(deltaTime: number): void {
    this.currentTime += deltaTime;

    this.updateWindConditions(deltaTime);
    this.updateWaveSpectrum(deltaTime);
    this.updateWaveInteractions(deltaTime);
    this.updateTurbulenceFields(deltaTime);
    this.updateFoamPersistence(deltaTime);
    this.updateWeatherSystem(deltaTime);
  }

  /**
   * Update wind conditions with natural variation
   */
  private updateWindConditions(deltaTime: number): void {
    const time = this.currentTime;

    // Natural wind speed variation
    const gustiness = this.windCondition.gustiness;
    const speedVariation = Math.sin(time * 0.3) * gustiness * 0.5 +
                          Math.sin(time * 0.8) * gustiness * 0.3 +
                          Math.sin(time * 1.2) * gustiness * 0.2;

    this.windCondition.speed *= (1.0 + speedVariation * deltaTime);
    this.windCondition.speed = Math.max(2.0, Math.min(25.0, this.windCondition.speed));

    // Wind direction shift
    const directionShift = Math.sin(time * 0.1) * 0.15 + Math.sin(time * 0.05) * 0.1;
    const baseAngle = Math.atan2(this.windCondition.direction.z, this.windCondition.direction.x);
    const newAngle = baseAngle + directionShift * deltaTime;

    this.windCondition.direction = new Vec3(Math.cos(newAngle), 0, Math.sin(newAngle));
  }

  /**
   * Update wave spectrum with energy cascade
   */
  private updateWaveSpectrum(deltaTime: number): void {
    for (let i = 0; i < this.waveSpectrum.length; i++) {
      const wave = this.waveSpectrum[i];
      wave.age += deltaTime;

      // Energy dissipation
      wave.energy *= Math.exp(-this.dissipationRate * deltaTime);

      // Amplitude decay with age
      const ageFactor = Math.exp(-wave.age * 0.01);
      wave.amplitude *= ageFactor;

      // Wave breaking for steep waves
      const steepness = 2 * Math.PI * wave.amplitude / wave.wavelength;
      if (steepness > 0.4) {
        this.generateTurbulence(wave);
        this.generateFoam(wave);
        wave.energy *= 0.7; // Energy loss from breaking
      }
    }

    // Remove old, low-energy waves
    this.waveSpectrum = this.waveSpectrum.filter(wave =>
      wave.energy > 0.001 && wave.age < 60.0
    );

    // Generate new waves based on wind conditions
    this.generateNewWaves(deltaTime);
  }

  /**
   * Generate new waves from wind input
   */
  private generateNewWaves(deltaTime: number): void {
    const windEnergy = this.windCondition.speed * this.windCondition.speed * 0.01;
    const generationRate = windEnergy * deltaTime;

    if (Math.random() < generationRate) {
      const frequency = 0.2 + Math.random() * 2.0;
      const wavelength = (this.gravityConstant / (2 * Math.PI)) / (frequency * frequency);

      const windDirection = this.windCondition.direction.clone();
      const angleSpread = (Math.random() - 0.5) * Math.PI * 0.3; // ±27 degrees
      const waveDirection = this.rotateVector(windDirection, angleSpread);

      const amplitude = this.calculatePhillipsAmplitude(frequency, this.windCondition.speed, waveDirection);

      const newWave: WaveSpectrum = {
        amplitude: amplitude * (0.5 + Math.random() * 0.5),
        wavelength: wavelength,
        frequency: frequency,
        direction: waveDirection,
        energy: amplitude * amplitude,
        age: 0,
        birthTime: this.currentTime
      };

      this.waveSpectrum.push(newWave);
    }
  }

  /**
   * Update wave-wave interactions
   */
  private updateWaveInteractions(deltaTime: number): void {
    // Simplified wave-wave interaction model
    for (let i = 0; i < this.waveSpectrum.length - 1; i++) {
      for (let j = i + 1; j < this.waveSpectrum.length; j++) {
        const wave1 = this.waveSpectrum[i];
        const wave2 = this.waveSpectrum[j];

        // Check for resonant interaction
        const frequencyRatio = wave1.frequency / wave2.frequency;
        if (frequencyRatio > 0.8 && frequencyRatio < 1.25) {
          // Energy transfer between waves
          const energyTransfer = this.nonlinearCoupling *
                               Math.min(wave1.energy, wave2.energy) * deltaTime;

          if (wave1.energy > wave2.energy) {
            wave1.energy -= energyTransfer;
            wave2.energy += energyTransfer * 0.8; // Some energy is lost
          } else {
            wave2.energy -= energyTransfer;
            wave1.energy += energyTransfer * 0.8;
          }

          // Update amplitudes
          wave1.amplitude = Math.sqrt(wave1.energy);
          wave2.amplitude = Math.sqrt(wave2.energy);
        }
      }
    }
  }

  /**
   * Generate turbulence from wave breaking
   */
  private generateTurbulence(wave: WaveSpectrum): void {
    const turbulence: TurbulenceField = {
      position: new Vec3(
        Math.random() * 100 - 50,
        0,
        Math.random() * 100 - 50
      ),
      strength: wave.amplitude * 2.0,
      radius: wave.wavelength * 0.5,
      vorticity: new Vec3(
        (Math.random() - 0.5) * 2,
        0,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(wave.amplitude),
      lifetime: 5.0 + Math.random() * 10.0,
      age: 0
    };

    this.turbulenceFields.push(turbulence);
  }

  /**
   * Generate foam from wave breaking
   */
  private generateFoam(wave: WaveSpectrum): void {
    const numFoamPatches = Math.floor(wave.amplitude * 10);

    for (let i = 0; i < numFoamPatches; i++) {
      const foam: FoamPersistence = {
        position: new Vec3(
          Math.random() * wave.wavelength - wave.wavelength * 0.5,
          0,
          Math.random() * wave.wavelength - wave.wavelength * 0.5
        ),
        intensity: wave.amplitude * (0.5 + Math.random() * 0.5),
        velocity: wave.direction.clone().multiplyScalar(wave.amplitude * 0.5),
        lifetime: 3.0 + Math.random() * 7.0,
        age: 0
      };

      this.foamPersistence.push(foam);
    }
  }

  /**
   * Update turbulence fields
   */
  private updateTurbulenceFields(deltaTime: number): void {
    for (let i = this.turbulenceFields.length - 1; i >= 0; i--) {
      const turbulence = this.turbulenceFields[i];
      turbulence.age += deltaTime;

      // Decay turbulence over time
      const ageFactor = 1.0 - (turbulence.age / turbulence.lifetime);
      turbulence.strength *= Math.max(0, ageFactor);

      // Remove expired turbulence
      if (turbulence.age >= turbulence.lifetime) {
        this.turbulenceFields.splice(i, 1);
      }
    }
  }

  /**
   * Update foam persistence
   */
  private updateFoamPersistence(deltaTime: number): void {
    for (let i = this.foamPersistence.length - 1; i >= 0; i--) {
      const foam = this.foamPersistence[i];
      foam.age += deltaTime;

      // Advect foam with velocity
      foam.position = foam.position.add(foam.velocity.multiplyScalar(deltaTime));

      // Decay foam intensity
      const ageFactor = 1.0 - (foam.age / foam.lifetime);
      foam.intensity *= Math.max(0, ageFactor);

      // Slow down foam velocity
      foam.velocity = foam.velocity.multiplyScalar(0.98);

      // Remove expired foam
      if (foam.age >= foam.lifetime) {
        this.foamPersistence.splice(i, 1);
      }
    }
  }

  /**
   * Update weather system
   */
  private updateWeatherSystem(deltaTime: number): void {
    const time = this.currentTime;

    // Slowly evolving weather patterns
    this.weatherSystem.pressure += Math.sin(time * 0.001) * 0.5 * deltaTime;
    this.weatherSystem.temperature += Math.sin(time * 0.0015) * 0.2 * deltaTime;
    this.weatherSystem.humidity += Math.sin(time * 0.0008) * 0.1 * deltaTime;

    // Clamp values
    this.weatherSystem.pressure = Math.max(980, Math.min(1040, this.weatherSystem.pressure));
    this.weatherSystem.temperature = Math.max(-5, Math.min(35, this.weatherSystem.temperature));
    this.weatherSystem.humidity = Math.max(0.3, Math.min(0.95, this.weatherSystem.humidity));

    // Update stability based on weather
    this.weatherSystem.stability = 0.5 +
      (this.weatherSystem.pressure - 1013.25) * 0.01 +
      (20 - Math.abs(this.weatherSystem.temperature - 15)) * 0.02;

    this.weatherSystem.stability = Math.max(0.1, Math.min(1.0, this.weatherSystem.stability));
  }

  /**
   * Convert wave spectrum to Gerstner waves for rendering
   */
  getGerstnerWaves(): GerstnerWave[] {
    const gerstnerWaves: GerstnerWave[] = [];

    // Sort by energy and take the most significant waves
    const sortedWaves = this.waveSpectrum
      .filter(wave => wave.energy > 0.01)
      .sort((a, b) => b.energy - a.energy)
      .slice(0, 12);

    for (const wave of sortedWaves) {
      const steepness = Math.min(0.8, 2 * Math.PI * wave.amplitude / wave.wavelength);

      gerstnerWaves.push({
        amplitude: wave.amplitude,
        wavelength: wave.wavelength,
        speed: Math.sqrt(this.gravityConstant * 2 * Math.PI / wave.wavelength),
        direction: wave.direction,
        steepness: steepness,
        phaseOffset: wave.birthTime * wave.frequency
      });
    }

    return gerstnerWaves;
  }

  /**
   * Get turbulence influence at position
   */
  getTurbulenceAt(position: Vec3): Vec3 {
    let totalTurbulence = new Vec3(0, 0, 0);

    for (const turbulence of this.turbulenceFields) {
      const distance = position.distanceTo(turbulence.position);

      if (distance < turbulence.radius) {
        const influence = Math.exp(-distance / turbulence.radius);
        const turbulenceContribution = turbulence.vorticity
          .multiplyScalar(turbulence.strength * influence);

        totalTurbulence = totalTurbulence.add(turbulenceContribution);
      }
    }

    return totalTurbulence;
  }

  /**
   * Get foam intensity at position
   */
  getFoamAt(position: Vec3): number {
    let totalFoam = 0;

    for (const foam of this.foamPersistence) {
      const distance = position.distanceTo(foam.position);
      const influence = Math.exp(-distance * 0.5);
      totalFoam += foam.intensity * influence;
    }

    return Math.min(1.0, totalFoam);
  }

  /**
   * Get current wind condition
   */
  getWindCondition(): WindCondition {
    return this.windCondition;
  }

  /**
   * Get weather system state
   */
  getWeatherSystem() {
    return this.weatherSystem;
  }

  /**
   * Set wind condition manually
   */
  setWindCondition(direction: Vec3, speed: number, gustiness: number = 0.3): void {
    this.windCondition.direction = direction.normalize();
    this.windCondition.speed = Math.max(1.0, Math.min(30.0, speed));
    this.windCondition.gustiness = Math.max(0.0, Math.min(1.0, gustiness));
  }
}
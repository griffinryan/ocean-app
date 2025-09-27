/**
 * Vessel system for managing boat movements and wake generation
 */

import {
  Vec3,
  calculateDynamicWakeAngle,
  calculateShearMapping,
  wakeWaveletTransform,
  calculateOffScreenFade,
  calculateWakeDecay
} from '../utils/math';

export interface Vessel {
  id: string;
  position: Vec3;
  velocity: Vec3;
  speed: number;
  vesselClass: VesselClass;
  weight: number;
  hullLength: number;
  spawnTime: number;
  lifetime: number;
  active: boolean;
  state: VesselState;
  ghostStartTime?: number;
  fadeStartTime?: number;
  wakeTrail: WakePoint[];
  movementPattern: MovementPattern;
  patternData: any;
}

export interface WakePoint {
  position: Vec3;
  velocity: Vec3;
  intensity: number;
  timestamp: number;
  // Enhanced wake properties for spline-wavelet transforms
  vesselWeight: number;
  vesselSpeed: number;
  hullLength: number;
  wakeAngle: number;
  spreadFactor: number;
  shearAngle: number;
  amplitudeCoeff: number;
  waveletPhase: number;
}

// Orphaned wake trail that persists after vessel is despawned
export interface OrphanedWakeTrail {
  id: string;
  vesselId: string;
  points: WakePoint[];
  startFadeTime: number;
  vesselWeight: number;
  lastUpdateTime: number;
}

export enum MovementPattern {
  STRAIGHT = 'straight',
  CURVED = 'curved',
  RANDOM = 'random'
}

export enum VesselClass {
  FAST_LIGHT = 0,  // Speedboat: weight 0.3, speed 4-5
  FAST_HEAVY = 1,  // Cargo ship: weight 1.0, speed 3-4
  SLOW_LIGHT = 2,  // Sailboat: weight 0.2, speed 1-2
  SLOW_HEAVY = 3   // Barge: weight 0.8, speed 1-2
}

export enum VesselState {
  ACTIVE = 'active',      // Visible on screen
  GHOST = 'ghost',        // Off-screen but wake persists
  FADING = 'fading'       // Final fade-out phase
}

export interface VesselClassConfig {
  weight: number;
  speedRange: [number, number];
  hullLength: number;
  name: string;
}

export interface VesselConfig {
  maxVessels: number;
  spawnInterval: number;
  vesselLifetime: number;
  speedRange: [number, number];
  oceanBounds: [number, number, number, number]; // [minX, maxX, minZ, maxZ]
  wakeTrailLength: number;
  wakeDecayTime: number;
  // Enhanced wake configuration
  maxOrphanedWakes: number;
  orphanedWakeLifetime: number;
  offScreenFadeDuration: number;
  wakeTrailSampleRate: number; // Points per second
}

export class VesselSystem {
  private vessels: Map<string, Vessel> = new Map();
  private config: VesselConfig;
  private lastSpawnTime: number = 0;
  private idCounter: number = 0;
  private initialized: boolean = false;

  // Enhanced wake trail management
  private orphanedWakes: Map<string, OrphanedWakeTrail> = new Map();
  private lastWakePointTime: Map<string, number> = new Map();
  private wakeIdCounter: number = 0;

  // Vessel class configurations
  private static readonly VESSEL_CLASS_CONFIGS: Record<VesselClass, VesselClassConfig> = {
    [VesselClass.FAST_LIGHT]: {
      weight: 0.3,
      speedRange: [4.0, 5.0],
      hullLength: 8.0,
      name: 'Speedboat'
    },
    [VesselClass.FAST_HEAVY]: {
      weight: 1.0,
      speedRange: [3.0, 4.0],
      hullLength: 20.0,
      name: 'Cargo Ship'
    },
    [VesselClass.SLOW_LIGHT]: {
      weight: 0.2,
      speedRange: [1.0, 2.0],
      hullLength: 12.0,
      name: 'Sailboat'
    },
    [VesselClass.SLOW_HEAVY]: {
      weight: 0.8,
      speedRange: [1.0, 2.0],
      hullLength: 15.0,
      name: 'Barge'
    }
  };


  constructor(config: VesselConfig) {
    this.config = config;
  }

  /**
   * Update vessel system
   */
  update(currentTime: number, deltaTime: number): void {
    // Initialize system on first update with correct timing
    if (!this.initialized) {
      this.initialized = true;
      this.lastSpawnTime = currentTime;

      // Spawn initial vessel immediately with correct timing
      const initialVessel = this.createRandomVessel(currentTime);
      this.vessels.set(initialVessel.id, initialVessel);
      console.log(`[VesselSystem] Initial vessel spawned: ${initialVessel.id} at position (${initialVessel.position.x}, ${initialVessel.position.z}) with speed ${initialVessel.speed}`);
    }

    // Spawn new vessels if needed
    this.trySpawnVessel(currentTime);

    // Update existing vessels
    for (const [id, vessel] of this.vessels) {
      if (!vessel.active) continue;

      // Check if vessel should be despawned
      if (currentTime - vessel.spawnTime > vessel.lifetime) {
        this.despawnVessel(id, currentTime);
        continue;
      }

      // Update vessel position based on movement pattern
      this.updateVesselMovement(vessel, deltaTime);

      // Add wake trail point with enhanced properties
      this.addEnhancedWakeTrailPoint(vessel, currentTime);

      // Clean old wake trail points using new decay function
      this.cleanEnhancedWakeTrail(vessel, currentTime);

      // Handle vessel state transitions based on bounds and timing
      this.updateVesselState(vessel, currentTime);

      // Only despawn vessels that have completed fading
      if (vessel.state === VesselState.FADING) {
        if (vessel.fadeStartTime && currentTime - vessel.fadeStartTime > this.config.offScreenFadeDuration) {
          this.despawnVessel(id, currentTime);
        }
      }
    }

    // Update orphaned wake trails
    this.updateOrphanedWakes(currentTime);
  }

  /**
   * Try to spawn a new vessel
   */
  private trySpawnVessel(currentTime: number): void {
    if (this.vessels.size >= this.config.maxVessels) return;
    if (currentTime - this.lastSpawnTime < this.config.spawnInterval) return;

    const vessel = this.createRandomVessel(currentTime);
    this.vessels.set(vessel.id, vessel);
    this.lastSpawnTime = currentTime;
  }

  /**
   * Create a random vessel with random properties based on vessel class
   */
  private createRandomVessel(currentTime: number): Vessel {
    const id = `vessel_${this.idCounter++}`;
    const pattern = this.getRandomMovementPattern();
    const vesselClass = this.getRandomVesselClass();
    const classConfig = VesselSystem.VESSEL_CLASS_CONFIGS[vesselClass];

    // Random spawn position at ocean edge
    const [minX, maxX, minZ, maxZ] = this.config.oceanBounds;
    const edge = Math.floor(Math.random() * 4); // 0=left, 1=right, 2=top, 3=bottom

    let position: Vec3;
    let velocity: Vec3;

    switch (edge) {
      case 0: // Left edge, moving right
        position = new Vec3(minX, 0, minZ + Math.random() * (maxZ - minZ));
        velocity = new Vec3(1, 0, (Math.random() - 0.5) * 0.5);
        break;
      case 1: // Right edge, moving left
        position = new Vec3(maxX, 0, minZ + Math.random() * (maxZ - minZ));
        velocity = new Vec3(-1, 0, (Math.random() - 0.5) * 0.5);
        break;
      case 2: // Top edge, moving down
        position = new Vec3(minX + Math.random() * (maxX - minX), 0, minZ);
        velocity = new Vec3((Math.random() - 0.5) * 0.5, 0, 1);
        break;
      default: // Bottom edge, moving up
        position = new Vec3(minX + Math.random() * (maxX - minX), 0, maxZ);
        velocity = new Vec3((Math.random() - 0.5) * 0.5, 0, -1);
        break;
    }

    // Speed based on vessel class
    const speed = classConfig.speedRange[0] +
                  Math.random() * (classConfig.speedRange[1] - classConfig.speedRange[0]);

    velocity.normalize();
    velocity.scale(speed);

    const vessel: Vessel = {
      id,
      position,
      velocity,
      speed,
      vesselClass,
      weight: classConfig.weight,
      hullLength: classConfig.hullLength,
      spawnTime: currentTime,
      lifetime: this.config.vesselLifetime,
      active: true,
      state: VesselState.ACTIVE,
      wakeTrail: [],
      movementPattern: pattern,
      patternData: this.initializePatternData(pattern, position, velocity)
    };

    console.log(`[VesselSystem] Spawned ${classConfig.name}: weight=${classConfig.weight}, speed=${speed.toFixed(1)}, hull=${classConfig.hullLength}`);

    return vessel;
  }

  /**
   * Get movement pattern - simplified to straight lines only
   */
  private getRandomMovementPattern(): MovementPattern {
    return MovementPattern.STRAIGHT;
  }

  /**
   * Get random vessel class with weighted probabilities
   */
  private getRandomVesselClass(): VesselClass {
    const weights = [0.3, 0.2, 0.3, 0.2]; // Fast light, fast heavy, slow light, slow heavy
    const classes = [VesselClass.FAST_LIGHT, VesselClass.FAST_HEAVY, VesselClass.SLOW_LIGHT, VesselClass.SLOW_HEAVY];

    const random = Math.random();
    let accumulated = 0;

    for (let i = 0; i < classes.length; i++) {
      accumulated += weights[i];
      if (random <= accumulated) {
        return classes[i];
      }
    }

    return VesselClass.FAST_LIGHT;
  }

  /**
   * Update vessel state based on bounds and timing
   */
  private updateVesselState(vessel: Vessel, currentTime: number): void {
    switch (vessel.state) {
      case VesselState.ACTIVE:
        // Check if vessel should transition to ghost state
        if (this.isVesselOutOfBounds(vessel)) {
          vessel.state = VesselState.GHOST;
          vessel.ghostStartTime = currentTime;
          console.log(`[VesselSystem] Vessel ${vessel.id} transitioned to GHOST state`);
        }
        break;

      case VesselState.GHOST:
        // Check if ghost duration has elapsed
        const ghostDuration = 10000; // 10 seconds
        if (vessel.ghostStartTime && currentTime - vessel.ghostStartTime > ghostDuration) {
          vessel.state = VesselState.FADING;
          vessel.fadeStartTime = currentTime;
          console.log(`[VesselSystem] Vessel ${vessel.id} transitioned to FADING state`);
        }
        break;

      case VesselState.FADING:
        // Fading is handled in the main update loop
        break;
    }
  }

  /**
   * Initialize pattern-specific data
   */
  private initializePatternData(pattern: MovementPattern, position: Vec3, _velocity: Vec3): any {
    switch (pattern) {
      case MovementPattern.CURVED:
        return {
          centerRadius: 5 + Math.random() * 10,
          angularSpeed: (Math.random() - 0.5) * 0.5,
          center: position.clone().add(new Vec3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10))
        };
      case MovementPattern.RANDOM:
        return {
          noiseOffset: Math.random() * 1000,
          changeFrequency: 2 + Math.random() * 3
        };
      default:
        return {};
    }
  }

  /**
   * Update vessel movement - simplified to straight line only
   */
  private updateVesselMovement(vessel: Vessel, deltaTime: number): void {
    this.updateStraightMovement(vessel, deltaTime);
  }

  /**
   * Straight line movement
   */
  private updateStraightMovement(vessel: Vessel, deltaTime: number): void {
    const displacement = vessel.velocity.clone().scale(deltaTime);
    vessel.position.add(displacement);
  }


  /**
   * Add enhanced wake trail point with spline-wavelet properties
   */
  private addEnhancedWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    // Control wake point sampling rate
    const lastPointTime = this.lastWakePointTime.get(vessel.id) || 0;
    const timeSinceLastPoint = currentTime - lastPointTime;
    const minInterval = 1000 / this.config.wakeTrailSampleRate; // Convert sample rate to interval

    if (timeSinceLastPoint < minInterval) {
      return; // Skip this frame to maintain sample rate
    }

    // Calculate dynamic wake properties
    const wakeAngle = calculateDynamicWakeAngle(vessel.speed, vessel.weight, vessel.hullLength);
    const shearData = calculateShearMapping(
      vessel.wakeTrail.length * vessel.speed * 0.1, // Approximate distance
      vessel.weight,
      1.5 + vessel.weight * 2.0 // Base width
    );

    // Calculate wavelet amplitude coefficient
    const trailAge = 0; // This is a new point
    const amplitudeCoeff = wakeWaveletTransform(trailAge, vessel.weight, 1.0);

    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: 1.0,
      timestamp: currentTime,
      // Enhanced properties
      vesselWeight: vessel.weight,
      vesselSpeed: vessel.speed,
      hullLength: vessel.hullLength,
      wakeAngle,
      spreadFactor: shearData.width / (1.5 + vessel.weight * 2.0),
      shearAngle: shearData.shearAngle,
      amplitudeCoeff,
      waveletPhase: (currentTime * 0.001) % (2 * Math.PI) // Convert to radians
    };

    vessel.wakeTrail.push(wakePoint);
    this.lastWakePointTime.set(vessel.id, currentTime);

    // Use dynamic trail length based on vessel properties
    const maxTrailPoints = Math.floor(this.config.wakeTrailLength * (1.0 + vessel.weight * 0.5));
    if (vessel.wakeTrail.length > maxTrailPoints) {
      vessel.wakeTrail.shift();
    }
  }

  /**
   * Clean old wake trail points using enhanced decay
   */
  private cleanEnhancedWakeTrail(vessel: Vessel, currentTime: number): void {
    // Filter out points beyond maximum age
    vessel.wakeTrail = vessel.wakeTrail.filter(point => {
      const age = (currentTime - point.timestamp) / 1000; // Convert to seconds
      return age < 45.0; // Maximum wake age
    });

    // Update intensities using spline-wavelet decay
    vessel.wakeTrail.forEach(point => {
      const age = (currentTime - point.timestamp) / 1000; // Convert to seconds
      const vesselWeight = point.vesselWeight;

      // Calculate base decay using spline interpolation
      const baseDecay = calculateWakeDecay(age, vesselWeight);

      // Apply off-screen fade if vessel is in appropriate state
      let fadeMultiplier = 1.0;
      if (vessel.state === VesselState.FADING && vessel.fadeStartTime) {
        fadeMultiplier = calculateOffScreenFade(vessel.fadeStartTime, currentTime, this.config.offScreenFadeDuration);
      }

      // Update point properties
      point.intensity = baseDecay * fadeMultiplier;

      // Recalculate amplitude coefficient based on current age
      point.amplitudeCoeff = wakeWaveletTransform(age, vesselWeight, 1.0);

      // Update shear mapping for dynamic spreading
      const distance = age * point.vesselSpeed;
      const shearData = calculateShearMapping(distance, vesselWeight, 1.5 + vesselWeight * 2.0);
      point.spreadFactor = shearData.width / (1.5 + vesselWeight * 2.0);
      point.shearAngle = shearData.shearAngle;
    });
  }

  /**
   * Check if vessel is out of bounds
   */
  private isVesselOutOfBounds(vessel: Vessel): boolean {
    const [minX, maxX, minZ, maxZ] = this.config.oceanBounds;
    const margin = 5; // Allow some buffer outside visible area

    return vessel.position.x < minX - margin ||
           vessel.position.x > maxX + margin ||
           vessel.position.z < minZ - margin ||
           vessel.position.z > maxZ + margin;
  }

  /**
   * Despawn vessel and create orphaned wake trail
   */
  private despawnVessel(id: string, currentTime: number): void {
    const vessel = this.vessels.get(id);
    if (vessel && vessel.wakeTrail.length > 0) {
      // Create orphaned wake trail if there are wake points to preserve
      if (this.orphanedWakes.size < this.config.maxOrphanedWakes) {
        const orphanedWake: OrphanedWakeTrail = {
          id: `wake_${this.wakeIdCounter++}`,
          vesselId: id,
          points: [...vessel.wakeTrail], // Clone the wake trail
          startFadeTime: currentTime,
          vesselWeight: vessel.weight,
          lastUpdateTime: currentTime
        };

        this.orphanedWakes.set(orphanedWake.id, orphanedWake);
        console.log(`[VesselSystem] Created orphaned wake trail ${orphanedWake.id} with ${orphanedWake.points.length} points`);
      }

      vessel.active = false;
      this.vessels.delete(id);
      this.lastWakePointTime.delete(id);
    }
  }

  /**
   * Update orphaned wake trails
   */
  private updateOrphanedWakes(currentTime: number): void {
    for (const [wakeId, orphanedWake] of this.orphanedWakes) {
      const age = (currentTime - orphanedWake.startFadeTime) / 1000;

      // Remove orphaned wake if it's too old
      if (age > this.config.orphanedWakeLifetime / 1000) {
        this.orphanedWakes.delete(wakeId);
        continue;
      }

      // Update wake points in orphaned trail
      orphanedWake.points = orphanedWake.points.filter(point => {
        const pointAge = (currentTime - point.timestamp) / 1000;
        return pointAge < 45.0; // Maximum wake age
      });

      // Update wake point properties
      orphanedWake.points.forEach(point => {
        const pointAge = (currentTime - point.timestamp) / 1000;
        const vesselWeight = orphanedWake.vesselWeight;

        // Calculate base decay
        const baseDecay = calculateWakeDecay(pointAge, vesselWeight);

        // Apply orphaned wake fade
        const orphanedFade = calculateOffScreenFade(
          orphanedWake.startFadeTime,
          currentTime,
          this.config.orphanedWakeLifetime
        );

        // Update point properties
        point.intensity = baseDecay * orphanedFade;
        point.amplitudeCoeff = wakeWaveletTransform(pointAge, vesselWeight, 1.0);

        // Update shear mapping
        const distance = pointAge * point.vesselSpeed;
        const shearData = calculateShearMapping(distance, vesselWeight, 1.5 + vesselWeight * 2.0);
        point.spreadFactor = shearData.width / (1.5 + vesselWeight * 2.0);
        point.shearAngle = shearData.shearAngle;
      });

      // Remove orphaned wake if no points remain
      if (orphanedWake.points.length === 0) {
        this.orphanedWakes.delete(wakeId);
      } else {
        orphanedWake.lastUpdateTime = currentTime;
      }
    }
  }

  /**
   * Get all active vessels
   */
  getActiveVessels(): Vessel[] {
    return Array.from(this.vessels.values()).filter(vessel => vessel.active);
  }

  /**
   * Get vessel data for shader uniforms (up to maxCount vessels)
   */
  getVesselDataForShader(maxCount: number = 5, currentTime: number = performance.now()): {
    positions: Float32Array;
    velocities: Float32Array;
    weights: Float32Array;
    classes: Float32Array;
    hullLengths: Float32Array;
    states: Float32Array;
    count: number;
  } {
    const allVessels = Array.from(this.vessels.values()).slice(0, maxCount);
    const positions = new Float32Array(maxCount * 3);
    const velocities = new Float32Array(maxCount * 3);
    const weights = new Float32Array(maxCount);
    const classes = new Float32Array(maxCount);
    const hullLengths = new Float32Array(maxCount);
    const states = new Float32Array(maxCount);

    allVessels.forEach((vessel, index) => {
      const i = index * 3;
      positions[i] = vessel.position.x;
      positions[i + 1] = vessel.position.y;
      positions[i + 2] = vessel.position.z;

      velocities[i] = vessel.velocity.x;
      velocities[i + 1] = vessel.velocity.y;
      velocities[i + 2] = vessel.velocity.z;

      weights[index] = vessel.weight;
      classes[index] = vessel.vesselClass;
      hullLengths[index] = vessel.hullLength;

      // Encode vessel state as float for shader
      let stateValue = 0.0; // ACTIVE
      if (vessel.state === VesselState.GHOST) {
        stateValue = 1.0;
      } else if (vessel.state === VesselState.FADING) {
        // Encode fade progress: 2.0 = start, 3.0 = complete
        if (vessel.fadeStartTime) {
          const fadeProgress = Math.min(1.0, (currentTime - vessel.fadeStartTime) / this.config.offScreenFadeDuration);
          stateValue = 2.0 + fadeProgress;
        } else {
          stateValue = 2.0;
        }
      }
      states[index] = stateValue;
    });

    return {
      positions,
      velocities,
      weights,
      classes,
      hullLengths,
      states,
      count: allVessels.length
    };
  }

  /**
   * Get all wake trail points for enhanced shader rendering
   */
  getAllWakeTrailPoints(): WakePoint[] {
    const allPoints: WakePoint[] = [];

    // Add wake points from active vessels
    for (const vessel of this.vessels.values()) {
      allPoints.push(...vessel.wakeTrail);
    }

    // Add wake points from orphaned trails
    for (const orphanedWake of this.orphanedWakes.values()) {
      allPoints.push(...orphanedWake.points);
    }

    return allPoints;
  }


  /**
   * Toggle vessel system on/off
   */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      // Clear all vessels and orphaned wakes
      this.vessels.clear();
      this.orphanedWakes.clear();
      this.lastWakePointTime.clear();
    }
  }

  /**
   * Get system statistics
   */
  getStats(): {
    activeVessels: number;
    totalWakePoints: number;
    orphanedWakes: number;
    orphanedWakePoints: number;
  } {
    const activeVessels = this.getActiveVessels().length;
    const totalWakePoints = Array.from(this.vessels.values())
      .reduce((sum, vessel) => sum + vessel.wakeTrail.length, 0);

    const orphanedWakes = this.orphanedWakes.size;
    const orphanedWakePoints = Array.from(this.orphanedWakes.values())
      .reduce((sum, wake) => sum + wake.points.length, 0);

    return {
      activeVessels,
      totalWakePoints,
      orphanedWakes,
      orphanedWakePoints
    };
  }
}
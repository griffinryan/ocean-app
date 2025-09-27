/**
 * Vessel system for managing boat movements and wake generation
 */

import { Vec3, createWakeDecayFunction, SplineControlPoint, ShearTransform2D } from '../utils/math';

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
  age: number;
  splineWeight: number;
  shearFactor: number;
  distanceFromVessel: number;
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
  shearRate: number;
  waveletSigma: number;
  maxTrailDistance: number;
  splineControlPoints: SplineControlPoint[];
}

export class VesselSystem {
  private vessels: Map<string, Vessel> = new Map();
  private config: VesselConfig;
  private lastSpawnTime: number = 0;
  private idCounter: number = 0;
  private initialized: boolean = false;
  private wakeDecayFunction: (distance: number, maxDistance: number, weight: number) => number;

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

    // Initialize enhanced wake decay function
    this.wakeDecayFunction = createWakeDecayFunction(
      config.splineControlPoints,
      config.waveletSigma
    );
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
        this.despawnVessel(id);
        continue;
      }

      // Update vessel position based on movement pattern
      this.updateVesselMovement(vessel, deltaTime);

      // Add wake trail point
      this.addWakeTrailPoint(vessel, currentTime);

      // Clean old wake trail points
      this.cleanWakeTrail(vessel, currentTime);

      // Handle vessel state transitions based on bounds and timing
      this.updateVesselState(vessel, currentTime);

      // Only despawn vessels that have completed fading
      if (vessel.state === VesselState.FADING) {
        const fadeDuration = 5000; // 5 seconds smooth fade
        if (vessel.fadeStartTime && currentTime - vessel.fadeStartTime > fadeDuration) {
          this.despawnVessel(id);
        }
      }
    }
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
   * Add wake trail point with enhanced properties
   */
  private addWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    // Calculate distance from vessel for the most recent wake point
    let distanceFromVessel = 0;
    if (vessel.wakeTrail.length > 0) {
      const lastPoint = vessel.wakeTrail[vessel.wakeTrail.length - 1];
      distanceFromVessel = lastPoint.distanceFromVessel + vessel.speed * (currentTime - lastPoint.timestamp) / 1000;
    }

    // Calculate progressive shear factor
    const shearFactor = ShearTransform2D.calculateDynamicWakeAngle(
      1.0, // Base factor
      distanceFromVessel,
      this.config.shearRate
    );

    // Calculate spline weight based on distance along trail
    const splineWeight = this.wakeDecayFunction(distanceFromVessel, this.config.maxTrailDistance, vessel.weight);

    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: splineWeight,
      timestamp: currentTime,
      age: 0,
      splineWeight,
      shearFactor,
      distanceFromVessel
    };

    vessel.wakeTrail.push(wakePoint);

    // Increase trail length significantly for longer wakes
    if (vessel.wakeTrail.length > this.config.wakeTrailLength) {
      vessel.wakeTrail.shift();
    }
  }

  /**
   * Clean old wake trail points with enhanced spline-based decay
   */
  private cleanWakeTrail(vessel: Vessel, currentTime: number): void {
    // Filter points that are too old or too far away
    vessel.wakeTrail = vessel.wakeTrail.filter(point => {
      const age = currentTime - point.timestamp;
      const isWithinTimeLimit = age < this.config.wakeDecayTime;
      const isWithinDistanceLimit = point.distanceFromVessel < this.config.maxTrailDistance;
      return isWithinTimeLimit && isWithinDistanceLimit;
    });

    // Update wake point properties with enhanced calculations
    vessel.wakeTrail.forEach(point => {
      // Update age
      point.age = currentTime - point.timestamp;

      // Recalculate intensity using spline-wavelet function
      const timeBasedDecay = Math.max(0, 1 - (point.age / this.config.wakeDecayTime));
      const distanceBasedDecay = this.wakeDecayFunction(
        point.distanceFromVessel,
        this.config.maxTrailDistance,
        vessel.weight
      );

      // Combine time and distance decay
      point.intensity = timeBasedDecay * distanceBasedDecay;
      point.splineWeight = distanceBasedDecay;

      // Update shear factor for progressive curling
      point.shearFactor = ShearTransform2D.calculateDynamicWakeAngle(
        1.0,
        point.distanceFromVessel,
        this.config.shearRate
      );
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
   * Despawn vessel
   */
  private despawnVessel(id: string): void {
    const vessel = this.vessels.get(id);
    if (vessel) {
      vessel.active = false;
      this.vessels.delete(id);
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
        const fadeDuration = 5000;
        if (vessel.fadeStartTime) {
          const fadeProgress = Math.min(1.0, (currentTime - vessel.fadeStartTime) / fadeDuration);
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
   * Toggle vessel system on/off
   */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      // Clear all vessels
      this.vessels.clear();
    }
  }

  /**
   * Get system statistics
   */
  getStats(): { activeVessels: number; totalWakePoints: number } {
    const activeVessels = this.getActiveVessels().length;
    const totalWakePoints = Array.from(this.vessels.values())
      .reduce((sum, vessel) => sum + vessel.wakeTrail.length, 0);

    return { activeVessels, totalWakePoints };
  }
}
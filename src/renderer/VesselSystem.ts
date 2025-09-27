/**
 * Vessel system for managing boat movements and wake generation
 */

import { Vec3, wakeDecayEnvelope } from '../utils/math';

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
  wakeTrail: WakePoint[];
  movementPattern: MovementPattern;
  patternData: any;
}

export interface WakePoint {
  position: Vec3;
  velocity: Vec3;
  intensity: number;
  timestamp: number;
}

export enum WakeState {
  ACTIVE = 'active',        // Vessel on-screen, generating fresh wake
  ORPHANED = 'orphaned',    // Vessel off-screen, wake decaying
  EXPIRED = 'expired'       // Wake fully dissipated
}

export interface GlobalWakePoint {
  position: Vec3;
  velocity: Vec3;
  intensity: number;
  timestamp: number;
  state: WakeState;
  vesselId: string | null;
  orphanedTime: number;
  baseAmplitude: number;
  vesselWeight: number;
  vesselClass: VesselClass;
}

export interface OrphanedWakeData {
  vesselId: string;
  lastPosition: Vec3;
  lastVelocity: Vec3;
  orphanTime: number;
  vesselWeight: number;
  vesselClass: VesselClass;
  wakePoints: GlobalWakePoint[];
}

export interface WakeShaderData {
  positions: Float32Array;
  velocities: Float32Array;
  intensities: Float32Array;
  states: Float32Array;        // 0=active, 1=orphaned
  orphanTimes: Float32Array;
  vesselWeights: Float32Array;
  count: number;
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
  maxGlobalWakePoints: number;
  orphanedWakeLifetime: number;
}

/**
 * Circular buffer for efficient wake point storage
 */
class CircularBuffer<T> {
  private buffer: (T | null)[];
  private head: number = 0;
  private size: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      const index = (this.head - this.size + i + this.capacity) % this.capacity;
      const item = this.buffer[index];
      if (item !== null) {
        result.push(item);
      }
    }
    return result;
  }

  removeExpired(isExpired: (item: T) => boolean): void {
    const all = this.getAll();
    this.clear();
    for (const item of all) {
      if (!isExpired(item)) {
        this.push(item);
      }
    }
  }

  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.size = 0;
  }

  getSize(): number {
    return this.size;
  }
}

/**
 * Manages wake trails independent of vessel lifecycle
 */
class WakeTrailManager {
  private globalWakePool: CircularBuffer<GlobalWakePoint>;
  private orphanedWakes: Map<string, OrphanedWakeData> = new Map();
  private maxOrphanAge: number;

  constructor(maxWakePoints: number, orphanedWakeLifetime: number, _oceanBounds: [number, number, number, number]) {
    this.globalWakePool = new CircularBuffer(maxWakePoints);
    this.maxOrphanAge = orphanedWakeLifetime;
  }

  /**
   * Add active wake point from vessel
   */
  addActiveWakePoint(vessel: Vessel, currentTime: number): void {
    const wakePoint: GlobalWakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: 1.0,
      timestamp: currentTime,
      state: WakeState.ACTIVE,
      vesselId: vessel.id,
      orphanedTime: 0,
      baseAmplitude: vessel.speed * (0.08 + vessel.weight * 0.12),
      vesselWeight: vessel.weight,
      vesselClass: vessel.vesselClass
    };

    this.globalWakePool.push(wakePoint);
  }

  /**
   * Called when vessel leaves screen bounds - orphan its wake
   */
  orphanVesselWake(vessel: Vessel, currentTime: number): void {
    console.log(`[WakeTrailManager] Orphaning wake for vessel ${vessel.id}`);

    const orphanedData: OrphanedWakeData = {
      vesselId: vessel.id,
      lastPosition: vessel.position.clone(),
      lastVelocity: vessel.velocity.clone(),
      orphanTime: currentTime,
      vesselWeight: vessel.weight,
      vesselClass: vessel.vesselClass,
      wakePoints: []
    };

    // Mark all active wake points from this vessel as orphaned
    const allWakes = this.globalWakePool.getAll();
    for (const wake of allWakes) {
      if (wake.vesselId === vessel.id && wake.state === WakeState.ACTIVE) {
        wake.state = WakeState.ORPHANED;
        wake.orphanedTime = currentTime;
        orphanedData.wakePoints.push(wake);
      }
    }

    this.orphanedWakes.set(vessel.id, orphanedData);
  }

  /**
   * Update all orphaned wakes with decay physics
   */
  updateOrphanedWakes(currentTime: number): void {
    for (const [vesselId, orphanData] of this.orphanedWakes) {
      const timeSinceOrphan = currentTime - orphanData.orphanTime;

      // Remove fully expired orphaned wakes
      if (timeSinceOrphan > this.maxOrphanAge) {
        this.orphanedWakes.delete(vesselId);
        continue;
      }

      // Update intensity for all orphaned wake points
      for (const wakePoint of orphanData.wakePoints) {
        if (wakePoint.state === WakeState.ORPHANED) {
          const pointTimeSinceOrphan = currentTime - wakePoint.orphanedTime;

          // Apply composite decay envelope
          const decayFactor = wakeDecayEnvelope(pointTimeSinceOrphan, this.maxOrphanAge);
          wakePoint.intensity = decayFactor;

          // Mark as expired if intensity is too low
          if (wakePoint.intensity < 0.01) {
            wakePoint.state = WakeState.EXPIRED;
          }
        }
      }
    }

    // Clean expired wake points from global pool
    this.globalWakePool.removeExpired((wake) => wake.state === WakeState.EXPIRED);
  }


  /**
   * Get all wake data for shader uniforms
   */
  getWakeDataForShader(maxCount: number = 200): WakeShaderData {
    const allWakes = this.globalWakePool.getAll()
      .filter(wake => wake.state !== WakeState.EXPIRED)
      .slice(0, maxCount);

    const positions = new Float32Array(maxCount * 3);
    const velocities = new Float32Array(maxCount * 3);
    const intensities = new Float32Array(maxCount);
    const states = new Float32Array(maxCount);
    const orphanTimes = new Float32Array(maxCount);
    const vesselWeights = new Float32Array(maxCount);

    allWakes.forEach((wake, index) => {
      const i = index * 3;
      positions[i] = wake.position.x;
      positions[i + 1] = wake.position.y;
      positions[i + 2] = wake.position.z;

      velocities[i] = wake.velocity.x;
      velocities[i + 1] = wake.velocity.y;
      velocities[i + 2] = wake.velocity.z;

      intensities[index] = wake.intensity;
      states[index] = wake.state === WakeState.ACTIVE ? 0.0 : 1.0;
      orphanTimes[index] = wake.orphanedTime;
      vesselWeights[index] = wake.vesselWeight;
    });

    return {
      positions,
      velocities,
      intensities,
      states,
      orphanTimes,
      vesselWeights,
      count: allWakes.length
    };
  }

  /**
   * Get statistics for debugging
   */
  getStats(): { totalWakes: number; activeWakes: number; orphanedWakes: number; orphanedTrails: number } {
    const allWakes = this.globalWakePool.getAll();
    const activeWakes = allWakes.filter(w => w.state === WakeState.ACTIVE).length;
    const orphanedWakes = allWakes.filter(w => w.state === WakeState.ORPHANED).length;

    return {
      totalWakes: allWakes.length,
      activeWakes,
      orphanedWakes,
      orphanedTrails: this.orphanedWakes.size
    };
  }
}

export class VesselSystem {
  private vessels: Map<string, Vessel> = new Map();
  private config: VesselConfig;
  private lastSpawnTime: number = 0;
  private idCounter: number = 0;
  private initialized: boolean = false;
  private wakeTrailManager: WakeTrailManager;

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
    this.config = {
      ...config,
      maxGlobalWakePoints: config.maxGlobalWakePoints || 500,
      orphanedWakeLifetime: config.orphanedWakeLifetime || 15.0
    };

    this.wakeTrailManager = new WakeTrailManager(
      this.config.maxGlobalWakePoints,
      this.config.orphanedWakeLifetime,
      this.config.oceanBounds
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
        this.despawnVessel(id, currentTime);
        continue;
      }

      // Update vessel position based on movement pattern
      this.updateVesselMovement(vessel, deltaTime);

      // Add wake trail point to global system
      this.wakeTrailManager.addActiveWakePoint(vessel, currentTime);

      // Check if vessel is out of bounds - orphan its wake if so
      if (this.isVesselOutOfBounds(vessel)) {
        this.wakeTrailManager.orphanVesselWake(vessel, currentTime);
        this.despawnVessel(id, currentTime);
      }
    }

    // Update orphaned wake trails
    this.wakeTrailManager.updateOrphanedWakes(currentTime);
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
  private despawnVessel(id: string, currentTime: number): void {
    const vessel = this.vessels.get(id);
    if (vessel) {
      vessel.active = false;
      this.vessels.delete(id);
      console.log(`[VesselSystem] Despawned vessel ${id} at time ${currentTime}`);
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
  getVesselDataForShader(maxCount: number = 5): {
    positions: Float32Array;
    velocities: Float32Array;
    weights: Float32Array;
    classes: Float32Array;
    hullLengths: Float32Array;
    count: number;
  } {
    const activeVessels = this.getActiveVessels().slice(0, maxCount);
    const positions = new Float32Array(maxCount * 3);
    const velocities = new Float32Array(maxCount * 3);
    const weights = new Float32Array(maxCount);
    const classes = new Float32Array(maxCount);
    const hullLengths = new Float32Array(maxCount);

    activeVessels.forEach((vessel, index) => {
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
    });

    return {
      positions,
      velocities,
      weights,
      classes,
      hullLengths,
      count: activeVessels.length
    };
  }

  /**
   * Get wake trail data for shader uniforms
   */
  getWakeDataForShader(maxCount: number = 200): WakeShaderData {
    return this.wakeTrailManager.getWakeDataForShader(maxCount);
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
  getStats(): {
    activeVessels: number;
    totalWakePoints: number;
    activeWakes: number;
    orphanedWakes: number;
    orphanedTrails: number;
  } {
    const activeVessels = this.getActiveVessels().length;
    const wakeStats = this.wakeTrailManager.getStats();

    return {
      activeVessels,
      totalWakePoints: wakeStats.totalWakes,
      activeWakes: wakeStats.activeWakes,
      orphanedWakes: wakeStats.orphanedWakes,
      orphanedTrails: wakeStats.orphanedTrails
    };
  }
}
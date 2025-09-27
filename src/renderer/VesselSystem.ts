/**
 * Vessel system for managing boat movements and wake generation
 */

import { Vec3 } from '../utils/math';

export interface Vessel {
  id: string;
  position: Vec3;
  velocity: Vec3;
  speed: number;
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

export enum MovementPattern {
  STRAIGHT = 'straight',
  CURVED = 'curved',
  RANDOM = 'random'
}

export interface VesselConfig {
  maxVessels: number;
  spawnInterval: number;
  vesselLifetime: number;
  speedRange: [number, number];
  oceanBounds: [number, number, number, number]; // [minX, maxX, minZ, maxZ]
  wakeTrailLength: number;
  wakeDecayTime: number;
}

export class VesselSystem {
  private vessels: Map<string, Vessel> = new Map();
  private config: VesselConfig;
  private lastSpawnTime: number = 0;
  private idCounter: number = 0;
  private initialized: boolean = false;


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
        this.despawnVessel(id);
        continue;
      }

      // Update vessel position based on movement pattern
      this.updateVesselMovement(vessel, deltaTime);

      // Add wake trail point
      this.addWakeTrailPoint(vessel, currentTime);

      // Clean old wake trail points
      this.cleanWakeTrail(vessel, currentTime);

      // Check if vessel is out of bounds
      if (this.isVesselOutOfBounds(vessel)) {
        this.despawnVessel(id);
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
   * Create a random vessel with random properties
   */
  private createRandomVessel(currentTime: number): Vessel {
    const id = `vessel_${this.idCounter++}`;
    const pattern = this.getRandomMovementPattern();

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

    const speed = this.config.speedRange[0] +
                  Math.random() * (this.config.speedRange[1] - this.config.speedRange[0]);

    velocity.normalize();
    velocity.scale(speed);

    return {
      id,
      position,
      velocity,
      speed,
      spawnTime: currentTime,
      lifetime: this.config.vesselLifetime,
      active: true,
      wakeTrail: [],
      movementPattern: pattern,
      patternData: this.initializePatternData(pattern, position, velocity)
    };
  }

  /**
   * Get movement pattern - simplified to straight lines only
   */
  private getRandomMovementPattern(): MovementPattern {
    return MovementPattern.STRAIGHT;
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
   * Add wake trail point - simplified
   */
  private addWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: 1.0,
      timestamp: currentTime
    };

    vessel.wakeTrail.push(wakePoint);

    // Limit trail length to 20 points for debugging only
    if (vessel.wakeTrail.length > 20) {
      vessel.wakeTrail.shift();
    }
  }

  /**
   * Clean old wake trail points
   */
  private cleanWakeTrail(vessel: Vessel, currentTime: number): void {
    vessel.wakeTrail = vessel.wakeTrail.filter(point =>
      currentTime - point.timestamp < this.config.wakeDecayTime
    );

    // Update intensities based on age
    vessel.wakeTrail.forEach(point => {
      const age = currentTime - point.timestamp;
      point.intensity = Math.max(0, 1 - (age / this.config.wakeDecayTime));
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
  getVesselDataForShader(maxCount: number = 5): {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
  } {
    const activeVessels = this.getActiveVessels().slice(0, maxCount);
    const positions = new Float32Array(maxCount * 3);
    const velocities = new Float32Array(maxCount * 3);

    activeVessels.forEach((vessel, index) => {
      const i = index * 3;
      positions[i] = vessel.position.x;
      positions[i + 1] = vessel.position.y;
      positions[i + 2] = vessel.position.z;

      velocities[i] = vessel.velocity.x;
      velocities[i + 1] = vessel.velocity.y;
      velocities[i + 2] = vessel.velocity.z;
    });

    return {
      positions,
      velocities,
      count: activeVessels.length
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
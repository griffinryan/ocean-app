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
  movementPattern: MovementPattern;
  patternData: any;
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
      movementPattern: pattern,
      patternData: this.initializePatternData(pattern, position, velocity)
    };
  }

  /**
   * Get random movement pattern
   */
  private getRandomMovementPattern(): MovementPattern {
    const patterns = [MovementPattern.STRAIGHT, MovementPattern.CURVED, MovementPattern.RANDOM];
    const weights = [0.5, 0.3, 0.2]; // Favor straight paths

    const random = Math.random();
    let accumulated = 0;

    for (let i = 0; i < patterns.length; i++) {
      accumulated += weights[i];
      if (random <= accumulated) {
        return patterns[i];
      }
    }

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
   * Update vessel movement based on pattern
   */
  private updateVesselMovement(vessel: Vessel, deltaTime: number): void {
    switch (vessel.movementPattern) {
      case MovementPattern.STRAIGHT:
        this.updateStraightMovement(vessel, deltaTime);
        break;
      case MovementPattern.CURVED:
        this.updateCurvedMovement(vessel, deltaTime);
        break;
      case MovementPattern.RANDOM:
        this.updateRandomMovement(vessel, deltaTime);
        break;
    }
  }

  /**
   * Straight line movement
   */
  private updateStraightMovement(vessel: Vessel, deltaTime: number): void {
    const displacement = vessel.velocity.clone().scale(deltaTime);
    vessel.position.add(displacement);
  }

  /**
   * Curved movement (circular arcs)
   */
  private updateCurvedMovement(vessel: Vessel, deltaTime: number): void {
    const data = vessel.patternData;
    const angleChange = data.angularSpeed * deltaTime;

    // Rotate velocity around Y axis
    const cos = Math.cos(angleChange);
    const sin = Math.sin(angleChange);
    const newVx = vessel.velocity.x * cos - vessel.velocity.z * sin;
    const newVz = vessel.velocity.x * sin + vessel.velocity.z * cos;

    vessel.velocity.x = newVx;
    vessel.velocity.z = newVz;

    // Update position
    const displacement = vessel.velocity.clone().scale(deltaTime);
    vessel.position.add(displacement);
  }

  /**
   * Random wandering movement
   */
  private updateRandomMovement(vessel: Vessel, deltaTime: number): void {
    const data = vessel.patternData;
    const time = performance.now() * 0.001;

    // Use simple noise-like function for direction changes
    const noiseX = Math.sin(time * data.changeFrequency + data.noiseOffset) * 0.5;
    const noiseZ = Math.cos(time * data.changeFrequency * 1.3 + data.noiseOffset + 100) * 0.5;

    // Gradually adjust velocity
    const targetVel = new Vec3(noiseX, 0, noiseZ).normalize().scale(vessel.speed);
    const lerpFactor = Math.min(deltaTime * 2, 1);

    vessel.velocity.lerp(targetVel, lerpFactor);

    // Update position
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

  // Note: getVesselDataForShader removed - vessels now feed into CA pipeline via getActiveVessels()

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
  getStats(): { activeVessels: number } {
    const activeVessels = this.getActiveVessels().length;

    return { activeVessels };
  }
}
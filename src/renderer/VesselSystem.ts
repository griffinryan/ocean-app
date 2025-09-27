/**
 * Vessel system for managing boat movements and wake generation
 */

import { Vec3 } from '../utils/math';
import { VesselPhysics, VesselPhysicsState } from './VesselPhysics';

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

  // Enhanced physics
  physics: VesselPhysicsState;
  vesselType: 'small' | 'medium' | 'large';
  currentWaypoint: number;
  waypoints: Vec3[];
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
   * Create a random vessel with realistic physics
   */
  private createRandomVessel(currentTime: number): Vessel {
    const id = `vessel_${this.idCounter++}`;
    const pattern = this.getRandomMovementPattern();

    // Choose vessel type randomly
    const vesselTypes: ('small' | 'medium' | 'large')[] = ['small', 'medium', 'large'];
    const vesselType = vesselTypes[Math.floor(Math.random() * vesselTypes.length)];

    // Random spawn position at ocean edge
    const [minX, maxX, minZ, maxZ] = this.config.oceanBounds;
    const edge = Math.floor(Math.random() * 4); // 0=left, 1=right, 2=top, 3=bottom

    let position: Vec3;
    let initialHeading: number;

    switch (edge) {
      case 0: // Left edge, moving right
        position = new Vec3(minX - 5, 0, minZ + Math.random() * (maxZ - minZ));
        initialHeading = (Math.random() - 0.5) * Math.PI / 3; // Roughly east
        break;
      case 1: // Right edge, moving left
        position = new Vec3(maxX + 5, 0, minZ + Math.random() * (maxZ - minZ));
        initialHeading = Math.PI + (Math.random() - 0.5) * Math.PI / 3; // Roughly west
        break;
      case 2: // Top edge, moving down
        position = new Vec3(minX + Math.random() * (maxX - minX), 0, minZ - 5);
        initialHeading = Math.PI / 2 + (Math.random() - 0.5) * Math.PI / 3; // Roughly south
        break;
      default: // Bottom edge, moving up
        position = new Vec3(minX + Math.random() * (maxX - minX), 0, maxZ + 5);
        initialHeading = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI / 3; // Roughly north
        break;
    }

    const speed = this.config.speedRange[0] +
                  Math.random() * (this.config.speedRange[1] - this.config.speedRange[0]);

    // Initialize physics
    const physics = VesselPhysics.createPhysicsState(vesselType);
    physics.yaw = initialHeading;
    physics.desiredSpeed = speed;

    // Create initial velocity from heading
    const velocity = new Vec3(
      Math.cos(initialHeading) * speed,
      0,
      Math.sin(initialHeading) * speed
    );

    // Generate waypoints for navigation
    const waypoints = this.generateWaypoints(position, pattern, minX, maxX, minZ, maxZ);

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
      patternData: this.initializePatternData(pattern, position, velocity),
      physics,
      vesselType,
      currentWaypoint: 0,
      waypoints
    };
  }

  /**
   * Generate realistic waypoints for vessel navigation
   */
  private generateWaypoints(
    startPos: Vec3,
    pattern: MovementPattern,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): Vec3[] {
    const waypoints: Vec3[] = [];

    switch (pattern) {
      case MovementPattern.STRAIGHT:
        // Create 2-3 waypoints in roughly the same direction
        const direction = this.getRandomDirection();
        for (let i = 1; i <= 3; i++) {
          const distance = 10 + i * 8;
          const waypoint = startPos.clone().add(direction.clone().scale(distance));
          waypoints.push(this.clampToOceanBounds(waypoint, minX, maxX, minZ, maxZ));
        }
        break;

      case MovementPattern.CURVED:
        // Create curved path waypoints
        const center = startPos.clone().add(new Vec3(
          (Math.random() - 0.5) * 20,
          0,
          (Math.random() - 0.5) * 20
        ));
        const radius = 8 + Math.random() * 12;
        for (let i = 0; i < 5; i++) {
          const angle = (i / 4) * Math.PI + Math.random() * 0.5;
          const waypoint = center.clone().add(new Vec3(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius
          ));
          waypoints.push(this.clampToOceanBounds(waypoint, minX, maxX, minZ, maxZ));
        }
        break;

      case MovementPattern.RANDOM:
        // Create random waypoints for wandering
        for (let i = 0; i < 6; i++) {
          const waypoint = new Vec3(
            minX + Math.random() * (maxX - minX),
            0,
            minZ + Math.random() * (maxZ - minZ)
          );
          waypoints.push(waypoint);
        }
        break;
    }

    return waypoints;
  }

  /**
   * Get random direction vector
   */
  private getRandomDirection(): Vec3 {
    const angle = Math.random() * 2 * Math.PI;
    return new Vec3(Math.cos(angle), 0, Math.sin(angle));
  }

  /**
   * Clamp waypoint to ocean bounds
   */
  private clampToOceanBounds(waypoint: Vec3, minX: number, maxX: number, minZ: number, maxZ: number): Vec3 {
    return new Vec3(
      Math.max(minX, Math.min(maxX, waypoint.x)),
      0,
      Math.max(minZ, Math.min(maxZ, waypoint.z))
    );
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
   * Update vessel movement using realistic physics
   */
  private updateVesselMovement(vessel: Vessel, deltaTime: number): void {
    // Update navigation based on movement pattern
    this.updateVesselNavigation(vessel);

    // Get ocean state at vessel position (simplified for now)
    const oceanHeight = 0; // TODO: Get actual ocean height
    const oceanVelocity = new Vec3(0, 0, 0); // TODO: Get actual ocean velocity

    // Update physics
    const physicsUpdate = VesselPhysics.updatePhysics(
      vessel.position,
      vessel.velocity,
      vessel.physics,
      deltaTime,
      oceanHeight,
      oceanVelocity
    );

    // Update vessel state
    vessel.position = physicsUpdate.position;
    vessel.velocity = physicsUpdate.velocity;
    vessel.physics = physicsUpdate.physics;
    vessel.speed = vessel.velocity.length();
  }

  /**
   * Update vessel navigation AI based on movement pattern
   */
  private updateVesselNavigation(vessel: Vessel): void {
    switch (vessel.movementPattern) {
      case MovementPattern.STRAIGHT:
        this.updateStraightNavigation(vessel);
        break;
      case MovementPattern.CURVED:
        this.updateCurvedNavigation(vessel);
        break;
      case MovementPattern.RANDOM:
        this.updateRandomNavigation(vessel);
        break;
    }
  }

  /**
   * Navigate to waypoints in sequence
   */
  private updateStraightNavigation(vessel: Vessel): void {
    if (vessel.waypoints.length === 0) return;

    const currentTarget = vessel.waypoints[vessel.currentWaypoint];
    const distance = vessel.position.distanceTo(currentTarget);

    if (distance < 3.0) {
      // Reached waypoint, move to next
      vessel.currentWaypoint = (vessel.currentWaypoint + 1) % vessel.waypoints.length;
      currentTarget.copy(vessel.waypoints[vessel.currentWaypoint]);
    }

    // Set heading toward current waypoint
    const direction = currentTarget.clone().subtract(vessel.position);
    const targetHeading = Math.atan2(direction.z, direction.x);

    VesselPhysics.setNavigationTarget(vessel.physics, targetHeading, vessel.physics.desiredSpeed);
  }

  /**
   * Follow curved path with smooth turns
   */
  private updateCurvedNavigation(vessel: Vessel): void {
    if (vessel.waypoints.length === 0) return;

    const currentTarget = vessel.waypoints[vessel.currentWaypoint];
    const distance = vessel.position.distanceTo(currentTarget);

    if (distance < 4.0) {
      // Reached waypoint, move to next
      vessel.currentWaypoint = (vessel.currentWaypoint + 1) % vessel.waypoints.length;
    }

    // Look ahead to next waypoint for smoother turns
    const nextIndex = (vessel.currentWaypoint + 1) % vessel.waypoints.length;
    const nextTarget = vessel.waypoints[nextIndex];

    // Weighted direction toward current and next waypoint
    const currentDir = currentTarget.clone().subtract(vessel.position).normalize();
    const nextDir = nextTarget.clone().subtract(vessel.position).normalize();
    const blendedDir = currentDir.scale(0.7).add(nextDir.scale(0.3));

    const targetHeading = Math.atan2(blendedDir.z, blendedDir.x);
    VesselPhysics.setNavigationTarget(vessel.physics, targetHeading, vessel.physics.desiredSpeed);
  }

  /**
   * Wander randomly with occasional direction changes
   */
  private updateRandomNavigation(vessel: Vessel): void {
    const time = performance.now() * 0.001;
    const data = vessel.patternData;

    // Change direction occasionally
    if (Math.floor(time) % 5 === 0 && Math.floor(time * 10) % 10 === 0) {
      const randomAngle = vessel.physics.yaw + (Math.random() - 0.5) * Math.PI / 2;
      VesselPhysics.setNavigationTarget(vessel.physics, randomAngle, vessel.physics.desiredSpeed);
    }
  }

  /**
   * Add wake trail point
   */
  private addWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: 1.0,
      timestamp: currentTime
    };

    vessel.wakeTrail.push(wakePoint);

    // Limit trail length
    if (vessel.wakeTrail.length > this.config.wakeTrailLength) {
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
   * Get all wake trail data for shader
   */
  getWakeTrailDataForShader(maxPoints: number = 100): {
    positions: Float32Array;
    velocities: Float32Array;
    intensities: Float32Array;
    count: number;
  } {
    const allPoints: WakePoint[] = [];

    for (const vessel of this.vessels.values()) {
      allPoints.push(...vessel.wakeTrail);
    }

    // Sort by timestamp (newest first) and limit
    allPoints.sort((a, b) => b.timestamp - a.timestamp);
    const limitedPoints = allPoints.slice(0, maxPoints);

    const positions = new Float32Array(maxPoints * 3);
    const velocities = new Float32Array(maxPoints * 3);
    const intensities = new Float32Array(maxPoints);

    limitedPoints.forEach((point, index) => {
      const i = index * 3;
      positions[i] = point.position.x;
      positions[i + 1] = point.position.y;
      positions[i + 2] = point.position.z;

      velocities[i] = point.velocity.x;
      velocities[i + 1] = point.velocity.y;
      velocities[i + 2] = point.velocity.z;

      intensities[index] = point.intensity;
    });

    return {
      positions,
      velocities,
      intensities,
      count: limitedPoints.length
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
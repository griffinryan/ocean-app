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
  heading: number; // Current heading in radians
  previousHeading: number; // Previous heading for angular velocity calculation
  angularVelocity: number; // Current rate of heading change
}

export interface WakePoint {
  position: Vec3;
  velocity: Vec3;
  intensity: number;
  timestamp: number;
  heading: number; // Direction angle in radians
  angularVelocity: number; // Rate of heading change (rad/s)
  speed: number; // Speed magnitude
  turnRadius: number; // Radius of current turn (0 for straight)
  curvature: number; // Amount of curvature in the wake
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

    const heading = Math.atan2(velocity.z, velocity.x);

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
      heading,
      previousHeading: heading,
      angularVelocity: 0
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
    // Store previous heading for angular velocity calculation
    vessel.previousHeading = vessel.heading;

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

    // Update heading and angular velocity
    this.updateVesselHeading(vessel, deltaTime);
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
   * Update vessel heading and angular velocity
   */
  private updateVesselHeading(vessel: Vessel, deltaTime: number): void {
    // Calculate current heading from velocity
    vessel.heading = Math.atan2(vessel.velocity.z, vessel.velocity.x);

    // Calculate angular velocity (heading change rate)
    let headingDiff = vessel.heading - vessel.previousHeading;

    // Handle angle wrapping (from -π to π)
    if (headingDiff > Math.PI) {
      headingDiff -= 2 * Math.PI;
    } else if (headingDiff < -Math.PI) {
      headingDiff += 2 * Math.PI;
    }

    vessel.angularVelocity = deltaTime > 0 ? headingDiff / deltaTime : 0;
  }

  /**
   * Add wake trail point
   */
  private addWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    // Calculate turn radius from angular velocity and speed
    const turnRadius = vessel.angularVelocity !== 0 ? vessel.speed / Math.abs(vessel.angularVelocity) : 0;

    // Calculate curvature factor for wake shape
    const curvature = vessel.angularVelocity !== 0 ? 1.0 / turnRadius : 0;

    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: 1.0,
      timestamp: currentTime,
      heading: vessel.heading,
      angularVelocity: vessel.angularVelocity,
      speed: vessel.speed,
      turnRadius: turnRadius,
      curvature: Math.abs(curvature)
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
   * Get all wake trail data for shader with intelligent point selection
   */
  getWakeTrailDataForShader(maxPoints: number = 15): {
    positions: Float32Array;
    velocities: Float32Array;
    intensities: Float32Array;
    headings: Float32Array;
    angularVelocities: Float32Array;
    speeds: Float32Array;
    curvatures: Float32Array;
    count: number;
  } {
    const allPoints: WakePoint[] = [];

    for (const vessel of this.vessels.values()) {
      allPoints.push(...vessel.wakeTrail);
    }

    // Intelligent point selection for performance optimization
    const selectedPoints = this.selectOptimalWakePoints(allPoints, maxPoints);

    const positions = new Float32Array(maxPoints * 3);
    const velocities = new Float32Array(maxPoints * 3);
    const intensities = new Float32Array(maxPoints);
    const headings = new Float32Array(maxPoints);
    const angularVelocities = new Float32Array(maxPoints);
    const speeds = new Float32Array(maxPoints);
    const curvatures = new Float32Array(maxPoints);

    selectedPoints.forEach((point, index) => {
      const i = index * 3;
      positions[i] = point.position.x;
      positions[i + 1] = point.position.y;
      positions[i + 2] = point.position.z;

      velocities[i] = point.velocity.x;
      velocities[i + 1] = point.velocity.y;
      velocities[i + 2] = point.velocity.z;

      intensities[index] = point.intensity;
      headings[index] = point.heading;
      angularVelocities[index] = point.angularVelocity;
      speeds[index] = point.speed;
      curvatures[index] = point.curvature;
    });

    return {
      positions,
      velocities,
      intensities,
      headings,
      angularVelocities,
      speeds,
      curvatures,
      count: selectedPoints.length
    };
  }

  /**
   * Intelligently select optimal wake points for maximum visual impact
   */
  private selectOptimalWakePoints(allPoints: WakePoint[], maxPoints: number): WakePoint[] {
    if (allPoints.length <= maxPoints) {
      return allPoints;
    }

    // Score each point based on multiple factors
    const scoredPoints = allPoints.map(point => ({
      point,
      score: this.calculateWakePointScore(point)
    }));

    // Sort by score (highest first) and take the best ones
    scoredPoints.sort((a, b) => b.score - a.score);

    // Ensure we have good spatial distribution
    const selectedPoints: WakePoint[] = [];
    const minDistance = 1.5; // Minimum distance between selected points

    for (const scoredPoint of scoredPoints) {
      if (selectedPoints.length >= maxPoints) break;

      // Check if this point is too close to already selected points
      const tooClose = selectedPoints.some(selected => {
        const dx = selected.position.x - scoredPoint.point.position.x;
        const dz = selected.position.z - scoredPoint.point.position.z;
        return (dx * dx + dz * dz) < (minDistance * minDistance);
      });

      if (!tooClose) {
        selectedPoints.push(scoredPoint.point);
      }
    }

    // If we don't have enough points due to spatial filtering, fill with remaining best
    if (selectedPoints.length < maxPoints) {
      for (const scoredPoint of scoredPoints) {
        if (selectedPoints.length >= maxPoints) break;
        if (!selectedPoints.includes(scoredPoint.point)) {
          selectedPoints.push(scoredPoint.point);
        }
      }
    }

    return selectedPoints;
  }

  /**
   * Calculate importance score for a wake point
   */
  private calculateWakePointScore(point: WakePoint): number {
    const currentTime = performance.now();
    const age = currentTime - point.timestamp;

    // Factors for scoring
    const ageScore = Math.max(0, 1 - (age / 15000)); // Decay over 15 seconds
    const intensityScore = point.intensity;
    const speedScore = Math.min(point.speed / 10, 1); // Normalize speed to 0-1
    const curvatureScore = Math.min(point.curvature * 5, 1); // Higher curvature = more important

    // Weighted combination
    return (ageScore * 0.4) + (intensityScore * 0.3) + (speedScore * 0.2) + (curvatureScore * 0.1);
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
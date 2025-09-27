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
  displacement: number;    // Depth of sculpting effect
  width: number;          // Wake width at this point
  turbulence: number;     // Chaos factor for turbulent effects
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

  /**
   * Catmull-Rom spline interpolation for smooth wake trails
   */
  private catmullRomInterpolate(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
    const t2 = t * t;
    const t3 = t2 * t;

    const x = 0.5 * ((2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

    const y = 0.5 * ((2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

    const z = 0.5 * ((2 * p1.z) +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

    return new Vec3(x, y, z);
  }

  /**
   * Generate interpolated wake trail points using splines
   */
  private generateInterpolatedWakeTrail(vessel: Vessel, samplesPerSegment: number = 3): Vec3[] {
    const trail = vessel.wakeTrail;
    if (trail.length < 4) return trail.map(p => p.position);

    const interpolatedPoints: Vec3[] = [];

    for (let i = 1; i < trail.length - 2; i++) {
      const p0 = trail[i - 1].position;
      const p1 = trail[i].position;
      const p2 = trail[i + 1].position;
      const p3 = trail[i + 2].position;

      // Add the actual point
      interpolatedPoints.push(p1.clone());

      // Add interpolated points between this and next
      for (let j = 1; j < samplesPerSegment; j++) {
        const t = j / samplesPerSegment;
        const interpolated = this.catmullRomInterpolate(p0, p1, p2, p3, t);
        interpolatedPoints.push(interpolated);
      }
    }

    // Add the last point
    if (trail.length > 0) {
      interpolatedPoints.push(trail[trail.length - 1].position.clone());
    }

    return interpolatedPoints;
  }

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
   * Add wake trail point with enhanced properties
   */
  private addWakeTrailPoint(vessel: Vessel, currentTime: number): void {
    // Calculate angular velocity for turn detection
    let angularVelocity = 0;
    if (vessel.wakeTrail.length > 0) {
      const lastPoint = vessel.wakeTrail[vessel.wakeTrail.length - 1];
      const deltaTime = (currentTime - lastPoint.timestamp) / 1000; // Convert to seconds

      if (deltaTime > 0) {
        const lastDir = lastPoint.velocity.clone().normalize();
        const currentDir = vessel.velocity.clone().normalize();

        // Calculate angle between directions
        const dotProduct = Math.max(-1, Math.min(1, lastDir.x * currentDir.x + lastDir.z * currentDir.z));
        const angle = Math.acos(dotProduct);
        angularVelocity = angle / deltaTime;
      }
    }

    // Enhanced wake properties based on vessel state
    const speed = vessel.velocity.length();
    const baseIntensity = Math.min(speed / 5.0, 1.0); // Normalize to max speed of 5

    const wakePoint: WakePoint = {
      position: vessel.position.clone(),
      velocity: vessel.velocity.clone(),
      intensity: baseIntensity,
      displacement: speed * 0.2,                    // Deeper displacement for faster vessels
      width: 2.0 + speed * 0.3 + angularVelocity * 2.0, // Wider wake during turns
      turbulence: angularVelocity * 0.5 + speed * 0.1,  // More turbulence during turns and at speed
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
   * Get all wake trail data for shader with spline interpolation
   */
  getWakeTrailDataForShader(maxPoints: number = 100): {
    positions: Float32Array;
    velocities: Float32Array;
    intensities: Float32Array;
    displacements: Float32Array;
    widths: Float32Array;
    turbulences: Float32Array;
    count: number;
  } {
    const allInterpolatedPoints: { position: Vec3; data: WakePoint }[] = [];

    // Generate spline-interpolated points for each vessel
    for (const vessel of this.vessels.values()) {
      if (vessel.wakeTrail.length < 2) continue;

      const interpolatedPositions = this.generateInterpolatedWakeTrail(vessel, 2);

      // Create data points with interpolated positions but original wake data
      interpolatedPositions.forEach((position, index) => {
        // Find closest original wake point for data
        const originalIndex = Math.min(
          Math.floor(index / 2),
          vessel.wakeTrail.length - 1
        );
        const originalPoint = vessel.wakeTrail[originalIndex];

        allInterpolatedPoints.push({
          position,
          data: originalPoint
        });
      });
    }

    // Sort by timestamp (newest first) and limit
    allInterpolatedPoints.sort((a, b) => b.data.timestamp - a.data.timestamp);
    const limitedPoints = allInterpolatedPoints.slice(0, maxPoints);

    const positions = new Float32Array(maxPoints * 3);
    const velocities = new Float32Array(maxPoints * 3);
    const intensities = new Float32Array(maxPoints);
    const displacements = new Float32Array(maxPoints);
    const widths = new Float32Array(maxPoints);
    const turbulences = new Float32Array(maxPoints);

    limitedPoints.forEach((point, index) => {
      const i = index * 3;
      positions[i] = point.position.x;
      positions[i + 1] = point.position.y;
      positions[i + 2] = point.position.z;

      velocities[i] = point.data.velocity.x;
      velocities[i + 1] = point.data.velocity.y;
      velocities[i + 2] = point.data.velocity.z;

      intensities[index] = point.data.intensity;
      displacements[index] = point.data.displacement;
      widths[index] = point.data.width;
      turbulences[index] = point.data.turbulence;
    });

    return {
      positions,
      velocities,
      intensities,
      displacements,
      widths,
      turbulences,
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
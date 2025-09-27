/**
 * Realistic vessel physics system for maritime dynamics
 */

import { Vec3 } from '../utils/math';

export interface VesselPhysicsState {
  // Fundamental properties
  mass: number;
  length: number;
  beam: number;       // Width
  draft: number;      // Depth in water

  // Hydrodynamic coefficients
  dragCoefficient: number;
  liftCoefficient: number;

  // Control surfaces
  rudderAngle: number;        // Radians, -PI/4 to PI/4
  throttle: number;           // 0 to 1
  maxRudderRate: number;      // Max rudder change per second

  // Engine properties
  maxThrust: number;
  thrustResponse: number;     // How quickly thrust responds to throttle

  // Current dynamic state
  acceleration: Vec3;
  angularVelocity: number;    // Yaw rate
  angularAcceleration: number;

  // Orientation
  roll: number;               // Banking angle
  pitch: number;              // Bow up/down
  yaw: number;                // Current heading

  // Navigation/AI state
  desiredHeading: number;
  desiredSpeed: number;
  currentThrust: number;

  // Performance tracking
  turningRadius: number;
  speedOverGround: number;
}

export class VesselPhysics {
  private static readonly WATER_DENSITY = 1025; // kg/m³
  private static readonly GRAVITY = 9.81;

  /**
   * Create default physics state for a vessel type
   */
  static createPhysicsState(vesselType: 'small' | 'medium' | 'large' = 'medium'): VesselPhysicsState {
    const configs = {
      small: {
        mass: 5000,      // 5 tons
        length: 12,      // 12 meters
        beam: 3,         // 3 meters
        draft: 1.2,      // 1.2 meters
        maxThrust: 15000, // Newtons
        dragCoefficient: 0.08,
      },
      medium: {
        mass: 25000,     // 25 tons
        length: 20,      // 20 meters
        beam: 5,         // 5 meters
        draft: 2.0,      // 2 meters
        maxThrust: 50000, // Newtons
        dragCoefficient: 0.06,
      },
      large: {
        mass: 100000,    // 100 tons
        length: 35,      // 35 meters
        beam: 8,         // 8 meters
        draft: 3.5,      // 3.5 meters
        maxThrust: 150000, // Newtons
        dragCoefficient: 0.05,
      }
    };

    const config = configs[vesselType];

    return {
      ...config,
      liftCoefficient: 0.02,
      rudderAngle: 0,
      throttle: 0.6,
      maxRudderRate: Math.PI / 6, // 30 degrees per second
      thrustResponse: 2.0,
      acceleration: new Vec3(0, 0, 0),
      angularVelocity: 0,
      angularAcceleration: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      desiredHeading: 0,
      desiredSpeed: 5,
      currentThrust: 0,
      turningRadius: 0,
      speedOverGround: 0,
    };
  }

  /**
   * Update vessel physics for one time step
   */
  static updatePhysics(
    position: Vec3,
    velocity: Vec3,
    physics: VesselPhysicsState,
    deltaTime: number,
    oceanHeight: number = 0,
    oceanVelocity: Vec3 = new Vec3(0, 0, 0)
  ): { position: Vec3; velocity: Vec3; physics: VesselPhysicsState } {

    const newPhysics = { ...physics };
    const newPosition = position.clone();
    const newVelocity = velocity.clone();

    // Update vessel orientation on ocean surface
    newPosition.y = oceanHeight + newPhysics.draft * 0.5;

    // Calculate current speed and heading
    const speed = newVelocity.length();
    newPhysics.speedOverGround = speed;

    if (speed > 0.1) {
      const currentHeading = Math.atan2(newVelocity.z, newVelocity.x);
      newPhysics.yaw = currentHeading;
    }

    // Navigation AI: Calculate desired rudder angle
    const headingError = this.angleWrap(newPhysics.desiredHeading - newPhysics.yaw);
    const desiredRudderAngle = Math.max(-Math.PI/4, Math.min(Math.PI/4, headingError * 2.0));

    // Gradual rudder movement (realistic response time)
    const rudderChange = (desiredRudderAngle - newPhysics.rudderAngle) * deltaTime * 3.0;
    const maxRudderDelta = newPhysics.maxRudderRate * deltaTime;
    newPhysics.rudderAngle += Math.max(-maxRudderDelta, Math.min(maxRudderDelta, rudderChange));

    // Speed control: adjust throttle to reach desired speed
    const speedError = newPhysics.desiredSpeed - speed;
    newPhysics.throttle = Math.max(0, Math.min(1, 0.5 + speedError * 0.1));

    // Engine thrust with realistic response
    const targetThrust = newPhysics.throttle * newPhysics.maxThrust;
    const thrustChange = (targetThrust - newPhysics.currentThrust) * newPhysics.thrustResponse * deltaTime;
    newPhysics.currentThrust += thrustChange;

    // Forces calculation
    const forces = this.calculateForces(newVelocity, newPhysics, oceanVelocity);

    // Update acceleration (F = ma)
    newPhysics.acceleration = forces.total.clone().scale(1 / newPhysics.mass);

    // Update angular acceleration (torque from rudder)
    const rudderTorque = this.calculateRudderTorque(speed, newPhysics);
    newPhysics.angularAcceleration = rudderTorque / (newPhysics.mass * newPhysics.length * newPhysics.length / 12);

    // Apply angular damping
    newPhysics.angularVelocity += newPhysics.angularAcceleration * deltaTime;
    newPhysics.angularVelocity *= Math.pow(0.95, deltaTime * 60); // Damping

    // Update velocity with acceleration
    newVelocity.add(newPhysics.acceleration.clone().scale(deltaTime));

    // Apply angular velocity to heading and velocity direction
    if (Math.abs(newPhysics.angularVelocity) > 0.001) {
      const angularChange = newPhysics.angularVelocity * deltaTime;
      newPhysics.yaw += angularChange;

      // Rotate velocity vector (vessels turn as a whole)
      const cos = Math.cos(angularChange);
      const sin = Math.sin(angularChange);
      const newVx = newVelocity.x * cos - newVelocity.z * sin;
      const newVz = newVelocity.x * sin + newVelocity.z * cos;
      newVelocity.x = newVx;
      newVelocity.z = newVz;

      // Calculate banking (roll) during turns
      const centrifugalForce = speed * newPhysics.angularVelocity;
      newPhysics.roll = Math.atan(centrifugalForce / this.GRAVITY) * 0.5; // Moderate banking
    }

    // Update position
    newPosition.add(newVelocity.clone().scale(deltaTime));

    // Calculate turning radius for wake generation
    if (Math.abs(newPhysics.angularVelocity) > 0.001) {
      newPhysics.turningRadius = speed / Math.abs(newPhysics.angularVelocity);
    } else {
      newPhysics.turningRadius = Infinity;
    }

    return {
      position: newPosition,
      velocity: newVelocity,
      physics: newPhysics
    };
  }

  /**
   * Calculate all forces acting on the vessel
   */
  private static calculateForces(
    velocity: Vec3,
    physics: VesselPhysicsState,
    oceanVelocity: Vec3
  ): { thrust: Vec3; drag: Vec3; total: Vec3 } {

    const speed = velocity.length();
    const direction = speed > 0.01 ? velocity.clone().normalize() : new Vec3(1, 0, 0);

    // Thrust force (forward direction)
    const forwardDir = new Vec3(Math.cos(physics.yaw), 0, Math.sin(physics.yaw));
    const thrust = forwardDir.clone().scale(physics.currentThrust);

    // Relative velocity (vessel velocity relative to water)
    const relativeVelocity = velocity.clone().subtract(oceanVelocity);
    const relativeSpeed = relativeVelocity.length();

    // Drag force (opposes relative motion)
    let drag = new Vec3(0, 0, 0);
    if (relativeSpeed > 0.01) {
      const dragDirection = relativeVelocity.clone().normalize().scale(-1);
      const frontalArea = physics.beam * physics.draft; // Approximate frontal area
      const dragMagnitude = 0.5 * this.WATER_DENSITY * relativeSpeed * relativeSpeed *
                           physics.dragCoefficient * frontalArea;
      drag = dragDirection.scale(dragMagnitude);
    }

    // Total force
    const total = thrust.clone().add(drag);

    return { thrust, drag, total };
  }

  /**
   * Calculate torque from rudder forces
   */
  private static calculateRudderTorque(speed: number, physics: VesselPhysicsState): number {
    if (speed < 0.5) return 0; // Rudder ineffective at low speed

    // Rudder effectiveness increases with speed, but plateaus
    const rudderEffectiveness = Math.min(1.0, speed / 5.0);

    // Torque proportional to rudder angle and speed squared
    const rudderArea = physics.length * 0.05; // Approximate rudder area
    const rudderForce = 0.5 * this.WATER_DENSITY * speed * speed *
                       physics.liftCoefficient * rudderArea * Math.sin(physics.rudderAngle * 2);

    // Lever arm (distance from center of mass to rudder)
    const leverArm = physics.length * 0.4;

    return rudderForce * leverArm * rudderEffectiveness;
  }

  /**
   * Wrap angle to [-PI, PI]
   */
  private static angleWrap(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Set vessel's desired navigation target
   */
  static setNavigationTarget(
    physics: VesselPhysicsState,
    targetHeading: number,
    targetSpeed: number
  ): void {
    physics.desiredHeading = this.angleWrap(targetHeading);
    physics.desiredSpeed = Math.max(0, Math.min(10, targetSpeed)); // Reasonable speed limits
  }

  /**
   * Get vessel's wake-generating properties
   */
  static getWakeProperties(physics: VesselPhysicsState): {
    intensity: number;
    width: number;
    turbulence: number;
  } {
    const speed = physics.speedOverGround;
    const speedFactor = Math.min(speed / 8.0, 1.0);

    return {
      intensity: speedFactor * (physics.mass / 25000), // Normalized to medium vessel
      width: physics.beam * (1.0 + speedFactor),
      turbulence: speedFactor * Math.abs(physics.angularVelocity) * 2.0
    };
  }
}
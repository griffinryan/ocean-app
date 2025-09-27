/**
 * Mathematical utilities for ocean rendering
 */

export class Vec3 {
  constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}

  static create(x: number, y: number, z: number): Vec3 {
    return new Vec3(x, y, z);
  }

  normalize(): Vec3 {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (len > 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  cross(other: Vec3): Vec3 {
    return new Vec3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x
    );
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(other: Vec3): Vec3 {
    this.x += other.x;
    this.y += other.y;
    this.z += other.z;
    return this;
  }

  scale(scalar: number): Vec3 {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  lerp(target: Vec3, factor: number): Vec3 {
    this.x += (target.x - this.x) * factor;
    this.y += (target.y - this.y) * factor;
    this.z += (target.z - this.z) * factor;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
}

export class Mat4 {
  public data: Float32Array;

  constructor() {
    this.data = new Float32Array(16);
    this.identity();
  }

  identity(): Mat4 {
    this.data.fill(0);
    this.data[0] = this.data[5] = this.data[10] = this.data[15] = 1;
    return this;
  }

  static orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    const mat = new Mat4();
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    mat.data[0] = -2 * lr;
    mat.data[5] = -2 * bt;
    mat.data[10] = 2 * nf;
    mat.data[12] = (left + right) * lr;
    mat.data[13] = (top + bottom) * bt;
    mat.data[14] = (far + near) * nf;
    mat.data[15] = 1;

    return mat;
  }

  static lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    const mat = new Mat4();

    const f = Vec3.create(center.x - eye.x, center.y - eye.y, center.z - eye.z).normalize();
    const s = f.cross(up).normalize();
    const u = s.cross(f);

    mat.data[0] = s.x;
    mat.data[4] = s.y;
    mat.data[8] = s.z;
    mat.data[1] = u.x;
    mat.data[5] = u.y;
    mat.data[9] = u.z;
    mat.data[2] = -f.x;
    mat.data[6] = -f.y;
    mat.data[10] = -f.z;
    mat.data[12] = -s.x * eye.x - s.y * eye.y - s.z * eye.z;
    mat.data[13] = -u.x * eye.x - u.y * eye.y - u.z * eye.z;
    mat.data[14] = f.x * eye.x + f.y * eye.y + f.z * eye.z;

    return mat;
  }

  multiply(other: Mat4): Mat4 {
    const result = new Mat4();
    const a = this.data;
    const b = other.data;
    const r = result.data;

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        r[i * 4 + j] =
          a[i * 4] * b[j] +
          a[i * 4 + 1] * b[4 + j] +
          a[i * 4 + 2] * b[8 + j] +
          a[i * 4 + 3] * b[12 + j];
      }
    }

    return result;
  }
}

export interface WaveParameters {
  amplitude: number;
  wavelength: number;
  speed: number;
  direction: Vec3;
  steepness: number;
}

export function createWaveParameters(
  amplitude: number,
  wavelength: number,
  speed: number,
  directionAngle: number,
  steepness: number = 0.5
): WaveParameters {
  return {
    amplitude,
    wavelength,
    speed,
    direction: Vec3.create(Math.cos(directionAngle), 0, Math.sin(directionAngle)),
    steepness
  };
}

export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Vec2 {
  constructor(public x: number = 0, public y: number = 0) {}

  static create(x: number, y: number): Vec2 {
    return new Vec2(x, y);
  }

  normalize(): Vec2 {
    const len = Math.sqrt(this.x * this.x + this.y * this.y);
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(other: Vec2): Vec2 {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  scale(scalar: number): Vec2 {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }
}

/**
 * Cubic B-spline basis function for smooth interpolation
 * Used for natural wake amplitude decay curves
 */
export function cubicBSpline(t: number): number {
  t = clamp(t, 0, 1);

  if (t < 0.5) {
    // Rising portion of decay curve
    return 2 * t * t * (1.5 - t);
  } else {
    // Falling portion with smooth transition to zero
    const u = 1 - t;
    return 2 * u * u * (1.5 - u);
  }
}

/**
 * Modified Morlet wavelet for natural oscillation decay
 * Creates realistic wake dissipation envelope
 */
export function morletWavelet(t: number, sigma: number = 2.0, omega: number = 5.0): number {
  if (t < 0) return 1.0;

  const gaussian = Math.exp(-(t * t) / (2 * sigma * sigma));
  const oscillation = Math.cos(omega * t);

  return gaussian * oscillation;
}

/**
 * Progressive shear transform for wake spreading
 * Applies lateral spreading that increases with distance/time
 */
export function shearTransform2D(point: Vec2, shearFactor: number, distance: number): Vec2 {
  const lambda = shearFactor * Math.log(distance + 1.0);

  return Vec2.create(
    point.x + lambda * point.y,
    point.y
  );
}

/**
 * Gaussian falloff function for smooth edge transitions
 */
export function gaussianFalloff(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/**
 * Composite wake decay envelope combining spline and wavelet
 * Used specifically for orphaned wake amplitude reduction
 */
export function wakeDecayEnvelope(
  timeSinceOrphan: number,
  maxOrphanAge: number = 15.0,
  waveletSigma: number = 4.0,
  waveletOmega: number = 3.0
): number {
  if (timeSinceOrphan <= 0) return 1.0;
  if (timeSinceOrphan >= maxOrphanAge) return 0.0;

  const normalizedTime = timeSinceOrphan / maxOrphanAge;

  // Cubic B-spline for smooth amplitude curve
  const splineDecay = cubicBSpline(normalizedTime);

  // Morlet wavelet for oscillation decay
  const waveletDecay = Math.max(0, morletWavelet(timeSinceOrphan, waveletSigma, waveletOmega));

  // Smooth fadeout near end of lifetime
  const fadeout = smoothstep(maxOrphanAge, maxOrphanAge * 0.8, timeSinceOrphan);

  return splineDecay * (0.3 + 0.7 * waveletDecay) * fadeout;
}

/**
 * Smooth step function for gradual transitions
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Calculate progressive wake width multiplier for orphaned wakes
 * Wake spreads laterally over time due to dispersion
 */
export function wakeSpreadFactor(timeSinceOrphan: number, baseShearFactor: number = 0.3): number {
  if (timeSinceOrphan <= 0) return 1.0;

  return 1.0 + baseShearFactor * Math.log(timeSinceOrphan + 1.0);
}
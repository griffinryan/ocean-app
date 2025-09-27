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

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// ===== SPLINE FUNCTIONS =====

// Cubic B-spline basis function
export function cubicBSplineBasis(t: number, i: number): number {
  const u = t - i;

  if (u < -2 || u >= 2) return 0;

  if (u >= -2 && u < -1) {
    const v = u + 2;
    return v * v * v / 6;
  } else if (u >= -1 && u < 0) {
    const v = u + 1;
    return (-3 * v * v * v + 3 * v * v + 3 * v + 1) / 6;
  } else if (u >= 0 && u < 1) {
    return (-3 * u * u * u + 3 * u * u + 3 * u + 1) / 6;
  } else {
    const v = 1 - u;
    return v * v * v / 6;
  }
}

// Cubic B-spline interpolation with uniform knots
export function cubicBSplineInterpolate(points: number[], t: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return points[0];

  // Clamp t to valid range
  t = clamp(t, 0, n - 1);

  let result = 0;
  for (let i = 0; i < n; i++) {
    result += points[i] * cubicBSplineBasis(t, i);
  }

  return result;
}

// Hermite interpolation for C1 continuity
export function hermiteInterpolate(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

// ===== WAVELET FUNCTIONS =====

// Morlet wavelet for amplitude modulation
// sigma: controls decay rate, omega: oscillation frequency
export function morletWavelet(t: number, sigma: number = 1.0, omega: number = 5.0): number {
  const gaussian = Math.exp(-(t * t) / (2 * sigma * sigma));
  const oscillation = Math.cos(omega * t);
  return gaussian * oscillation;
}

// Mexican hat wavelet (second derivative of Gaussian)
export function mexicanHatWavelet(t: number, sigma: number = 1.0): number {
  const t2 = t * t;
  const sigma2 = sigma * sigma;
  const gaussian = Math.exp(-t2 / (2 * sigma2));
  const factor = (2 / (Math.sqrt(3 * sigma) * Math.pow(Math.PI, 0.25)));
  return factor * (1 - t2 / sigma2) * gaussian;
}

// Continuous wavelet transform for wake amplitude modulation
export function wakeWaveletTransform(
  trailAge: number,
  vesselWeight: number,
  baseAmplitude: number
): number {
  // Adaptive parameters based on vessel weight
  const sigma = 3.0 + vesselWeight * 2.0; // Heavier vessels have longer-lasting wakes
  const omega = 2.0 - vesselWeight * 0.5; // Heavier vessels have lower frequency oscillations

  // Time scaling for wake persistence
  const scaledTime = trailAge / sigma;

  // Apply Morlet wavelet for natural decay with oscillations
  const waveletValue = morletWavelet(scaledTime, 1.0, omega);

  // Combine with exponential decay for realistic physics
  const exponentialDecay = Math.exp(-trailAge / (15.0 + vesselWeight * 10.0));

  return baseAmplitude * waveletValue * exponentialDecay;
}

// ===== SHEAR MAPPING FUNCTIONS =====

// Apply shear transformation to wake geometry
export function calculateShearMapping(
  distance: number,
  vesselWeight: number,
  baseWidth: number
): { width: number; shearAngle: number } {
  // Logarithmic spreading for realistic wake behavior
  const spreadFactor = 1.0 + Math.log(1.0 + distance * 0.1) * (0.3 + vesselWeight * 0.2);

  // Dynamic shear angle based on wake physics
  const shearAngle = Math.atan(0.05 + vesselWeight * 0.03) * Math.min(distance / 20.0, 1.0);

  // Calculate effective width with shear
  const width = baseWidth * spreadFactor;

  return { width, shearAngle };
}

// Calculate dynamic wake angle based on vessel properties
export function calculateDynamicWakeAngle(
  vesselSpeed: number,
  vesselWeight: number,
  hullLength: number,
  baseKelvinAngle: number = 19.47 * Math.PI / 180
): number {
  // Froude number for wake dynamics
  const froudeNumber = vesselSpeed / Math.sqrt(9.81 * hullLength);

  // Weight-based angle adjustment (heavier vessels push water laterally)
  const weightFactor = 1.0 + vesselWeight * 1.2;

  // Speed-based adjustment
  const speedFactor = Math.sqrt(1.0 + froudeNumber * 0.3);

  // Combined dynamic angle (clamped to reasonable limits)
  return clamp(baseKelvinAngle * weightFactor * speedFactor, baseKelvinAngle, baseKelvinAngle * 2.0);
}

// ===== WAKE TRAIL UTILITIES =====

// Calculate smooth fade-out when vessel leaves screen
export function calculateOffScreenFade(
  fadeStartTime: number,
  currentTime: number,
  fadeDuration: number = 5000
): number {
  const fadeProgress = clamp((currentTime - fadeStartTime) / fadeDuration, 0.0, 1.0);

  // Use smooth cubic fade-out
  const cubicFade = 1.0 - fadeProgress * fadeProgress * (3.0 - 2.0 * fadeProgress);

  // Apply additional exponential component for natural decay
  const exponentialFade = Math.exp(-fadeProgress * 3.0);

  return cubicFade * exponentialFade;
}

// Multi-stage wake decay function with spline smoothing
export function calculateWakeDecay(
  wakeAge: number,
  vesselWeight: number,
  maxAge: number = 45.0
): number {
  if (wakeAge >= maxAge) return 0.0;
  if (wakeAge <= 0) return 1.0;

  // Normalized age [0, 1]
  const normalizedAge = wakeAge / maxAge;

  // Three-stage decay: sustained -> gradual -> rapid
  const controlPoints = [
    1.0,                    // Full intensity
    0.95,                   // Slight reduction
    0.6 + vesselWeight * 0.2, // Weight-dependent mid-stage
    0.15,                   // Rapid decay start
    0.0                     // Complete fade
  ];

  // Map normalized age to control point space
  const splineT = normalizedAge * (controlPoints.length - 1);

  return cubicBSplineInterpolate(controlPoints, splineT);
}
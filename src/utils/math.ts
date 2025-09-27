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

export interface SplineControlPoint {
  position: number;
  value: number;
  tangent?: number;
}

/**
 * Cubic Hermite spline for smooth wake decay interpolation
 */
export class CubicSpline {
  private controlPoints: SplineControlPoint[];

  constructor(points: SplineControlPoint[]) {
    this.controlPoints = [...points].sort((a, b) => a.position - b.position);

    // Auto-calculate tangents if not provided
    this.autoCalculateTangents();
  }

  private autoCalculateTangents(): void {
    for (let i = 0; i < this.controlPoints.length; i++) {
      if (this.controlPoints[i].tangent !== undefined) continue;

      let tangent = 0;
      if (i === 0 && this.controlPoints.length > 1) {
        // First point: use slope to next point
        tangent = (this.controlPoints[i + 1].value - this.controlPoints[i].value) /
                  (this.controlPoints[i + 1].position - this.controlPoints[i].position);
      } else if (i === this.controlPoints.length - 1 && i > 0) {
        // Last point: use slope from previous point
        tangent = (this.controlPoints[i].value - this.controlPoints[i - 1].value) /
                  (this.controlPoints[i].position - this.controlPoints[i - 1].position);
      } else if (i > 0 && i < this.controlPoints.length - 1) {
        // Middle points: use average of adjacent slopes
        const leftSlope = (this.controlPoints[i].value - this.controlPoints[i - 1].value) /
                         (this.controlPoints[i].position - this.controlPoints[i - 1].position);
        const rightSlope = (this.controlPoints[i + 1].value - this.controlPoints[i].value) /
                          (this.controlPoints[i + 1].position - this.controlPoints[i].position);
        tangent = (leftSlope + rightSlope) * 0.5;
      }

      this.controlPoints[i].tangent = tangent;
    }
  }

  evaluate(t: number): number {
    if (this.controlPoints.length === 0) return 0;
    if (this.controlPoints.length === 1) return this.controlPoints[0].value;

    // Clamp to bounds
    if (t <= this.controlPoints[0].position) return this.controlPoints[0].value;
    if (t >= this.controlPoints[this.controlPoints.length - 1].position) {
      return this.controlPoints[this.controlPoints.length - 1].value;
    }

    // Find the segment
    let i = 0;
    while (i < this.controlPoints.length - 1 && this.controlPoints[i + 1].position < t) {
      i++;
    }

    const p0 = this.controlPoints[i];
    const p1 = this.controlPoints[i + 1];

    // Normalize t to [0, 1] within this segment
    const segmentT = (t - p0.position) / (p1.position - p0.position);

    // Cubic Hermite interpolation
    const t2 = segmentT * segmentT;
    const t3 = t2 * segmentT;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + segmentT;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const dt = p1.position - p0.position;

    return h00 * p0.value +
           h10 * dt * (p0.tangent || 0) +
           h01 * p1.value +
           h11 * dt * (p1.tangent || 0);
  }
}

/**
 * Mexican Hat wavelet function for natural amplitude modulation
 */
export class WaveletTransform {
  static mexicanHat(x: number, sigma: number = 1.0): number {
    const normalized = x / sigma;
    const x2 = normalized * normalized;
    return (1 - x2) * Math.exp(-x2 * 0.5);
  }

  static mexicanHatDerivative(x: number, sigma: number = 1.0): number {
    const normalized = x / sigma;
    const x2 = normalized * normalized;
    return (-3 * normalized + normalized * x2) * Math.exp(-x2 * 0.5) / sigma;
  }

  /**
   * Apply wavelet-based amplitude modulation
   */
  static applyWaveletDecay(distance: number, maxDistance: number, sigma: number = 0.3): number {
    const normalizedDistance = distance / maxDistance;
    return Math.max(0, this.mexicanHat(normalizedDistance, sigma));
  }
}

/**
 * 2D shear transformation for progressive wake spreading
 */
export class ShearTransform2D {
  static applyShear(point: Vec3, shearMatrix: number[]): Vec3 {
    // Apply 2D shear transformation matrix to XZ plane
    const newX = shearMatrix[0] * point.x + shearMatrix[1] * point.z;
    const newZ = shearMatrix[2] * point.x + shearMatrix[3] * point.z;
    return new Vec3(newX, point.y, newZ);
  }

  /**
   * Create progressive shear matrix for wake spreading
   */
  static createProgressiveShearMatrix(distance: number, shearRate: number = 0.1): number[] {
    const shearAmount = shearRate * Math.log(1 + distance);
    return [
      1.0, shearAmount,
      0.0, 1.0
    ];
  }

  /**
   * Calculate dynamic wake angle with progressive shear
   */
  static calculateDynamicWakeAngle(baseAngle: number, distance: number, shearRate: number = 0.1): number {
    return baseAngle * (1.0 + shearRate * Math.log(1 + distance * 0.1));
  }
}

/**
 * B-Spline basis functions for smooth local control
 */
export class BSplineBasis {
  /**
   * Cubic B-spline basis function
   */
  static cubicBasis(t: number, i: number): number {
    const u = Math.abs(t - i);

    if (u >= 2) return 0;

    if (u < 1) {
      return (1 - 1.5 * u * u + 0.75 * u * u * u);
    } else {
      const u2 = 2 - u;
      return 0.25 * u2 * u2 * u2;
    }
  }

  /**
   * Evaluate B-spline with given control points
   */
  static evaluate(t: number, controlPoints: number[], degree: number = 3): number {
    let result = 0;
    const n = controlPoints.length;

    for (let i = 0; i < n; i++) {
      const basisValue = this.cubicBasis(t * (n - degree), i);
      result += controlPoints[i] * basisValue;
    }

    return result;
  }

  /**
   * Create smooth decay curve using B-spline
   */
  static createDecayCurve(stages: number[]): (t: number) => number {
    return (t: number) => {
      const clampedT = clamp(t, 0, 1);
      return this.evaluate(clampedT, stages);
    };
  }
}

/**
 * Enhanced wake decay function using spline-wavelet transforms
 */
export function createWakeDecayFunction(
  stages: SplineControlPoint[],
  waveletSigma: number = 0.3
): (distance: number, maxDistance: number, weight: number) => number {
  const spline = new CubicSpline(stages);

  return (distance: number, maxDistance: number, weight: number) => {
    const normalizedDistance = distance / maxDistance;
    const splineDecay = spline.evaluate(normalizedDistance);
    const waveletModulation = WaveletTransform.applyWaveletDecay(distance, maxDistance, waveletSigma);

    // Combine spline and wavelet with weight influence
    const weightFactor = 1.0 + weight * 0.3;
    return Math.max(0, splineDecay * waveletModulation * weightFactor);
  };
}
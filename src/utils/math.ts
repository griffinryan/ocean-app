/**
 * Mathematical utilities for ocean rendering
 */

export class Vec3 {
  constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}

  static create(x: number, y: number, z: number): Vec3 {
    return new Vec3(x, y, z);
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
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

  add(other: Vec3): Vec3 {
    return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  multiplyScalar(scalar: number): Vec3 {
    return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  dot(other: Vec3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  distanceTo(other: Vec3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  cross(other: Vec3): Vec3 {
    return new Vec3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x
    );
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
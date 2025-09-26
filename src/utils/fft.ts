/**
 * Fast Fourier Transform utilities for ocean wave synthesis
 * Based on Stockham formulation optimized for GPU computation
 */

export interface Complex {
  real: number;
  imag: number;
}

export class FFTUtilities {
  /**
   * Create complex number
   */
  static complex(real: number, imag: number = 0): Complex {
    return { real, imag };
  }

  /**
   * Complex number addition
   */
  static add(a: Complex, b: Complex): Complex {
    return {
      real: a.real + b.real,
      imag: a.imag + b.imag
    };
  }

  /**
   * Complex number multiplication
   */
  static multiply(a: Complex, b: Complex): Complex {
    return {
      real: a.real * b.real - a.imag * b.imag,
      imag: a.real * b.imag + a.imag * b.real
    };
  }

  /**
   * Complex conjugate
   */
  static conjugate(z: Complex): Complex {
    return {
      real: z.real,
      imag: -z.imag
    };
  }

  /**
   * Complex magnitude
   */
  static magnitude(z: Complex): number {
    return Math.sqrt(z.real * z.real + z.imag * z.imag);
  }

  /**
   * Complex phase
   */
  static phase(z: Complex): number {
    return Math.atan2(z.imag, z.real);
  }

  /**
   * Create twiddle factors for FFT
   */
  static createTwiddleFactors(size: number): Float32Array {
    const factors = new Float32Array(size * 2); // real, imag pairs

    for (let i = 0; i < size; i++) {
      const angle = -2.0 * Math.PI * i / size;
      factors[i * 2] = Math.cos(angle);     // real
      factors[i * 2 + 1] = Math.sin(angle); // imag
    }

    return factors;
  }

  /**
   * Bit reversal for FFT reordering
   */
  static bitReverse(n: number, bits: number): number {
    let reversed = 0;
    for (let i = 0; i < bits; i++) {
      reversed = (reversed << 1) | (n & 1);
      n >>= 1;
    }
    return reversed;
  }

  /**
   * Create bit-reversed indices
   */
  static createBitReversedIndices(size: number): Uint32Array {
    const bits = Math.log2(size);
    const indices = new Uint32Array(size);

    for (let i = 0; i < size; i++) {
      indices[i] = this.bitReverse(i, bits);
    }

    return indices;
  }

  /**
   * Generate initial wave amplitudes using Phillips spectrum
   */
  static generatePhillipsSpectrum(
    size: number,
    windSpeed: number,
    windDirection: [number, number],
    amplitude: number,
    gravity: number = 9.81
  ): Complex[][] {
    const spectrum: Complex[][] = [];
    const L = windSpeed * windSpeed / gravity; // Largest possible wave size
    const l = L / 1000; // Cut-off for small waves

    for (let m = 0; m < size; m++) {
      spectrum[m] = [];
      for (let n = 0; n < size; n++) {
        const kx = (2.0 * Math.PI * (n - size / 2)) / size;
        const ky = (2.0 * Math.PI * (m - size / 2)) / size;
        const k = Math.sqrt(kx * kx + ky * ky);

        if (k === 0) {
          spectrum[m][n] = this.complex(0, 0);
          continue;
        }

        // Phillips spectrum calculation
        const kLength = k * k * k * k;
        const kDotWind = kx * windDirection[0] + ky * windDirection[1];
        const L2 = L * L;

        const phillips =
          amplitude *
          Math.exp(-1.0 / (k * k * L2)) /
          kLength *
          Math.pow(Math.abs(kDotWind), 2) *
          Math.exp(-k * k * l * l); // Damping for small waves

        // Generate Gaussian random numbers (Box-Muller transform)
        const xi_r = this.gaussianRandom();
        const xi_i = this.gaussianRandom();

        const amplitudeReal = xi_r * Math.sqrt(phillips / 2.0);
        const amplitudeImag = xi_i * Math.sqrt(phillips / 2.0);

        spectrum[m][n] = this.complex(amplitudeReal, amplitudeImag);
      }
    }

    return spectrum;
  }

  /**
   * Generate Gaussian random number using Box-Muller transform
   */
  private static gaussianRandom(): number {
    static let hasSpare = false;
    static let spare: number;

    if (hasSpare) {
      hasSpare = false;
      return spare;
    }

    hasSpare = true;
    const u = Math.random();
    const v = Math.random();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.cos(2.0 * Math.PI * v);
    return mag * Math.sin(2.0 * Math.PI * v);
  }

  /**
   * Time evolution of wave spectrum
   */
  static evolveSpectrum(
    initialSpectrum: Complex[][],
    time: number,
    size: number,
    gravity: number = 9.81
  ): Complex[][] {
    const evolved: Complex[][] = [];

    for (let m = 0; m < size; m++) {
      evolved[m] = [];
      for (let n = 0; n < size; n++) {
        const kx = (2.0 * Math.PI * (n - size / 2)) / size;
        const ky = (2.0 * Math.PI * (m - size / 2)) / size;
        const k = Math.sqrt(kx * kx + ky * ky);

        if (k === 0) {
          evolved[m][n] = this.complex(0, 0);
          continue;
        }

        // Dispersion relation: ω = √(gk)
        const omega = Math.sqrt(gravity * k);
        const phase = omega * time;

        // Time evolution
        const h0 = initialSpectrum[m][n];
        const h0Conj = this.conjugate(initialSpectrum[size - m - 1][size - n - 1]);

        const expPos = this.complex(Math.cos(phase), Math.sin(phase));
        const expNeg = this.complex(Math.cos(-phase), Math.sin(-phase));

        const term1 = this.multiply(h0, expPos);
        const term2 = this.multiply(h0Conj, expNeg);

        evolved[m][n] = this.add(term1, term2);
      }
    }

    return evolved;
  }

  /**
   * Convert spectrum to texture data for GPU
   */
  static spectrumToTexture(spectrum: Complex[][]): Float32Array {
    const size = spectrum.length;
    const data = new Float32Array(size * size * 4); // RGBA format

    for (let m = 0; m < size; m++) {
      for (let n = 0; n < size; n++) {
        const index = (m * size + n) * 4;
        data[index] = spectrum[m][n].real;     // R channel
        data[index + 1] = spectrum[m][n].imag; // G channel
        data[index + 2] = 0;                   // B channel (unused)
        data[index + 3] = 1;                   // A channel (unused)
      }
    }

    return data;
  }

  /**
   * Calculate gradient (normal) from height field
   */
  static calculateGradient(heightSpectrum: Complex[][], size: number): { dx: Complex[][], dy: Complex[][] } {
    const gradientX: Complex[][] = [];
    const gradientY: Complex[][] = [];

    for (let m = 0; m < size; m++) {
      gradientX[m] = [];
      gradientY[m] = [];

      for (let n = 0; n < size; n++) {
        const kx = (2.0 * Math.PI * (n - size / 2)) / size;
        const ky = (2.0 * Math.PI * (m - size / 2)) / size;

        // Gradient is multiplication by ik in frequency domain
        const h = heightSpectrum[m][n];

        // ∂h/∂x = IFFT(ik_x * H(k))
        gradientX[m][n] = this.multiply(this.complex(0, kx), h);

        // ∂h/∂y = IFFT(ik_y * H(k))
        gradientY[m][n] = this.multiply(this.complex(0, ky), h);
      }
    }

    return { dx: gradientX, dy: gradientY };
  }

  /**
   * JONSWAP spectrum parameters (alternative to Phillips)
   */
  static generateJONSWAPSpectrum(
    size: number,
    windSpeed: number,
    fetch: number,
    gamma: number = 3.3
  ): Complex[][] {
    const spectrum: Complex[][] = [];
    const g = 9.81;

    // JONSWAP parameters
    const alpha = 0.076 * Math.pow(windSpeed * windSpeed / (fetch * g), 0.22);
    const wp = 22 * Math.pow(g * g / (windSpeed * fetch), 1/3);

    for (let m = 0; m < size; m++) {
      spectrum[m] = [];
      for (let n = 0; n < size; n++) {
        const kx = (2.0 * Math.PI * (n - size / 2)) / size;
        const ky = (2.0 * Math.PI * (m - size / 2)) / size;
        const k = Math.sqrt(kx * kx + ky * ky);

        if (k === 0) {
          spectrum[m][n] = this.complex(0, 0);
          continue;
        }

        const omega = Math.sqrt(g * k);
        const sigma = omega <= wp ? 0.07 : 0.09;

        // JONSWAP spectrum
        const jonswap =
          alpha * g * g * Math.pow(omega, -5) *
          Math.exp(-1.25 * Math.pow(wp / omega, 4)) *
          Math.pow(gamma, Math.exp(-Math.pow(omega - wp, 2) / (2 * sigma * sigma * wp * wp)));

        // Convert to amplitude
        const xi_r = this.gaussianRandom();
        const xi_i = this.gaussianRandom();

        const amplitudeReal = xi_r * Math.sqrt(jonswap / 2.0);
        const amplitudeImag = xi_i * Math.sqrt(jonswap / 2.0);

        spectrum[m][n] = this.complex(amplitudeReal, amplitudeImag);
      }
    }

    return spectrum;
  }
}
# Ocean Portfolio

> **Real-time ocean simulation with liquid glass optics and physically-based vessel wakes**

A WebGL2-powered portfolio featuring advanced rendering techniques: procedural wave synthesis, Kelvin wake theory, Fresnel/Snell's law refraction, and a sophisticated multi-pass render pipeline optimized for interactive performance.

**Live Demo**: [griffinryan.com](https://griffinryan.com/)

---

## Overview

Ocean Portfolio is a technical showcase combining **procedural ocean synthesis**, **physics-based vessel wake simulation**, and **liquid glass distortion effects** into a cohesive interactive experience. Built with TypeScript and WebGL2, it demonstrates real-time rendering techniques suitable for high-performance web applications.

**Key Features:**
- **Multi-pass render pipeline** with shared framebuffer optimization (3× → 1× ocean renders)
- **Procedural sine wave ocean** with LOD-based adaptive detail
- **Physically-based vessel wakes** using Kelvin wave theory and deep-water dispersion
- **Liquid glass optics** with Fresnel reflectance, Snell's law refraction, and chromatic aberration
- **Adaptive performance** with frame budget management and quality presets
- **Advanced upscaling** (FSR/Bicubic/Lanczos) for high-DPI displays

**Technology Stack:** TypeScript, WebGL2, GLSL ES 3.0, Vite

---

## Render Pipeline Architecture

The application uses a **6-pass multi-stage pipeline** with independent resolution scaling and work prioritization:

```
┌─────────────┐
│ Wake Pass   │──► R32F texture (vessel wake heights)
└─────────────┘    Resolution: 0.5-1.0× render scale
       │
       ▼
┌─────────────┐
│ Ocean Pass  │──► Shared Buffer (RGBA) ◄── PERFORMANCE: Render ONCE, sample N times
└─────────────┘    Resolution: 1.0× render scale     Eliminates redundant draws (3→1)
       │
       ├───────────────────────────────────┐
       ▼                                   ▼
┌─────────────┐                     ┌─────────────┐
│ Glass Pass  │──► Distorted RGBA   │ Text Pass   │──► Adaptive text + scene capture
└─────────────┘    (Fresnel/Snell)  └─────────────┘    Resolution: 1.0× render scale
  Resolution: 1.0×                          │
       │                                    ▼
       │                            ┌──────────────┐
       │                            │ Blur Map     │──► Distance field (R8)
       │                            └──────────────┘    (Frosted glass around text)
       │                                    │
       ├────────────────────────────────────┘
       ▼
┌─────────────┐
│ Composite   │──► Final scene (Ocean + Glass + Text)
└─────────────┘    Resolution: render scale (0.5-1.0×)
       │
       ▼
┌─────────────┐
│ Upscale     │──► Display resolution (FSR/Bicubic/Lanczos)
└─────────────┘    Resolution: 1.0× display (native)
       │
       ▼
   [Display]
```

---

## Mathematical Foundations

### 1. Ocean Wave Synthesis

Unlike Tessendorf's FFT-based spectral approach (used in *Sea of Thieves*, *Uncharted 4*), this project uses **real-time procedural sine wave composition** for interactive performance. We trade spectral accuracy for computational efficiency.

#### Composite Wave Formula

The ocean height field is synthesized from **multiple directional sine waves** with interference:

```
h(x, t) = Σᵢ Aᵢ · sin(kᵢ · (dᵢ · x) - ωᵢt + φᵢ)
```

Where:
- **A** = Amplitude (wave height)
- **k** = Wave number = 2π/λ (λ = wavelength)
- **ω** = Angular frequency (speed of phase propagation)
- **d** = Direction vector (normalized 2D)
- **φ** = Phase offset (for wave interference)

**Implementation** (from `ocean.frag`):
```glsl
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * PI / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// Composite: 8 waves with varying parameters
height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);  // Primary
height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);  // Secondary
// ... + 6 more waves for complexity
```

#### Fractional Brownian Motion (FBM) Texture

Surface detail is added via **multi-octave noise**:

```
f(x) = Σᵢ aⁱ · noise(2ⁱ · x)    where a = 0.5 (amplitude decay)
```

**Adaptive FBM** reduces octaves at low pixel density (LOD):
- **LOD 0-1**: 3 octaves (full detail)
- **LOD 1-2**: 2 octaves
- **LOD 2+**: 1 octave (minimal detail, 4K displays)

#### Normal Calculation

Ocean normals are computed via **central differences** of the height field:

```glsl
vec3 calculateNormal(vec2 pos, float time) {
    float eps = 0.1;
    float hL = getOceanHeight(pos - vec2(eps, 0), time);
    float hR = getOceanHeight(pos + vec2(eps, 0), time);
    float hD = getOceanHeight(pos - vec2(0, eps), time);
    float hU = getOceanHeight(pos + vec2(0, eps), time);

    // Gradient: ∇h ≈ [(hR - hL)/(2ε), (hU - hD)/(2ε)]
    return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}
```

---

### 2. Vessel Wake Physics

Vessel wakes are simulated using **Kelvin wave theory** with dynamic angle adaptation and realistic decay.

#### Kelvin Angle

The **Kelvin wake pattern** is a classic result in fluid dynamics ([Lord Kelvin, 1887](https://en.wikipedia.org/wiki/Wake_(physics))). For deep water, the half-angle is:

```
θ_Kelvin ≈ 19.47° ≈ 0.34 radians
```

**Dynamic angle adjustment** based on vessel properties:

```
θ_dynamic = θ_base × (1 + Fr × 0.2) × (1 + shear_rate × log(1 + distance × 0.1))
             ↑               ↑                        ↑
          Base angle    Froude effect        Progressive shear (curling)
```

**Froude Number** (dimensionless speed ratio):

```
Fr = v / √(g·L)
```

Where:
- **v** = Vessel velocity (m/s)
- **g** = Gravitational acceleration (9.81 m/s²)
- **L** = Hull length (m)

**Progressive Shear Mapping** (`math.ts`):
```typescript
static calculateDynamicWakeAngle(baseAngle: number, distance: number, shearRate = 0.1): number {
    // Wake spreads outward logarithmically with distance
    return baseAngle * (1.0 + shearRate * Math.log(1 + distance * 0.1));
}
```

#### Deep Water Dispersion Relation

Wave frequency relates to wavelength via the **dispersion relation**:

```
ω = √(g·k)    where k = 2π/λ
```

This ensures waves of different lengths travel at physically correct speeds:

```glsl
// wake.frag - Calculate wave frequency from wavelength
float waveNumber(float wavelength) {
    return 2.0 * PI / wavelength;
}

float waveFrequency(float k) {
    return sqrt(GRAVITY * k);  // Deep water: ω² = gk
}
```

#### Fibonacci Wave Interference

Wakes use **golden ratio phase offsets** for natural interference patterns:

```glsl
float phi = 1.618;  // Golden ratio

for (int j = 0; j < 2; j++) {
    float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.5);
    float k = waveNumber(wavelength);
    float omega = waveFrequency(k);

    // Golden angle phase offset: φ = j × 2.39 rad ≈ j × 137°
    float phase = k * pathDistance - omega * time + float(j) * 2.39;
    float amplitude = baseAmplitude * pow(0.618, float(j));  // φ⁻¹ decay

    wakeHeight += amplitude * sin(phase);
}
```

#### Wake Decay Functions

Wake intensity decays over distance using **advanced mathematical transforms** from `math.ts`:

##### Cubic Hermite Splines

Smooth interpolation through control points with tangent control:

```typescript
// Hermite basis functions
h₀₀(t) = 2t³ - 3t² + 1
h₁₀(t) = t³ - 2t² + t
h₀₁(t) = -2t³ + 3t²
h₁₁(t) = t³ - t²

// Interpolated value
f(t) = h₀₀(t)·p₀ + h₁₀(t)·Δt·m₀ + h₀₁(t)·p₁ + h₁₁(t)·Δt·m₁
```

**Example spline configuration** (from `OceanRenderer.ts`):
```typescript
splineControlPoints: [
    { position: 0.0,  value: 1.0,  tangent: -0.5 },  // Strong start
    { position: 0.3,  value: 0.85, tangent: -0.8 },  // Gentle initial decay
    { position: 0.6,  value: 0.5,  tangent: -1.2 },  // Mid-trail fade
    { position: 0.85, value: 0.2,  tangent: -2.0 },  // Rapid final fade
    { position: 1.0,  value: 0.0,  tangent: -3.0 }   // Complete fade
]
```

##### Mexican Hat Wavelet Modulation

**Ricker wavelet** (second derivative of Gaussian) for natural amplitude modulation:

```
ψ(x) = (1 - x²/σ²) · exp(-x²/(2σ²))
```

```typescript
// math.ts - WaveletTransform
static mexicanHat(x: number, sigma = 1.0): number {
    const normalized = x / sigma;
    const x2 = normalized * normalized;
    return (1 - x2) * Math.exp(-x2 * 0.5);
}
```

Visual representation of Mexican Hat wavelet (σ = 1.0):
```
  1.0 ┤     ╭─╮
      │    ╱   ╲
  0.5 ┤   ╱     ╲
      │  ╱       ╲
  0.0 ┼─┴─────────┴─
      │╱           ╲
 -0.2 ┤             ╲─
      └─────────────────
     -3  -1  0  1  3
```

##### Cubic B-Spline Basis

**Local control** smooth curves with continuous second derivatives:

```
             ⎧ 1 - 1.5u² + 0.75u³              if u < 1
B₃(u) =      ⎨
             ⎩ 0.25(2 - u)³                    if 1 ≤ u < 2
```

```typescript
// math.ts - BSplineBasis
static cubicBasis(t: number, i: number): number {
    const u = Math.abs(t - i);
    if (u >= 2) return 0;

    if (u < 1) {
        return 1 - 1.5 * u * u + 0.75 * u * u * u;
    } else {
        const u2 = 2 - u;
        return 0.25 * u2 * u2 * u2;
    }
}
```

##### Combined Decay Function

Final decay combines **spline interpolation** with **wavelet modulation**:

```typescript
// math.ts - createWakeDecayFunction
export function createWakeDecayFunction(
    stages: SplineControlPoint[],
    waveletSigma = 0.3
): (distance: number, maxDistance: number, weight: number) => number {
    const spline = new CubicSpline(stages);

    return (distance, maxDistance, weight) => {
        const normalizedDistance = distance / maxDistance;
        const splineDecay = spline.evaluate(normalizedDistance);
        const waveletModulation = WaveletTransform.applyWaveletDecay(
            distance, maxDistance, waveletSigma
        );

        // Combine with vessel weight influence
        const weightFactor = 1.0 + weight * 0.3;
        return Math.max(0, splineDecay * waveletModulation * weightFactor);
    };
}
```

---

### 3. Liquid Glass Optics

Glass panels use **physically-based rendering** with Fresnel reflections and Snell's law refraction.

#### Fresnel Reflectance (Schlick Approximation)

The **Fresnel effect** describes how reflectivity varies with viewing angle:

```
F(θ) = F₀ + (1 - F₀)(1 - cos θ)ᵖ
```

Where:
- **F₀** = Reflectance at normal incidence = `((η - 1)/(η + 1))²`
- **η** = Refractive index (glass ≈ 1.5, water ≈ 1.33)
- **p** = Fresnel power (2.0 for physically accurate, 1.8 for subtle falloff)

```glsl
// glass.frag - Fresnel calculation
float fresnel(float cosTheta, float refractionIndex) {
    float f0 = pow((refractionIndex - 1.0) / (refractionIndex + 1.0), 2.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, FRESNEL_POWER);
}
```

**Physical interpretation:**
- At **grazing angles** (θ → 90°), glass becomes highly reflective (F → 1)
- At **normal incidence** (θ = 0°), reflectance is minimal (F = F₀ ≈ 0.04 for glass)

#### Snell's Law Refraction

**Refraction vector** calculation using Snell's law:

```
η₁ sin θᵢ = η₂ sin θₜ
```

Refracted ray direction:

```
R = η·I + (η·cos θᵢ - cos θₜ)·N
```

Where:
- **I** = Incident ray direction (normalized)
- **N** = Surface normal (normalized)
- **η** = η₁/η₂ (relative refractive index)
- **cos θₜ** = √(1 - η²(1 - cos² θᵢ))

```glsl
// glass.frag - Refraction with total internal reflection
vec3 calculateRefraction(vec3 incident, vec3 normal, float eta) {
    float cosI = -dot(normal, incident);
    float sinT2 = eta * eta * (1.0 - cosI * cosI);

    if (sinT2 > 1.0) {
        return vec3(0.0); // Total internal reflection
    }

    float cosT = sqrt(1.0 - sinT2);
    return eta * incident + (eta * cosI - cosT) * normal;
}
```

#### Chromatic Aberration

**Wavelength-dependent refraction** simulates dispersion (like a prism):

```glsl
// Sample RGB channels at different refraction offsets
vec3 chromaticColor = vec3(
    texture(u_oceanTexture, uv + refraction * 1.006).r,  // Red (less refraction)
    texture(u_oceanTexture, uv + refraction * 1.000).g,  // Green (baseline)
    texture(u_oceanTexture, uv + refraction * 0.994).b   // Blue (more refraction)
);
```

#### Liquid Flow Distortion

Multi-scale **noise-based flow** for animated liquid surface:

```glsl
// Flowing noise layers with different frequencies
float flow1 = time * LIQUID_FLOW_SPEED;
vec2 flowDir1 = vec2(cos(flow1 * 0.8), sin(flow1 * 1.2));

float h = noise(uv * 15.0 + flowDir1 * 2.0) * 0.08;      // Large scale
h += noise(uv * 22.5 + flowDir2 * 1.5) * 0.05;           // Medium scale
h += noise(uv * 37.5 + time * 0.6) * 0.03;               // Fine detail

// Ripple patterns (radial waves from center)
float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
h += ripple * exp(-length(uv - 0.5) * 3.0);
```

---

### 4. Performance Optimizations

#### LOD System (Pixel-Density Derivatives)

**Adaptive detail** based on screen-space derivatives:

```glsl
// Calculate pixel-density LOD
float calculatePixelDensityLOD(vec2 oceanPos) {
    vec2 dx = dFdx(oceanPos);  // ∂(oceanPos)/∂x (screen-space derivative)
    vec2 dy = dFdy(oceanPos);  // ∂(oceanPos)/∂y

    float maxDerivative = max(length(dx), length(dy));

    // Invert: Small derivative = high pixel density = high LOD (less detail)
    float pixelsPerOceanUnit = 1.0 / max(0.001, maxDerivative);

    // Map to LOD range [0, 3.5]
    return clamp(log2(pixelsPerOceanUnit) - 6.5, 0.0, 3.5);
}
```

**LOD-based wave reduction:**
```glsl
if (lod < 2.5) {
    // Add 4 primary waves (medium-high detail)
    height += sineWave(...);
}
if (lod < 1.5) {
    // Add 2 secondary waves (high detail)
    height += sineWave(...);
}
if (lod < 0.5) {
    // Add 2 interference waves (highest detail)
    height += sineWave(...);
}
```

**Performance gain:** ~40% speedup on 4K displays by reducing unnecessary detail at low pixel density.

#### Fast Sine Approximation (Bhaskara I)

**Polynomial approximation** ([Bhaskara I, 7th century](https://en.wikipedia.org/wiki/Bhāskara_I%27s_sine_approximation_formula)):

```
sin(x) ≈ x(16 - 5x²) / (5x² + 4π²)    for x ∈ [-π, π]
```

**Error:** < 0.002 across full range
**Speedup:** ~2× over native `sin()`

```glsl
float fastSin(float x) {
    const float PI = 3.14159265359;
    const float TWO_PI = 6.28318530718;
    x = mod(x + PI, TWO_PI) - PI;  // Normalize to [-π, π]

    float x2 = x * x;
    return x * (16.0 - 5.0 * x2) / (5.0 * x2 + 4.0 * PI * PI);
}
```

Used for waves at **LOD ≥ 1.0** where slight error is imperceptible.

#### Resolution Scaling

Automatic scaling based on display size:

| Display Resolution | Pixels | Render Scale | Upscale Method |
|-------------------|--------|--------------|----------------|
| 4K+ (>6M pixels) | >3840×2160 | 0.5× | FSR/Bicubic |
| 1440p-4K (3.5M-6M) | 2560×1440 | 0.66× | Bicubic |
| 1080p-1440p | 1920×1080 | 1.0× | None (native) |

**Result:** 4× performance gain on 4K displays with imperceptible quality loss.

#### Upscaling Algorithms

##### FSR-Inspired Edge-Adaptive Sharpening

**RCAS** (Robust Contrast Adaptive Sharpening):

```glsl
// Detect edges via gradient magnitude
vec3 gradX = right - left;
vec3 gradY = top - bottom;
float edgeStrength = length(gradX) + length(gradY);

// Adaptive sharpening kernel
vec3 sharpened = center * (1.0 + 4.0 * sharpness * contrastFactor)
               - (top + bottom + left + right) * (sharpness * contrastFactor * 0.25);

// Clamp to prevent oversharpening artifacts
sharpened = clamp(sharpened, minColor, maxColor);
```

##### Lanczos Resampling

**3-tap sinc interpolation** for best wave detail preservation:

```
L(x) = a · sin(πx) · sin(πx/a) / (π²x²)    for |x| < a
```

```glsl
float lanczosWeight(float x, float a) {
    if (abs(x) < 0.001) return 1.0;
    if (abs(x) >= a) return 0.0;

    float pi_x = PI * x;
    return a * sin(pi_x) * sin(pi_x / a) / (pi_x * pi_x);
}
```

---

## Comparison to Tessendorf's FFT Ocean

**Tessendorf (2001):** "Simulating Ocean Water" ([PDF](https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf))

### Tessendorf's Approach (Spectral FFT)

- **Method:** Phillips spectrum → inverse FFT → height field
- **Advantages:** Photorealistic, statistically accurate ocean surfaces
- **Disadvantages:**
  - Requires 512×512+ FFT grid (computationally expensive)
  - GPU FFT implementation complexity
  - Difficult to integrate with interactive UI elements

**Used in:** *Sea of Thieves*, *Uncharted 4*, *etc* (large-scale ocean scenes)

### This Project's Approach (Procedural Synthesis)

- **Method:** Composite sine waves + FBM noise → real-time evaluation
- **Advantages:**
  - Minimal GPU overhead (8 sine evaluations vs. full FFT)
  - Adaptive LOD based on pixel density
  - Perfect integration with UI distortion effects
  - ~60 FPS on mid-range hardware at 4K
- **Disadvantages:** Less statistical realism than spectral methods

**Trade-off:** We prioritize **interactive performance** and **UI integration** over photorealistic ocean simulation. For portfolio/UI applications, this is the optimal approach.

---

## Build & Development

### Prerequisites

- Node.js 18+
- npm 9+

### Quick Start

```bash
# Install dependencies
npm install

# Development server (auto-opens localhost:3000)
npm run dev

# Production build (TypeScript compilation + Vite build)
npm run build

# Preview production build
npm run preview
```

### Project Structure

```
ocean-app/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── renderer/
│   │   ├── OceanRenderer.ts    # Main renderer (orchestrates all passes)
│   │   ├── WakeRenderer.ts     # Vessel wake texture generation
│   │   ├── GlassRenderer.ts    # Fresnel/Snell glass distortion
│   │   ├── TextRenderer.ts     # Adaptive text overlay
│   │   ├── VesselSystem.ts     # Vessel physics & wake generation
│   │   ├── PipelineManager.ts  # Pipeline state & variant management
│   │   └── ...
│   ├── shaders/                # GLSL shaders (6 programs)
│   │   ├── ocean.{vert,frag}   # Procedural ocean waves
│   │   ├── wake.{vert,frag}    # Vessel wake physics
│   │   ├── glass.{vert,frag}   # Glass optics (Fresnel/Snell)
│   │   ├── text.{vert,frag}    # Adaptive text rendering
│   │   ├── blurmap.{vert,frag} # Distance field blur map
│   │   └── upscale.{vert,frag} # FSR/Bicubic/Lanczos upscaling
│   ├── utils/
│   │   ├── math.ts             # Mathematical utilities (Vec3, Mat4, splines, wavelets)
│   │   ├── PerformanceMonitor.ts
│   │   └── FrameBudget.ts      # 16.67ms frame budget management
│   └── components/             # UI components (panels, router, navigation)
└── CLAUDE.md                   # Developer documentation
```

---

## Debug Controls

Press **`O`** to toggle debug overlay.

### Keyboard Shortcuts

| Key | Function |
|-----|----------|
| **D** | Cycle debug modes (Normal → UV → Wave Height → Normals → Wake Map → LOD) |
| **0-5** | Select debug mode directly |
| **V** | Toggle vessel wake system |
| **G** | Toggle glass panel rendering |
| **T** | Toggle text rendering |
| **B** | Toggle blur map (frosted glass effect) |
| **F** | Toggle fullscreen |

### Debug Visualizations

- **UV Coords:** Shows texture coordinate mapping (red=U, green=V)
- **Wave Height:** Grayscale visualization of ocean height field
- **Normals:** Surface normals as RGB (useful for lighting debug)
- **Wake Map:** Vessel wake contribution visualization (blue=low, yellow=high)
- **LOD:** Pixel-density LOD visualization (green=high detail, red=low detail)

---

## Technical Architecture

### Renderer Subsystems

| System | Responsibility | Key Features |
|--------|---------------|--------------|
| **OceanRenderer** | Main coordinator | Multi-pass pipeline, shared buffer, upscaling |
| **WakeRenderer** | Vessel wake simulation | Kelvin angle, dispersion relation, decay functions |
| **GlassRenderer** | Glass distortion | Fresnel/Snell, chromatic aberration, liquid flow |
| **TextRenderer** | Adaptive text overlay | Scene capture, adaptive coloring, blur map generation |
| **VesselSystem** | Vessel physics | Path following, Froude number, wake generation |
| **PipelineManager** | Pipeline optimization | Pre-warmed variants, crossfade transitions |

### Shader Programs

All shaders use **GLSL ES 3.0** (WebGL2):

1. **ocean.{vert,frag}** - Procedural sine wave ocean with LOD
2. **wake.{vert,frag}** - Vessel wake physics (Kelvin angle, dispersion)
3. **glass.{vert,frag}** - Fresnel reflectance + Snell's law refraction
4. **text.{vert,frag}** - Adaptive text rendering with scene sampling
5. **blurmap.{vert,frag}** - Distance field generation (multi-ring sampling)
6. **upscale.{vert,frag}** - FSR/Bicubic/Lanczos upscaling

### Performance Systems

- **FrameBudgetManager:** Enforces 16.67ms frame budget with work priorities
- **PerformanceMonitor:** Tracks FPS, frame drops, GPU timing
- **Quality Presets:** Ultra/High/Medium/Low/Potato (resolution scales + feature flags)
- **Adaptive LOD:** Screen-space derivatives determine wave detail level

---

## Mathematical References

### Academic Papers

1. **Tessendorf, Jerry.** "Simulating Ocean Water." *SIGGRAPH 2001 Course Notes*. ([PDF](https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf))
   - Classic FFT-based ocean simulation (referenced for comparison)

2. **Kelvin, Lord.** "On Ship Waves." *Proceedings of the Institution of Mechanical Engineers*, 1887.
   - Original Kelvin wake theory (19.47° half-angle)

3. **Schlick, Christophe.** "An Inexpensive BRDF Model for Physically-Based Rendering." *Computer Graphics Forum*, 1994.
   - Fresnel approximation used in glass.frag

### Mathematical Techniques

- **Bhaskara I's Sine Approximation** (7th century): Fast polynomial sine
- **Hermite Cubic Splines**: Smooth interpolation with tangent control
- **Mexican Hat Wavelets** (Ricker wavelets): Amplitude modulation
- **Cubic B-Splines**: Local control curves
- **Shear Transformations**: Progressive wake spreading
- **Dispersion Relations**: Deep water wave physics

---

## License

MIT License - See LICENSE file for details.

---

## Credits

**Author:** Griffin Ryan
**Website:** [griffinryan.com](https://griffinryan.com/)

**Inspirations:**
- Jerry Tessendorf's ocean simulation research
- Lord Kelvin's wake theory
- Modern real-time rendering techniques (FSR, TAA, adaptive LOD)

---

*Built with precision, rendered in real-time.*

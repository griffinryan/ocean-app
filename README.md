# Ocean Simulation with Enhanced Saltwater Rendering

A WebGL-based ocean simulation featuring physically-accurate saltwater coloring and advanced wave crest foam detection.

## Enhanced Ocean Color Theory Implementation

This project implements scientifically-based ocean rendering based on extensive research into saltwater optics and wave physics.

### Key Features

#### 1. **Physically-Based Saltwater Colors**
- **Deep Ocean**: `RGB(0.004, 0.016, 0.047)` - Very dark blue representing deep water where only minimal blue light penetrates
- **Mid-Depth Ocean**: `RGB(0.011, 0.058, 0.118)` - Rich ocean blue for typical viewing depths
- **Shallow Ocean**: `RGB(0.039, 0.176, 0.282)` - Blue-green transition in shallow areas
- **Surface Scatter**: `RGB(0.085, 0.239, 0.392)` - Lighter blue from surface scattering

#### 2. **Advanced Wave Breaking & Foam Detection**
Based on oceanographic research, foam is only rendered for truly breaking waves:

- **Jacobian Analysis**: Detects wave folding using the wave displacement Jacobian determinant
- **Steepness Detection**: Identifies breaking crests using gradient analysis and curvature
- **Velocity Thresholds**: Whitecaps only appear when wind speeds exceed 5 m/s (realistic threshold)
- **Multi-Stage Foam Evolution**:
  - **Nascent**: `RGB(0.98, 0.98, 1.0)` - Pure white for active breaking crests only
  - **Mature**: `RGB(0.89, 0.94, 0.97)` - Slightly grayed foam
  - **Decay**: `RGB(0.76, 0.86, 0.91)` - Fading foam residue

#### 3. **Optical Physics Implementation**
- **Beer-Lambert Law**: Wavelength-dependent light absorption (red absorbed first, blue penetrates deepest)
- **Rayleigh Scattering**: Molecular scattering that gives water its characteristic blue color
- **Fresnel Reflections**: Viewing-angle dependent surface reflectance (IOR ≈ 1.33)
- **Subsurface Scattering**: Approximated light scattering within the water volume

### Wave Mathematics
- Primary Wave: y₁ = A·sin(kx - ωt + φ)
- Inverse Wave: y₂ = -A·sin(kx - ωt + φ + π)
- Composite: y_total = y₁ + y₂ + interference_term
- Gerstner Waves: Enhanced with choppiness and steepness parameters

### Shader Architecture

#### Primary Shaders
- `ocean_enhanced.frag` - Full physics-based ocean rendering with all advanced features
- `ocean.frag` - Simplified version with improved color palette and foam detection
- `surface_ripples.frag` - Enhanced ripple rendering with realistic colors
- `wave_spectrum.frag` - FFT-based wave generation (Phillips & JONSWAP spectra)

#### Rendering Pipeline
1. **FFT Wave Generation** - Tessendorf method for realistic wave displacement
2. **Navier-Stokes Fluid Simulation** - For current and foam texture generation
3. **Multi-Layer Compositing** - Combines height fields, normals, velocity, and foam

### Scientific Basis

The color model is based on:
- **Ocean Optics Research**: Absorption and scattering coefficients for seawater
- **Wave Breaking Physics**: Stokes limiting steepness (≈0.44) and Jacobian folding detection
- **Whitecap Formation Studies**: Wind speed thresholds and foam evolution stages
- **Marine Optics Literature**: Wavelength-dependent attenuation in natural seawater

### Installation & Running

```bash
npm install
npm run dev
```

Navigate to `http://localhost:5173` to view the enhanced ocean simulation.

### Controls & Debug Modes
- Debug Mode 1: UV coordinates visualization
- Debug Mode 2: Wave height field grayscale
- Debug Mode 3: Surface normals as color
- Real-time parameter adjustment for wind speed, direction, and foam coverage

## Technical Notes

The implementation prioritizes physical accuracy while maintaining real-time performance. Only the most energetic, steepest wave crests display pure white foam, creating a more realistic ocean appearance that matches actual saltwater behavior under various wind conditions. The deep blue coloration accurately reflects the absorption and scattering properties of natural seawater.

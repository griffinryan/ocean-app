# Liquid Glass Distortion Implementation Plan

## Overview
This document outlines the implementation strategy for creating an elegant liquid glass warping effect underneath CSS panels in the ocean simulation. The approach emphasizes heavy distortion at panel boundaries while maintaining mathematical soundness and performance standards.

## Core Concept: Boundary Layer Physics
The key to achieving authentic liquid glass is simulating **meniscus effects** and **viscous boundary layers** where the liquid glass "clings" to panel edges, creating maximum optical distortion at these transition zones.

## Architecture

### Hybrid CSS-WebGL Bridge Approach
- **CSS Layer**: Handles panel positioning, interactions, and animations
- **WebGL Distortion Layer**: Reads CSS panel positions and applies dynamic warping
- **Shader Integration**: Ocean shader receives panel boundaries as uniforms for real-time distortion

## Implementation Strategy

### 1. Distance Field-Based Distortion Gradient

```glsl
// Signed distance function to panel boundary
float panelSDF = computeSignedDistance(fragCoord, panelBounds);
float boundaryZone = 1.0 - smoothstep(0.0, 0.15, abs(panelSDF)); // 15% panel width

// Exponential falloff for intense edge distortion
float distortionIntensity = pow(boundaryZone, 2.2) * maxDistortion;
```

### 2. Multi-Layer Distortion Approach

#### Layer 1: Meniscus Warping (0-5% from edge)
- Maximum refraction using Fresnel equations
- Non-linear IOR gradient: 1.52 → 1.33 (glass to water transition)
- Surface tension curvature implementation
- Contact angle physics for realistic edge behavior

#### Layer 2: Viscous Transition (5-15% from edge)
- Turbulent mixing zone with vortex shedding simulation
- Time-dependent flow patterns using curl noise
- Chromatic dispersion that increases toward edge
- Navier-Stokes approximation for fluid dynamics

#### Layer 3: Bulk Liquid (15%+ from edge)
- Gentle undulation matching ocean wave rhythm
- Subtle caustic light patterns
- Minimal performance impact through reduced sampling
- Smooth transition to undistorted ocean

### 3. Mathematical Foundation

#### Meniscus Profile Function
Based on the Young-Laplace equation for curved interfaces:

```glsl
float meniscusCurvature(float d) {
    float contactAngle = 0.785; // ~45 degrees for glass-water interface
    float surfaceTension = 0.072; // N/m for water-glass
    float densityDiff = 1000.0; // kg/m³ water density

    // Young-Laplace pressure difference
    float pressure = surfaceTension * cos(contactAngle);

    // Exponential decay from edge
    return pressure * exp(-d * 10.0);
}
```

#### Viscous Boundary Layer
Using simplified Prandtl boundary layer theory:

```glsl
float viscousProfile(float d, float time) {
    float reynolds = 1000.0; // Moderate viscosity regime
    float boundaryThickness = 5.0 / sqrt(reynolds);

    // Blasius solution approximation
    float profile = 1.0 - exp(-d / boundaryThickness);

    // Add time-dependent perturbations for living liquid effect
    float perturbation = 0.1 * sin(time * 2.0 + d * 20.0);
    perturbation += 0.05 * sin(time * 3.7 - d * 35.0);

    return profile * (1.0 + perturbation);
}
```

#### Flow Field Simulation
Implement organic liquid motion using vector fields:

```glsl
vec2 liquidFlowField(vec2 pos, float time) {
    // Base circular flow around panel
    vec2 center = panelCenter;
    vec2 toCenter = pos - center;
    float angle = atan(toCenter.y, toCenter.x);

    // Curl noise for turbulence
    float curl = curlNoise(pos * 3.0 + time * 0.5);

    // Combine rotational and turbulent flow
    vec2 flow = vec2(
        -sin(angle + curl * 0.5),
        cos(angle + curl * 0.5)
    );

    // Modulate by distance from panel
    float falloff = exp(-length(toCenter) * 0.3);
    return flow * falloff;
}
```

### 4. Performance Optimization Strategies

#### Hierarchical Distortion Sampling
```glsl
// Adaptive sampling based on distance to boundary
int sampleCount = mix(16, 4, smoothstep(0.0, 0.2, distanceToEdge));
for(int i = 0; i < sampleCount; i++) {
    // Perform distortion calculations
}
```

#### Texture-Based Acceleration
- **1D Lookup Texture**: Pre-baked meniscus profiles at different distances
- **2D Flow Texture**: Time-evolved flow patterns (256x256, tileable)
- **Texture Arrays**: Multiple panel configurations cached
- **Distortion Atlas**: Combined texture for all distortion components

#### Early-Exit Optimization
```glsl
// Quick rejection test
if (distanceToNearestPanel > maxInfluenceRadius) {
    return standardOceanShading();
}

// Progressive quality reduction
float lodFactor = clamp(distanceToNearestPanel / maxInfluenceRadius, 0.0, 1.0);
int qualityLevel = int(mix(3.0, 0.0, lodFactor)); // 3 = highest, 0 = lowest
```

#### Boundary Computation Optimization
```glsl
// Precompute in vertex shader
out vec4 boundaryWeights;
out vec2 nearestEdgeVector;

void main() {
    boundaryWeights = computeBoundaryWeights(panelCorners);
    nearestEdgeVector = computeNearestEdge(vertexPosition, panelBounds);
    // ... rest of vertex shader
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create `PanelTracker` class for CSS → WebGL coordinate conversion
2. Implement basic distance field calculation for panel boundaries
3. Add panel uniform system to ocean shader
4. Test basic distance-based color visualization

### Phase 2: Core Distortion (Week 2)
1. Implement meniscus warping function with exponential falloff
2. Add viscous boundary layer simulation
3. Create flow field functions with curl noise
4. Integrate temporal evolution for liquid movement

### Phase 3: Visual Enhancement (Week 3)
1. Add chromatic aberration near boundaries
2. Implement enhanced caustic patterns under panels
3. Create IOR variation for realistic refraction
4. Add surface tension effects at edges

### Phase 4: Optimization (Week 4)
1. Implement texture-based lookup acceleration
2. Add LOD system for distant panels
3. Create early-exit optimization paths
4. Profile and optimize shader performance

### Phase 5: Polish & Integration (Week 5)
1. Fine-tune distortion parameters
2. Add panel state transitions (fade in/out effects)
3. Implement panel proximity ripples
4. Create debug visualization modes

## Visual Hierarchy

### Distortion Intensity Distribution
- **90-100% distortion**: Panel edge (0-5% from boundary)
- **30-90% distortion**: Transition zone (5-15% from boundary)
- **10-30% distortion**: Panel interior (15-50% from boundary)
- **0-10% distortion**: Panel center and beyond

### Effect Layering
1. **Primary**: Meniscus curvature and refraction
2. **Secondary**: Viscous flow patterns and turbulence
3. **Tertiary**: Chromatic aberration and caustics
4. **Quaternary**: Subtle temporal animations

## Technical Requirements

### Shader Uniforms
```glsl
// Panel data (up to 8 panels supported)
uniform int u_panelCount;
uniform vec4 u_panelBounds[8]; // xy: min, zw: max
uniform vec2 u_panelCenters[8];
uniform float u_panelDistortionStrength[8];
uniform float u_panelStates[8]; // 0=hidden, 1=visible, 0-1=transition

// Liquid glass parameters
uniform float u_liquidViscosity;
uniform float u_surfaceTension;
uniform float u_refractionIndex;
uniform float u_chromaticStrength;
uniform float u_flowSpeed;
```

### Performance Targets
- **60 FPS** minimum on mid-range hardware (GTX 1060/RX 580)
- **<2ms** additional GPU time for liquid glass effect
- **<100MB** additional memory usage for textures/buffers
- Support for up to **8 simultaneous panels**

## Debugging & Visualization

### Debug Modes
1. **Distance Field**: Visualize signed distance to panels
2. **Distortion Intensity**: Heat map of distortion strength
3. **Flow Vectors**: Display flow field as arrows
4. **Performance**: Show LOD levels and optimization zones
5. **Boundary Layers**: Visualize three-layer system

### Performance Monitoring
```javascript
class LiquidGlassProfiler {
    measureDistortionTime() {
        // GPU timer queries for shader execution
    }

    trackPanelUpdates() {
        // Monitor CSS → WebGL update frequency
    }

    analyzeOverdraw() {
        // Measure fragment shader invocations
    }
}
```

## Future Enhancements

### Advanced Features (Post-Launch)
1. **Surface Waves**: Ripples that propagate from panel interactions
2. **Bubble Simulation**: Air bubbles trapped in liquid glass
3. **Temperature Gradients**: Heat-based distortion variations
4. **Multi-Layer Glass**: Stacked panels with compound refraction
5. **Particle Integration**: Foam/debris interaction with liquid boundary

### Research Directions
- Real-time ray marching for volumetric liquid glass
- Machine learning-based flow prediction
- WebGPU compute shaders for advanced fluid simulation
- Temporal upsampling for higher quality at lower cost

## References

### Academic Papers
- "Efficient Rendering of Liquid Surfaces" - Müller et al., 2007
- "Real-Time Fluid Dynamics for Games" - Jos Stam, GDC 2003
- "Practical Real-Time Strategies for Accurate Indirect Occlusion" - Ritschel et al., 2009

### Technical Resources
- WebGL2 Specification: https://www.khronos.org/webgl/
- GLSL ES 3.0 Reference: https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language
- GPU Gems 2, Chapter 19: "Generic Refraction Simulation"

### Inspiration
- Apple WWDC 2024 Liquid Glass Design System
- Half-Life: Alyx liquid shader techniques
- Pixar's "Finding Nemo" water rendering

## Conclusion

This liquid glass implementation combines physically-based simulation with artistic control to create a visually stunning effect that enhances the ocean simulation without compromising performance. The multi-layered approach ensures maximum visual impact at panel boundaries while maintaining smooth framerates through strategic optimization.

The key to success lies in the careful balance between mathematical accuracy and real-time performance, using simplified physics models that capture the essence of liquid glass behavior without the computational overhead of full fluid simulation.
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Griffin Ryan's Portfolio Website** - An interactive personal portfolio built on a real-time WebGL2 ocean simulation featuring three novel rendering systems:

1. **Procedural Ocean with Vessel Wake Simulation** - Mathematically accurate Kelvin wave physics with progressive shear for curling wakes, spline-controlled decay, and vessel state management
2. **Apple Liquid Glass System** - Reverse-engineered WebGL2 glass panels with refraction physics, liquid flow distortion, and capture-based rendering
3. **Adaptive Text Rendering with Glow** - Novel WebGL2 text system combining Canvas2D rasterization, CSS-informed positioning, per-pixel adaptive coloring based on background luminance, and wave-reactive glow with distance fields

**Tech Stack**: TypeScript, WebGL2, GLSL ES 3.00, Vite, vanilla CSS

## Development Commands

- `npm run dev` - Start development server on port 3000 with hot reloading
- `npm run build` - Build production version (TypeScript → Vite bundle)
- `npm run preview` - Preview built application

## Architecture Overview

### Application Structure

```
src/
├── main.ts                    # Entry point, orchestrates all systems
├── components/                # UI component system
│   ├── Router.ts             # Hash-based SPA routing
│   ├── Panel.ts              # Panel state management with transition tracking
│   └── Navigation.ts         # Navbar controls and keyboard shortcuts
├── renderer/                  # WebGL rendering systems
│   ├── OceanRenderer.ts      # Main rendering pipeline orchestrator
│   ├── GlassRenderer.ts      # Apple Liquid Glass distortion overlay
│   ├── TextRenderer.ts       # Adaptive text rendering with glow
│   ├── VesselSystem.ts       # Kelvin wake simulation
│   ├── ShaderManager.ts      # Shader compilation and uniform management
│   └── Geometry.ts           # Full-screen quad geometry and buffer management
├── shaders/                   # GLSL ES 3.00 shaders
│   ├── ocean.vert/frag       # Procedural ocean with vessel wakes
│   ├── glass.vert/frag       # Liquid glass distortion with refraction physics
│   └── text.vert/frag        # Adaptive text coloring with glow
├── styles/                    # CSS (liquid-glass.css)
└── utils/                     # Math utilities (Vec3, Mat4, spline functions)
```

### Data Flow

```
User Input → Router → PanelManager → Render Loop
                ↓
        UI Component Updates
                ↓
    OceanRenderer (orchestrator)
                ↓
    ┌───────────┴────────────┐
    ↓                        ↓
VesselSystem          Conditional Pipeline
    ↓                        ↓
Wake Data      Ocean → Glass → Text
                             ↓
                        Final Frame
```

## Rendering Pipeline: 3-Stage Architecture

**OceanRenderer** orchestrates a multi-pass framebuffer-based rendering pipeline with conditional execution based on enabled features.

### Full Pipeline (Text + Glass Enabled)

```
1. Ocean Pass → GlassRenderer.oceanFramebuffer
   - Render procedural ocean with vessel wakes
   - Output: Ocean texture for glass distortion

2. Glass Pass → TextRenderer.sceneFramebuffer
   - Render ocean (no glass capture)
   - Render glass panels as overlay using captured ocean texture
   - Output: Combined ocean+glass scene for text background analysis

3. Text Pass → Screen
   - Render ocean (no captures)
   - Render glass panels as overlay
   - Render text with per-pixel adaptive coloring and glow
   - Output: Final frame
```

**Key Insight**: Each renderer owns its framebuffer. Captures happen via callback functions that render to framebuffer, avoiding shared state dependencies.

### Conditional Pipelines

**Glass Only**:
```
1. Ocean Pass → GlassRenderer.oceanFramebuffer
2. Final Pass → Screen
   - Render ocean
   - Render glass overlay
```

**Text Only**:
```
1. Ocean Pass → TextRenderer.sceneFramebuffer
2. Final Pass → Screen
   - Render ocean
   - Render text overlay
```

**Ocean Only**:
```
1. Final Pass → Screen
   - Render ocean directly
```

## Rendering Systems Deep-Dive

### OceanRenderer: Pipeline Orchestrator

**File**: `src/renderer/OceanRenderer.ts`

**Responsibilities**:
- Manage rendering pipeline and conditional execution
- Coordinate sub-renderers (Glass, Text, Vessel)
- Handle canvas resizing and framebuffer updates
- Optimize uniform updates with caching

**Critical Functions**:

#### `renderOceanScene(elapsedTime: number)`

Main rendering entry point. Executes conditional pipeline based on enabled features:

```typescript
if (textEnabled && textRenderer) {
  if (glassEnabled && glassRenderer) {
    // Full pipeline: Ocean → Glass → Text
    glassRenderer.captureOceanScene(() => {
      gl.clear(...);
      this.drawOcean(elapsedTime);
    });

    textRenderer.captureScene(() => {
      gl.clear(...);
      this.drawOcean(elapsedTime);
      glassRenderer.render();
    });

    gl.clear(...);
    this.drawOcean(elapsedTime);
    glassRenderer.render();
    textRenderer.render(vesselData, wakesEnabled);
  } else {
    // Ocean + Text pipeline
    // ...
  }
}
```

**Performance Optimization**:
- **Uniform Caching**: `uniformCache` object tracks last set values, skips redundant WebGL calls
- **Pre-cached DOM Elements**: `cachedElements` stores FPS counter reference
- **Throttled Captures**: TextRenderer throttles scene captures to 60fps max

#### `drawOcean(elapsedTime: number)`

Renders the ocean surface with vessel wakes. Called multiple times per frame for different render targets.

**Uniform Updates**:
- Time: Always updated (changes every frame)
- Aspect ratio: Only on change
- Resolution: Only on change
- Debug mode: Only on change
- Vessel data: Always updated when vessels active

### GlassRenderer: Apple Liquid Glass System

**File**: `src/renderer/GlassRenderer.ts`

**Technique**: Capture-based distortion overlay

**Architecture**:
1. Capture ocean scene to `oceanFramebuffer`
2. Render full-screen quad with glass shader
3. Glass shader samples ocean texture with distorted UV coordinates
4. Apply refraction physics, liquid flow, chromatic aberration

**Framebuffer Strategy**:
- **Ownership**: GlassRenderer owns `oceanFramebuffer` and `oceanTexture`
- **Capture Method**: `captureOceanScene(callback)` binds framebuffer, executes callback, restores screen framebuffer
- **Resize**: `resizeFramebuffer()` called by OceanRenderer when canvas dimensions change

**Panel Management**:
- **Configuration**: Map of panel IDs → `GlassPanelConfig` (position, size, distortion strength, refraction index)
- **Default Panels**: Landing, app, portfolio, resume panels + navbar
- **Position Updates**: `updatePanelPositions()` called every frame, uses `getBoundingClientRect()` to get HTML positions

**Coordinate Mapping** (HTML → WebGL):

```typescript
// HTML screen coordinates (pixels from viewport top-left)
const elementRect = element.getBoundingClientRect();
const canvasRect = canvas.getBoundingClientRect();

// Normalize to [0,1]
const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

// Convert to WebGL NDC [-1,1] with Y-flip
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;  // Y-axis flip

// Size in NDC
const width = (elementRect.width / canvasRect.width) * 2.0;
const height = (elementRect.height / canvasRect.height) * 2.0;
```

**Glass Shader Techniques** (`src/shaders/glass.frag`):
- **Refraction Physics**: Snell's law with IOR 1.52, proper incident/refraction vector calculation
- **Liquid Distortion**: Multi-layer flowing noise with directional flow, ripple patterns, cellular structures
- **Chromatic Aberration**: Uniform across panel, animated with sine wave
- **Edge Effects**: Fresnel-based rim lighting, pulsing edge glow, depth-based tinting
- **Boundary Enforcement**: Strict UV clamping [0,1], soft fade at edges

**Rendering**:
```typescript
render() {
  // Update panel positions from HTML
  this.updatePanelPositions();

  // Render each visible panel
  this.panels.forEach((config, id) => {
    const element = document.getElementById(elementId);
    if (element && !element.classList.contains('hidden')) {
      this.renderPanel(config, program);
    }
  });
}
```

### TextRenderer: Adaptive Text with Glow

**File**: `src/renderer/TextRenderer.ts`

**Novel Technique**: Combines Canvas2D text rasterization, CSS-informed positioning, and WebGL shader-based per-pixel adaptive coloring with wave-reactive glow.

**Architecture**:
1. **Rasterization**: Draw text to Canvas2D using CSS computed styles
2. **Positioning**: Use `getBoundingClientRect()` to get exact screen positions
3. **WebGL Upload**: Upload Canvas2D to WebGL texture with Y-flip
4. **Scene Capture**: Capture ocean+glass scene to framebuffer
5. **Adaptive Coloring**: Sample background luminance per-pixel, output black or white
6. **Glow**: Distance field from text with Gaussian falloff, wave-reactive distortion

**Framebuffer Strategy**:
- **Ownership**: TextRenderer owns `sceneFramebuffer` and `sceneTexture`
- **Capture Method**: `captureScene(callback)` binds framebuffer, executes callback, restores screen
- **Throttling**: Max 60fps captures via `captureThrottleMs` and `sceneTextureDirty` flag

**Text Element Management**:
- **Configuration**: Map of text element IDs → `TextElementConfig` (selector, panelId)
- **Default Elements**: Titles, subtitles, buttons, nav items
- **Visibility Culling**: Only render text from visible panels (checks `.hidden` class)

**Canvas2D Text Rasterization** (`renderTextToCanvas`):

**Critical Process**:
1. Force layout recalculation: `void element.offsetHeight`
2. Get computed styles: `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `textAlign`
3. Get screen position: `elementRect = element.getBoundingClientRect()`
4. Scale to texture coordinates: `scaleX = textCanvas.width / canvasRect.width`
5. Calculate content box: Account for padding, borders
6. Detect layout mode: Flexbox centering, button centering, standard flow
7. Set Canvas2D context state: `font`, `textBaseline`, `textAlign`, `fillStyle`
8. Render text lines: `ctx.fillText(line, textX, textY)`
9. Restore context state: `ctx.restore()`

**Layout Detection**: System detects three modes: (1) inline-flex buttons → center/middle alignment, (2) flex containers → uses alignItems/justifyContent, (3) flex children → vertical centering with CSS text-align for horizontal, (4) standard flow → pure CSS text-align. Each mode sets appropriate Canvas2D `textAlign` and `textBaseline` values.

**Coordinate Mapping** (HTML → Canvas2D → WebGL):

```typescript
// 1. HTML screen coordinates (pixels)
const screenX = elementRect.left - canvasRect.left;
const screenY = elementRect.top - canvasRect.top;

// 2. Scale to Canvas2D texture coordinates
const scaleX = textCanvas.width / canvasRect.width;  // 1:1 mapping
const scaleY = textCanvas.height / canvasRect.height;
const textureX = screenX * scaleX;
const textureY = screenY * scaleY;

// 3. WebGL upload with Y-flip
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(..., textCanvas);

// 4. WebGL shader samples texture normally (Y-flip handled by upload)
```

**Transition-Aware Updates**: PanelManager blocks TextRenderer during transitions via `setTransitioning(true)`, tracks `transitionend` events (transform property only), waits for all transitions to complete, then waits 2 additional frames before unblocking. This ensures text positions are never captured mid-animation.

**Texture Update Process**: Early return if transitioning. Clear canvas, reset Canvas2D state, query visible panels (via `.hidden` class), render only text from visible panels, upload to WebGL with Y-flip. This visibility culling prevents cross-panel text bleeding.

**Adaptive Coloring Shader** (`src/shaders/text.frag`):

**Per-Pixel Process**:
1. Sample background: `backgroundColor = texture(u_sceneTexture, screenUV)`
2. Calculate luminance: `luminance = dot(color, vec3(0.299, 0.587, 0.200))`
3. Binary threshold: `colorMix = step(0.5, luminance)`
4. Mix colors: `mix(WHITE, BLACK, colorMix)`
5. Apply quantization: `quantizeColor(color, 8)` with Bayer dithering

**Glow System** (Novel wave-reactive distance field glow):

**Distance Field Calculation**:
```glsl
float calculateGlowDistance(vec2 uv, vec2 pixelSize) {
  float minDistance = u_glowRadius;

  // Multi-ring sampling (3 rings: 1px, 3px, 5px radius)
  for (int ring = 0; ring < 3; ring++) {
    float radius = radii[ring];

    // 8-direction sampling per ring
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * (2.0 * PI / 8.0);
      vec2 direction = vec2(cos(angle), sin(angle));
      vec2 sampleUV = uv + direction * pixelSize * radius;

      float sampleAlpha = texture(u_textTexture, sampleUV).a;
      if (sampleAlpha > 0.01) {
        float dist = length(direction * pixelSize * radius * u_resolution.x);
        minDistance = min(minDistance, dist);
      }
    }
  }

  return minDistance;
}
```

**Glow Intensity** (Gaussian falloff):
```glsl
float calculateGlowIntensity(float distance) {
  float sigma = u_glowRadius * 0.5;
  float normalizedDist = distance / sigma;
  return exp(-0.5 * normalizedDist * normalizedDist) * u_glowIntensity;
}
```

**Wave Reactivity**:
```glsl
// Calculate ocean height at text position
float oceanHeight = getOceanHeightForGlow(oceanPos, v_time);

// Add wave distortion to text sampling
float waveDistortion = oceanHeight * u_glowWaveReactivity;
vec2 waveDistortionVec = vec2(
  sin(oceanPos.y * 0.5 + v_time) * waveDistortion,
  cos(oceanPos.x * 0.5 + v_time) * waveDistortion
) * 0.01;

// Apply to UV coordinates
vec2 distortedUV = screenUV + waveDistortionVec;

// Also boost glow intensity with wave height
float waveBoost = abs(oceanHeight) * 0.15;
glowIntensity += waveBoost * glowIntensity;
```

**Heatmap Glow Coloring**:
```glsl
vec3 calculateGlowColor(vec3 backgroundColor, float glowIntensity) {
  float luminance = calculateLuminance(backgroundColor);

  vec3 coldGlow = vec3(0.2, 0.4, 0.8);   // Deep blue for light backgrounds
  vec3 warmGlow = vec3(0.7, 0.9, 1.0);   // Bright cyan for mid backgrounds
  vec3 hotGlow = vec3(1.0, 1.0, 1.0);    // White for dark backgrounds

  if (luminance < 0.3) {
    return mix(hotGlow, warmGlow, luminance / 0.3);
  } else if (luminance < 0.7) {
    return mix(warmGlow, coldGlow, (luminance - 0.3) / 0.4);
  } else {
    return coldGlow;
  }
}
```

**Text Intro Animation**:
```glsl
// Wiggly distortion during intro
float eased = cubicEaseOut(u_textIntroProgress);
float distortionAmount = 1.0 - eased;

float wave1 = sin(screenUV.y * 30.0 + v_time * 8.0) * 0.12;
float wave2 = sin(screenUV.x * 20.0 - v_time * 6.0) * 0.08;
float deepWave = sin(screenUV.y * 8.0 + v_time * 3.0) * 0.20;

vec2 distortion = vec2(wave1 + deepWave, wave2) * distortionAmount;
vec2 distortedUV = screenUV + distortion;
```

**Rendering**:
```typescript
render(vesselData, wakesEnabled) {
  // Skip rendering during transitions
  if (this.isTransitioningFlag) return;

  // Update texture if needed
  this.updateTextTexture();

  // Set uniforms
  // - Scene texture (ocean+glass)
  // - Text texture (Canvas2D)
  // - Panel positions/sizes for boundary checking
  // - Vessel data for wave-reactive glow
  // - Glow parameters (radius, intensity, reactivity)

  // Render full-screen quad
  gl.drawElements(gl.TRIANGLES, ...);
}
```

## Wave Simulation: Kelvin Wake Physics

**File**: `src/renderer/VesselSystem.ts`

**Technique**: Mathematically accurate Kelvin wave generation with progressive shear, spline-controlled decay, and vessel state management.

### Vessel System Architecture

**Vessel Classes**:
- **Fast Light** (Speedboat): weight 0.3, speed 4-5, hull 8m
- **Fast Heavy** (Cargo): weight 1.0, speed 3-4, hull 20m
- **Slow Light** (Sailboat): weight 0.2, speed 1-2, hull 12m
- **Slow Heavy** (Barge): weight 0.8, speed 1-2, hull 15m

**Vessel States**:
- **Active**: On-screen, full wake intensity
- **Ghost**: Off-screen but wake persists (10s), reduced intensity (0.7x)
- **Fading**: Final fade-out (5s), progressive intensity reduction

**Wake Trail System**:
- **Trail Length**: 150 wake points per vessel
- **Max Distance**: 80 units (+ weight × 25)
- **Decay Time**: 35 seconds
- **Update Rate**: Every frame during vessel movement

### Kelvin Wake Mathematics

**Constants**:
- Kelvin angle: 19.47° (0.34 radians)
- Gravity: 9.81 m/s²
- Golden ratio (φ): 1.618 (for wave interference patterns)

**Progressive Shear** (Wake curling):
```typescript
// Shear factor increases logarithmically with distance
const progressiveShear = 1.0 + shearRate * log(1.0 + pathDistance * 0.1);

// Wake angle increases over distance for natural curling
const dynamicAngle = baseAngle * froudeModifier * progressiveShear;
```

**Froude Number** (Speed-based wake angle adjustment):
```typescript
const froudeNumber = vesselSpeed / sqrt(GRAVITY * hullLength);
const baseAngle = KELVIN_ANGLE * (1.0 + weight * 0.8);  // 19.47° to 35°
const froudeModifier = 1.0 + froudeNumber * 0.2;
```

**Spline-Controlled Decay**:
```typescript
const splineControlPoints = [
  { position: 0.0, value: 1.0, tangent: -0.5 },   // Strong start
  { position: 0.3, value: 0.85, tangent: -0.8 },  // Gentle initial decay
  { position: 0.6, value: 0.5, tangent: -1.2 },   // Mid-trail fade
  { position: 0.85, value: 0.2, tangent: -2.0 },  // Rapid final fade
  { position: 1.0, value: 0.0, tangent: -3.0 }    // Complete fade
];

// In shader:
float getSimplifiedTrailDecay(float normalizedDistance, float weight) {
  float decay = exp(-normalizedDistance * 2.5);
  float modulation = 1.0 - normalizedDistance * 0.3;
  float weightFactor = 1.0 + weight * 0.2;
  return max(0.0, decay * modulation * weightFactor);
}
```

**Wake Width** (Progressive spreading with curling):
```typescript
const baseWakeWidth = 2.0 + weight * 3.0;  // 2-5 units
const spreadFactor = 1.0 + log(pathDistance + 1.0) * 0.3;
const curlSpread = 1.0 + progressiveShear * 0.2;
const effectiveWidth = baseWakeWidth * spreadFactor * curlSpread;
```

### Ocean Shader Wake Calculation

**File**: `src/shaders/ocean.frag`

**Wake Generation Process** (`calculateVesselWake`):

```glsl
float calculateVesselWake(vec2 pos, vec3 vesselPos, vec3 vesselVel,
                          float weight, float hullLength, float vesselState) {
  // 1. Calculate position relative to vessel
  vec2 delta = pos - vesselPos.xz;
  vec2 vesselDir = normalize(vesselVel.xz);
  float vesselSpeed = length(vesselVel.xz);

  // 2. Check if behind vessel
  float dotProduct = dot(delta, vesselDir);
  if (dotProduct > 0.0) return 0.0;  // Only generate wake behind

  float pathDistance = abs(dotProduct);

  // 3. Calculate dynamic wake angle with progressive shear
  float froudeNumber = vesselSpeed / sqrt(GRAVITY * hullLength);
  float baseAngle = KELVIN_ANGLE * (1.0 + weight * 0.8);
  float froudeModifier = 1.0 + froudeNumber * 0.2;
  float progressiveShear = 1.0 + 0.15 * log(1.0 + pathDistance * 0.1);
  float dynamicAngle = baseAngle * froudeModifier * progressiveShear;

  // 4. Calculate wake arms
  vec2 leftArm = rotate2D(vesselDir, dynamicAngle);
  vec2 rightArm = rotate2D(vesselDir, -dynamicAngle);

  float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
  float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

  // 5. Calculate decay factors
  float normalizedPathDistance = min(pathDistance / maxTrailDistance, 1.0);
  float simplifiedDecay = getSimplifiedTrailDecay(normalizedPathDistance, weight);

  // 6. Vessel state-based intensity
  float stateIntensity = 1.0;
  if (vesselState > 0.5 && vesselState < 1.5) {  // Ghost
    stateIntensity = 0.7;
  } else if (vesselState > 1.5) {  // Fading
    float fadeFactor = vesselState - 2.0;
    stateIntensity = 0.7 * (1.0 - fadeFactor);
  }

  // 7. Wave synthesis (left and right arms)
  float wakeHeight = 0.0;
  float effectiveWidth = (2.0 + weight * 3.0) * spreadFactor * curlSpread;

  if (leftDist < effectiveWidth) {
    float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, leftDist);

    // Multi-component waves with golden ratio wavelengths
    for (int j = 0; j < 2; j++) {
      float wavelength = (2.5 + vesselSpeed * 0.5) * pow(1.618, float(j) * 0.5);
      float k = waveNumber(wavelength);
      float omega = waveFrequency(k);
      float phase = k * pathDistance - omega * time + float(j) * 2.39;
      float amplitude = baseAmplitude * pow(0.618, float(j));

      wakeHeight += amplitude * armIntensity * simplifiedDecay * sin(phase);
    }
  }

  // Same for right arm...

  return wakeHeight * 1.5;
}
```

**Integration with Procedural Waves**:
```glsl
float getOceanHeight(vec2 pos, float time) {
  float height = 0.0;

  // Procedural sine waves (8 layers with interference)
  height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
  height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
  // ... 6 more layers

  // Add vessel wakes
  float wakeHeight = getAllVesselWakes(pos, time);
  height += wakeHeight;

  return height;
}
```

## Component Systems: UI Integration

**Router** (`Router.ts`): Hash-based SPA routing (`#`, `#app`, `#portfolio`, `#resume`) that calls `PanelManager.transitionTo(state)` and updates document metadata.

**PanelManager** (`Panel.ts`): Manages 6 panel states (landing, app, portfolio, resume, paper, not-found) with transition-aware synchronization. Tracks `transitionend` events (transform property only), waits for all transitions + timeouts to complete, then waits 2 frames before notifying TextRenderer to update. Critical integration point for preventing mid-animation text captures.

**NavigationManager** (`Navigation.ts`): Navbar with keyboard shortcuts (Ctrl+H/P/R, Alt+←/→), active state tracking, and visibility rules (hidden for landing/not-found/paper, visible for app/portfolio/resume). Integrates with PanelManager via wrapped `transitionTo()` method.

## Shader Architecture

### Ocean Shader: Procedural Waves + Vessel Wakes

**File**: `src/shaders/ocean.frag`

**Features**:
- Procedural sine wave synthesis (8 layers)
- Vessel wake integration with Kelvin physics
- Glass-aware rendering (crystalline pattern under glass panels)
- Multi-layer caustics
- Stylistic quantization with Bayer dithering

**Glass Detection**:
```glsl
float isUnderGlass(vec2 screenPos) {
  for (int i = 0; i < u_glassPanelCount; i++) {
    vec2 localPos = (screenPos - u_glassPanelPositions[i]) / u_glassPanelSizes[i];
    if (abs(localPos.x) < 0.6 && abs(localPos.y) < 0.6) {
      return 1.0;
    }
  }
  return 0.0;
}
```

**Dual Rendering Paths**:
```glsl
if (glassIntensity > 0.1) {
  // Crystalline pattern under glass
  baseColor = glassColors[colorIndex];
  baseColor *= stipplePattern;
} else {
  // Standard ocean rendering
  baseColor = mix(DEEP_WATER, SHALLOW_WATER, height);
  baseColor = mix(baseColor, WAVE_CREST, crestAmount);
  baseColor += caustics;
}
```

**Debug Modes**:
- 0: Normal rendering
- 1: UV coordinates
- 2: Wave height (grayscale)
- 3: Normals (RGB)
- 4: Wake intensity map

### Glass Shader: Liquid Distortion with Refraction Physics

**File**: `src/shaders/glass.frag`

**Techniques**:
- **Refraction**: Snell's law with IOR 1.52
- **Liquid Flow**: Multi-scale flowing noise with directional flow
- **Ripples**: Sine-based ripple patterns with exponential decay
- **Chromatic Aberration**: RGB channel offset with animated flow
- **Edge Effects**: Fresnel rim lighting, pulsing edge glow

**Refraction Calculation**:
```glsl
vec3 calculateRefraction(vec3 incident, vec3 normal, float eta) {
  float cosI = -dot(normal, incident);
  float sinT2 = eta * eta * (1.0 - cosI * cosI);

  if (sinT2 > 1.0) return vec3(0.0);  // Total internal reflection

  float cosT = sqrt(1.0 - sinT2);
  return eta * incident + (eta * cosI - cosT) * normal;
}
```

**Liquid Distortion**: Multi-scale noise (15.0, 22.5, 37.5 frequencies) with time-varying flow directions creates liquid normal. Radial ripples with exponential decay add surface detail. Final distortion combines: refraction offset (physics-based), liquid flow (sin/cos patterns), ripples (radial sine), and noise. Total amplitude ~2.5× distortionStrength.

### Text Shader: Adaptive Coloring with Wave-Reactive Glow

**File**: `src/shaders/text.frag`

**Dual Rendering Paths**:
1. **Text Path**: `textAlpha > 0.01`
   - Sample background scene
   - Calculate luminance
   - Binary threshold → black or white
   - Apply quantization with Bayer dithering

2. **Glow Path**: `textAlpha <= 0.01 && glowDistance < u_glowRadius`
   - Calculate distance to nearest text
   - Gaussian falloff
   - Wave-reactive intensity boost
   - Heatmap color based on background luminance

**Per-Pixel Adaptive Coloring**:
```glsl
vec3 calculateAdaptiveTextColor(vec3 backgroundColor) {
  float luminance = dot(backgroundColor, vec3(0.299, 0.587, 0.200));
  float colorMix = step(0.5, luminance);
  return mix(WHITE, BLACK, colorMix);
}
```

**Distance Field Glow**:
```glsl
// Multi-ring 8-direction sampling
float minDistance = u_glowRadius;

for (int ring = 0; ring < 3; ring++) {  // 3 rings
  for (int i = 0; i < 8; i++) {  // 8 directions
    vec2 sampleUV = uv + direction * pixelSize * radius;
    float sampleAlpha = texture(u_textTexture, sampleUV).a;

    if (sampleAlpha > 0.01) {
      float dist = length(direction * pixelSize * radius * u_resolution.x);
      minDistance = min(minDistance, dist);
    }
  }
}
```

**Wave Reactivity**: Ocean height at text position drives UV distortion (sin/cos patterns scaled by u_glowWaveReactivity × 0.01) and boosts glow intensity (abs(height) × 0.15). Creates dynamic text response to underlying waves.

**Intro Animation**: Three-layer sine waves (frequencies 30, 20, 8) with cubic ease-out create wiggly distortion that fades as u_textIntroProgress → 1.0.

## Coordinate Systems: Mapping Transformations

### HTML → WebGL (GlassRenderer, TextRenderer Panel Boundaries)

**Source**: HTML `getBoundingClientRect()` in screen pixels
**Target**: WebGL NDC (Normalized Device Coordinates) [-1, 1]

```typescript
// 1. Get HTML positions
const elementRect = element.getBoundingClientRect();
const canvasRect = canvas.getBoundingClientRect();

// 2. Normalize to [0,1]
const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

// 3. Convert to NDC [-1,1] with Y-flip
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;  // Y-axis flip

// 4. Size in NDC
const width = (elementRect.width / canvasRect.width) * 2.0;
const height = (elementRect.height / canvasRect.height) * 2.0;
```

**Coordinate Systems**:
- **HTML**: Origin top-left, Y down, units in pixels
- **WebGL NDC**: Origin center, Y up, range [-1, 1]

### HTML → Canvas2D → WebGL (TextRenderer)

**3-Stage Transformation**:

**Stage 1: HTML Screen Coordinates**
```typescript
// Pixel coordinates from viewport top-left
const screenX = elementRect.left - canvasRect.left;
const screenY = elementRect.top - canvasRect.top;
```

**Stage 2: Canvas2D Texture Coordinates**
```typescript
// Scale to Canvas2D dimensions (1:1 mapping with WebGL canvas)
const scaleX = textCanvas.width / canvasRect.width;
const scaleY = textCanvas.height / canvasRect.height;

const textureX = screenX * scaleX;
const textureY = screenY * scaleY;

// Draw text at texture coordinates
ctx.fillText(text, textureX, textureY);
```

**Stage 3: WebGL Texture Upload with Y-Flip**
```typescript
// Upload Canvas2D to WebGL with Y-axis flip
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);

// WebGL shader samples texture normally (Y-flip handled by upload)
float textAlpha = texture(u_textTexture, screenUV).a;
```

**Why Y-Flip?**
- Canvas2D: Origin top-left, Y down
- WebGL: Origin bottom-left, Y up
- `UNPACK_FLIP_Y_WEBGL` converts Canvas2D → WebGL coordinate system during upload

### Screen Space → Ocean Space (Wave Calculations)

**WebGL Screen Space to Ocean Coordinates**:
```glsl
// v_screenPos is in NDC [-1, 1]
vec2 oceanPos = v_screenPos * 15.0;  // Scale for wave visibility
oceanPos.x *= u_aspectRatio;  // Maintain aspect ratio

// Now oceanPos is in ocean simulation space (units)
float oceanHeight = getOceanHeight(oceanPos, v_time);
```

**Conversion**:
- **Screen Space**: NDC [-1, 1], matches viewport
- **Ocean Space**: Arbitrary units (typically [-30, 30]), independent of viewport size

## Critical Implementation Details

### Framebuffer Ownership Strategy

**Problem**: Multiple renderers need to capture scenes without circular dependencies.

**Solution**: Each renderer owns its framebuffer and provides capture methods.

**Ownership**:
- `GlassRenderer` owns `oceanFramebuffer` and `oceanTexture`
- `TextRenderer` owns `sceneFramebuffer` and `sceneTexture`

**Capture Pattern**:
```typescript
// In GlassRenderer:
captureOceanScene(renderCallback: () => void) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);
  renderCallback();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// In OceanRenderer:
glassRenderer.captureOceanScene(() => {
  gl.clear(...);
  this.drawOcean(elapsedTime);
});
```

**Benefits**:
- No shared state
- Clear ownership
- No circular dependencies
- Easy to reason about render order

### Visibility Culling

**Text Rendering**:
```typescript
// Get visible panels
const visiblePanels = new Set<string>();
panelIds.forEach(panelId => {
  const panel = document.getElementById(panelId);
  if (panel && !panel.classList.contains('hidden')) {
    visiblePanels.add(panelId);
  }
});

// Only render text from visible panels
this.textElements.forEach((config) => {
  if (visiblePanels.has(config.panelId)) {
    this.renderTextToCanvas(element, config);
  }
});
```

**Glass Rendering**:
```typescript
this.panels.forEach((config, id) => {
  const element = document.getElementById(elementId);
  if (element && !element.classList.contains('hidden')) {
    this.renderPanel(config, program);
  }
});
```

**Benefits**:
- Prevents cross-panel text bleeding
- Reduces Canvas2D draw calls
- Improves performance

### Performance Optimizations

**Uniform Caching** (OceanRenderer):
```typescript
private uniformCache = {
  lastAspectRatio: -1,
  lastResolution: new Float32Array(2),
  lastDebugMode: -1,
  lastWakesEnabled: false,
  lastVesselCount: -1
};

// In drawOcean():
if (aspect !== this.uniformCache.lastAspectRatio) {
  this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
  this.uniformCache.lastAspectRatio = aspect;
}
```

**Scene Capture Throttling** (TextRenderer):
```typescript
private captureThrottleMs: number = 16;  // Max 60fps
private sceneTextureDirty: boolean = true;

captureScene(renderCallback) {
  const currentTime = performance.now();

  if (!this.sceneTextureDirty &&
      (currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
    return;  // Skip capture
  }

  // Proceed with capture...
}
```

**DOM Element Caching** (OceanRenderer):
```typescript
private cachedElements = {
  fpsElement: null as HTMLElement | null,
  elementsInitialized: false
};

private initializeCachedElements() {
  if (this.cachedElements.elementsInitialized) return;
  this.cachedElements.fpsElement = document.getElementById('fps');
  this.cachedElements.elementsInitialized = true;
}
```

### Transition Synchronization Timing

**Critical Timing Requirements**:
1. CSS transition must complete
2. Browser must compute final styles
3. Browser must paint final frame
4. Text positions can then be captured

**Implementation**:
```typescript
onAllTransitionsComplete() {
  // CRITICAL: Wait 2 frames for browser to fully render final state
  // Frame 1: Browser computes final styles after transitionend
  // Frame 2: Browser renders final painted state
  // Frame 3: We can safely capture positions
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      textRenderer.setTransitioning(false);
      textRenderer.forceTextureUpdate();
      textRenderer.markSceneDirty();
    });
  });
}
```

**Why 2 Frames?**
- Frame 1: `transitionend` fires, but styles may not be computed yet
- Frame 2: Styles computed, but frame may not be painted yet
- Frame 3: Frame painted, positions stable

### Canvas2D State Management

**Critical Pattern**: Wrap each text render in `ctx.save()`/`ctx.restore()` to prevent state leakage. Before texture update, aggressively clear canvas and reset globalAlpha, globalCompositeOperation, and imageSmoothingEnabled to defaults.

## Application Flow

**Initialization Dependencies**: UI components (PanelManager, Router, Navigation) → OceanRenderer → Shader compilation → Render loop start → UI-Renderer connection (enable Glass/Text, bind PanelManager) → Initial animation wait → Controls setup. Critical: TextRenderer blocks updates during landing animation until `animationend` event.

**Render Loop**: Each frame: VesselSystem.update() → renderOceanScene() → FPS update. Scene rendering uses conditional pipeline based on enabled features (see 3-Stage Architecture above). Full pipeline executes 3 ocean draws: (1) capture to GlassRenderer.oceanFramebuffer, (2) capture ocean+glass to TextRenderer.sceneFramebuffer, (3) final composite to screen.

**Panel Transition State Machine**: User interaction → Router.navigate() → hashchange → PanelManager.transitionTo() → [Block TextRenderer] → Fade out (300ms) → Toggle .hidden → Fade in (300ms) → Add .active (triggers CSS transform) → transitionend → Wait 2 frames → [Unblock TextRenderer] → Force texture update. Critical: TextRenderer must remain blocked throughout CSS transition to prevent capturing mid-animation positions.

## Extension Patterns

**Glass Panel API**: Register HTML element with `GlassRenderer.addPanel(id, config)` where config specifies distortionStrength (0.3-0.5), refractionIndex (1.52), and initial size. Positions auto-update via `getBoundingClientRect()` each frame.

**Text Element API**: Add to `TextRenderer.setupDefaultTextElements()` with selector, id, and panelId. System automatically handles CSS style inheritance, positioning, adaptive coloring, and glow effects.

**Debug Modes** (Keys D/0-4): 0=Normal, 1=UV coords, 2=Wave height, 3=Normals, 4=Wake intensity. Use for verifying coordinate mappings and wave calculations.

## Keyboard Controls

| Key | Action |
|-----|--------|
| **F** | Toggle fullscreen |
| **Esc** | Exit fullscreen / Return to landing |
| **D** | Cycle debug modes (0-4) |
| **0-4** | Select debug mode directly |
| **V** | Toggle vessel wake system |
| **G** | Toggle glass panel rendering |
| **T** | Toggle adaptive text rendering |
| **Ctrl+H/P/R** | Navigate to Home/Portfolio/Resume |
| **Alt+←/→** | Navigate previous/next panel |

## Technical Summary

This project demonstrates three novel rendering techniques integrated into a cohesive WebGL2 application:

1. **Mathematically Accurate Wave Simulation**: Kelvin wake physics with progressive shear, spline-controlled decay, and vessel state management creates realistic curling wakes that persist after vessels leave the screen.

2. **Apple-Inspired Liquid Glass**: Capture-based rendering with refraction physics, multi-layer liquid distortion, and chromatic aberration creates convincing glass panels that distort the ocean underneath while maintaining sharp boundaries.

3. **Adaptive Text with Wave-Reactive Glow**: Novel combination of Canvas2D rasterization, CSS-informed positioning, per-pixel WebGL adaptive coloring, and distance field glow creates text that adapts to background luminance and reacts to ocean waves.

All three systems integrate seamlessly with a transition-aware UI system, coordinate mapping between HTML/Canvas2D/WebGL spaces, and performance optimizations including uniform caching, scene capture throttling, and visibility culling.

The architecture is designed for extensibility: adding new panels, text elements, or debug modes follows clear patterns documented above.
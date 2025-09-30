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

**Layout Modes**:

```typescript
// Special case: Glass buttons (inline-flex with centering)
if (isButton && display === 'inline-flex') {
  textX = textureX + scaledWidth / 2;
  textY = textureY + scaledHeight / 2;
  alignMode = 'center';
  baselineMode = 'middle';
}

// Case 1: Element is flex container with centering
else if (isFlexContainer) {
  if (alignItems === 'center') {
    textY = textureY + scaledHeight / 2;
    baselineMode = 'middle';
  }
  if (justifyContent === 'center') {
    textX = textureX + scaledWidth / 2;
    alignMode = 'center';
  }
}

// Case 2: Element is child of flex container
else if (parentIsFlexContainer && parentAlignItems === 'center') {
  textY = textureY + scaledHeight / 2;
  baselineMode = 'middle';
  // Horizontal uses element's text-align
}

// Case 3: Standard flow
else {
  // Use CSS text-align
}
```

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

**Transition-Aware Updates** (Critical for correct positioning):

**Problem**: Text positions must not be captured during CSS transitions, as elements are mid-animation.

**Solution**: Block text updates during transitions, wait for completion + 2 frames.

```typescript
// In PanelManager.updatePanelVisibility():
if (textRenderer) {
  textRenderer.setTransitioning(true);  // Block updates
  this.activeTransitions.add(currentPanel);  // Track transition
}

// In transitionend event handler (Panel.ts):
handleTransitionEnd(panel, event) {
  // Only track transform transitions (spatial positioning)
  if (propertyName !== 'transform') return;

  this.activeTransitions.delete(panel);
  this.checkAllStateChangesComplete();
}

// When all transitions complete:
onAllTransitionsComplete() {
  // Wait 2 frames for browser to fully render final state
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      textRenderer.setTransitioning(false);  // Enable updates
      textRenderer.forceTextureUpdate();
      textRenderer.markSceneDirty();
    });
  });
}
```

**Texture Update Process** (`updateTextTexture`):

```typescript
updateTextTexture() {
  // Block updates during transitions
  if (this.isTransitioningFlag) return;

  // Aggressively clear canvas
  ctx.clearRect(0, 0, width, height);

  // Reset Canvas2D state
  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // Get visible panels
  const visiblePanels = new Set<string>();
  panelIds.forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (panel && !panel.classList.contains('hidden')) {
      visiblePanels.add(panelId);
    }
  });

  // Render only text from visible panels
  this.textElements.forEach((config) => {
    if (visiblePanels.has(config.panelId)) {
      this.renderTextToCanvas(element, config);
    }
  });

  // Upload to WebGL with Y-flip
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(..., this.textCanvas);
}
```

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

### Router: Hash-Based SPA Navigation

**File**: `src/components/Router.ts`

**Routes**:
- `#` → Landing panel
- `#app` → Home/App panel
- `#portfolio` → Portfolio panel
- `#resume` → Resume panel

**Integration**:
```typescript
// In Router.navigateToRoute():
this.panelManager.transitionTo(route.state);

// Updates document title and meta description
document.title = route.title;
```

### PanelManager: State Management with Transition Tracking

**File**: `src/components/Panel.ts`

**Panel States**: `landing` | `app` | `portfolio` | `resume` | `paper` | `not-found`

**Critical Feature**: Transition-aware text update synchronization

**Transition Tracking**:
```typescript
private activeTransitions: Set<HTMLElement> = new Set();
private pendingTimeouts: Set<number> = new Set();

setupTransitionListeners() {
  panels.forEach(panel => {
    panel.addEventListener('transitionend', (e) => {
      // Only track transform transitions (spatial positioning)
      if (e.propertyName !== 'transform') return;

      this.activeTransitions.delete(panel);
      this.checkAllStateChangesComplete();
    });
  });
}

checkAllStateChangesComplete() {
  if (this.activeTransitions.size === 0 &&
      this.pendingTimeouts.size === 0) {
    this.onAllTransitionsComplete();
  }
}

onAllTransitionsComplete() {
  // Wait 2 frames for browser to fully render final state
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      textRenderer.setTransitioning(false);
      textRenderer.forceTextureUpdate();
      textRenderer.markSceneDirty();
    });
  });
}
```

**State Transition Flow**:
```
1. User navigates (#app)
2. Router.navigate() called
3. PanelManager.transitionTo('app')
4. Block text updates: textRenderer.setTransitioning(true)
5. Fade out old panel
6. Wait 300ms
7. Update visibility
8. Fade in new panel
9. Add 'active' class (triggers transform transition)
10. transitionend fired
11. Check all transitions complete
12. Wait 2 frames
13. Enable text updates: textRenderer.setTransitioning(false)
14. Force texture update
```

### NavigationManager: Apple-Style Navbar

**File**: `src/components/Navigation.ts`

**Features**:
- Glassmorphism styling with WebGL enhancement
- Keyboard shortcuts (Ctrl+H/P/R, Alt+←/→)
- Active state tracking
- Visibility control based on panel state

**Integration with PanelManager**:
```typescript
// In main.ts:
this.panelManager.transitionTo = (newState) => {
  originalTransitionTo(newState);
  this.navigationManager.updateVisibilityForPanelState(newState);
};
```

**Visibility Rules**:
- Hidden: Landing, not-found, paper
- Visible: App, portfolio, resume

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

**Liquid Glass Normal**:
```glsl
vec3 calculateLiquidGlassNormal(vec2 uv, float time) {
  // Multi-scale liquid distortion
  vec2 flowDir1 = vec2(cos(time * 0.8), sin(time * 1.2));
  vec2 flowDir2 = vec2(cos(time * 1.3), sin(time * 0.9));

  float h = noise(uv * 15.0 + flowDir1 * 2.0) * 0.08;
  h += noise(uv * 22.5 + flowDir2 * 1.5) * 0.05;
  h += noise(uv * 37.5 + time * 0.6) * 0.03;

  // Add ripple patterns
  float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
  h += ripple * exp(-length(uv - 0.5) * 3.0);

  // Calculate gradient for normal
  vec3 normal = normalize(vec3(dhdx, dhdy, 1.0));
  return normal;
}
```

**Distortion Application**:
```glsl
vec2 distortedUV = screenUV;

// Refraction offset
vec2 refractionOffset = refractionDir.xy * u_distortionStrength;

// Liquid flow
vec2 liquidOffset = vec2(
  sin(panelUV.y * 12.0 + v_time * 2.5) * 0.04,
  cos(panelUV.x * 10.0 + v_time * 2.0) * 0.04
);

// Ripples
vec2 rippleOffset = normalize(panelUV - 0.5) *
                    (sin(ripplePhase1) * 0.025 + sin(ripplePhase2) * 0.015);

// Noise
vec2 noiseOffset = vec2(noise(...), noise(...)) * 0.03;

// Combine
distortedUV += (refractionOffset + liquidOffset + rippleOffset + noiseOffset) * 2.5;
```

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

**Wave Reactivity**:
```glsl
// Calculate ocean height at text position
float oceanHeight = getOceanHeightForGlow(oceanPos, v_time);

// Wave distortion for text sampling
vec2 waveDistortionVec = vec2(
  sin(oceanPos.y * 0.5 + v_time) * oceanHeight * u_glowWaveReactivity,
  cos(oceanPos.x * 0.5 + v_time) * oceanHeight * u_glowWaveReactivity
) * 0.01;

// Boost glow intensity with wave height
float waveBoost = abs(oceanHeight) * 0.15;
glowIntensity += waveBoost * glowIntensity;
```

**Intro Animation**:
```glsl
// Wiggly distortion with cubic ease-out
float eased = cubicEaseOut(u_textIntroProgress);
float distortionAmount = 1.0 - eased;

float wave1 = sin(screenUV.y * 30.0 + v_time * 8.0) * 0.12;
float wave2 = sin(screenUV.x * 20.0 - v_time * 6.0) * 0.08;
float deepWave = sin(screenUV.y * 8.0 + v_time * 3.0) * 0.20;

vec2 distortion = vec2(wave1 + deepWave, wave2) * distortionAmount;
```

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

**Problem**: Canvas2D state leaks between text elements if not properly reset.

**Solution**: Aggressive state reset and save/restore.

```typescript
renderTextToCanvas(element, config) {
  // CRITICAL: Reset ALL Canvas2D context state
  ctx.save();

  // Reset text properties explicitly
  ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
  ctx.textBaseline = baselineMode;
  ctx.textAlign = alignMode;
  ctx.fillStyle = 'white';
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';

  // Render text
  ctx.fillText(line, textX, textY);

  // CRITICAL: Restore context state
  ctx.restore();
}
```

**Before Texture Update**:
```typescript
updateTextTexture() {
  // Aggressively clear canvas
  ctx.clearRect(0, 0, width, height);

  // Reset global Canvas2D state
  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.restore();

  // Render all text...
}
```

## Application Flow

### Initialization Sequence (main.ts)

```typescript
class OceanApp {
  async init() {
    // 1. Initialize UI components
    this.initializeUI();
    // - PanelManager
    // - Router (with PanelManager)
    // - NavigationManager (with Router)
    // - Connect navigation to panel state changes

    // 2. Create OceanRenderer
    this.renderer = new OceanRenderer({ canvas, antialias, alpha });

    // 3. Initialize shaders (ocean, glass, text)
    await this.renderer.initializeShaders(
      oceanVertexShader, oceanFragmentShader,
      glassVertexShader, glassFragmentShader,
      textVertexShader, textFragmentShader
    );

    // 4. Start rendering
    this.renderer.start();

    // 5. Connect UI to renderer
    this.connectUIToRenderer();
    // - Enable glass rendering
    // - Enable text rendering
    // - Connect TextRenderer to PanelManager for visibility updates

    // 6. Wait for initial animation
    this.waitForInitialAnimation();
    // - Block text rendering during landing panel fadeInUp animation
    // - Listen for animationend event
    // - Enable text rendering when animation completes

    // 7. Setup controls
    this.setupControls();
  }
}
```

### Render Loop (OceanRenderer.render)

```typescript
private render() {
  const currentTime = performance.now();
  const elapsedTime = (currentTime - this.startTime) / 1000;
  const deltaTime = 1 / 60;

  // 1. Update vessel system
  this.vesselSystem.update(currentTime, deltaTime);

  // 2. Render ocean scene with conditional pipeline
  this.renderOceanScene(elapsedTime);

  // 3. Update FPS counter
  this.updateFPS(currentTime);
}

private renderOceanScene(elapsedTime: number) {
  const vesselData = this.vesselSystem.getVesselDataForShader(5, performance.now());

  if (this.textEnabled && this.textRenderer) {
    if (this.glassEnabled && this.glassRenderer) {
      // Full pipeline: Ocean → Glass → Text

      // 1. Capture ocean for glass distortion
      this.glassRenderer.captureOceanScene(() => {
        gl.clear(...);
        this.drawOcean(elapsedTime);
      });

      // 2. Capture ocean+glass for text background analysis
      this.textRenderer.captureScene(() => {
        gl.clear(...);
        this.drawOcean(elapsedTime);
        this.glassRenderer.render();
      });

      // 3. Final render with all layers
      gl.clear(...);
      this.drawOcean(elapsedTime);
      this.glassRenderer.render();
      this.textRenderer.render(vesselData, this.wakesEnabled);
    } else {
      // Ocean + Text pipeline (no glass)
      // ...
    }
  } else if (this.glassEnabled && this.glassRenderer) {
    // Glass pipeline (no text)
    // ...
  } else {
    // Basic ocean rendering
    gl.clear(...);
    this.drawOcean(elapsedTime);
  }
}
```

### Panel Transition Flow

```
1. User clicks navigation button or changes URL hash
   ↓
2. Router.navigate(path) called
   ↓
3. window.location.hash = path
   ↓
4. hashchange event fired
   ↓
5. Router.handleNavigation()
   ↓
6. Router.navigateToRoute(route)
   ↓
7. PanelManager.transitionTo(newState)
   ↓
8. TextRenderer.setTransitioning(true)  [Block text updates]
   ↓
9. Fade out old panel
   ↓
10. setTimeout(300ms)
   ↓
11. Update panel visibility (.hidden class)
   ↓
12. Fade in new panel
   ↓
13. setTimeout(300ms)
   ↓
14. Add .active class (triggers transform transition)
   ↓
15. CSS transform transition starts
   ↓
16. transitionend event fired
   ↓
17. Check all transitions complete
   ↓
18. requestAnimationFrame() × 2  [Wait 2 frames]
   ↓
19. TextRenderer.setTransitioning(false)  [Enable text updates]
   ↓
20. TextRenderer.forceTextureUpdate()
   ↓
21. TextRenderer.markSceneDirty()
   ↓
22. Next render frame: Text positions updated
```

## Development Patterns

### Adding a New Glass Panel

1. **Create HTML Element**:
```html
<div id="my-panel" class="glass-panel hidden">
  <h2>My Panel</h2>
  <p>Content here</p>
</div>
```

2. **Add to GlassRenderer**:
```typescript
// In GlassRenderer.setupDefaultPanels():
this.addPanel('my-panel', {
  position: [0.0, 0.0],  // Will be updated dynamically
  size: [0.4, 0.5],
  distortionStrength: 0.35,
  refractionIndex: 1.52
});
```

3. **Add to PanelManager**:
```typescript
// In Panel.ts:
private myPanel: HTMLElement;

constructor() {
  this.myPanel = this.getElement('my-panel');
}

// Update visibility methods to include myPanel
```

4. **Update Position Tracking**:
```typescript
// In GlassRenderer.updatePanelPositions():
const myPanelElement = document.getElementById('my-panel');
if (myPanelElement && !myPanelElement.classList.contains('hidden')) {
  const rect = myPanelElement.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const normalizedPos = this.htmlRectToNormalized(rect, canvasRect);
    this.updatePanel('my-panel', {
      position: normalizedPos.position,
      size: normalizedPos.size
    });
  }
}
```

### Adding Text Elements

1. **HTML Element** (must have selectable element):
```html
<h2 id="my-title">My Title</h2>
```

2. **Add to TextRenderer**:
```typescript
// In TextRenderer.setupDefaultTextElements():
const textElementSelectors = [
  { selector: '#my-title', id: 'my-title-text', panelId: 'my-panel' },
  // ...
];
```

3. **Text Will Automatically**:
   - Render to Canvas2D with CSS styles
   - Position based on `getBoundingClientRect()`
   - Apply adaptive coloring based on background
   - Add glow effect
   - Update on panel visibility changes

### Debugging Rendering Issues

**Ocean Debug Modes** (Press D or 0-4):
- **0**: Normal rendering
- **1**: UV coordinates (verify screen-space mapping)
- **2**: Wave height (verify wave amplitude)
- **3**: Normals (verify normal calculation)
- **4**: Wake map (verify vessel wake generation)

**Glass Rendering**:
- Check `console.debug` logs from `GlassRenderer.updatePanelPositions()`
- Verify panel boundaries: Look for "GlassRenderer Panel Mapping" logs
- Check element visibility: `.hidden` class
- Verify WebGL texture binding: Check `gl.bindTexture` calls

**Text Rendering**:
- Check transition state: `TextRenderer.isTransitioning()`
- Verify visible panels: Look for "TextRenderer: Updating text texture for visible panels" log
- Check button positioning: Look for "Button positioning" debug logs
- Verify Canvas2D state: Check `textContext` properties after each render
- Check texture upload: Verify `UNPACK_FLIP_Y_WEBGL` is set

**Coordinate Debugging**:
```typescript
// Add to htmlRectToNormalized():
console.debug(`Element: ${elementRect.width}x${elementRect.height} at (${elementRect.left}, ${elementRect.top})`);
console.debug(`WebGL Center: (${glX.toFixed(3)}, ${glY.toFixed(3)})`);
console.debug(`WebGL Size: (${width.toFixed(3)}, ${height.toFixed(3)})`);
```

**Vessel Wake Debugging**:
- Press **V** to toggle vessel system
- Press **4** to see wake intensity map
- Check console for vessel spawn logs
- Verify vessel data uniforms in shader

### Performance Optimization Tips

**Uniform Updates**:
- Cache last set values in `uniformCache`
- Only update when value changes
- Group related uniforms together

**Scene Captures**:
- Throttle captures to max 60fps
- Use `sceneTextureDirty` flag for invalidation
- Skip captures when scene hasn't changed

**Text Rendering**:
- Block updates during transitions
- Cull text from hidden panels
- Update texture only when needed
- Use ResizeObserver instead of continuous polling

**Vessel System**:
- Adjust `maxVessels` for performance
- Reduce `wakeTrailLength` on low-end devices
- Use vessel state system for graceful fade-out

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
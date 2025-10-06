# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Griffin Ryan's Portfolio Website** - Interactive portfolio built on real-time WebGL2 ocean simulation with three novel rendering systems:

1. **Kelvin Wake Physics** - Mathematically accurate vessel wakes with progressive shear, golden ratio wave patterns, and state-based persistence
2. **Apple Liquid Glass** - Capture-based rendering with refraction physics, blur maps, and liquid flow distortion
3. **Adaptive Text Rendering** - Canvas2D rasterization with per-pixel WebGL adaptive coloring and CSS layout detection

**Tech Stack**: TypeScript, WebGL2, GLSL ES 3.00, Vite, vanilla CSS

## Development Commands

```bash
npm run dev      # Dev server on port 3000
npm run build    # Production build
npm run preview  # Preview build
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       Application Layer                       │
│  main.ts → Router → PanelManager → NavigationManager         │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │         OceanRenderer (Orchestrator)   │
        └───────────────────┬───────────────────┘
                            │
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
┌───▼────┐           ┌──────▼──────┐       ┌──────▼──────┐
│ Wake   │ R16F tex  │    Glass    │ Ocean │    Text     │ Scene
│Renderer├──────────►│  Renderer   │ tex   │  Renderer   │ tex
└────────┘           └──────┬──────┘       └──────┬──────┘
                            │                      │
                     [Blur Map System]    [Layout Detection]
                            │                      │
                            └──────────┬───────────┘
                                       │
                          ┌────────────▼────────────┐
                          │    Final Composite      │
                          │   (Screen Framebuffer)  │
                          └─────────────────────────┘

VesselSystem → WakeRenderer → Ocean samples wake texture
QualityManager → 5 Renderers (resolution scaling)
```

## Application Structure

```
src/
├── main.ts                    # Entry point, 7-phase initialization
├── components/
│   ├── Router.ts             # Hash-based SPA routing
│   ├── Panel.ts              # Transition tracking, 2-frame delay
│   └── Navigation.ts         # Keyboard shortcuts (Ctrl+H/P/R, Alt+←/→)
├── renderer/
│   ├── OceanRenderer.ts      # Pipeline orchestrator, uniform caching
│   ├── WakeRenderer.ts       # Independent R16F wake textures
│   ├── GlassRenderer.ts      # Liquid glass + blur map system
│   ├── TextRenderer.ts       # Adaptive text + layout detection
│   ├── VesselSystem.ts       # Kelvin physics, 3 vessel states
│   ├── ParticleSystem.ts     # GPU particle foam (WIP, not integrated)
│   ├── ShaderManager.ts      # Shader compilation, uniform setters
│   └── Geometry.ts           # Full-screen quad, plane mesh
├── shaders/                   # GLSL ES 3.00
│   ├── ocean.vert/frag       # Procedural waves + wake sampling + glass detection
│   ├── wake.vert/frag        # Kelvin wake generation (R16F output)
│   ├── glass.vert/frag       # Liquid distortion + blur map modulation
│   └── text.vert/frag        # Adaptive coloring + intro animation
├── config/
│   └── QualityPresets.ts     # 5 quality tiers, 7 resolution scales
├── utils/
│   ├── math.ts               # Vec3, Mat4, CubicSpline, ShearTransform2D
│   └── PerformanceMonitor.ts # FPS tracking, dynamic quality adjustment
└── styles/
    └── liquid-glass.css      # Glass panels, WebGL enhancement, animations
```

## Rendering Pipeline

### 4-Renderer Architecture

**WakeRenderer** → **OceanRenderer** → **GlassRenderer** → **TextRenderer**

### Independent Wake Texture System (NEW)

**WakeRenderer** renders Kelvin wakes to an independent R16F texture at configurable resolution (0.25x - 0.75x):

```typescript
// In WakeRenderer.ts
class WakeRenderer {
  private wakeFramebuffer: WebGLFramebuffer;  // R16F single-channel
  private wakeTexture: WebGLTexture;          // Upscaled with linear filtering
  private wakeResolutionScale: number = 0.5;  // Default 50% resolution

  render(vesselData, elapsedTime) {
    // 1. Bind wake framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wakeFramebuffer);
    gl.viewport(0, 0, this.wakeWidth, this.wakeHeight);

    // 2. Clear to zero
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 3. Render wake shader (outputs R16F height values)
    // Uses Kelvin mathematics from wake.frag

    // 4. Restore screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
```

**Performance Impact**: 0.5x wake resolution = ~4× performance gain with minimal visual quality loss due to upscaling.

**Ocean Shader Integration**:

```glsl
// In ocean.frag
uniform sampler2D u_wakeTexture;  // From WakeRenderer

float sampleWakeTexture(vec2 oceanPos) {
  // Convert ocean coordinates [-15*aspectRatio, 15*aspectRatio] to UV [0,1]
  vec2 wakeUV = vec2(
    (oceanPos.x / (15.0 * u_aspectRatio)) * 0.5 + 0.5,
    (oceanPos.y / 15.0) * 0.5 + 0.5
  );

  // Sample wake texture (R channel contains wake height)
  return texture(u_wakeTexture, wakeUV).r;
}

float getOceanHeight(vec2 pos, float time) {
  float height = 0.0;

  // Procedural waves (8 layers)
  height += sineWave(...);

  // Add vessel wakes from pre-rendered texture
  height += sampleWakeTexture(pos);

  return height;
}
```

### Conditional Pipeline (8 Configurations)

Based on enabled features, pipeline executes different passes:

| Wake | Glass | Text | Blur | Pipeline |
|------|-------|------|------|----------|
| ✓ | ✓ | ✓ | ✓ | Wake → Ocean(capture) → Glass → BlurMap → Ocean+Glass(capture) → Text → Final |
| ✓ | ✓ | ✓ | ✗ | Wake → Ocean(capture) → Glass → Ocean+Glass(capture) → Text → Final |
| ✓ | ✓ | ✗ | ✗ | Wake → Ocean(capture) → Glass → Final |
| ✓ | ✗ | ✓ | ✗ | Wake → Ocean(capture) → Text → Final |
| ✓ | ✗ | ✗ | ✗ | Wake → Ocean → Final |
| ✗ | ✓ | ✓ | ✓ | Ocean(capture) → Glass → BlurMap → Ocean+Glass(capture) → Text → Final |
| ✗ | ✓ | ✗ | ✗ | Ocean(capture) → Glass → Final |
| ✗ | ✗ | ✗ | ✗ | Ocean → Final |

**Code** (OceanRenderer.ts:renderOceanScene):

```typescript
// Example: Full pipeline with all features
if (wakesEnabled && wakeRenderer) {
  wakeRenderer.render(vesselData, elapsedTime);  // 1. Render wakes to R16F texture
}

if (textEnabled && textRenderer) {
  if (glassEnabled && glassRenderer) {
    // Capture ocean for glass distortion
    glassRenderer.captureOceanScene(() => {
      this.drawOcean(elapsedTime);  // Samples wake texture
    });

    // Render blur map if enabled
    if (blurMapEnabled) {
      textRenderer.renderBlurMap();
    }

    // Capture ocean+glass for text background analysis
    textRenderer.captureScene(() => {
      this.drawOcean(elapsedTime);
      glassRenderer.render();  // Reads blur map if enabled
    });

    // Final composite
    this.drawOcean(elapsedTime);
    glassRenderer.render();
    textRenderer.render(vesselData, wakesEnabled);
  }
}
```

### Quality Scaling System (NEW)

**5 Quality Presets** (QualityPresets.ts):

```typescript
export const QUALITY_PRESETS = {
  ultra: {
    oceanBaseResolution: 1.0,     // Full resolution ocean
    oceanCaptureResolution: 1.0,  // Full resolution captures
    wakeResolution: 0.75,          // 75% wake texture
    glassResolution: 1.0,
    textCanvasResolution: 2160,    // 4K text
    blurMapResolution: 0.5,
    finalPassResolution: 1.0,
    // ... feature flags
  },
  high: { /* 0.75x / 0.5x resolutions */ },
  medium: { /* 0.5x / 0.33x resolutions */ },
  low: { /* 0.33x / 0.25x resolutions */ },
  potato: { /* 0.25x minimum resolution, no caustics/blur */ }
};
```

**Auto-detection** (detectOptimalQuality):
- Checks GPU (RTX/M1/M2 → ultra/high, GTX/Intel → medium/low)
- Screen resolution (4K → caps at high, 1080p → high/ultra)
- Default fallback: medium

## Core Renderers

### OceanRenderer: Pipeline Orchestrator

**File**: src/renderer/OceanRenderer.ts

**Responsibilities**:
- Execute conditional pipeline based on enabled features
- Coordinate WakeRenderer, GlassRenderer, TextRenderer
- Manage uniform caching for performance
- Handle canvas resizing, propagate to all renderers

**Uniform Caching** (performance optimization):

```typescript
private uniformCache = {
  lastAspectRatio: -1,
  lastResolution: new Float32Array(2),
  lastDebugMode: -1,
  lastWakesEnabled: false,
  lastVesselCount: -1,
  lastGlassCount: -1,
  lastGlassPositions: null as Float32Array | null,
  lastGlassSizes: null as Float32Array | null
};

// Only update uniforms when values change
if (aspect !== this.uniformCache.lastAspectRatio) {
  this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
  this.uniformCache.lastAspectRatio = aspect;
}
```

**Glass-Aware Ocean Rendering**:

Ocean shader detects glass panels and renders a crystalline pattern underneath:

```glsl
// In ocean.frag
float glassIntensity = isUnderGlass(v_screenPos);

if (glassIntensity > 0.1) {
  // Crystalline pattern under glass
  baseColor = vec3(0.08, 0.12, 0.25);  // Solid dark blue
} else {
  // Standard ocean rendering (waves, caustics, foam)
  baseColor = mix(DEEP_WATER, SHALLOW_WATER, height);
  baseColor += caustics;
}
```

### WakeRenderer: Independent Wake Textures

**File**: src/renderer/WakeRenderer.ts

**Architecture**:
- Renders to R16F single-channel texture (height values only)
- Independent resolution scaling (0.25x - 0.75x)
- Linear upscaling provides smooth results

**Framebuffer Setup**:

```typescript
initializeFramebuffer() {
  this.wakeTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.wakeTexture);

  // R16F format (WebGL2 core, no extensions needed)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F,
                this.wakeWidth, this.wakeHeight, 0,
                gl.RED, gl.HALF_FLOAT, null);

  // Linear filtering for smooth upscaling
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Attach to framebuffer
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, this.wakeTexture, 0);
}
```

**Integration**: OceanRenderer binds wake texture to ocean shader via `u_wakeTexture` uniform.

### GlassRenderer: Liquid Glass + Blur Map

**File**: src/renderer/GlassRenderer.ts

**New Systems**:

1. **Transition Mode** (continuous position updates during CSS transitions):

```typescript
private inTransitionMode: boolean = false;
private transitionModeRAF: number | null = null;

startTransitionMode() {
  this.inTransitionMode = true;
  this.runTransitionModeLoop();
}

private runTransitionModeLoop() {
  if (!this.inTransitionMode) return;

  // Update panel positions every frame during transition
  this.updatePanelPositions();

  this.transitionModeRAF = requestAnimationFrame(() => {
    this.runTransitionModeLoop();
  });
}

endTransitionMode() {
  this.inTransitionMode = false;
  if (this.transitionModeRAF) {
    cancelAnimationFrame(this.transitionModeRAF);
    this.transitionModeRAF = null;
  }
}
```

**Why?**: CSS `transform` changes don't trigger ResizeObserver, so we use RAF loop for smooth updates.

2. **Blur Map System** (frosted glass around text):

**BlurMapRenderer** (integrated into GlassRenderer):

```typescript
renderBlurMap() {
  // 1. Bind blur map framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurMapFramebuffer);

  // 2. Clear to zero (no blur)
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // 3. Render distance field from text positions
  // (Gaussian blur kernel centered on text elements)

  // 4. Upload to texture for glass shader
}
```

**Glass Shader Integration** (glass.frag):

```glsl
uniform sampler2D u_blurMapTexture;
uniform bool u_blurMapEnabled;
uniform float u_blurOpacityBoost;      // How much to increase opacity
uniform float u_blurDistortionBoost;   // How much to reduce distortion

void main() {
  // Sample blur map
  float blurIntensity = texture(u_blurMapTexture, screenUV).r;

  // Modulate distortion: reduce in text regions
  float effectiveDistortion = u_distortionStrength;
  if (u_blurMapEnabled && blurIntensity > 0.01) {
    effectiveDistortion *= (1.0 - blurIntensity * u_blurDistortionBoost);
  }

  // Apply distortion
  vec2 totalOffset = refractionOffset + liquidOffset + rippleOffset;
  totalOffset *= effectiveDistortion * 2.5;
  distortedUV += totalOffset;

  // Sample ocean with modulated distortion
  vec3 oceanColor = texture(u_oceanTexture, distortedUV).rgb;

  // Modulate opacity: increase in text regions for frost effect
  float alpha = 0.85;
  if (u_blurMapEnabled && blurIntensity > 0.01) {
    alpha += blurIntensity * u_blurOpacityBoost;

    // Add blue-white frost tint
    vec3 frostColor = vec3(0.92, 0.96, 1.0);
    oceanColor = mix(oceanColor, frostColor, blurIntensity * 0.12);
  }

  fragColor = vec4(oceanColor, alpha);
}
```

**Effect**: Creates frosted glass appearance around text, reducing distortion for clarity while maintaining liquid glass aesthetic.

**Coordinate Mapping** (HTML → WebGL):

```typescript
updatePanelPositions() {
  this.panels.forEach((config, id) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    const elementRect = element.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    // Calculate center in normalized coordinates [0,1]
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    // Convert to WebGL NDC [-1,1] with Y-flip
    config.position = new Float32Array([
      centerX * 2.0 - 1.0,
      (1.0 - centerY) * 2.0 - 1.0
    ]);

    // Size in NDC
    config.size = new Float32Array([
      (elementRect.width / canvasRect.width) * 2.0,
      (elementRect.height / canvasRect.height) * 2.0
    ]);
  });
}
```

### TextRenderer: Adaptive Text + Layout Detection

**File**: src/renderer/TextRenderer.ts

**New Systems**:

1. **CSS Layout Detection Engine** (3 modes):

```typescript
renderTextToCanvas(element: HTMLElement, config: TextElementConfig) {
  const computedStyle = window.getComputedStyle(element);
  const parentStyle = window.getComputedStyle(element.parentElement!);

  // Detect layout mode
  let textAlign: CanvasTextAlign;
  let textBaseline: CanvasTextBaseline;

  // Mode 1: Inline-flex button (center/middle)
  if (computedStyle.display === 'inline-flex') {
    textAlign = 'center';
    textBaseline = 'middle';
  }
  // Mode 2: Flex container (use alignItems/justifyContent)
  else if (parentStyle.display === 'flex' || parentStyle.display === 'inline-flex') {
    const alignItems = parentStyle.alignItems;
    const justifyContent = parentStyle.justifyContent;

    textAlign = justifyContent === 'center' ? 'center' :
                justifyContent === 'flex-end' ? 'right' : 'left';
    textBaseline = alignItems === 'center' ? 'middle' :
                   alignItems === 'flex-end' ? 'bottom' : 'top';
  }
  // Mode 3: Standard flow (use CSS text-align)
  else {
    textAlign = computedStyle.textAlign as CanvasTextAlign;
    textBaseline = 'top';
  }

  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;
  ctx.fillText(text, textX, textY);
}
```

2. **Visibility Culling** (panel-based):

```typescript
updateTextTexture() {
  if (this.isTransitioningFlag) return;  // Block during transitions

  // Clear canvas
  this.textCtx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

  // Query visible panels
  const visiblePanels = new Set<string>();
  ['landing-panel', 'app-bio-panel', 'navbar', /* ... */].forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (panel && !panel.classList.contains('hidden')) {
      visiblePanels.add(panelId);
    }
  });

  // Only render text from visible panels
  this.textElements.forEach((config, id) => {
    if (visiblePanels.has(config.panelId)) {
      const element = document.getElementById(id);
      if (element) {
        this.renderTextToCanvas(element, config);
      }
    }
  });

  // Upload to WebGL with Y-flip
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);
}
```

3. **Transition Blocking** (2-frame delay):

```typescript
// In PanelManager.ts
onAllTransitionsComplete() {
  // CRITICAL: Wait 2 frames for browser to fully render final state
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      this.textRenderer?.setTransitioning(false);
      this.textRenderer?.forceTextureUpdate();
      this.textRenderer?.markSceneDirty();
    });
  });
}
```

**Why 2 Frames?**
- Frame 1: `transitionend` fires, styles may not be computed
- Frame 2: Styles computed, frame may not be painted
- Frame 3: Frame painted, positions stable for capture

4. **Intro Animation** (wiggly distortion):

**Text Shader** (text.frag):

```glsl
// Intro animation with cubic ease-out
float eased = cubicEaseOut(u_textIntroProgress);  // 0.0 → 1.0
float distortionAmount = 1.0 - eased;

// Multi-frequency sine waves
float wave1 = sin(screenUV.y * 30.0 + v_time * 8.0) * 0.12;
float wave2 = sin(screenUV.x * 20.0 - v_time * 6.0) * 0.08;
float deepWave = sin(screenUV.y * 8.0 + v_time * 3.0) * 0.20;

vec2 distortion = vec2(wave1 + deepWave, wave2) * distortionAmount;
vec2 distortedUV = screenUV + distortion;

// Sample text with distortion (fades as progress → 1.0)
float textAlpha = texture(u_textTexture, distortedUV).a;
```

**Glow System Removed**: Previous distance field glow replaced with blur map system for better performance and cleaner frosted glass aesthetic.

### VesselSystem: Kelvin Wake Physics

**File**: src/renderer/VesselSystem.ts

**Vessel Classes**:

```typescript
export enum VesselClass {
  FAST_LIGHT = 0,   // Speedboat: weight 0.3, speed 4-5, hull 8m
  FAST_HEAVY = 1,   // Cargo: weight 1.0, speed 3-4, hull 20m
  SLOW_LIGHT = 2,   // Sailboat: weight 0.2, speed 1-2, hull 12m
  SLOW_HEAVY = 3    // Barge: weight 0.8, speed 1-2, hull 15m
}
```

**Vessel States** (state machine):

```typescript
export enum VesselState {
  ACTIVE = 0,   // On-screen, full wake intensity (1.0x)
  GHOST = 1,    // Off-screen but wake persists (10s), reduced intensity (0.7x)
  FADING = 2    // Final fade-out (5s), progressive intensity reduction
}
```

**State Transitions**:

```
         leaves screen
ACTIVE ──────────────────→ GHOST
                            │ 10s
                            ↓
                          FADING
                            │ 5s
                            ↓
                         REMOVED
```

**Wake Trail System**:

```typescript
class Vessel {
  private wakeTrail: Vec3[] = [];  // 150 wake points
  private maxTrailLength: number = 150;
  private maxTrailDistance: number = 80 + this.weight * 25;  // 80-105 units

  update(deltaTime: number) {
    // Add new wake point every frame when moving
    if (this.velocity.length() > 0.1) {
      this.wakeTrail.push(this.position.clone());

      // Remove old points beyond max distance
      while (this.wakeTrail.length > this.maxTrailLength) {
        this.wakeTrail.shift();
      }
    }
  }
}
```

**Kelvin Wake Mathematics** (wake.frag):

**Progressive Shear** (wake curling):

```glsl
// Shear factor increases logarithmically with distance
float progressiveShear = 1.0 + 0.15 * log(1.0 + pathDistance * 0.1);

// Wake angle increases over distance for natural curling
float dynamicAngle = baseAngle * froudeModifier * progressiveShear;

// Calculate wake arms with dynamic angle
vec2 leftArm = rotate2D(vesselDir, dynamicAngle);
vec2 rightArm = rotate2D(vesselDir, -dynamicAngle);
```

**Froude Number** (speed-based wake angle):

```glsl
float froudeNumber = vesselSpeed / sqrt(GRAVITY * hullLength);
float baseAngle = KELVIN_ANGLE * (1.0 + weight * 0.8);  // 19.47° → 35°
float froudeModifier = 1.0 + froudeNumber * 0.2;
```

**Simplified Decay Function** (performance optimized from spline):

```glsl
float getSimplifiedTrailDecay(float normalizedDistance, float weight) {
  float decay = exp(-normalizedDistance * 2.5);
  float modulation = 1.0 - normalizedDistance * 0.3;
  float weightFactor = 1.0 + weight * 0.2;
  return max(0.0, decay * modulation * weightFactor);
}
```

**Golden Ratio Wave Patterns**:

```glsl
const float phi = 1.618;  // Golden ratio

for (int j = 0; j < 2; j++) {
  float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.5);
  float k = waveNumber(wavelength);
  float omega = waveFrequency(k);
  float phase = k * pathDistance - omega * time + float(j) * 2.39;  // Golden angle
  float amplitude = baseAmplitude * pow(0.618, float(j));  // 1/phi decay

  wakeHeight += amplitude * armIntensity * ageFactor * sin(phase);
}
```

**State-Based Intensity**:

```glsl
float stateIntensity = 1.0;
if (vesselState > 0.5 && vesselState < 1.5) {  // Ghost
  stateIntensity = 0.7;
} else if (vesselState > 1.5) {  // Fading
  float fadeFactor = vesselState - 2.0;
  stateIntensity = 0.7 * (1.0 - fadeFactor);
}
```

## Shader Architecture

### Ocean Shader (ocean.frag)

**Key Features**:
- Wake texture sampling from WakeRenderer
- Glass detection with dual rendering paths
- Multi-layer caustics
- Bayer dithering for quantization

**Wake Sampling**:

```glsl
uniform sampler2D u_wakeTexture;

float sampleWakeTexture(vec2 oceanPos) {
  vec2 wakeUV = vec2(
    (oceanPos.x / (15.0 * u_aspectRatio)) * 0.5 + 0.5,
    (oceanPos.y / 15.0) * 0.5 + 0.5
  );
  return texture(u_wakeTexture, wakeUV).r;  // R16F single channel
}
```

**Glass Detection**:

```glsl
uniform int u_glassPanelCount;
uniform vec2 u_glassPanelPositions[2];
uniform vec2 u_glassPanelSizes[2];

float isUnderGlass(vec2 screenPos) {
  for (int i = 0; i < u_glassPanelCount && i < 2; i++) {
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
float glassIntensity = isUnderGlass(v_screenPos);

if (glassIntensity > 0.1) {
  // Crystalline pattern under glass (solid color, minimal noise)
  baseColor = vec3(0.08, 0.12, 0.25);
} else {
  // Standard ocean rendering
  baseColor = mix(DEEP_WATER, SHALLOW_WATER, height);
  baseColor = mix(baseColor, WAVE_CREST, crestAmount);
  baseColor += caustics;  // Multi-layer caustics
  baseColor = quantizeColor(baseColor, 8);  // Stylistic quantization
}
```

**Debug Modes** (D key cycles, 0-4 keys direct):

```glsl
uniform int u_debugMode;

if (u_debugMode == 1) fragColor = vec4(v_uv, 0.5, 1.0);         // UV coords
else if (u_debugMode == 2) fragColor = vec4(vec3(height + 0.5), 1.0);  // Wave height
else if (u_debugMode == 3) fragColor = vec4(normal * 0.5 + 0.5, 1.0);  // Normals
else if (u_debugMode == 4) {  // Wake intensity map
  float wakeContribution = sampleWakeTexture(oceanPos);
  vec3 wakeColor = mix(vec3(0.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0),
                       clamp(abs(wakeContribution) * 5.0, 0.0, 1.0));
  fragColor = vec4(wakeColor, 1.0);
}
```

### Wake Shader (wake.frag)

**Output**: R16F single channel (wake height)

**Complete Kelvin Mathematics**:

```glsl
float calculateVesselWake(vec2 pos, vec3 vesselPos, vec3 vesselVel,
                          float weight, float hullLength, float vesselState, float time) {
  // 1. Calculate relative position
  vec2 delta = pos - vesselPos.xz;
  vec2 vesselDir = normalize(vesselVel.xz);
  float vesselSpeed = length(vesselVel.xz);

  // 2. Only generate wake behind vessel
  float dotProduct = dot(delta, vesselDir);
  if (dotProduct > 0.0) return 0.0;

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

  // 5. Calculate decay
  float normalizedPathDistance = min(pathDistance / maxTrailDistance, 1.0);
  float simplifiedDecay = getSimplifiedTrailDecay(normalizedPathDistance, weight);

  // 6. Vessel state intensity
  float stateIntensity = 1.0;
  if (vesselState > 0.5 && vesselState < 1.5) stateIntensity = 0.7;
  else if (vesselState > 1.5) stateIntensity = 0.7 * (1.0 - (vesselState - 2.0));

  // 7. Wave synthesis for both arms
  float wakeHeight = 0.0;
  float effectiveWidth = (2.0 + weight * 3.0) * spreadFactor * curlSpread;

  // Left arm (simplified, same for right arm)
  if (leftDist < effectiveWidth) {
    for (int j = 0; j < 2; j++) {  // 2 wave components (performance optimized)
      float wavelength = (2.5 + vesselSpeed * 0.5) * pow(1.618, float(j) * 0.5);
      // ... wave calculation with golden ratio patterns
      wakeHeight += amplitude * armIntensity * simplifiedDecay * sin(phase);
    }
  }

  return wakeHeight * 1.5;
}
```

**Performance**: Reduced from 3 to 2 wave components per arm (6 → 4 total) for better performance while maintaining visual quality.

### Glass Shader (glass.frag)

**Blur Map Modulation**:

```glsl
uniform sampler2D u_blurMapTexture;
uniform bool u_blurMapEnabled;
uniform float u_blurOpacityBoost;      // 0.3 (boost opacity 30% in text regions)
uniform float u_blurDistortionBoost;   // 0.6 (reduce distortion 60% in text regions)

// Early blur map sample
float blurIntensity = texture(u_blurMapTexture, screenUV).r;

// Modulate distortion
float effectiveDistortion = u_distortionStrength;
if (u_blurMapEnabled && blurIntensity > 0.01) {
  effectiveDistortion *= (1.0 - blurIntensity * u_blurDistortionBoost);
}

// Apply to total offset calculation
vec2 totalOffset = refractionOffset + liquidOffset + rippleOffset + noiseOffset;
totalOffset *= effectiveDistortion * 2.5;

// Modulate opacity and add frost tint
float alpha = 0.85;
if (u_blurMapEnabled && blurIntensity > 0.01) {
  alpha += blurIntensity * u_blurOpacityBoost;
  vec3 frostColor = vec3(0.92, 0.96, 1.0);
  finalColor = mix(finalColor, frostColor, blurIntensity * 0.12);
}
```

**Liquid Flow Physics**:

```glsl
vec3 calculateLiquidGlassNormal(vec2 uv, float time) {
  // Multi-scale liquid distortion
  float flow1 = time * LIQUID_FLOW_SPEED;
  float flow2 = time * LIQUID_FLOW_SPEED * 1.7;

  vec2 flowDir1 = vec2(cos(flow1 * 0.8), sin(flow1 * 1.2));
  vec2 flowDir2 = vec2(cos(flow2 * 1.3), sin(flow2 * 0.9));

  // 3-scale flowing noise
  float h = noise(uv * 15.0 + flowDir1 * 2.0) * 0.08;
  h += noise(uv * 22.5 + flowDir2 * 1.5) * 0.05;
  h += noise(uv * 37.5 + time * 0.6) * 0.03;

  // Ripple patterns
  float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
  h += ripple * exp(-length(uv - 0.5) * 3.0);

  // Voroni-like cellular structures
  vec2 cellUv = uv * 8.0 + time * 0.2;
  float cellDist = length(fract(cellUv) - 0.5);
  h += (0.5 - cellDist) * 0.01;

  return normalize(vec3(gradient_x, gradient_y, 1.0));
}
```

**Refraction Physics** (Snell's law):

```glsl
vec3 calculateRefraction(vec3 incident, vec3 normal, float eta) {
  float cosI = -dot(normal, incident);
  float sinT2 = eta * eta * (1.0 - cosI * cosI);

  if (sinT2 > 1.0) return vec3(0.0);  // Total internal reflection

  float cosT = sqrt(1.0 - sinT2);
  return eta * incident + (eta * cosI - cosT) * normal;
}

// Usage
vec3 refractionDir = calculateRefraction(viewDir, glassNormal, 1.0 / u_refractionIndex);
vec2 refractionOffset = refractionDir.xy * effectiveDistortion;
```

**Chromatic Aberration** (uniform across panel):

```glsl
float chromaticAberration = u_distortionStrength * 0.006;
float chromaticFlow = sin(v_time * 1.0) * 0.001;

vec3 chromaticColor = vec3(
  texture(u_oceanTexture, distortedUV + vec2(chromaticAberration + chromaticFlow, 0.0)).r,
  texture(u_oceanTexture, distortedUV).g,
  texture(u_oceanTexture, distortedUV - vec2(chromaticAberration - chromaticFlow, 0.0)).b
);

oceanColor = mix(oceanColor, chromaticColor * GLASS_TINT, 0.35);
```

### Text Shader (text.frag)

**Glow System Removed**: Previous distance field glow removed in favor of blur map system.

**Adaptive Coloring** (per-pixel):

```glsl
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength) {
  float luminance = dot(backgroundColor, vec3(0.299, 0.587, 0.200));
  float colorMix = step(0.5, luminance);  // Binary threshold
  vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);
  return mix(LIGHT_TEXT_COLOR, adaptiveColor, adaptiveStrength);
}

// Usage
if (textAlpha > 0.01) {
  vec3 adaptiveTextColor = calculateAdaptiveTextColor(backgroundColor, u_adaptiveStrength);
  vec3 quantizedColor = quantizeColor(adaptiveTextColor, 8);
  finalColor = quantizedColor;
  finalAlpha = smoothstep(0.1, 0.5, textAlpha);
} else {
  discard;  // No glow rendering
}
```

**Panel Boundary Detection**:

```glsl
uniform vec2 u_panelPositions[5];
uniform vec2 u_panelSizes[5];
uniform int u_panelCount;

bool isWithinPanel(vec2 screenPos, out vec2 panelUV) {
  for (int i = 0; i < u_panelCount && i < 5; i++) {
    vec2 panelCenter = (u_panelPositions[i] + 1.0) * 0.5;
    vec2 panelHalfSize = u_panelSizes[i] * 0.5;
    vec2 deltaFromCenter = screenPos - panelCenter;
    vec2 localPanelUV = deltaFromCenter / panelHalfSize + 0.5;

    if (localPanelUV.x >= 0.0 && localPanelUV.x <= 1.0 &&
        localPanelUV.y >= 0.0 && localPanelUV.y <= 1.0) {
      panelUV = localPanelUV;
      return true;
    }
  }
  return false;
}

void main() {
  vec2 screenUV = (v_screenPos + 1.0) * 0.5;
  vec2 panelUV;
  if (!isWithinPanel(screenUV, panelUV)) {
    discard;  // Only render text within panels
  }
  // ...
}
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
vec2 distortedUV = screenUV + distortion;
```

## Component Architecture

### PanelManager (Panel.ts)

**Transition Tracking System**:

```typescript
class PanelManager {
  // Transition tracking
  private activeTransitions: Set<HTMLElement> = new Set();
  private activeAnimations: Set<HTMLElement> = new Set();
  private pendingTimeouts: Set<number> = new Set();

  // Setup listeners on all panels
  private setupTransitionListeners() {
    panels.forEach(panel => {
      panel.addEventListener('transitionend', (e: TransitionEvent) => {
        // CRITICAL: Only track transform transitions (spatial positioning)
        if (e.propertyName !== 'transform' &&
            e.propertyName !== '-webkit-transform') {
          return;
        }

        this.activeTransitions.delete(panel);
        this.checkAllStateChangesComplete();
      });
    });
  }

  private checkAllStateChangesComplete() {
    if (this.activeTransitions.size === 0 &&
        this.activeAnimations.size === 0 &&
        this.pendingTimeouts.size === 0) {
      this.onAllTransitionsComplete();
    }
  }

  private onAllTransitionsComplete() {
    // End glass transition mode
    this.glassRenderer?.endTransitionMode();

    // Wait 2 frames for browser to fully render final state
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.textRenderer?.setTransitioning(false);
        this.textRenderer?.forceTextureUpdate();
        this.textRenderer?.markSceneDirty();
      });
    });
  }
}
```

**Glass Transition Mode Integration**:

```typescript
transitionTo(newState: PanelState) {
  // Start continuous glass position updates
  this.glassRenderer?.startTransitionMode();

  // Perform transition (fade out, toggle hidden, fade in, add active)
  this.performTransition(oldState, newState);

  // endTransitionMode() called in onAllTransitionsComplete()
}
```

**State Machine** (6 states):

```typescript
export type PanelState = 'landing' | 'app' | 'portfolio' | 'resume' | 'paper' | 'not-found';

// Transitions
transitionTo(newState: PanelState) {
  if (newState === this.currentState) return;

  // Block TextRenderer
  this.textRenderer?.setTransitioning(true);

  // Start glass transition mode
  this.glassRenderer?.startTransitionMode();

  // Fade out → Toggle hidden → Fade in → Add active → transitionend → 2 frames → Unblock
  this.performTransition(oldState, newState);
}
```

### Router (Router.ts)

**Hash-Based Navigation**:

```typescript
class Router {
  private routes: Map<string, Route> = new Map([
    ['', { state: 'landing', title: 'Griffin Ryan - Ocean Portfolio' }],
    ['app', { state: 'app', title: 'Griffin Ryan - Home' }],
    ['portfolio', { state: 'portfolio', title: 'Griffin Ryan - Portfolio' }],
    ['resume', { state: 'resume', title: 'Griffin Ryan - Resume' }],
    ['paper', { state: 'paper', title: 'Research Paper - Ocean Simulation' }]
  ]);

  private handleNavigation() {
    const hash = window.location.hash.slice(1);
    const route = this.routes.get(hash);

    if (route) {
      document.title = route.title;
      this.panelManager.transitionTo(route.state);
    } else {
      this.panelManager.transitionTo('not-found');
    }
  }
}
```

### NavigationManager (Navigation.ts)

**Keyboard Shortcuts**:

```typescript
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key) {
    case 'h':
    case 'H':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.router.navigate('app');  // Ctrl+H → Home
      }
      break;
    case 'p':
    case 'P':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.router.navigate('portfolio');  // Ctrl+P → Portfolio
      }
      break;
    case 'r':
    case 'R':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.router.navigate('resume');  // Ctrl+R → Resume
      }
      break;
    case 'ArrowLeft':
      if (e.altKey) {
        e.preventDefault();
        this.navigatePrevious();  // Alt+← → Previous
      }
      break;
    case 'ArrowRight':
      if (e.altKey) {
        e.preventDefault();
        this.navigateNext();  // Alt+→ → Next
      }
      break;
  }
});
```

**Visibility Management**:

```typescript
updateVisibilityForPanelState(panelState: PanelState) {
  switch (panelState) {
    case 'landing':
    case 'not-found':
    case 'paper':
      this.hide();  // Hide navbar
      break;
    case 'app':
    case 'portfolio':
    case 'resume':
      this.show();  // Show navbar
      break;
  }
}
```

## Quality & Performance System

### QualityManager (QualityPresets.ts)

**5 Quality Presets**:

| Preset | Ocean | Capture | Wake | Glass | Text | Blur | Final | Features |
|--------|-------|---------|------|-------|------|------|-------|----------|
| Ultra | 1.0x | 1.0x | 0.75x | 1.0x | 2160p | 0.5x | 1.0x | All enabled |
| High | 0.75x | 0.5x | 0.5x | 0.75x | 1920p | 0.33x | 0.75x | All enabled |
| Medium | 0.5x | 0.33x | 0.4x | 0.5x | 1920p | 0.25x | 0.66x | No wave reactivity |
| Low | 0.33x | 0.25x | 0.33x | 0.33x | 1280p | 0.25x | 0.5x | No caustics, blur |
| Potato | 0.25x | 0.25x | 0.25x | 0.25x | 1280p | 0.25x | 0.33x | Minimal features |

**Quality Detection**:

```typescript
export function detectOptimalQuality(): QualityPreset {
  const dpr = window.devicePixelRatio || 1;
  const screenPixels = window.innerWidth * window.innerHeight * dpr * dpr;

  const gl = canvas.getContext('webgl2');
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

  // High-end GPUs
  if (renderer.includes('RTX') || renderer.includes('M1') || renderer.includes('M2')) {
    return screenPixels > 8000000 ? 'high' : 'ultra';  // 4K+ → high
  }

  // Mid-range GPUs
  if (renderer.includes('GTX') || renderer.includes('Intel Iris')) {
    return 'medium';
  }

  // Low-end GPUs
  if (renderer.includes('Intel HD')) {
    return 'low';
  }

  // Fallback based on resolution
  if (screenPixels > 8000000) return 'medium';  // 4K
  if (screenPixels > 2000000) return 'high';    // 1080p
  return 'medium';
}
```

**Usage**:

```typescript
// In main.ts
const qualityManager = new QualityManager();  // Auto-detects
const settings = qualityManager.getSettings();

// Apply to renderers
oceanRenderer.updateQualitySettings(settings);
wakeRenderer.updateQualitySettings(settings);
glassRenderer.updateQualitySettings(settings);
textRenderer.updateQualitySettings(settings);
```

### PerformanceMonitor (PerformanceMonitor.ts)

**FPS Tracking**:

```typescript
class PerformanceMonitor {
  private frameCount: number = 0;
  private lastFrameTime: number = performance.now();
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];

  endFrame() {
    const currentTime = performance.now();
    const frameTime = currentTime - this.lastFrameTime;
    const fps = 1000 / frameTime;

    this.frameTimes.push(frameTime);
    this.fpsHistory.push(fps);

    // Keep only recent samples (default: 60 frames)
    if (this.frameTimes.length > this.config.sampleWindow) {
      this.frameTimes.shift();
      this.fpsHistory.shift();
    }

    // Calculate metrics
    this.averageFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    this.minFps = Math.min(...this.fpsHistory);
    this.maxFps = Math.max(...this.fpsHistory);

    this.lastFrameTime = currentTime;
  }

  getMetrics(): PerformanceMetrics {
    return {
      fps: Math.round(this.currentFps),
      frameTime: parseFloat(this.currentFrameTime.toFixed(2)),
      averageFps: Math.round(this.averageFps),
      minFps: Math.round(this.minFps),
      maxFps: Math.round(this.maxFps)
    };
  }
}
```

**Dynamic Quality Adjustment** (optional, disabled by default):

```typescript
// Enable dynamic quality adjustment
performanceMonitor.setDynamicQuality(true);

// Auto-adjusts quality based on FPS
// If avgFPS < targetFPS - threshold: decrease quality
// If avgFPS > targetFPS + threshold: increase quality
```

## Coordinate Systems

### 5 Coordinate Spaces

1. **HTML Screen Space**
   - Origin: Top-left
   - Y-axis: Down
   - Units: Pixels

2. **WebGL NDC (Normalized Device Coordinates)**
   - Origin: Center
   - Y-axis: Up
   - Range: [-1, 1]

3. **Canvas2D Texture Space**
   - Origin: Top-left
   - Y-axis: Down
   - Units: Pixels (1:1 with WebGL canvas)

4. **Ocean Simulation Space**
   - Origin: Center
   - Y-axis: Up
   - Range: Typically [-30, 30] units

5. **Panel Local Space**
   - Origin: Panel center
   - Range: [0, 1] (panel-relative UV)

### Transformation Pipelines

**HTML → WebGL** (GlassRenderer panels):

```typescript
// 1. Get HTML bounding rect (pixels, top-left origin)
const elementRect = element.getBoundingClientRect();
const canvasRect = canvas.getBoundingClientRect();

// 2. Normalize to [0,1]
const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

// 3. Convert to WebGL NDC [-1,1] with Y-flip
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;  // Y-axis flip (top-left → bottom-left)

// 4. Size in NDC
const width = (elementRect.width / canvasRect.width) * 2.0;
const height = (elementRect.height / canvasRect.height) * 2.0;
```

**HTML → Canvas2D → WebGL** (TextRenderer):

```typescript
// 1. HTML screen coordinates (pixels)
const screenX = elementRect.left - canvasRect.left;
const screenY = elementRect.top - canvasRect.top;

// 2. Scale to Canvas2D texture coordinates (1:1 mapping)
const scaleX = textCanvas.width / canvasRect.width;
const scaleY = textCanvas.height / canvasRect.height;
const textureX = screenX * scaleX;
const textureY = screenY * scaleY;

// 3. Draw to Canvas2D (top-left origin, Y down)
ctx.fillText(text, textureX, textureY);

// 4. Upload to WebGL with Y-flip
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);

// 5. Sample in shader (Y-flip handled by upload)
float textAlpha = texture(u_textTexture, screenUV).a;
```

**Screen → Ocean** (Wave calculations):

```glsl
// v_screenPos is in NDC [-1, 1]
vec2 oceanPos = v_screenPos * 15.0;  // Scale for wave visibility
oceanPos.x *= u_aspectRatio;  // Maintain aspect ratio

// Now oceanPos is in ocean simulation space (units)
float oceanHeight = getOceanHeight(oceanPos, v_time);
```

## State Flow

### Application Initialization (7 Phases)

```
1. UI Components
   PanelManager → Router → NavigationManager

2. WebGL Context
   Get canvas → Create WebGL2 context → Check extensions

3. Quality Detection
   QualityManager.detectOptimalQuality() → Get settings

4. Renderers
   ShaderManager → VesselSystem → WakeRenderer → OceanRenderer → GlassRenderer → TextRenderer

5. Shader Compilation
   Load shader files → Compile programs → Link uniforms/attributes

6. Render Loop
   Start requestAnimationFrame loop
   VesselSystem.update() → OceanRenderer.renderOceanScene() → FPS update

7. UI-Renderer Connection
   Enable Glass/Text → Bind PanelManager → Wait for landing animation → Setup controls
```

### Transition State Flow

```
User Interaction
      ↓
Router.navigate()
      ↓
hashchange event
      ↓
PanelManager.transitionTo(newState)
      ↓
┌─────────────────────────────────────────┐
│ Block TextRenderer                      │ ← setTransitioning(true)
│ Start Glass Transition Mode             │ ← startTransitionMode()
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Fade Out (300ms)                        │
│   - Add .fade-out class                 │
│   - Track transition                    │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Toggle Hidden                           │
│   - Add .hidden to old panels           │
│   - Remove .hidden from new panels      │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Fade In (300ms)                         │
│   - Add .fade-in class                  │
│   - Track transition                    │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Add Active Class                        │
│   - Triggers CSS transform              │
│   - Track transform transition          │
└─────────────────────────────────────────┘
      ↓
transitionend (transform property only)
      ↓
┌─────────────────────────────────────────┐
│ End Glass Transition Mode               │ ← endTransitionMode()
│ Wait 2 Frames                           │ ← RAF → RAF
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Unblock TextRenderer                    │ ← setTransitioning(false)
│ Force Texture Update                    │ ← forceTextureUpdate()
│ Mark Scene Dirty                        │ ← markSceneDirty()
└─────────────────────────────────────────┘
```

### Render Loop Data Flow

```
Each Frame:
  VesselSystem.update(deltaTime)
      ↓
  IF wakesEnabled:
    WakeRenderer.render(vesselData, elapsedTime)
      → Outputs to R16F texture
      ↓
  OceanRenderer.renderOceanScene(elapsedTime)
      ↓
  Conditional Pipeline:
    IF textEnabled && glassEnabled:
      1. GlassRenderer.captureOceanScene(() => drawOcean())
         → Ocean samples wake texture
         → Outputs to oceanFramebuffer

      2. IF blurMapEnabled:
           BlurMapRenderer.renderBlurMap()
           → Outputs to blurMapTexture

      3. TextRenderer.captureScene(() => {
           drawOcean()
           GlassRenderer.render()  // Reads blur map
         })
         → Outputs to sceneFramebuffer

      4. Final Composite:
         drawOcean()
         GlassRenderer.render()  // Reads blur map
         TextRenderer.render(vesselData, wakesEnabled)

    ELSE IF textEnabled:
      // Ocean + Text pipeline...

    ELSE IF glassEnabled:
      // Ocean + Glass pipeline...

    ELSE:
      // Ocean only
      ↓
  FPS Update
  requestAnimationFrame(loop)
```

## CSS Integration

### WebGL Enhancement Strategy

**CSS Foundation** (liquid-glass.css):

```css
.glass-panel {
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05));
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-radius: 20px;
  /* ... */
}
```

**WebGL Enhancement** (remove CSS effects):

```css
.glass-panel.webgl-enhanced {
  /* Remove CSS effects when WebGL is active */
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
  z-index: 150;  /* Ensure proper layering with WebGL canvas */
}
```

**Text Hiding Pattern**:

```css
/* Hide HTML text when WebGL text rendering is active */
/* Elements remain in DOM for layout, accessibility, SEO */
.webgl-text-enabled h1,
.webgl-text-enabled h2,
.webgl-text-enabled p,
.webgl-text-enabled .glass-button,
.webgl-text-enabled .nav-label {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  background: none !important;  /* Remove gradient backgrounds */
}
```

### Animation System

```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translate(-50%, -40%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

@keyframes navbarSlideIn {
  from {
    transform: translateY(calc(-100% - 20px));
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Staggered delays for portfolio panels */
#portfolio-lakehouse-panel { animation-delay: 0s; }
#portfolio-encryption-panel { animation-delay: 0.1s; }
#portfolio-dotereditor-panel { animation-delay: 0.2s; }
/* ... */
```

### Responsive Design

```css
@media (max-width: 768px) {
  .navbar-panel {
    top: 10px;
    left: 10px;
    right: 10px;
    width: calc(100% - 20px);
  }

  .content-scroll-container {
    top: 70px;  /* Smaller navbar on mobile */
  }

  .project-panel,
  .resume-card-panel {
    width: 100%;
    max-width: 400px;
    padding: 1.5rem;
  }
}
```

## Extension Patterns

### Add Glass Panel

```typescript
// In main.ts or GlassRenderer initialization
glassRenderer.addPanel('my-panel', {
  elementId: 'my-panel',
  distortionStrength: 0.4,
  refractionIndex: 1.52,
  size: new Float32Array([0, 0])  // Auto-updated via getBoundingClientRect
});
```

**HTML**:

```html
<div id="my-panel" class="glass-panel webgl-enhanced">
  <!-- Content -->
</div>
```

### Register Text Element

```typescript
// In TextRenderer.setupDefaultTextElements()
this.textElements.set('my-title', {
  selector: '#my-panel h1',
  id: 'my-title',
  panelId: 'my-panel'
});
```

**System automatically handles**:
- CSS style inheritance (font, weight, size, alignment)
- Layout detection (flex, inline-flex, standard)
- Positioning via getBoundingClientRect
- Adaptive coloring
- Intro animation

### Custom Quality Preset

```typescript
const customSettings: QualitySettings = {
  oceanBaseResolution: 0.66,
  oceanCaptureResolution: 0.5,
  wakeResolution: 0.5,
  glassResolution: 0.66,
  textCanvasResolution: 1920,
  blurMapResolution: 0.33,
  finalPassResolution: 0.75,

  oceanWaveCount: 6,
  fbmOctaves: 2,
  causticLayers: 1,
  wakeWaveComponents: 2,
  glassDistortionQuality: 0.75,

  enableCaustics: true,
  enableGlassDistortion: true,
  enableBlurMap: true,
  enableWaveReactivity: true,

  upscaleSharpness: 0.4,
  upscaleMethod: 'fsr'
};

qualityManager.updateSettings(customSettings);
```

### Debug Mode Workflow

**Keys**:
- `D` - Cycle debug modes (0 → 1 → 2 → 3 → 4 → 0)
- `0-4` - Jump directly to debug mode

**Modes**:
0. Normal rendering
1. UV coordinates (verify texture mapping)
2. Wave height (grayscale, verify ocean simulation)
3. Normals (RGB, verify lighting calculations)
4. Wake intensity map (verify wake texture sampling)

**Usage**:
```typescript
// Toggle debug mode in OceanRenderer
document.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    this.debugMode = (this.debugMode + 1) % 5;
  } else if (e.key >= '0' && e.key <= '4') {
    this.debugMode = parseInt(e.key);
  }
});
```

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
| **Q** | Cycle quality presets (ultra → high → medium → low → potato) |
| **Ctrl+H** | Navigate to Home |
| **Ctrl+P** | Navigate to Portfolio |
| **Ctrl+R** | Navigate to Resume |
| **Alt+←** | Navigate previous panel |
| **Alt+→** | Navigate next panel |

## Performance Optimizations

### Uniform Caching (OceanRenderer)

```typescript
private uniformCache = {
  lastAspectRatio: -1,
  lastResolution: new Float32Array(2),
  lastDebugMode: -1,
  lastWakesEnabled: false,
  lastVesselCount: -1,
  lastGlassCount: -1,
  lastGlassPositions: null as Float32Array | null,
  lastGlassSizes: null as Float32Array | null
};

// Only call WebGL uniform setters when values change
if (aspect !== this.uniformCache.lastAspectRatio) {
  this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
  this.uniformCache.lastAspectRatio = aspect;
}
```

**Impact**: ~15% CPU reduction by avoiding redundant WebGL calls.

### Scene Capture Throttling (TextRenderer)

```typescript
private captureThrottleMs: number = 16;  // Max 60fps
private lastCaptureTime: number = 0;
private sceneTextureDirty: boolean = true;

captureScene(renderCallback: () => void) {
  const currentTime = performance.now();

  if (!this.sceneTextureDirty &&
      (currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
    return;  // Skip capture
  }

  // Proceed with capture...
  this.lastCaptureTime = currentTime;
  this.sceneTextureDirty = false;
}
```

**Impact**: Prevents unnecessary framebuffer captures when scene hasn't changed.

### Wake Resolution Scaling (WakeRenderer)

```typescript
// Default: 0.5x wake resolution
private wakeResolutionScale: number = 0.5;

// Calculate wake texture size
this.wakeWidth = Math.round(canvasWidth * this.wakeResolutionScale);
this.wakeHeight = Math.round(canvasHeight * this.wakeResolutionScale);
```

**Impact**: 0.5x resolution = ~4× performance gain (quadratic scaling) with minimal visual quality loss due to linear upscaling.

### DOM Element Caching (OceanRenderer)

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

// Use cached element instead of repeated getElementById
if (this.cachedElements.fpsElement) {
  this.cachedElements.fpsElement.textContent = `${fps} FPS`;
}
```

**Impact**: Avoids DOM queries every frame.

### Visibility Culling (TextRenderer, GlassRenderer)

```typescript
// Only render text from visible panels
const visiblePanels = new Set<string>();
panelIds.forEach(panelId => {
  const panel = document.getElementById(panelId);
  if (panel && !panel.classList.contains('hidden')) {
    visiblePanels.add(panelId);
  }
});

this.textElements.forEach((config) => {
  if (visiblePanels.has(config.panelId)) {
    this.renderTextToCanvas(element, config);
  }
});
```

**Impact**: Reduces Canvas2D draw calls by ~60% during typical usage.

## Critical Implementation Notes

### Canvas2D State Management

**Problem**: Canvas2D state leakage between text renders.

**Solution**: Aggressive state reset + save/restore pattern.

```typescript
updateTextTexture() {
  const ctx = this.textCtx;

  // Clear canvas
  ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

  // CRITICAL: Reset global state
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;

  // Render each text element
  this.textElements.forEach((config, id) => {
    const element = document.getElementById(id);
    if (!element) return;

    // Save state before rendering
    ctx.save();

    // ... render text with element-specific styles

    // Restore state after rendering
    ctx.restore();
  });

  // Upload to WebGL
  gl.texImage2D(...);
}
```

### Framebuffer Ownership

**Problem**: Multiple renderers need to capture scenes without circular dependencies.

**Solution**: Each renderer owns its framebuffer and provides capture methods.

```typescript
// GlassRenderer owns oceanFramebuffer
class GlassRenderer {
  captureOceanScene(renderCallback: () => void) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);
    renderCallback();  // OceanRenderer draws ocean
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

// TextRenderer owns sceneFramebuffer
class TextRenderer {
  captureScene(renderCallback: () => void) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    renderCallback();  // OceanRenderer draws ocean + glass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
```

**Benefits**:
- Clear ownership boundaries
- No circular dependencies
- Easy to reason about render order

### Transition Timing

**Critical Requirements**:
1. CSS transition must complete (`transitionend`)
2. Browser must compute final styles (Frame 1)
3. Browser must paint final frame (Frame 2)
4. Text positions can be captured (Frame 3)

**Implementation**:

```typescript
onAllTransitionsComplete() {
  requestAnimationFrame(() => {  // Frame 1
    requestAnimationFrame(() => {  // Frame 2
      // Frame 3: Safe to capture
      this.textRenderer?.setTransitioning(false);
      this.textRenderer?.forceTextureUpdate();
    });
  });
}
```

**Why This Works**: Ensures text positions are captured after browser has fully rendered the final state, preventing mid-animation captures that would cause text to appear in wrong positions.

## File References

**Renderers**:
- src/renderer/OceanRenderer.ts - Pipeline orchestrator, lines 128-173 (renderOceanScene)
- src/renderer/WakeRenderer.ts - Independent R16F wake textures, lines 132-191 (resizeFramebuffer)
- src/renderer/GlassRenderer.ts - Liquid glass + blur map, lines 1-330 (complete)
- src/renderer/TextRenderer.ts - Adaptive text + layout detection, lines 1-600 (complete)
- src/renderer/VesselSystem.ts - Kelvin physics, lines 1-400 (complete)

**Shaders**:
- src/shaders/ocean.frag - Lines 88-100 (wake sampling), 162-184 (glass detection), 279-388 (main)
- src/shaders/wake.frag - Lines 61-197 (calculateVesselWake)
- src/shaders/glass.frag - Lines 114-308 (main with blur map modulation)
- src/shaders/text.frag - Lines 222-321 (main adaptive coloring)

**Components**:
- src/components/Panel.ts - Lines 120-261 (transition tracking system)
- src/components/Router.ts - Lines 75-103 (navigation handling)
- src/components/Navigation.ts - Lines 144-186 (keyboard shortcuts)

**Utilities**:
- src/utils/math.ts - Lines 174-257 (CubicSpline), 286-312 (ShearTransform2D)
- src/utils/PerformanceMonitor.ts - Lines 92-138 (endFrame, metrics)
- src/config/QualityPresets.ts - Lines 36-186 (QUALITY_PRESETS), 191-233 (detectOptimalQuality)

---

**End of CLAUDE.md**

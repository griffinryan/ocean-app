# CLAUDE.md

Project guidance for Claude Code.

## Project Overview

**Griffin Ryan's Portfolio** - WebGL2 ocean simulation with 3 novel rendering systems:

1. **Kelvin Wake Physics** - Accurate vessel wakes with progressive shear, golden ratio waves, state persistence
2. **Apple Liquid Glass** - Capture-based refraction, blur maps, liquid flow distortion
3. **Adaptive Text** - Canvas2D → WebGL with per-pixel coloring, CSS layout detection

**Stack**: TypeScript, WebGL2, GLSL ES 3.00, Vite, vanilla CSS

**Commands**: `npm run dev` (port 3000) | `npm run build` | `npm run preview`

## Architecture

```
App Layer: main.ts → Router → PanelManager → NavigationManager
              ↓
       OceanRenderer (orchestrator)
              ↓
    ┌─────────┼─────────┐
WakeRenderer  │  GlassRenderer  TextRenderer
  (R16F) ────┘    (blur map)    (layout detect)
              ↓
         Final Composite
```

**Pipeline**: Wake(R16F) → Ocean(samples wake) → Glass(distortion+blur) → Text(adaptive) → Final

**Files**:
```
src/
├── main.ts                    # 7-phase init
├── components/
│   ├── Router.ts              # Hash routing
│   ├── Panel.ts               # Transition tracking, 2-frame delay
│   └── Navigation.ts          # Keyboard shortcuts
├── renderer/
│   ├── OceanRenderer.ts       # Pipeline orchestrator, uniform cache
│   ├── WakeRenderer.ts        # R16F wake textures (0.25x-0.75x res)
│   ├── GlassRenderer.ts       # Liquid glass + blur map
│   ├── TextRenderer.ts        # Adaptive text + layout detection
│   ├── VesselSystem.ts        # Kelvin physics, 3 states
│   └── ShaderManager.ts       # Shader compilation
├── shaders/                   # GLSL ES 3.00
│   ├── ocean.frag             # Waves + wake sampling + glass detection
│   ├── wake.frag              # Kelvin wake (R16F output)
│   ├── glass.frag             # Liquid distortion + blur modulation
│   └── text.frag              # Adaptive coloring + intro animation
├── config/QualityPresets.ts   # 5 quality tiers
└── utils/
    ├── math.ts                # Vec3, Mat4, CubicSpline, ShearTransform2D
    └── PerformanceMonitor.ts  # FPS tracking, dynamic quality
```

## Rendering Pipeline

### Wake System (Independent R16F Texture)

**WakeRenderer** renders to R16F single-channel texture at configurable resolution (default 0.5x):
- **Performance**: 0.5x resolution = ~4× gain, linear upscaling maintains quality
- **Integration**: Ocean shader samples via `u_wakeTexture` uniform
- **Coordinates**: Converts ocean space [-15×aspect, 15] to UV [0,1]

```glsl
// ocean.frag: Wake sampling
float sampleWakeTexture(vec2 oceanPos) {
  vec2 wakeUV = vec2(
    (oceanPos.x / (15.0 * u_aspectRatio)) * 0.5 + 0.5,
    (oceanPos.y / 15.0) * 0.5 + 0.5
  );
  return texture(u_wakeTexture, wakeUV).r;
}
```

### Conditional Pipeline (8 Configurations)

Pipeline adapts based on enabled features:

| Features | Pipeline |
|----------|----------|
| Wake+Glass+Text+Blur | Wake → Ocean(cap) → Glass → Blur → Ocean+Glass(cap) → Text → Final |
| Wake+Glass+Text | Wake → Ocean(cap) → Glass → Ocean+Glass(cap) → Text → Final |
| Wake+Glass | Wake → Ocean(cap) → Glass → Final |
| Wake only | Wake → Ocean → Final |
| Glass+Text+Blur | Ocean(cap) → Glass → Blur → Ocean+Glass(cap) → Text → Final |
| Ocean only | Ocean → Final |

**See**: OceanRenderer.ts:128-173 (renderOceanScene) for full conditional logic

### Quality Presets

| Preset | Ocean | Wake | Glass | Text | Features |
|--------|-------|------|-------|------|----------|
| Ultra | 1.0x | 0.75x | 1.0x | 2160p | All |
| High | 0.75x | 0.5x | 0.75x | 1920p | All |
| Medium | 0.5x | 0.4x | 0.5x | 1920p | No wave reactivity |
| Low | 0.33x | 0.33x | 0.33x | 1280p | No caustics/blur |
| Potato | 0.25x | 0.25x | 0.25x | 1280p | Minimal |

**Auto-detection**: GPU check (RTX/M1/M2 → ultra/high, GTX/Intel → medium/low), screen res (4K → caps at high)

## Core Renderers

### OceanRenderer (Pipeline Orchestrator)

**Responsibilities**: Execute conditional pipeline, coordinate renderers, uniform caching, canvas resize

**Uniform Caching** (~15% CPU reduction):
```typescript
// Only update when values change
if (aspect !== this.uniformCache.lastAspectRatio) {
  this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
  this.uniformCache.lastAspectRatio = aspect;
}
```

**Glass-Aware Rendering**: Ocean shader detects glass panels, renders crystalline pattern underneath (solid blue vs. standard ocean)

### WakeRenderer (Independent Textures)

- **Format**: R16F single-channel (height values)
- **Resolution**: Independent scaling (0.25x-0.75x), linear filtering for smooth upscale
- **Setup**: `gl.R16F` format, `gl.LINEAR` filtering, framebuffer attachment
- **Integration**: Bound to ocean shader via `u_wakeTexture`

### GlassRenderer (Liquid + Blur Map)

**Transition Mode**: Continuous position updates during CSS transitions (RAF loop, handles transform changes that don't trigger ResizeObserver)

**Blur Map System**: Frosted glass around text
- Renders distance field from text positions
- Modulates glass distortion (reduce 60% in text regions)
- Boosts opacity (increase 30% in text regions)
- Adds frost tint (blue-white)

**Coordinate Mapping** (HTML → WebGL NDC):
```typescript
// getBoundingClientRect → [0,1] → [-1,1] with Y-flip
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;
```

### TextRenderer (Adaptive + Layout Detection)

**3 Layout Modes**:
1. Inline-flex: center/middle
2. Flex container: use alignItems/justifyContent
3. Standard flow: CSS text-align

**Visibility Culling**: Only render text from visible panels (~60% draw call reduction)

**Transition Blocking** (CRITICAL - 2-frame delay):
```typescript
onAllTransitionsComplete() {
  requestAnimationFrame(() => {        // Frame 1: styles computed
    requestAnimationFrame(() => {      // Frame 2: frame painted
      this.textRenderer?.setTransitioning(false);  // Frame 3: capture
      this.textRenderer?.forceTextureUpdate();
    });
  });
}
```

**Why**: Prevents capturing text mid-animation (would cause wrong positions)

**Intro Animation**: Wiggly multi-frequency sine wave distortion with cubic ease-out (text.frag)

### VesselSystem (Kelvin Wake Physics)

**Classes**: FAST_LIGHT (speedboat), FAST_HEAVY (cargo), SLOW_LIGHT (sailboat), SLOW_HEAVY (barge)

**State Machine**:
```
ACTIVE (1.0x intensity) → leaves screen → GHOST (0.7x, 10s) → FADING (5s) → REMOVED
```

**Wake Trail**: 150 points, 80-105 units distance based on weight

**Kelvin Mathematics** (wake.frag:61-197):
- **Progressive Shear**: `1.0 + 0.15 * log(1.0 + pathDistance * 0.1)` - wake curls over distance
- **Froude Number**: `vesselSpeed / sqrt(GRAVITY * hullLength)` - angle modifier
- **Golden Ratio Waves**: φ=1.618, 2 wave components (reduced from 3 for performance)
- **Simplified Decay**: `exp(-normalizedDistance * 2.5)` - optimized from cubic spline

## Shader Architecture

### ocean.frag (Lines 88-100, 162-184, 279-388)

**Features**: Wake texture sampling, glass detection (dual rendering paths), multi-layer caustics, Bayer dithering

**Glass Detection**:
```glsl
float isUnderGlass(vec2 screenPos) {
  for (int i = 0; i < u_glassPanelCount && i < 2; i++) {
    vec2 localPos = (screenPos - u_glassPanelPositions[i]) / u_glassPanelSizes[i];
    if (abs(localPos.x) < 0.6 && abs(localPos.y) < 0.6) return 1.0;
  }
  return 0.0;
}
// If under glass: solid dark blue (0.08, 0.12, 0.25)
// Else: standard ocean (waves, caustics, foam, quantization)
```

**Debug Modes**: D key cycles, 0-5 direct select (UV, height, normals, wake intensity, LOD visualization)

### wake.frag (Lines 61-197)

**Output**: R16F wake height

**Algorithm**: Calculate relative position → wake angle with progressive shear → wake arms with dynamic angle → decay → state intensity → wave synthesis (golden ratio patterns)

### glass.frag (Lines 114-308)

**Blur Map Modulation**:
```glsl
// Reduce distortion in text regions
effectiveDistortion *= (1.0 - blurIntensity * 0.6);
// Increase opacity for frost effect
alpha += blurIntensity * 0.3;
// Add frost tint
finalColor = mix(finalColor, vec3(0.92, 0.96, 1.0), blurIntensity * 0.12);
```

**Physics**: Snell's law refraction, multi-scale liquid flow (3 octaves), ripple patterns, chromatic aberration

### text.frag (Lines 222-321)

**Adaptive Coloring** (per-pixel):
```glsl
float luminance = dot(backgroundColor, vec3(0.299, 0.587, 0.200));
float colorMix = step(0.5, luminance);  // Binary threshold
vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);
```

**Panel Boundary Detection**: Only render text within panel bounds (discard otherwise)

## Component Architecture

### PanelManager (Panel.ts:120-261)

**Transition Tracking**: Monitors `transitionend` (transform property only), manages glass transition mode, enforces 2-frame delay before text capture

**State Machine**: 6 states (landing, app, portfolio, resume, paper, not-found)

**Flow**: Fade out (300ms) → Toggle hidden → Fade in (300ms) → Add active → transitionend → End glass mode → 2 frames → Unblock text

### Router (Router.ts:75-103)

Hash-based navigation, 5 routes, updates document.title, triggers PanelManager transitions

### NavigationManager (Navigation.ts:144-186)

**Shortcuts**: Ctrl+H/P/R (Home/Portfolio/Resume), Alt+←/→ (Prev/Next)

**Visibility**: Hide navbar on landing/not-found/paper, show on app/portfolio/resume

## Coordinate Systems

**5 Spaces**:
1. HTML Screen (top-left origin, Y down, pixels)
2. WebGL NDC (center origin, Y up, [-1,1])
3. Canvas2D Texture (top-left origin, Y down, pixels 1:1 with WebGL)
4. Ocean Simulation (center origin, Y up, [-30,30] units)
5. Panel Local (panel center origin, [0,1] UV)

**HTML → WebGL NDC**:
```typescript
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;  // Y-flip
```

**HTML → Canvas2D → WebGL**:
```typescript
// 1. Scale to Canvas2D coords
const textureX = screenX * (textCanvas.width / canvasRect.width);
// 2. Draw to Canvas2D
ctx.fillText(text, textureX, textureY);
// 3. Upload with Y-flip
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(..., textCanvas);
```

## State Flow

### Init (7 Phases)
1. UI Components (PanelManager → Router → NavigationManager)
2. WebGL Context (canvas → WebGL2 → extensions)
3. Quality Detection (auto-detect GPU/resolution)
4. Renderers (ShaderManager → VesselSystem → Wake/Ocean/Glass/Text)
5. Shader Compilation (load → compile → link)
6. Render Loop (requestAnimationFrame)
7. UI-Renderer Connection (enable features → bind → setup controls)

### Transition Flow
```
User → Router → hashchange → PanelManager.transitionTo()
  → Block text + Start glass transition mode
  → Fade out → Toggle hidden → Fade in → Add active
  → transitionend (transform only)
  → End glass mode → 2 frames → Unblock text
```

### Render Loop
```
Each Frame:
  VesselSystem.update()
  IF wakesEnabled: WakeRenderer.render() → R16F texture
  OceanRenderer.renderOceanScene() → Conditional pipeline
  FPS update
  requestAnimationFrame()
```

## CSS Integration

**WebGL Enhancement Pattern**:
- CSS Foundation: `.glass-panel` with `backdrop-filter: blur(20px)`
- WebGL Active: `.glass-panel.webgl-enhanced` removes CSS effects
- Text Hiding: `.webgl-text-enabled h1` sets `color: transparent` (elements remain in DOM for layout/a11y/SEO)

**Animations**: `fadeInUp`, `navbarSlideIn`, staggered portfolio delays (0s, 0.1s, 0.2s, ...)

**Responsive**: @media (max-width: 768px) adjusts navbar, content top, panel sizing

## Extension Patterns

**Add Glass Panel**:
```typescript
glassRenderer.addPanel('my-panel', {
  elementId: 'my-panel',
  distortionStrength: 0.4,
  refractionIndex: 1.52,
  size: new Float32Array([0, 0])  // Auto-updated
});
```

**Register Text Element**:
```typescript
this.textElements.set('my-title', {
  selector: '#my-panel h1',
  id: 'my-title',
  panelId: 'my-panel'
});
// System auto-handles: CSS inheritance, layout detection, positioning, adaptive coloring, animation
```

**Custom Quality Preset**: Create `QualitySettings` object with resolution scales, feature flags, upscale method

## Keyboard Controls

| Key | Action |
|-----|--------|
| F | Fullscreen |
| Esc | Exit fullscreen / Return to landing |
| D | Cycle debug modes (0-5) |
| 0-5 | Direct debug mode select |
| 5 | LOD visualization (green=high detail, red=low) |
| V | Toggle vessel wake system |
| G | Toggle glass rendering |
| T | Toggle adaptive text |
| Q | Cycle quality presets |
| Ctrl+H/P/R | Navigate Home/Portfolio/Resume |
| Alt+←/→ | Navigate Previous/Next |

## Performance Optimizations

1. **Pixel-Density Adaptive LOD** (ocean.frag, glass.frag): Automatic detail scaling based on screen-space derivatives
   - Uses `dFdx()/dFdy()` to measure ocean units per pixel
   - LOD 0 (high detail): 8 waves, 3 FBM octaves, full caustics/foam
   - LOD 1.5 (medium): 4-6 waves, 2 octaves, reduced effects
   - LOD 3+ (low detail): 2 waves, 1 octave, minimal effects
   - **Result**: 60-75% GPU reduction at 4K fullscreen, 30-40% at 1080p
   - **Debug Mode 5**: Visualize LOD (green=high detail, yellow=medium, red=low)

2. **Fast Sine Approximation** (ocean.frag): Bhaskara I polynomial for LOD ≥ 1.0
   - ~2× faster than native sin() with <0.002 error
   - Automatically used at medium-low detail levels

3. **Uniform Caching** (OceanRenderer): Only call WebGL setters when values change → ~15% CPU reduction

4. **Scene Capture Throttling** (TextRenderer): Max 60fps captures, skip if scene not dirty

5. **Wake Resolution Scaling**: 0.5x = ~4× gain (quadratic), linear upscaling maintains quality

6. **DOM Element Caching**: Cache `getElementById` results, reuse across frames

7. **Visibility Culling**: Only render text from visible panels → ~60% draw call reduction

## Critical Implementation Notes

### Canvas2D State Management

**Problem**: State leakage between text renders

**Solution**: Aggressive state reset + save/restore pattern
```typescript
updateTextTexture() {
  ctx.clearRect(...);
  // CRITICAL: Reset global state
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;

  this.textElements.forEach((config, id) => {
    ctx.save();
    // ... render text
    ctx.restore();
  });
}
```

### Framebuffer Ownership

**Problem**: Multiple renderers need scene captures without circular dependencies

**Solution**: Each renderer owns its framebuffer, provides capture methods
- GlassRenderer owns `oceanFramebuffer`, provides `captureOceanScene(callback)`
- TextRenderer owns `sceneFramebuffer`, provides `captureScene(callback)`
- **Benefits**: Clear ownership, no circular deps, easy to reason about render order

### Transition Timing (CRITICAL)

**Requirements**:
1. CSS transition completes (`transitionend`)
2. Browser computes final styles (Frame 1)
3. Browser paints final frame (Frame 2)
4. Text positions captured (Frame 3)

**Implementation**:
```typescript
onAllTransitionsComplete() {
  requestAnimationFrame(() => {      // Frame 1
    requestAnimationFrame(() => {    // Frame 2
      // Frame 3: Safe to capture
      this.textRenderer?.setTransitioning(false);
      this.textRenderer?.forceTextureUpdate();
    });
  });
}
```

**Why**: Prevents capturing text mid-animation (would cause wrong positions)

## File References

**Renderers**:
- OceanRenderer.ts:128-173 (renderOceanScene)
- WakeRenderer.ts:132-191 (resizeFramebuffer)
- GlassRenderer.ts:1-330 (complete)
- TextRenderer.ts:1-600 (complete)
- VesselSystem.ts:1-400 (complete)

**Shaders**:
- ocean.frag:88-100 (wake sampling), 162-184 (glass detection), 279-388 (main)
- wake.frag:61-197 (calculateVesselWake)
- glass.frag:114-308 (main with blur modulation)
- text.frag:222-321 (adaptive coloring)

**Components**:
- Panel.ts:120-261 (transition tracking)
- Router.ts:75-103 (navigation)
- Navigation.ts:144-186 (shortcuts)

**Utils**:
- math.ts:174-257 (CubicSpline), 286-312 (ShearTransform2D)
- PerformanceMonitor.ts:92-138 (endFrame, metrics)
- QualityPresets.ts:36-186 (QUALITY_PRESETS), 191-233 (detectOptimalQuality)

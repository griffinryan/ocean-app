# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development:**
- `npm install` or `yarn install` - Install dependencies
- `npm run dev` or `yarn dev` - Start Vite dev server with hot reload
- `npm run build` or `yarn build` - Type-check with `tsc` and build production bundle
- `npm run preview` or `yarn preview` - Preview production build locally

**TypeScript:**
- `tsc --noEmit` - Type-check without building (part of build pipeline)

## Architecture Overview

This is a WebGL-powered portfolio webapp featuring procedural ocean rendering with liquid glass distortion effects and adaptive text overlays. The core architecture uses a **3-stage multi-pass rendering pipeline**:

### Rendering Pipeline

**Stage 1: Ocean Pass**
- Procedural sine wave synthesis for ocean surface
- Vessel wake system with dynamic fluid simulation
- Fragment shader calculates wave heights and normals
- Output: Ocean scene rendered directly to screen

**Stage 2: Glass Pass** (if enabled via `glassEnabled`)
- Captures ocean scene to `GlassRenderer` framebuffer
- Re-renders ocean to screen
- For each visible glass panel:
  - Samples ocean texture with liquid distortion
  - Applies refraction, flow animations, and chromatic effects
  - Renders distorted panel as overlay within HTML element bounds
- Output: Ocean + Glass effects on screen

**Stage 3: Text Pass** (if enabled via `textEnabled`)
- Captures ocean+glass scene to `TextRenderer` framebuffer
- Rasterizes HTML text to Canvas2D, uploads to WebGL texture
- Shader performs per-pixel luminance analysis of background
- Outputs adaptive black/white text for optimal contrast
- Output: Ocean + Glass + Adaptive Text (final composite)

### Key Components

**`src/main.ts`** - Application entry point
- Bootstraps `OceanRenderer`, `PanelManager`, `Router`, `NavigationManager`
- Initializes shader programs and connects UI to WebGL
- Manages loading sequence (ocean-first progressive enhancement)
- Sets up keyboard controls: D (debug mode), V (wakes), G (glass), T (text), B (blur map), O (debug overlay)

**`src/renderer/OceanRenderer.ts`** - Central orchestrator
- Owns and coordinates sub-renderers: `GlassRenderer`, `TextRenderer`, `VesselSystem`, `WakeRenderer`
- Executes multi-pass framebuffer pipeline in `renderOceanScene()`
- Manages quality settings, performance monitoring, frame budgeting
- Implements uniform caching to reduce WebGL state changes (~60% reduction)
- Handles resolution scaling and upscaling via dedicated framebuffer

**`src/renderer/GlassRenderer.ts`** - Liquid glass distortion
- Maintains separate framebuffer to capture clean ocean (prevents recursive glass-on-glass)
- Converts HTML element positions (DOM pixels) to WebGL NDC coordinates
- Shader uses multi-scale noise + flowing ripples for organic liquid look
- Implements Snell's law for physically-based refraction
- Enforces strict boundary culling via fragment shader `discard` (glass stays within panel bounds)

**`src/renderer/TextRenderer.ts`** - Adaptive text overlay
- Two-texture system: scene capture (ocean+glass) + Canvas2D text rasterization
- Captures HTML text with CSS styles (font, size, weight) to Canvas2D
- Uploads Canvas2D bitmap to WebGL texture
- Shader calculates ITU-R BT.601 luminance (modified for ocean blue emphasis: `0.299R + 0.587G + 0.200B`)
- Applies binary threshold (luminance > 0.5 = black text, else white text)
- Visibility culling: only rasterizes text from non-hidden panels

**`src/renderer/VesselSystem.ts`** - Vessel wake simulation
- Manages autonomous vessels with configurable paths (circular, figure-8, linear)
- Generates wake trail points using fluid simulation
- Integrated with `WakeRenderer` for GPU-accelerated wake texture

**`src/renderer/WakeRenderer.ts`** - Wake texture generation
- Renders wake intensity maps to dedicated framebuffer
- Sampled by ocean shader to modulate wave heights

**`src/renderer/PipelineManager.ts`** - Render pipeline state machine
- Manages transitions between rendering configurations
- Coordinates framebuffer captures and sub-renderer execution order

**`src/components/PanelManager.ts`** - UI panel orchestration
- Manages panel visibility states: `landing`, `app`, `portfolio`, `resume`, `paper`, `not-found`
- Triggers glass/text renderer updates during CSS transitions
- Scroll tracking for continuous glass position synchronization
- Connects to `TextRenderer` and `GlassRenderer` for position/visibility updates

**`src/components/Router.ts`** - Hash-based routing
- Maps URL hashes to panel states
- Delegates state transitions to `PanelManager`

**`src/components/Navigation.ts`** - Navigation UI
- Manages navbar visibility based on panel state
- Synchronizes with routing and panel transitions

**`src/utils/FrameBudget.ts`** - Frame time budgeting
- Allocates CPU/GPU work within 16ms budget for 60 FPS
- Priority-based work scheduling (critical vs. deferrable)

**`src/utils/PerformanceMonitor.ts`** - Performance profiling
- Tracks frame time, GPU stalls, dropped frames
- Drives quality adjustments via `QualityManager`

**`src/config/QualityPresets.ts`** - Adaptive quality
- Presets: `high`, `medium`, `low`
- Adjusts resolution scale, wake trail length, effect complexity based on performance

### Coordinate Systems

**HTML DOM Coordinates:**
- Origin: top-left of viewport
- Units: pixels
- Y-axis: positive downward
- Range: `[0, viewportWidth] x [0, viewportHeight]`

**WebGL NDC (Normalized Device Coordinates):**
- Origin: center of screen
- Units: normalized -1 to 1
- Y-axis: positive upward
- Range: `[-1, 1] x [-1, 1]`

**Conversion (HTML → WebGL NDC):**
```typescript
// Step 1: Viewport space [0, 1]
centerX_viewport = (elementRect.centerX - canvasRect.left) / canvasRect.width
centerY_viewport = (elementRect.centerY - canvasRect.top) / canvasRect.height

// Step 2: NDC [-1, 1]
glX = centerX_viewport * 2 - 1
glY = (1 - centerY_viewport) * 2 - 1  // Flip Y-axis

// Step 3: Size in NDC
width_ndc = (elementRect.width / canvasRect.width) * 2
height_ndc = (elementRect.height / canvasRect.height) * 2
```

Implementation: `src/renderer/GlassRenderer.ts:469-499` (`htmlRectToNormalized()`)

### Shader Pipeline

**Shaders are imported as strings via `vite-plugin-glsl`:**
- `ocean.vert` / `ocean.frag` - Procedural ocean with sine wave synthesis
- `wake.vert` / `wake.frag` - Vessel wake rendering
- `glass.vert` / `glass.frag` - Liquid glass distortion with refraction
- `text.vert` / `text.frag` - Adaptive text with luminance analysis
- `blurmap.vert` / `blurmap.frag` - Frosted glass blur around text
- `upscale.vert` / `upscale.frag` - Framebuffer upscaling for performance

Shaders live in `src/shaders/` and are loaded in `src/main.ts`.

### Performance Optimizations

1. **Uniform Caching** (`OceanRenderer:64-71, 413-475`)
   - Cache last-set uniform values, only call `gl.uniform*()` on change
   - Reduces WebGL state changes by ~60%

2. **Scene Capture Throttling** (`TextRenderer`)
   - Throttle framebuffer captures to 60 FPS max (16ms)
   - 3x reduction in framebuffer binds

3. **Visibility Culling**
   - Only render/rasterize content for visible panels
   - Glass panels with `.hidden` class are skipped
   - Text from hidden panels not rasterized to Canvas2D

4. **Shared Ocean Buffer** (`OceanRenderer:87-89`)
   - Render ocean once to shared framebuffer
   - Glass and text renderers sample shared texture
   - Eliminates redundant ocean draws (3x → 1x per frame)

5. **ResizeObserver** (not `window.resize`)
   - Only resize framebuffers on actual canvas size change
   - Avoids spurious resize events

### Debug Controls (Keyboard)

**General:**
- `F` - Toggle fullscreen
- `Escape` - Exit fullscreen / Return to landing

**Debug Modes:**
- `D` - Cycle debug modes (0-4)
- `0` - Normal rendering
- `1` - UV coordinates
- `2` - Wave height (grayscale)
- `3` - Normal vectors (RGB)
- `4` - Wake intensity map

**Effects Toggle:**
- `V` - Toggle vessel wake system
- `G` - Toggle glass panel rendering
- `T` - Toggle text rendering
- `B` - Toggle blur map (frosted glass)
- `O` - Toggle debug overlay

**Blur Tuning:**
- `N` / `M` - Decrease/increase blur radius (20-256px)
- `,` / `.` - Decrease/increase falloff power (0.5-5.0)

### Integration Notes

**CSS Class Markers:**
- `.webgl-enhanced` - Added to panels when glass rendering is enabled (`PanelManager.enableWebGLDistortion()`)
- `.webgl-text-enabled` - Added when text rendering is enabled (CSS hides DOM text: `opacity: 0`)
- `.hidden` - Used for visibility culling (glass/text renderers skip these panels)

**Event Flow:**
```
User navigation → Router.navigateToRoute()
                → PanelManager.transitionTo(newState)
                → Panel CSS transition start
                → GlassRenderer.startTransitionMode() (frequent updates)
                → TextRenderer.setTransitioning(true) (block captures)
                → CSS transition end
                → GlassRenderer.endTransitionMode()
                → TextRenderer.setTransitioning(false) + forceTextureUpdate()
```

**Loading Sequence:**
Phase 1: Ocean renders immediately (CSS hidden)
Phase 2: Shaders load in background
Phase 3: Glass effects fade in (300ms)
Phase 4: Text fades in with stagger (300ms + 50ms stagger per element)

Implementation: `src/components/LoadingSequence.ts`

### Common Patterns

**Adding a new glass panel:**
1. Add HTML element with unique ID and `.glass-panel` class
2. Register in `GlassRenderer.panels` Map with `GlassPanelConfig`
3. Add to `PanelManager` visibility tracking (if it's a routable panel)

**Adding text elements:**
1. Add HTML element with unique selector
2. Register in `TextRenderer.textElements` Map with `TextElementConfig` (must include `panelId` for visibility culling)
3. Text positions auto-captured from DOM via `getBoundingClientRect()`

**Modifying the render pipeline:**
- Pipeline logic lives in `OceanRenderer.renderOceanScene()` (lines 348-407)
- Each stage: capture to framebuffer → render to screen → next stage samples previous texture
- Order matters: Glass needs clean ocean, Text needs ocean+glass

### Important Technical Details

**Framebuffer Completeness:**
- Texture format: `gl.RGBA` with `gl.UNSIGNED_BYTE`
- Depth buffer: `gl.DEPTH_COMPONENT24`
- Always verify `gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE`

**Text Rasterization:**
- Canvas2D dimensions match WebGL canvas exactly (1:1 pixel mapping)
- Uses `getComputedStyle()` to extract CSS font properties
- Accounts for padding, borders, flexbox centering
- `imageSmoothingEnabled = false` for crisp text

**Glass Boundary Enforcement:**
- Panel UV calculation in fragment shader: `panelUV = (screenUV - panelCenter) / panelHalfSize + 0.5`
- Strict discard: `if (panelUV.x < 0 || panelUV.x > 1 || ...) discard;`
- Prevents glass effects bleeding outside HTML element bounds

**Refraction Index:**
- Implementation uses `u_refractionIndex = 1.52` (crown glass)
- Snell's law: `eta * incident + (eta * cosI - cosT) * normal`
- Total internal reflection handled when `sinT² > 1`

### Performance Targets

- **60 FPS** on desktop (high quality preset)
- **30 FPS** on mobile (low quality preset with reduced resolution scale)
- Frame budget: 16ms for 60 FPS, work prioritized by `FrameBudget`
- Adaptive quality: `PerformanceMonitor` triggers quality downgrades on sustained < 55 FPS

### Documentation References

For deeper technical details, see:
- **`RENDER.md`** - Complete 3-stage pipeline documentation (coordinates, shaders, framebuffers)
- **`OPTIMIZATION.md`** - Performance optimization strategies (if exists)
- **`AGENTS.md`** - AI agent integration notes (if relevant)

### Repository Structure

```
src/
├── main.ts                      # Entry point, initialization, keyboard controls
├── renderer/                    # WebGL rendering subsystems
│   ├── OceanRenderer.ts         # Central orchestrator
│   ├── GlassRenderer.ts         # Liquid glass distortion
│   ├── TextRenderer.ts          # Adaptive text overlay
│   ├── VesselSystem.ts          # Vessel wake simulation
│   ├── WakeRenderer.ts          # Wake texture generation
│   ├── PipelineManager.ts       # Render pipeline state
│   ├── ShaderManager.ts         # Shader compilation & uniforms
│   ├── Geometry.ts              # Buffer management
│   └── ParticleSystem.ts        # (if used)
├── components/                  # UI management
│   ├── Panel.ts                 # Panel state & transitions
│   ├── Router.ts                # Hash routing
│   ├── Navigation.ts            # Navbar visibility
│   └── LoadingSequence.ts       # Progressive enhancement
├── utils/                       # Shared utilities
│   ├── FrameBudget.ts           # Frame time budgeting
│   ├── PerformanceMonitor.ts    # Performance profiling
│   ├── ScrollTracker.ts         # Scroll-based updates
│   └── math.ts                  # Matrix operations
├── config/
│   └── QualityPresets.ts        # Adaptive quality settings
├── shaders/                     # GLSL shader source
│   ├── ocean.{vert,frag}
│   ├── glass.{vert,frag}
│   ├── text.{vert,frag}
│   ├── wake.{vert,frag}
│   ├── blurmap.{vert,frag}
│   └── upscale.{vert,frag}
└── styles/                      # CSS (not tracked here)

public/                          # Static assets (fonts, models)
dist/                            # Production build output
```

### TypeScript Configuration

- Target: ES2020
- Module: ESNext with bundler resolution
- Strict mode enabled (`strict: true`)
- No unused locals/parameters enforced
- Source in `src/**/*`, output in `dist/`

### Dependencies

**Production:**
- Vite 7.1.7 (dev server & build)
- TypeScript 5.9.2
- `vite-plugin-glsl` 1.5.1 (shader imports)

**No runtime dependencies** - pure WebGL2 + vanilla TypeScript.

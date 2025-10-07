# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
yarn install        # Install dependencies
yarn dev           # Start development server (port 3000, auto-opens browser)
yarn build         # Type-check with tsc, then build production bundle
yarn preview       # Preview production build from dist/
```

## Architecture Overview

This is a WebGL-based portfolio webapp featuring procedural ocean rendering with multi-pass rendering pipeline for glass distortion effects and adaptive text overlays.

### Core Rendering Pipeline (3-Stage)

The application uses a **multi-pass framebuffer pipeline** orchestrated by `OceanRenderer`:

1. **Ocean Pass**: Procedural wave synthesis using sine waves + vessel wakes
2. **Glass Pass** (optional): Captures ocean scene to framebuffer, applies liquid glass distortion to HTML panel regions
3. **Text Pass** (optional): Captures ocean+glass scene, rasterizes HTML text to Canvas2D texture, renders with adaptive black/white contrast based on background luminance

**Key Files:**
- `src/renderer/OceanRenderer.ts` - Central orchestrator, manages render loop and sub-renderers
- `src/renderer/GlassRenderer.ts` - Liquid glass distortion with framebuffer capture
- `src/renderer/TextRenderer.ts` - Adaptive text rendering via Canvas2D → WebGL texture pipeline
- `src/renderer/VesselSystem.ts` - Vessel wake simulation system
- `src/renderer/ShaderManager.ts` - Shader compilation and uniform management

### Coordinate System Architecture

**Critical**: Two coordinate spaces require careful conversion:

1. **HTML DOM Coordinates**: Origin at top-left, Y-axis down, units in pixels
2. **WebGL NDC**: Origin at center, Y-axis UP, range [-1, 1] × [-1, 1]

**Conversion (see `GlassRenderer.ts:469-499`):**
```typescript
// HTML → WebGL NDC
const centerX_viewport = ((elementRect.left + elementRect.width/2) - canvasRect.left) / canvasRect.width;
const centerY_viewport = ((elementRect.top + elementRect.height/2) - canvasRect.top) / canvasRect.height;
const glX = centerX_viewport * 2.0 - 1.0;
const glY = (1.0 - centerY_viewport) * 2.0 - 1.0;  // Y-axis flip
```

The Y-axis flip is critical: HTML increases downward, WebGL increases upward. See `coordinate-analysis.md` for detailed explanation.

### UI Components & State Management

- `src/main.ts` - Bootstrap entry point, initializes all systems
- `src/components/Panel.ts` - Panel visibility management and transitions (23KB file with extensive state machine)
- `src/components/Router.ts` - Hash-based routing, integrates with PanelManager
- `src/components/Navigation.ts` - Navigation bar state sync with panel visibility
- `src/components/LoadingSequence.ts` - Ocean-first loading with staggered glass/text fade-ins

**State Flow**: Router → PanelManager → Navigation → WebGL renderers update panel positions

### Utilities

- `src/utils/FrameBudget.ts` - Frame time budgeting for performance
- `src/utils/ScrollTracker.ts` - Scroll-based interaction tracking
- `src/utils/PanelLayoutTracker.ts` - HTML element position tracking for WebGL sync
- `src/utils/PerformanceMonitor.ts` - FPS and performance metrics
- `src/utils/math.ts` - Vector/matrix math helpers

### Shader Pipeline

Shaders live in `src/shaders/` and are imported as strings via `vite-plugin-glsl`:

- `ocean.{vert,frag}` - Sine wave synthesis with multi-layer waves
- `glass.{vert,frag}` - Liquid glass distortion with refraction (Snell's law)
- `text.{vert,frag}` - Adaptive text color based on background luminance
- `wake.{vert,frag}` - Vessel wake rendering
- `blurmap.{vert,frag}` - Blur map generation
- `upscale.{vert,frag}` - Upscaling pass

## Performance Patterns

### Uniform Caching
`OceanRenderer` caches uniform values to avoid redundant WebGL calls (see `OceanRenderer.ts:64-71, 413-475`). Only call `gl.uniform*()` when values change. This reduces state changes by ~60%.

### Scene Capture Throttling
`TextRenderer` throttles framebuffer captures to 60fps max via `captureThrottleMs` (see `TextRenderer.ts:270-307`). Reduces framebuffer binds by 3x.

### Visibility Culling
Both `GlassRenderer` and `TextRenderer` only render visible panels by checking `!element.classList.contains('hidden')`. Text is only rasterized to Canvas2D for visible panels.

### ResizeObserver Pattern
Use `ResizeObserver` instead of window resize events for canvas resizing. Only triggers on actual size changes, not every window event.

## Common Workflows

### Adding a New Shader
1. Create `{name}.vert` and `{name}.frag` in `src/shaders/`
2. Import in `src/main.ts`: `import {name}VertexShader from './shaders/{name}.vert'`
3. Register with `ShaderManager` in renderer initialization
4. `vite-plugin-glsl` handles bundling automatically

### Debugging Rendering Issues
- Press `D` to cycle debug modes (0-4): normal, UV, wave height, normals, wake intensity
- Press `G` to toggle glass rendering
- Press `T` to toggle text rendering
- Press `V` to toggle vessel wakes
- Check browser console for framebuffer status errors

### Coordinate Conversion Debugging
If glass panels or text appear misaligned:
1. Log `getBoundingClientRect()` values vs computed WebGL positions
2. Verify canvas rect matches actual viewport size (check `devicePixelRatio`)
3. Remember Y-axis flip: `glY = (1.0 - y_viewport) * 2.0 - 1.0`
4. See `RENDER.md` sections on coordinate systems and common issues

## Important Implementation Details

### Framebuffer Isolation
Each renderer owns its framebuffer to prevent render order dependencies:
- `GlassRenderer` captures clean ocean (no glass recursion)
- `TextRenderer` captures combined ocean+glass for accurate background analysis
- Never share framebuffers between renderers

### Canvas2D → WebGL Texture Pipeline
`TextRenderer` uses Canvas2D as intermediate for HTML text rendering:
1. Query HTML element styles (font, size, alignment) via `getComputedStyle`
2. Render text to Canvas2D with proper layout (flexbox, padding, borders)
3. Upload canvas to WebGL texture via `gl.texImage2D(..., canvas)`
4. Sample in shader with adaptive luminance-based coloring

**Critical**: Canvas2D (0,0) at top-left maps to WebGL texture UV (0,1) due to Y-axis flip. Full-screen quad UV must account for this.

### Panel Boundary Enforcement
Glass and text effects must stay within HTML element bounds. Shaders use strict boundary checks:
```glsl
vec2 panelUV = deltaFromCenter / panelHalfSize + 0.5;
if (panelUV.x < 0.0 || panelUV.x > 1.0 ||
    panelUV.y < 0.0 || panelUV.y > 1.0) {
  discard;
}
```

## Key Technical Documentation

- **`RENDER.md`** - Comprehensive rendering pipeline documentation (1178 lines)
  - Detailed coordinate system math
  - Shader algorithms and physics formulas
  - Performance optimization strategies
  - Debugging guide with common issues
- **`AGENTS.md`** - Agent-based development guidelines
- **`coordinate-analysis.md`** - In-depth Y-axis flipping and coordinate conversion
- **`performance-test.md`** - Performance benchmarks
- **`text-positioning-fix-summary.md`** - Historical text positioning fixes

## Git Branch Context

Main branch: `main`
Current branch: `one-coords`

Recent focus: coordinate system fixes, positioning with navbar/blur effects, FPS optimization

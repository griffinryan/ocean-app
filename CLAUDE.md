# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ocean Portfolio is a WebGL-powered portfolio webapp featuring a real-time ocean simulation with advanced rendering effects. The app uses TypeScript, WebGL2, and custom GLSL shaders to create an interactive "liquid glass" UI experience.

## Build & Development Commands

```bash
# Development server (auto-opens on localhost:3000)
npm run dev

# Production build (TypeScript compilation + Vite build)
npm run build

# Preview production build
npm run preview
```

Note: The project uses `npm` (not `yarn` despite what the README says - package.json defines npm scripts).

## Architecture Overview

### Core Rendering Pipeline

The app uses a **multi-pass rendering pipeline** orchestrated by `OceanRenderer`:

1. **Ocean Base Pass** → Renders animated ocean surface with sine wave compositing
2. **Wake Pass** → Renders vessel wake system to independent texture (WakeRenderer)
3. **Glass Pass** → Captures ocean + applies distortion effects for UI panels (GlassRenderer)
4. **Text Pass** → Renders adaptive text overlay with distortion (TextRenderer)
5. **Blur Map Pass** → Generates distance field for frosted glass effect around text
6. **Final Composite** → Upscales and composites all layers with FSR/bicubic filtering

All passes support **independent resolution scaling** via QualityPresets for adaptive performance.

### Key Systems

**OceanRenderer** (`src/renderer/OceanRenderer.ts`)
- Central renderer coordinating all rendering subsystems
- Manages WebGL2 context, shader compilation, and frame loop
- Owns shared ocean framebuffer to eliminate redundant ocean draws (3x → 1x per frame optimization)
- Handles quality management and adaptive performance via FrameBudgetManager

**PipelineManager** (`src/renderer/PipelineManager.ts`)
- Pre-warms shader variants and framebuffers for instant pipeline switching
- Supports crossfade transitions between pipeline states
- Registers common variants: `ocean`, `ocean-wakes`, `full`, `full-no-blur`, etc.

**Quality & Performance System**
- `QualityPresets` defines presets: ultra/high/medium/low/potato with resolution scales and feature flags
- `FrameBudgetManager` enforces 16.67ms frame budget with work priority system (CRITICAL → OPTIONAL)
- `PerformanceMonitor` tracks FPS, frame drops, and triggers adaptive quality adjustments
- Each subsystem (wakes, glass, text, blur) can be independently scaled or disabled

**VesselSystem** (`src/renderer/VesselSystem.ts`)
- Manages vessel fleet with path following and wake generation
- Vessels have configurable classes (destroyer, cargo, etc.) with different wake characteristics
- Physics simulation includes drag, buoyancy, and wave reactivity

**UI Components**
- `PanelManager` manages panel state machine and transitions (landing → app/portfolio/resume/paper)
- `Router` handles URL routing and panel state synchronization
- `NavigationManager` controls navbar visibility based on panel state
- `LoadingSequence` orchestrates progressive enhancement during app initialization

### Shader Pipeline

All shaders are in `src/shaders/` and loaded via `vite-plugin-glsl`:

- `ocean.{vert,frag}` - Main ocean surface with composite sine waves
- `wake.{vert,frag}` - Vessel wake rendering to texture
- `glass.{vert,frag}` - Glass distortion effects for UI panels
- `text.{vert,frag}` - Adaptive text rendering with distortion
- `blurmap.{vert,frag}` - Distance field generation for frosted glass effect
- `upscale.{vert,frag}` - Final upscaling pass with FSR/bicubic filtering

### Important Implementation Details

**Initialization Sequence** (`src/main.ts:46-122`)
The app uses an **ocean-first loading sequence** to ensure the ocean renders immediately while other systems load progressively:

1. Initialize UI components (panels, router, navigation)
2. Create OceanRenderer and LoadingSequence
3. Initialize all shaders (ocean, wake, glass, text, blur, upscale)
4. **Connect UI to renderer BEFORE starting render loop** to prevent visual "jump"
5. Start rendering (enables ocean)
6. Wait for landing panel CSS animation to complete (~1.2s)
7. Start loading sequence for progressive enhancement

**Critical Timing:** Text positions must NOT be captured during the landing panel's `fadeInUp` animation. TextRenderer is blocked via `setTransitioning(true)` until the animation completes.

**Glass Renderer Integration** (`src/main.ts:170-203`)
Glass and text renderers connect to PanelManager for position updates during transitions. PanelManager calls `markPositionsDirty()` and manages transition states to keep effects synchronized with CSS animations.

**Shared Ocean Buffer Optimization** (`src/renderer/OceanRenderer.ts:86-89`)
The ocean is rendered once per frame to a shared framebuffer, then sampled by glass/text passes. This eliminates redundant ocean draws (3x → 1x per frame).

## Debug Controls

Press `O` to toggle debug overlay. Available hotkeys:

- `D` / `0-4` - Cycle/select debug modes (Normal, UV Coords, Wave Height, Normals, Wake Map)
- `V` - Toggle vessel wake system
- `G` - Toggle glass panel rendering
- `T` - Toggle text rendering
- `B` - Toggle blur map (frosted glass)
- `N` / `M` - Decrease/increase blur radius
- `,` / `.` - Decrease/increase blur falloff power
- `F` - Toggle fullscreen
- `Escape` - Exit fullscreen

## Common Development Patterns

**Adding a new rendering effect:**
1. Create shader files in `src/shaders/`
2. Import shaders in `src/main.ts` and pass to `renderer.initializeShaders()`
3. Create dedicated renderer class (e.g., `NewEffectRenderer`) following pattern of `WakeRenderer`
4. Add framebuffer initialization and resolution scaling support
5. Register in `PipelineManager` variants if it affects pipeline states
6. Add quality preset controls in `QualityPresets.ts`
7. Wire up to `FrameBudgetManager` with appropriate WorkPriority

**Modifying ocean wave simulation:**
Edit `src/shaders/ocean.frag`. The composite wave formula is documented in README:
- Primary Wave: `y₁ = A·sin(kx - ωt + φ)`
- Inverse Wave: `y₂ = -A·sin(kx - ωt + φ + π)`
- Composite includes interference term

**Adjusting performance:**
Modify `QualityPresets.ts` resolution scales or feature flags. The system will automatically adapt framebuffer sizes and shader complexity. Consider adding work to `FrameBudgetManager` for temporal amortization.

## Project Structure Notes

- Uses Vite with TypeScript (tsconfig follows ES modules with `"type": "module"`)
- No test infrastructure currently exists
- No linting configuration (no ESLint/Prettier)
- Single-page app with hash-based routing via Router component
- All rendering logic in `src/renderer/`, UI components in `src/components/`, utilities in `src/utils/`

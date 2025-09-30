# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Griffin Ryan's Portfolio Website** - An interactive personal portfolio built on a real-time WebGL2 ocean simulation. Features liquid glass UI panels with distortion effects, per-pixel adaptive text rendering, and vessel wake simulation with Kelvin wave physics.

**Tech Stack**: TypeScript, WebGL2, GLSL shaders, Vite, vanilla CSS

## Development Commands

- `npm run dev` - Start development server on port 3000 with hot reloading
- `npm run build` - Build production version (TypeScript → Vite bundle)
- `npm run preview` - Preview built application

## Architecture

### Application Structure

```
src/
├── main.ts                  # Entry point, app lifecycle
├── components/              # UI component system
│   ├── Router.ts           # Hash-based SPA routing
│   ├── Panel.ts            # Panel state management
│   └── Navigation.ts       # Navbar controls
├── renderer/                # WebGL rendering systems
│   ├── OceanRenderer.ts    # Main rendering pipeline
│   ├── GlassRenderer.ts    # Glass distortion overlay
│   ├── TextRenderer.ts     # Adaptive text rendering
│   ├── VesselSystem.ts     # Wake simulation
│   ├── ShaderManager.ts    # Shader compilation
│   └── Geometry.ts         # Buffer management
├── shaders/                 # GLSL shaders (.vert/.frag)
├── styles/                  # CSS (liquid-glass.css)
└── utils/                   # Math utilities (Vec3, Mat4)
```

### Rendering Pipeline (3-Stage)

**OceanRenderer** orchestrates a multi-pass rendering pipeline:

1. **Ocean Pass** → Framebuffer
   - Render procedural ocean waves to texture
   - Sine wave synthesis + vessel wakes

2. **Glass Pass** → Framebuffer (if enabled)
   - Capture ocean texture
   - Apply distortion effects per glass panel
   - Render combined ocean+glass to texture

3. **Text Pass** → Screen (if enabled)
   - Capture ocean+glass scene
   - Rasterize text to Canvas2D texture
   - Render with per-pixel adaptive shader

**Key**: Each renderer captures the previous stage to framebuffer. Final composite renders to screen.

## Component System

### Router (`src/components/Router.ts`)
- Hash-based SPA routing (`#app`, `#portfolio`, `#resume`)
- Maps routes to panel states
- Updates document title and meta tags

### PanelManager (`src/components/Panel.ts`)
- Controls visibility of glass panels (landing, app, portfolio, resume)
- Handles CSS transitions and WebGL enhancement flags
- Manages panel-specific event handlers

### NavigationManager (`src/components/Navigation.ts`)
- Apple-style navbar with glassmorphism
- Appears/hides based on panel state (hidden on landing)
- Keyboard shortcuts: Ctrl+H (home), Ctrl+P (portfolio), Ctrl+R (resume)
- Arrow navigation with Alt+Left/Right

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
| **Space** | Reserved for future use |
| **Ctrl+H/P/R** | Navigate to Home/Portfolio/Resume |
| **Alt+←/→** | Navigate previous/next panel |

### Debug Modes
- **0**: Normal rendering
- **1**: UV coordinates
- **2**: Wave height visualization
- **3**: Normal vectors
- **4**: Wake intensity map

## Rendering Systems

### Ocean Renderer (`src/renderer/OceanRenderer.ts`)

**Primary rendering engine:**
- Full-screen quad screen-space rendering
- Manages all sub-renderers (Glass, Text, Vessel)
- Responsive canvas with device pixel ratio scaling
- Performance tracking with FPS counter

**Coordinate System:**
- WebGL: Normalized device coordinates (-1 to 1, origin center)
- HTML: Pixel coordinates (0 to viewport size, origin top-left)
- Conversion: `htmlRectToNormalized()` in GlassRenderer/TextRenderer

### Glass Renderer (`src/renderer/GlassRenderer.ts`)

**Liquid glass distortion system:**
- Captures ocean scene to framebuffer texture
- Renders distorted glass panels as overlays
- Maps HTML element positions → WebGL UV space via `getBoundingClientRect()`
- Per-panel distortion strength, refraction index

**Adding New Panels:**
1. Create HTML element with `.glass-panel` class
2. Add to `setupDefaultPanels()` with position/size config
3. Update `updatePanelPositions()` to track new element ID

### Text Renderer (`src/renderer/TextRenderer.ts`)

**Per-pixel adaptive text coloring:**
- Rasterizes text to Canvas2D (respects CSS styles: font, size, line-height)
- Captures ocean+glass scene to framebuffer
- WebGL shader samples background luminance per text pixel
- Outputs black or white text for optimal contrast

**NOT CSS variable injection** - Uses WebGL shader for per-pixel adaptation.

**Text Positioning:**
- Reads HTML element geometry via `getComputedStyle()` and `getBoundingClientRect()`
- Handles flexbox centering, padding, borders, text-align
- Converts screen coordinates → Canvas2D texture → WebGL shader

**Adding New Text:**
```typescript
textRenderer.addTextElement('my-text', {
  selector: '#my-element',
  panelId: 'my-panel'  // Associates text with panel for visibility culling
});
```

### Vessel System (`src/renderer/VesselSystem.ts`)

**Ship wake simulation with Kelvin wave physics:**
- Spawns vessels at ocean edges with random trajectories
- Generates curling wake trails with progressive shear deformation
- 4 vessel classes: Fast/Slow × Light/Heavy (weight, speed, hull length)
- Wake decay via spline-controlled intensity function
- States: Active (on-screen) → Ghost (off-screen) → Fading

**Wake Physics:**
- Kelvin angle: ~19.47° wake cone
- Progressive shear: Wake curls outward over time
- Wavelet decay: Gaussian-like intensity falloff

**Configuration:** Modify `VesselConfig` in OceanRenderer constructor for vessel count, spawn rate, wake length.

## Shader Architecture

### Ocean Shader (`src/shaders/ocean.frag`)
- Procedural sine wave synthesis (multiple wave layers)
- Vessel wake integration via uniform arrays
- Kelvin wake pattern generation
- Normal calculation from height gradients
- Caustics, foam, stylized quantization

### Glass Shader (`src/shaders/glass.frag`)
- Liquid glass flow animations
- Multi-layer distortion (chromatic aberration, Fresnel)
- UV boundary enforcement (0-1 range)
- Soft edge fading for seamless compositing

### Text Shader (`src/shaders/text.frag`)
- Per-pixel background luminance sampling
- Binary threshold (luminance > 0.5 → black, else white)
- Alpha blending for smooth text edges
- Panel boundary masking

## Technical Notes

### Coordinate Mapping (HTML ↔ WebGL)

**HTML → WebGL conversion:**
```typescript
// Center position in NDC (-1 to 1)
const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;
const glX = centerX * 2.0 - 1.0;
const glY = (1.0 - centerY) * 2.0 - 1.0;  // Flip Y-axis

// Size in NDC
const width = (elementRect.width / canvasRect.width) * 2.0;
const height = (elementRect.height / canvasRect.height) * 2.0;
```

### Framebuffer Strategy

**Each renderer owns its framebuffer:**
- GlassRenderer: Captures ocean for distortion
- TextRenderer: Captures ocean+glass for background analysis
- No shared framebuffers to avoid render order dependencies

**Performance:**
- Scene captures throttled to 60fps max
- Hidden panels skipped in render loop
- Text texture updates only when DOM changes

### Wave Simulation Parameters

**Sine wave layers:**
- Wavelengths: 2.5 - 10 units
- Amplitudes: 0.08 - 0.4 units
- Speeds: 0.8 - 2.2 units/sec
- Multiple directional waves create interference patterns

**Vessel wakes:**
- Max 5 active vessels
- Wake trail: 150 points per vessel
- Wake decay: 35 seconds
- Shear rate: 0.15 (curling intensity)

## Development Patterns

### Adding a New Panel State

1. Update `PanelState` type in `Panel.ts`
2. Add route in `Router.initializeRoutes()`
3. Create HTML panel element with `.glass-panel` class
4. Add to `GlassRenderer.setupDefaultPanels()` for distortion
5. Update `NavigationManager.updateVisibilityForPanelState()` for navbar visibility

### Debugging Rendering Issues

- Use **D** key to cycle debug modes (UV, normals, height)
- Check browser console for WebGL errors
- Verify framebuffer completeness status
- Use **G/T** keys to isolate glass/text rendering bugs
- Check coordinate mapping with `console.debug()` in `htmlRectToNormalized()`

### Performance Optimization

- Minimize uniform updates: `uniformCache` in OceanRenderer
- Throttle scene captures: `captureThrottleMs` in TextRenderer
- Cull hidden panels: Check `.hidden` class before rendering
- Reduce wake points for lower-end devices
- Disable glass/text on mobile via feature detection

## CSS Integration

**Liquid Glass CSS** (`src/styles/liquid-glass.css`):
- CSS custom properties for theming
- Backdrop-filter blur for glassmorphism
- Animation classes: `.fade-in`, `.fade-out`, `.hidden`
- Responsive breakpoints for mobile

**WebGL Enhancement:**
- Panels marked with `.webgl-enhanced` class
- CSS text hidden when WebGL text enabled (`.webgl-text-enabled`)
- Fallback: Pure CSS glassmorphism if WebGL unavailable

## Build Configuration

**Vite Config** (`vite.config.ts`):
- `vite-plugin-glsl` imports shaders as strings
- Dev server on port 3000
- Build target: `esnext`
- Shader hot reloading enabled
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server on port 3000 with hot reloading
- `npm run build` - Build production version (TypeScript compilation + Vite build)
- `npm run preview` - Preview built application

## Architecture Overview

This is a WebGL2-based ocean simulation and rendering application built with TypeScript and Vite. The application uses shader-based rendering for real-time ocean wave simulation with procedural wave generation.

### Core Components

**Main Application (`src/main.ts`)**
- Entry point that initializes the `OceanApp` class
- Handles canvas setup, shader initialization, and application lifecycle
- Provides keyboard controls for debug modes and fullscreen
- Controls: F (fullscreen), D (cycle debug modes), 0-3 (select debug mode), Space (reserved)

**Ocean Renderer (`src/renderer/OceanRenderer.ts`)**
- Main WebGL2 rendering engine that manages the full rendering pipeline
- Uses full-screen quad rendering for screen-space ocean effects
- Implements responsive canvas resizing with device pixel ratio support
- Manages view/projection matrices, animation timing, and performance tracking
- Provides 4 debug modes: Normal, UV Coords, Wave Height, Normals

**Shader Management (`src/renderer/ShaderManager.ts`)**
- Centralized WebGL shader program compilation and management
- Handles uniform and attribute location caching
- Provides type-safe uniform setting methods

**Geometry System (`src/renderer/Geometry.ts`)**
- Contains `GeometryBuilder` for creating rendering primitives
- `BufferManager` handles WebGL buffer operations and vertex attribute setup
- Currently creates full-screen quads for screen-space rendering

**Particle System (`src/renderer/ParticleSystem.ts`)**
- GPU-based particle system for ocean foam and spray effects
- Uses transform feedback and texture-based particle data storage
- Implements double-buffered ping-pong rendering for particle updates
- Note: Particle system is implemented but not currently integrated into main renderer

**Glass Renderer (`src/renderer/GlassRenderer.ts`)**
- WebGL2-based liquid glass panel system with real-time distortion effects
- Captures ocean scene to framebuffer for distortion mapping
- Maps HTML element positions to WebGL coordinates for precise boundary control
- Supports multiple panels with individual distortion settings

**Text Color Analyzer (`src/renderer/TextRenderer.ts`)**
- Background-aware adaptive text coloring system
- Analyzes ocean+glass scene colors via WebGL framebuffer readback
- Dynamically sets CSS custom properties for text colors
- Throttled GPU readback (150ms intervals) for performance
- Falls back to CSS `mix-blend-mode: difference` if custom properties unsupported
- No WebGL text rendering - uses native CSS text with adaptive colors

**Math Utilities (`src/utils/math.ts`)**
- Contains matrix math classes (`Mat4`, `Vec3`) for 3D transformations
- Provides helper functions for WebGL matrix operations

### Shader Architecture

**Ocean Vertex Shader (`src/shaders/ocean.vert`)**
- Simple pass-through shader for full-screen quad rendering
- Calculates screen coordinates and passes time/UV data to fragment shader

**Ocean Fragment Shader (`src/shaders/ocean.frag`)**
- Contains the main ocean wave simulation logic using sine wave functions
- Implements procedural wave height calculation with multiple wave layers
- Features normal calculation from height derivatives for lighting
- Includes caustics effects, foam generation, and stylized color quantization
- Supports 4 debug visualization modes

**Glass Fragment Shader (`src/shaders/glass.frag`)**
- Liquid glass surface simulation with flowing animations and multi-layer distortion
- Strict boundary enforcement (0.0-1.0 UV range) with soft edge fading
- Chromatic aberration, Fresnel reflections, and caustic light patterns
- Real-time coordinate mapping from HTML element bounds to shader UV space

### Technical Details

- Uses Vite with `vite-plugin-glsl` for shader file imports as strings
- WebGL2 context with high-performance preference and antialiasing
- Screen-space rendering approach eliminates need for complex 3D geometry
- All wave math happens in fragment shader for maximum detail
- Responsive design with ResizeObserver for efficient canvas resizing

### Wave Simulation

The ocean uses layered sine waves with different:
- Wavelengths (2.5-10 units)
- Amplitudes (0.08-0.4 units)
- Directions (various normalized vectors)
- Speeds (0.8-2.2 units/time)

Wave height is calculated by summing multiple sine wave functions, creating realistic interference patterns. Normals are derived from height gradients for lighting calculations.

## Glass Panel System

### Adding New Glass Panels

1. **HTML Structure**: Create panel with `.glass-panel` class and unique ID
2. **CSS Styling**: Define panel positioning, size, and visual properties in `liquid-glass.css`
3. **Glass Renderer Integration**:
   - Add panel config in `GlassRenderer.setupDefaultPanels()`
   - Update `updatePanelPositions()` to track new element ID
   - Ensure panel has valid `getBoundingClientRect()` dimensions

### Key Implementation Details

- **Boundary Enforcement**: Glass effect strictly contained within HTML element bounds (0.0-1.0 UV range)
- **Coordinate Mapping**: HTML DOM coordinates automatically converted to WebGL space
- **Performance**: Uses framebuffer capture for ocean distortion with single full-screen quad render
- **Responsiveness**: Real-time position updates via `ResizeObserver` and `getBoundingClientRect()`

## Adaptive Text Coloring System

### Architecture

The text coloring system uses WebGL to analyze background colors and CSS to render text:

1. **Scene Capture**: Ocean+glass scene rendered to framebuffer texture
2. **Color Analysis**: GPU readback samples pixels at text element positions
3. **Color Calculation**: Luminance threshold determines black vs. white text
4. **CSS Injection**: Colors applied via `--adaptive-text-color` custom property
5. **Fallback**: CSS `mix-blend-mode: difference` for older browsers

### How It Works

```typescript
// TextRenderer analyzes background
const bgColor = analyzeBackgroundColor(element); // GPU readback
const textColor = calculateAdaptiveColor(bgColor); // luminance > 0.5 ? black : white

// Apply to CSS
element.style.setProperty('--adaptive-text-color', textColor);
```

CSS receives the color:
```css
.glass-panel h1 {
  color: var(--adaptive-text-color, rgba(255, 255, 255, 0.95));
  transition: color 0.2s ease-out;
}
```

### Performance Optimizations

- **Throttling**: Color updates every 150ms (not every frame)
- **Sampling**: 5x5 pixel grid averaged per element
- **Viewport Culling**: Hidden elements skipped
- **Caching**: Scene capture throttled to 60fps max

### Adding New Text Elements

To track new text elements for adaptive coloring:

```typescript
textRenderer.addTextElement('my-element-id', {
  position: [0, 0],
  size: [1, 0.2],
  selector: '#my-element',  // CSS selector
  color: 'white',            // Fallback
  panelId: 'my-panel'
});
```

Or add to `setupDefaultTextElements()` in `TextRenderer.ts`.
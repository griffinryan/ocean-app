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
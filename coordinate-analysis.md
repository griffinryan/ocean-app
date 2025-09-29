# Coordinate System Analysis for TextRenderer Fix

## Current Problem
- Text appears upside down (Y-axis flipped)
- Text positioning is incorrect
- Font sizing and spacing issues
- Line breaks not working properly

## Coordinate System Flow

### 1. HTML Element Position (Browser Space)
- **Origin**: Top-left of viewport (0,0)
- **Direction**: X increases right, Y increases down
- **Range**: [0, viewport.width] × [0, viewport.height]
- **getBoundingClientRect()** returns these coordinates

### 2. WebGL NDC (Normalized Device Coordinates)
- **Origin**: Center of screen (0,0)
- **Direction**: X increases right, Y increases UP (opposite of HTML!)
- **Range**: [-1, 1] × [-1, 1]
- **Bottom-left**: (-1, -1)
- **Top-right**: (1, 1)

### 3. Canvas 2D Context (Text Rendering)
- **Origin**: Top-left (0,0) - same as HTML
- **Direction**: X increases right, Y increases down
- **Range**: [0, canvas.width] × [0, canvas.height]

### 4. WebGL Texture Coordinates (UV)
- **Origin**: Bottom-left (0,0) - OPPOSITE of Canvas!
- **Direction**: U increases right, V increases UP
- **Range**: [0, 1] × [0, 1]

## The Core Issue

### GlassRenderer (Working Correctly)
1. HTML rect → WebGL NDC:
   - `glY = (1.0 - centerY) * 2.0 - 1.0` (flips Y correctly)
2. In shader, uses panel position/size directly
3. Calculates UV relative to panel: `panelUV = deltaFromCenter / panelHalfSize + 0.5`

### TextRenderer (Currently Broken)
1. HTML rect → WebGL NDC (same as Glass - this part is OK)
2. WebGL NDC → Canvas 2D for text drawing:
   - `canvasY = (1.0 - (config.position[1] + 1.0) * 0.5) * height`
   - This double-flips the Y coordinate!
3. Canvas texture → WebGL texture:
   - Canvas (0,0) at top-left maps to UV (0,1) in WebGL
   - Canvas (w,h) at bottom-right maps to UV (1,0) in WebGL
4. Full-screen quad UV mapping:
   - Bottom-left vertex: position (-1,-1), UV (0,0)
   - Top-right vertex: position (1,1), UV (1,1)

## The Flipping Problem

When we render text to Canvas:
- Canvas Y=0 is at top
- WebGL texture V=0 is at bottom
- The texture gets flipped when uploaded to WebGL

When sampling in shader:
- v_uv comes from the full-screen quad
- v_uv (0,0) corresponds to bottom-left of screen
- But our text was rendered with (0,0) at top-left

## Solution Strategy

### Option 1: Fix UV Coordinates in Full-Screen Quad
- Flip V coordinates: (0,0) → (0,1), (1,1) → (1,0)
- This makes UV match Canvas orientation

### Option 2: Fix Canvas Rendering Position
- Render text with Y coordinate flipped in canvas
- Account for the texture flip that will happen

### Option 3: Individual Text Quads (Like Glass Panels)
- Create a quad for each text element
- Position each quad at the correct screen location
- Sample text texture with proper UV mapping per element

### Option 4: Fix Texture Sampling in Shader
- Calculate correct UV coordinates based on text position
- Map screen position to text texture correctly
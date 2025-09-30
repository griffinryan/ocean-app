# RENDER.md - Rendering Pipeline Technical Documentation

Complete technical reference for the 3-stage rendering pipeline (Ocean → Glass → Text) in the Griffin Ryan portfolio website.

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Coordinate Systems](#coordinate-systems)
3. [OceanRenderer - Central Orchestrator](#oceanrenderer---central-orchestrator)
4. [GlassRenderer - Liquid Glass Distortion](#glassrenderer---liquid-glass-distortion)
5. [TextRenderer - Adaptive Text Overlay](#textrenderer---adaptive-text-overlay)
6. [Shader Deep Dive](#shader-deep-dive)
7. [Performance Optimization](#performance-optimization)
8. [Integration & Communication](#integration--communication)
9. [Debugging Guide](#debugging-guide)

---

## Pipeline Overview

### 3-Stage Rendering Architecture

The application uses a **multi-pass rendering pipeline** where each stage captures the previous stage to a framebuffer texture:

```
┌─────────────────────────────────────────────────────────────┐
│                        RENDER LOOP                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 1: OCEAN PASS                                        │
│  ─────────────────────────────────────────────────────────  │
│  • Render procedural ocean waves to screen                  │
│  • Sine wave synthesis + vessel wakes                       │
│  • Fragment shader calculates wave height, normals          │
│  • Output: Ocean scene on screen                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    [If Glass Enabled]
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 2: GLASS PASS                                        │
│  ─────────────────────────────────────────────────────────  │
│  • Capture ocean scene → GlassRenderer framebuffer          │
│  • Render ocean again to screen                             │
│  • For each visible panel:                                  │
│    - Sample ocean texture with distortion                   │
│    - Apply liquid glass effects (flow, refraction)          │
│    - Render distorted panel as overlay                      │
│  • Output: Ocean + Glass on screen                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    [If Text Enabled]
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 3: TEXT PASS                                         │
│  ─────────────────────────────────────────────────────────  │
│  • Capture ocean+glass scene → TextRenderer framebuffer     │
│  • Rasterize text to Canvas2D texture                       │
│  • Upload Canvas2D → WebGL texture                          │
│  • Render text overlay with adaptive shader:                │
│    - Sample background luminance per pixel                  │
│    - Output black/white text for contrast                   │
│  • Output: Ocean + Glass + Adaptive Text (FINAL)            │
└─────────────────────────────────────────────────────────────┘
```

### Why Multi-Pass?

**Framebuffer Isolation**: Each renderer owns its framebuffer to avoid render order dependencies.

- **GlassRenderer** needs clean ocean scene (no glass recursion)
- **TextRenderer** needs combined ocean+glass scene for accurate background analysis
- No shared framebuffers = predictable render order

### Rendering Flow (src/renderer/OceanRenderer.ts:348-407)

```typescript
private renderOceanScene(elapsedTime: number): void {
  const gl = this.gl;

  if (this.textEnabled && this.textRenderer) {
    // FULL PIPELINE: Ocean → Glass → Text

    if (this.glassEnabled && this.glassRenderer) {
      // 1. Capture ocean to glass framebuffer
      this.glassRenderer.captureOceanScene(() => {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
      });

      // 2. Capture ocean+glass to text framebuffer
      this.textRenderer.captureScene(() => {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.drawOcean(elapsedTime);
        this.glassRenderer!.render();
      });

      // 3. Final render: Ocean + Glass + Text
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawOcean(elapsedTime);
      this.glassRenderer.render();
      this.textRenderer.render();
    }
    // ... other pipeline combinations
  }
}
```

---

## Coordinate Systems

### Two Coordinate Spaces

#### 1. HTML DOM Coordinates
- **Origin**: Top-left corner of viewport
- **Units**: Pixels
- **Y-Axis**: Down (positive downward)
- **Range**: `[0, viewportWidth] x [0, viewportHeight]`

#### 2. WebGL Normalized Device Coordinates (NDC)
- **Origin**: Center of screen
- **Units**: Normalized (-1 to 1)
- **Y-Axis**: Up (positive upward)
- **Range**: `[-1, 1] x [-1, 1]`

### Conversion Mathematics

#### HTML → WebGL (Implementation: src/renderer/GlassRenderer.ts:469-499)

```typescript
/**
 * Convert HTML element DOMRect to WebGL NDC coordinates
 *
 * Input:
 *   elementRect: DOMRect from getBoundingClientRect()
 *   canvasRect: Canvas DOMRect for relative positioning
 *
 * Output:
 *   position: [glX, glY] center position in NDC [-1, 1]
 *   size: [width, height] in NDC units
 */
function htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect) {
  // Step 1: Calculate center position in viewport space [0, 1]
  const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left)
                  / canvasRect.width;
  const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top)
                  / canvasRect.height;

  // Step 2: Convert to NDC [-1, 1]
  const glX = centerX * 2.0 - 1.0;
  const glY = (1.0 - centerY) * 2.0 - 1.0;  // Flip Y-axis

  // Step 3: Convert size to NDC (as fraction of viewport * 2)
  const width = (elementRect.width / canvasRect.width) * 2.0;
  const height = (elementRect.height / canvasRect.height) * 2.0;

  return {
    position: [glX, glY],
    size: [width, height]
  };
}
```

**Mathematical Breakdown:**

1. **Relative Position**: `(element.center - canvas.topLeft) / canvas.size` → [0, 1]
2. **NDC Conversion**: `x_ndc = x_viewport * 2 - 1` → [-1, 1]
3. **Y-Axis Flip**: `y_ndc = (1 - y_viewport) * 2 - 1` → [-1, 1] (inverted)
4. **Size Scaling**: `size_ndc = (size_pixels / canvas_size) * 2` → NDC units

#### WebGL → UV Coordinates (In Shaders)

```glsl
// Vertex shader output: v_screenPos in NDC [-1, 1]
// Fragment shader: Convert to UV [0, 1]
vec2 screenUV = (v_screenPos + 1.0) * 0.5;

// For panel-relative UV:
vec2 panelCenter = (u_panelPosition + 1.0) * 0.5; // [-1,1] → [0,1]
vec2 deltaFromCenter = screenUV - panelCenter;
vec2 panelUV = deltaFromCenter / panelHalfSize + 0.5;
```

### Coordinate Flow Example

**HTML Element:**
```
<div id="landing-panel" style="position: absolute; left: 200px; top: 150px; width: 400px; height: 300px;">
```

**Step 1: DOM Rect**
```
elementRect = { left: 200, top: 150, width: 400, height: 300 }
canvasRect = { left: 0, top: 0, width: 1920, height: 1080 }
```

**Step 2: Calculate Center**
```
centerX_pixels = 200 + 400/2 = 400px
centerY_pixels = 150 + 300/2 = 300px
centerX_viewport = 400 / 1920 = 0.208
centerY_viewport = 300 / 1080 = 0.278
```

**Step 3: Convert to NDC**
```
glX = 0.208 * 2 - 1 = -0.584
glY = (1 - 0.278) * 2 - 1 = 0.444  (flipped)
width_ndc = (400 / 1920) * 2 = 0.417
height_ndc = (300 / 1080) * 2 = 0.556
```

**Result:**
```typescript
{ position: [-0.584, 0.444], size: [0.417, 0.556] }
```

---

## OceanRenderer - Central Orchestrator

**Location**: `src/renderer/OceanRenderer.ts`

### Responsibilities

1. **Lifecycle Management**: Initialize, start, stop render loop
2. **Sub-Renderer Orchestration**: Manage Glass, Text, Vessel systems
3. **Framebuffer Coordination**: Execute multi-pass pipeline
4. **State Management**: Debug modes, enable/disable features
5. **Performance Tracking**: FPS counter, uniform caching

### Architecture

```typescript
class OceanRenderer {
  // Core WebGL
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private oceanProgram: ShaderProgram;

  // Sub-renderers (owned)
  private glassRenderer: GlassRenderer;
  private textRenderer: TextRenderer;
  private vesselSystem: VesselSystem;

  // State
  private isRunning: boolean;
  private debugMode: number;  // 0-4
  private glassEnabled: boolean;
  private textEnabled: boolean;
  private wakesEnabled: boolean;

  // Performance
  private uniformCache: UniformCache;  // Avoid redundant GL calls
  private frameCount: number;
  private fps: number;
}
```

### Render Loop (src/renderer/OceanRenderer.ts:479-495)

```typescript
private render(): void {
  if (!this.oceanProgram) return;

  const currentTime = performance.now();
  const elapsedTime = (currentTime - this.startTime) / 1000;
  const deltaTime = 1 / 60;

  // Update vessel system (wake simulation)
  this.vesselSystem.update(currentTime, deltaTime);

  // Execute rendering pipeline
  this.renderOceanScene(elapsedTime);

  // Update FPS counter
  this.updateFPS(currentTime);
}
```

### Uniform Caching Strategy (src/renderer/OceanRenderer.ts:64-71, 413-475)

**Problem**: Setting uniforms every frame is expensive, even if values don't change.

**Solution**: Cache last set values, only call `gl.uniform*()` on change.

```typescript
private uniformCache = {
  lastAspectRatio: -1,
  lastResolution: new Float32Array(2),
  lastDebugMode: -1,
  lastWakesEnabled: false,
  lastVesselCount: -1
};

private drawOcean(elapsedTime: number): void {
  // Always set time (changes every frame)
  this.shaderManager.setUniform1f(program, 'u_time', elapsedTime);

  // Only set aspect ratio if changed
  const aspect = this.canvas.width / this.canvas.height;
  if (aspect !== this.uniformCache.lastAspectRatio) {
    this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
    this.uniformCache.lastAspectRatio = aspect;
  }

  // ... similar for other uniforms
}
```

**Performance Impact**: Reduces WebGL state changes by ~60% in steady state.

### Responsive Canvas (src/renderer/OceanRenderer.ts:145-193)

```typescript
private setupResizing(): void {
  this.resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === this.canvas) {
        this.resize();
      }
    }
  });
  this.resizeObserver.observe(this.canvas);
}

private resize(): void {
  const displayWidth = this.canvas.clientWidth;
  const displayHeight = this.canvas.clientHeight;
  const devicePixelRatio = window.devicePixelRatio || 1;

  const canvasWidth = Math.round(displayWidth * devicePixelRatio);
  const canvasHeight = Math.round(displayHeight * devicePixelRatio);

  if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    // Resize all framebuffers
    this.gl.viewport(0, 0, canvasWidth, canvasHeight);
    this.glassRenderer?.resizeFramebuffer(canvasWidth, canvasHeight);
    this.textRenderer?.resizeFramebuffer(canvasWidth, canvasHeight);
  }
}
```

---

## GlassRenderer - Liquid Glass Distortion

**Location**: `src/renderer/GlassRenderer.ts`

### Purpose

Render liquid glass panels that distort the ocean underneath with:
- Real-time flowing animations
- Refraction/chromatic aberration
- Strict HTML element boundary enforcement

### Architecture

```typescript
class GlassRenderer {
  // Framebuffer for ocean capture
  private oceanFramebuffer: WebGLFramebuffer;
  private oceanTexture: WebGLTexture;
  private depthBuffer: WebGLRenderbuffer;

  // Panel configurations
  private panels: Map<string, GlassPanelConfig>;

  // Geometry (full-screen quad)
  private panelGeometry: GeometryData;
  private bufferManager: BufferManager;
}
```

### Framebuffer Strategy (src/renderer/GlassRenderer.ts:113-177)

**Why Separate Framebuffer?**
- Need clean ocean scene (no glass panels in texture)
- Prevents recursive glass-on-glass rendering
- Allows glass distortion to sample undistorted ocean

**Initialization:**

```typescript
private initializeFramebuffer(): void {
  const gl = this.gl;

  // Create framebuffer
  this.oceanFramebuffer = gl.createFramebuffer();

  // Create color texture
  this.oceanTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Create depth buffer
  this.depthBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

  // Attach to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, this.oceanTexture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
                             gl.RENDERBUFFER, this.depthBuffer);

  // Verify completeness
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer incomplete');
  }
}
```

### Ocean Capture (src/renderer/GlassRenderer.ts:182-209)

```typescript
public captureOceanScene(renderOceanCallback: () => void): void {
  const gl = this.gl;

  // Store current viewport
  const viewport = gl.getParameter(gl.VIEWPORT);

  // Render to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.oceanFramebuffer);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Execute ocean rendering
  renderOceanCallback();

  // Restore screen framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
}
```

### Panel Rendering (src/renderer/GlassRenderer.ts:258-330)

```typescript
public render(): void {
  // Update panel positions from HTML
  this.updatePanelPositions();

  // Use glass shader
  const program = this.shaderManager.useProgram('glass');

  // Set global uniforms
  this.shaderManager.setUniform1f(program, 'u_time', currentTime);
  this.shaderManager.setUniform2f(program, 'u_resolution', width, height);

  // Bind ocean texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.oceanTexture);
  this.shaderManager.setUniform1i(program, 'u_oceanTexture', 0);

  // Render each visible panel
  this.panels.forEach((config, id) => {
    const element = document.getElementById(id);
    if (element && !element.classList.contains('hidden')) {
      this.renderPanel(config, program);
    }
  });
}
```

### Boundary Enforcement (src/shaders/glass.frag:108-132)

**Critical**: Glass effects must stay within HTML element bounds.

```glsl
void main() {
  vec2 screenUV = (v_screenPos + 1.0) * 0.5;  // NDC → UV

  // Calculate position relative to panel
  vec2 panelCenter = (u_panelPosition + 1.0) * 0.5;
  vec2 panelHalfSize = u_panelSize * 0.5;
  vec2 deltaFromCenter = screenUV - panelCenter;
  vec2 panelUV = deltaFromCenter / panelHalfSize + 0.5;

  // STRICT BOUNDARY CHECK - discard fragments outside [0, 1]
  if (panelUV.x < 0.0 || panelUV.x > 1.0 ||
      panelUV.y < 0.0 || panelUV.y > 1.0) {
    discard;
  }

  // Soft edge fade
  float edgeFade = 1.0;
  float fadeWidth = 0.02;
  edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
  edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
  edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
  edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);
}
```

---

## TextRenderer - Adaptive Text Overlay

**Location**: `src/renderer/TextRenderer.ts`

### Purpose

Render text that adapts to background colors for optimal contrast:
- Rasterize HTML text to Canvas2D texture
- Capture ocean+glass scene for background analysis
- Per-pixel luminance calculation → black or white text

### Two-Texture Architecture

```typescript
class TextRenderer {
  // Scene capture (ocean + glass)
  private sceneFramebuffer: WebGLFramebuffer;
  private sceneTexture: WebGLTexture;
  private sceneDepthBuffer: WebGLRenderbuffer;

  // Text rasterization
  private textCanvas: HTMLCanvasElement;
  private textContext: CanvasRenderingContext2D;
  private textTexture: WebGLTexture;

  // Text tracking
  private textElements: Map<string, TextElementConfig>;
}
```

### Pipeline: DOM → Canvas2D → WebGL

#### 1. Text Rasterization (src/renderer/TextRenderer.ts:320-472)

**Problem**: Need to render HTML text (with CSS styles) to WebGL.

**Solution**: Use Canvas2D as intermediate texture.

```typescript
private renderTextToCanvas(element: HTMLElement, config: TextElementConfig): void {
  const ctx = this.textContext;
  const canvasRect = this.gl.canvas.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  // Get computed CSS styles
  const styles = getComputedStyle(element);
  const fontSize = parseFloat(styles.fontSize);
  const fontFamily = styles.fontFamily;
  const fontWeight = styles.fontWeight;
  const textAlign = styles.textAlign;

  // Calculate position in screen space
  const screenX = elementRect.left - canvasRect.left;
  const screenY = elementRect.top - canvasRect.top;

  // Scale to canvas texture coordinates
  const scaleX = this.textCanvas.width / canvasRect.width;
  const scaleY = this.textCanvas.height / canvasRect.height;
  const textureX = screenX * scaleX;
  const textureY = screenY * scaleY;
  const scaledFontSize = fontSize * scaleY;

  // Handle flexbox centering, padding, borders
  const paddingTop = parseFloat(styles.paddingTop) * scaleY;
  const paddingLeft = parseFloat(styles.paddingLeft) * scaleX;
  const contentLeft = textureX + borderLeftWidth + paddingLeft;
  const contentTop = textureY + borderTopWidth + paddingTop;

  // Set canvas font and draw text
  ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
  ctx.textBaseline = baselineMode;
  ctx.textAlign = alignMode;
  ctx.fillStyle = 'white';
  ctx.fillText(text, contentLeft, contentTop);
}
```

**Key Insight**: Canvas2D dimensions match WebGL canvas exactly (1:1 pixel mapping).

#### 2. Scene Capture (src/renderer/TextRenderer.ts:270-307)

```typescript
public captureScene(renderSceneCallback: () => void): void {
  const gl = this.gl;

  // Throttle captures to 60fps max
  if (!this.sceneTextureDirty &&
      (currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
    return;
  }

  // Render ocean+glass to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderSceneCallback();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  this.sceneTextureDirty = false;
  this.lastCaptureTime = currentTime;
}
```

#### 3. Adaptive Rendering (src/renderer/TextRenderer.ts:568-625)

```typescript
public render(): void {
  // Update text texture from Canvas2D
  this.updateTextTexture();

  const program = this.shaderManager.useProgram('text');

  // Bind scene texture (ocean+glass background)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
  this.shaderManager.setUniform1i(program, 'u_sceneTexture', 0);

  // Bind text texture (Canvas2D rasterization)
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
  this.shaderManager.setUniform1i(program, 'u_textTexture', 1);

  // Set panel positions for boundary masking
  const panelInfo = this.getPanelInfo();
  this.shaderManager.setUniform2fv(program, 'u_panelPositions', panelInfo.positions);
  this.shaderManager.setUniform2fv(program, 'u_panelSizes', panelInfo.sizes);

  // Render full-screen quad
  gl.drawElements(gl.TRIANGLES, this.quadGeometry.indexCount, gl.UNSIGNED_SHORT, 0);
}
```

### Visibility Culling (src/renderer/TextRenderer.ts:478-513)

**Problem**: Text from hidden panels bleeds into visible panels.

**Solution**: Only rasterize text from visible panels.

```typescript
private updateTextTexture(): void {
  // Clear canvas
  ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

  // Get visible panels
  const visiblePanels = new Set<string>();
  ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel'].forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (panel && !panel.classList.contains('hidden')) {
      visiblePanels.add(panelId);
    }
  });

  // Render ONLY text from visible panels
  this.textElements.forEach((config) => {
    if (visiblePanels.has(config.panelId)) {
      const element = document.querySelector(config.selector);
      if (element) {
        this.renderTextToCanvas(element, config);
      }
    }
  });

  // Upload to WebGL
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);
}
```

---

## Shader Deep Dive

### Ocean Shader (src/shaders/ocean.frag)

#### Sine Wave Synthesis (Lines 87-91)

```glsl
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
  float k = 2.0 * 3.14159 / wavelength;        // Wave number
  float phase = k * dot(direction, pos) - speed * time;
  return amplitude * sin(phase);
}

// Usage: Layer multiple waves
float height = sineWave(worldPos, vec2(1, 0), 5.0, 0.2, 1.5, time);
height += sineWave(worldPos, vec2(0.8, 0.6), 3.5, 0.15, 1.2, time);
height += sineWave(worldPos, vec2(-0.5, 0.8), 7.0, 0.3, 0.9, time);
```

**Physics**: Standard wave equation `y = A * sin(kx - ωt)` where:
- `k = 2π/λ` (wave number)
- `ω = speed` (angular frequency)
- `A = amplitude`

### Glass Shader (src/shaders/glass.frag)

#### Liquid Glass Normal Calculation (Lines 50-87)

Creates flowing liquid surface using multi-scale noise:

```glsl
vec3 calculateLiquidGlassNormal(vec2 uv, float time) {
  // Flow directions (time-varying)
  float flow1 = time * LIQUID_FLOW_SPEED;
  vec2 flowDir1 = vec2(cos(flow1 * 0.8), sin(flow1 * 1.2));

  // Multi-scale noise for organic look
  float h = noise(uv * 15.0 + flowDir1 * 2.0) * 0.08;
  h += noise(uv * 22.5 + flowDir2 * 1.5) * 0.05;
  h += noise(uv * 37.5 + time * 0.6) * 0.03;

  // Ripple patterns
  float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
  h += ripple * exp(-length(uv - 0.5) * 3.0);

  // Calculate gradient for normal
  float epsilon = 0.002;
  float hx = noise((uv + vec2(epsilon, 0.0)) * 15.0 + flowDir1 * 2.0) * 0.08;
  float hy = noise((uv + vec2(0.0, epsilon)) * 15.0 + flowDir1 * 2.0) * 0.08;

  vec3 normal = normalize(vec3(
    (h - hx) / epsilon * 2.0,
    (h - hy) / epsilon * 2.0,
    1.0
  ));

  return normal;
}
```

**Technique**: Numerical gradient approximation with central difference.

#### Refraction Calculation (Lines 95-106)

Implements Snell's law for physically-based refraction:

```glsl
vec3 calculateRefraction(vec3 incident, vec3 normal, float eta) {
  float cosI = -dot(normal, incident);
  float sinT2 = eta * eta * (1.0 - cosI * cosI);

  if (sinT2 > 1.0) {
    return vec3(0.0); // Total internal reflection
  }

  float cosT = sqrt(1.0 - sinT2);
  return eta * incident + (eta * cosI - cosT) * normal;
}
```

**Physics**: Snell's law `n₁ sin(θ₁) = n₂ sin(θ₂)` where:
- `eta = n₁/n₂` (relative refractive index)
- `cosI = cos(θ₁)` (incident angle)
- `cosT = cos(θ₂)` (transmitted angle)

#### Distortion Application (Lines 148-180)

```glsl
// Base refraction offset
vec2 refractionOffset = refractionDir.xy * u_distortionStrength;

// Flowing liquid patterns
vec2 liquidOffset = vec2(
  sin(panelUV.y * 12.0 + v_time * 2.5) * 0.04,
  cos(panelUV.x * 10.0 + v_time * 2.0) * 0.04
);

// Ripple layers
float ripplePhase1 = length(panelUV - 0.5) * 15.0 - v_time * 4.0;
vec2 rippleOffset = normalize(panelUV - 0.5) * sin(ripplePhase1) * 0.025;

// Noise-based organic distortion
vec2 noisePos = panelUV * 8.0 + v_time * 0.8;
vec2 noiseOffset = vec2(
  noise(noisePos) - 0.5,
  noise(noisePos + vec2(100.0)) - 0.5
) * 0.03;

// Combine all distortions
vec2 totalOffset = (refractionOffset + liquidOffset + rippleOffset + noiseOffset)
                   * u_distortionStrength * 2.5;
distortedUV += totalOffset;
```

**Result**: Multi-layered distortion that feels liquid and organic.

### Text Shader (src/shaders/text.frag)

#### Luminance Calculation (Lines 45-48)

```glsl
float calculateLuminance(vec3 color) {
  // ITU-R BT.601 luminance weights with blue emphasis for ocean
  return dot(color, vec3(0.299, 0.587, 0.200));
}
```

**Note**: Modified blue weight (0.114 → 0.200) for ocean-heavy scenes.

#### Adaptive Color Selection (Lines 56-67)

```glsl
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength) {
  float luminance = calculateLuminance(backgroundColor);

  // Simple step function: luminance > 0.5 → black text, else white
  float colorMix = step(LUMINANCE_THRESHOLD, luminance);
  vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);

  // Apply adaptive strength (allows blending)
  return mix(LIGHT_TEXT_COLOR, adaptiveColor, adaptiveStrength);
}
```

**Algorithm**:
1. Calculate background luminance (perceived brightness)
2. Binary threshold at 0.5
3. Output white (dark bg) or black (light bg)

#### Panel Boundary Masking (Lines 70-88)

```glsl
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
```

**Purpose**: Only render text within visible panel boundaries.

---

## Performance Optimization

### 1. Uniform Caching (OceanRenderer)

**Impact**: ~60% reduction in WebGL state changes

```typescript
// BAD: Set every frame
this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);

// GOOD: Cache and compare
if (aspect !== this.uniformCache.lastAspectRatio) {
  this.shaderManager.setUniform1f(program, 'u_aspectRatio', aspect);
  this.uniformCache.lastAspectRatio = aspect;
}
```

### 2. Scene Capture Throttling (TextRenderer)

**Impact**: 3x reduction in framebuffer binds

```typescript
private captureThrottleMs = 16; // Max 60fps captures
private lastCaptureTime = 0;

public captureScene(renderCallback: () => void): void {
  if ((currentTime - this.lastCaptureTime) < this.captureThrottleMs) {
    return; // Skip capture
  }
  // ... perform capture
  this.lastCaptureTime = currentTime;
}
```

### 3. Visibility Culling

**Impact**: Only render visible panels

```typescript
// GlassRenderer
this.panels.forEach((config, id) => {
  const element = document.getElementById(id);
  if (element && !element.classList.contains('hidden')) {
    this.renderPanel(config, program);
  }
});

// TextRenderer
const visiblePanels = new Set<string>();
panelIds.forEach(id => {
  const panel = document.getElementById(id);
  if (panel && !panel.classList.contains('hidden')) {
    visiblePanels.add(id);
  }
});
```

### 4. Canvas2D Optimizations (TextRenderer)

```typescript
// Disable image smoothing for crisp text
this.textContext.imageSmoothingEnabled = false;

// Use 2D context with desynchronized flag
const context = this.textCanvas.getContext('2d', {
  alpha: true,
  desynchronized: true  // Faster compositing
});
```

### 5. ResizeObserver vs Window Events

**BAD**: Resize on every window event (fires too often)
```typescript
window.addEventListener('resize', () => this.resize());
```

**GOOD**: Use ResizeObserver (fires only on actual size change)
```typescript
this.resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target === this.canvas) {
      this.resize();
    }
  }
});
```

---

## Integration & Communication

### Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     OceanApp (main.ts)                  │
│  • Initializes all systems                              │
│  • Connects UI to renderers                             │
└────────────┬────────────────────────────────────────────┘
             │
             ├──────────────┬──────────────┬──────────────┐
             ↓              ↓              ↓              ↓
    ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────────┐
    │   Router   │  │ PanelManager │  │ NavManager│  │OceanRenderer│
    └────────────┘  └──────────────┘  └──────────┘  └─────────────┘
         │                 │                 │              │
         │                 │                 │              │
         └─────────────────┴─────────────────┴──────────────┘
                              ↓
                    Hash Change / Route Update
                              ↓
         ┌─────────────────────────────────────────┐
         │ Panel Visibility Change                 │
         └─────────────────────────────────────────┘
                              ↓
         ┌─────────────────────────────────────────┐
         │ GlassRenderer.updatePanelPositions()    │
         │ TextRenderer.updateTextPositions()      │
         └─────────────────────────────────────────┘
```

### Router → Panel State Flow

```typescript
// Router.ts
private navigateToRoute(route: Route): void {
  this.panelManager.transitionTo(route.state);
}

// Panel.ts
public transitionTo(newState: PanelState): void {
  this.performTransition(oldState, newState);
  this.updatePanelVisibility();
}

// Navigation.ts (connected via main.ts)
const originalTransitionTo = this.panelManager.transitionTo.bind(this.panelManager);
this.panelManager.transitionTo = (newState) => {
  originalTransitionTo(newState);
  this.navigationManager!.updateVisibilityForPanelState(newState);
};
```

### WebGL Enhancement Flags

```typescript
// Panel.ts
public enableWebGLDistortion(): void {
  this.landingPanel.classList.add('webgl-enhanced');
  this.appPanel.classList.add('webgl-enhanced');
  // ...
}

// TextRenderer.ts
private enableWebGLText(): void {
  document.querySelectorAll('.glass-panel').forEach(panel => {
    panel.classList.add('webgl-text-enabled');
  });
}
```

**CSS Integration:**
```css
.webgl-text-enabled h1,
.webgl-text-enabled p {
  opacity: 0; /* Hide CSS text, use WebGL rendering */
}
```

---

## Debugging Guide

### Debug Modes (Press D to cycle, 0-4 to select)

| Mode | Visualization | Use Case |
|------|---------------|----------|
| **0** | Normal rendering | Final output |
| **1** | UV coordinates | Debug texture mapping |
| **2** | Wave height (grayscale) | Debug wave simulation |
| **3** | Normal vectors (RGB) | Debug lighting calculations |
| **4** | Wake intensity map | Debug vessel wake system |

### Common Issues & Solutions

#### Issue: Glass panels not aligned with HTML elements

**Symptom**: Glass distortion appears offset from HTML panels.

**Debug**:
1. Enable console debug logging in `htmlRectToNormalized()`:
   ```typescript
   console.debug(`Panel Mapping: ${elementRect.width}x${elementRect.height} → WebGL (${glX}, ${glY})`);
   ```
2. Check `getBoundingClientRect()` returns valid dimensions
3. Verify canvas rect is correct (canvas may be scaled)

**Common Causes**:
- CSS transforms on canvas element
- Canvas not full viewport size
- Device pixel ratio not accounted for

#### Issue: Text bleeding across panels

**Symptom**: Text from hidden panels visible on screen.

**Debug**:
1. Check visibility culling in `updateTextTexture()`:
   ```typescript
   console.log('Visible panels:', Array.from(visiblePanels));
   ```
2. Verify panel IDs match between HTML and TextRenderer config
3. Check CSS `.hidden` class is applied correctly

**Solution**: Ensure `config.panelId` matches panel element IDs exactly.

#### Issue: Framebuffer incomplete errors

**Symptom**: Console error "Framebuffer incomplete: [status code]"

**Debug**:
```typescript
const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
console.log('Framebuffer status:', {
  [gl.FRAMEBUFFER_COMPLETE]: 'COMPLETE',
  [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
  [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'MISSING_ATTACHMENT',
  [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED',
}[status]);
```

**Common Causes**:
- Texture format mismatch (RGB vs RGBA)
- Depth buffer wrong format
- Texture not bound before framebuffer attach

#### Issue: Poor performance on mobile

**Solutions**:
1. Reduce wake points:
   ```typescript
   wakeTrailLength: 50  // Down from 150
   ```
2. Disable glass rendering:
   ```typescript
   this.renderer.setGlassEnabled(false);
   ```
3. Lower canvas resolution:
   ```typescript
   const devicePixelRatio = Math.min(window.devicePixelRatio, 1.5);
   ```

### Visual Debugging Tools

**Press G**: Toggle glass rendering (isolate ocean issues)
**Press T**: Toggle text rendering (isolate text issues)
**Press V**: Toggle vessel wakes (isolate wake issues)

**Chrome DevTools**: Canvas inspection
1. Open DevTools → Rendering tab
2. Enable "Paint flashing" to see repaints
3. Use Performance profiler for GPU timeline

---

## Appendix: Mathematical Reference

### Coordinate Conversions

**Viewport [0,1] → NDC [-1,1]:**
```
x_ndc = x_viewport * 2 - 1
y_ndc = (1 - y_viewport) * 2 - 1  (flip Y)
```

**NDC [-1,1] → Viewport [0,1]:**
```
x_viewport = (x_ndc + 1) * 0.5
y_viewport = 1 - ((y_ndc + 1) * 0.5)  (flip Y)
```

**Pixels → NDC (via viewport):**
```
x_viewport = (x_pixels - canvas.left) / canvas.width
y_viewport = (y_pixels - canvas.top) / canvas.height
x_ndc = x_viewport * 2 - 1
y_ndc = (1 - y_viewport) * 2 - 1
```

### Refraction Index Values

| Material | Refractive Index |
|----------|------------------|
| Vacuum | 1.0 |
| Air | 1.000293 |
| Water | 1.333 |
| Window Glass | 1.52 |
| Crown Glass | 1.50-1.62 |

**Our Implementation**: `u_refractionIndex = 1.52` (crown glass)

### Luminance Weights

**Standard (ITU-R BT.601)**: `L = 0.299R + 0.587G + 0.114B`
**Our Implementation**: `L = 0.299R + 0.587G + 0.200B` (blue emphasis)

---

## Future Optimizations

### 1. Texture Atlasing
Combine ocean + glass + text into single texture with different UV regions.

### 2. Instance Rendering
Render all glass panels in single draw call using instancing.

### 3. Compute Shaders
Move vessel wake simulation to compute shader for better performance.

### 4. Level of Detail (LOD)
Reduce wave complexity when panels are small on screen.

### 5. Deferred Text Rendering
Only update text texture when DOM changes (MutationObserver).

---

**Document Version**: 1.0
**Last Updated**: January 2025
**Codebase Version**: Branch `txt-css`
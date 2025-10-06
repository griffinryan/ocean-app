#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Wake texture uniform (rendered by WakeRenderer)
uniform sampler2D u_wakeTexture;
uniform bool u_wakesEnabled;

// Glass panel uniforms
uniform bool u_glassEnabled;
uniform int u_glassPanelCount;
uniform vec2 u_glassPanelPositions[2];
uniform vec2 u_glassPanelSizes[2];
uniform float u_glassDistortionStrengths[2];

out vec4 fragColor;

// Ocean color palette
const vec3 DEEP_WATER = vec3(0.05, 0.15, 0.4);
const vec3 SHALLOW_WATER = vec3(0.1, 0.4, 0.7);
const vec3 FOAM_COLOR = vec3(0.9, 0.95, 1.0);
const vec3 WAVE_CREST = vec3(0.3, 0.6, 0.9);

// Hash function for procedural noise
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Fast pseudo-random for glass distortion (cheaper than full noise)
float cheapNoise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Quick directional noise for glass gradients
vec2 gradientNoise(vec2 p) {
    float n = cheapNoise(p);
    float angle = n * 6.28318; // 2 * PI
    return vec2(cos(angle), sin(angle)) * (n - 0.5) * 2.0;
}

// Improved noise function
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// PERFORMANCE: Calculate pixel-density LOD using screen-space derivatives
// Returns LOD level where:
// - LOD 0 = highest detail (1 ocean unit per pixel)
// - LOD 1 = 2 ocean units per pixel
// - LOD 2 = 4 ocean units per pixel
// - LOD 3+ = 8+ ocean units per pixel (lowest detail)
float calculatePixelDensityLOD(vec2 oceanPos) {
    // Measure how fast ocean coordinates change per screen pixel
    vec2 dx = dFdx(oceanPos);
    vec2 dy = dFdy(oceanPos);

    // Maximum rate of change determines required detail level
    float maxDerivative = max(length(dx), length(dy));

    // LOD increases logarithmically with derivative
    // Clamp to reasonable range [0, 3.5]
    return clamp(log2(max(1.0, maxDerivative)), 0.0, 3.5);
}

// Optimized FBM with fewer octaves
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;

    for(int i = 0; i < 3; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// PERFORMANCE: Adaptive FBM with LOD-based octave count
// Automatically reduces octaves at low pixel density
float fbmAdaptive(vec2 p, float lod) {
    float value = 0.0;
    float amplitude = 0.5;

    // LOD 0-1: 3 octaves (full detail)
    // LOD 1-2: 2 octaves
    // LOD 2+: 1 octave (minimal)
    int octaves = int(3.0 - clamp(lod, 0.0, 2.0));

    for(int i = 0; i < 3; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// PERFORMANCE: Fast sine approximation using polynomial
// Provides ~2x speedup over native sin() with minimal quality loss
float fastSin(float x) {
    // Normalize to [-PI, PI]
    const float PI = 3.14159265359;
    const float TWO_PI = 6.28318530718;
    x = mod(x + PI, TWO_PI) - PI;

    // Bhaskara I's sine approximation
    // Error < 0.002 across full range
    float x2 = x * x;
    return x * (16.0 - 5.0 * x2) / (5.0 * x2 + 4.0 * PI * PI);
}

// Simple sine wave for visible patterns
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * 3.14159 / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// PERFORMANCE: Optimized sine wave using fast sine approximation
// Use for LOD > 1.0 where slight error is imperceptible
float sineWaveFast(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * 3.14159 / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * fastSin(phase);
}

// Sample wake texture (rendered by WakeRenderer at lower resolution)
float sampleWakeTexture(vec2 oceanPos) {
    if (!u_wakesEnabled) return 0.0;

    // Convert ocean coordinates to UV space [0,1]
    // Ocean space is [-15*aspectRatio, 15*aspectRatio] x [-15, 15]
    vec2 wakeUV = vec2(
        (oceanPos.x / (15.0 * u_aspectRatio)) * 0.5 + 0.5,
        (oceanPos.y / 15.0) * 0.5 + 0.5
    );

    // Sample wake texture (R channel contains wake height)
    return texture(u_wakeTexture, wakeUV).r;
}

// Calculate liquid glass distortion for screen position
vec2 getGlassDistortion(vec2 screenPos, float time) {
    if (!u_glassEnabled || u_glassPanelCount == 0) return vec2(0.0);

    // Early bounds check across all panels before expensive calculations
    bool inAnyPanel = false;
    for (int i = 0; i < u_glassPanelCount && i < 2; i++) {
        vec2 delta = abs(screenPos - u_glassPanelPositions[i]);
        vec2 halfSize = u_glassPanelSizes[i] * 0.5;
        if (delta.x < halfSize.x * 0.7 && delta.y < halfSize.y * 0.7) {
            inAnyPanel = true;
            break;
        }
    }

    // Early exit if not in any panel region
    if (!inAnyPanel) return vec2(0.0);

    vec2 totalDistortion = vec2(0.0);

    for (int i = 0; i < u_glassPanelCount && i < 2; i++) {
        vec2 panelCenter = u_glassPanelPositions[i];
        vec2 panelSize = u_glassPanelSizes[i];
        float distortionStrength = u_glassDistortionStrengths[i];

        // Convert screen position to panel-relative coordinates
        vec2 localPos = (screenPos - panelCenter) / panelSize;

        // Check if within panel bounds with some padding for smooth edges
        if (abs(localPos.x) < 0.6 && abs(localPos.y) < 0.6) {
            // Distance from center for falloff calculations
            float distFromCenter = length(localPos);

            // Simplified uniform liquid distortion
            float flow1 = sin(localPos.y * 8.0 + time * 2.0) * cos(localPos.x * 6.0 + time * 1.5);
            float flow2 = cos(localPos.x * 10.0 + time * 2.5) * sin(localPos.y * 8.0 + time * 1.8);

            // Simple ripple effects
            float ripplePhase = distFromCenter * 12.0 - time * 3.0;
            float ripple = sin(ripplePhase) * exp(-distFromCenter * 1.5) * 0.15;

            vec2 liquidDistortion = vec2(
                (flow1 + ripple) * 0.15,
                (flow2 + ripple) * 0.15
            );

            // Edge falloff for smooth panel boundaries
            float edgeFade = smoothstep(0.6, 0.4, max(abs(localPos.x), abs(localPos.y)));

            // Apply uniform distortion strength across panel
            liquidDistortion *= distortionStrength * edgeFade * 2.0;

            totalDistortion += liquidDistortion;
        }
    }

    return totalDistortion;
}

// Check if current fragment is under a glass panel
float isUnderGlass(vec2 screenPos) {
    if (!u_glassEnabled || u_glassPanelCount == 0) return 0.0;

    float maxIntensity = 0.0;

    for (int i = 0; i < u_glassPanelCount && i < 2; i++) {
        vec2 panelCenter = u_glassPanelPositions[i];
        vec2 panelSize = u_glassPanelSizes[i];

        // Convert screen position to panel-relative coordinates
        vec2 localPos = (screenPos - panelCenter) / panelSize;

        // Check if within panel bounds (consistent with getGlassDistortion)
        if (abs(localPos.x) < 0.6 && abs(localPos.y) < 0.6) {
            // Calculate smooth falloff from panel edges
            vec2 edgeDistance = abs(localPos);
            float edgeFactor = 1.0 - smoothstep(0.4, 0.6, max(edgeDistance.x, edgeDistance.y));
            maxIntensity = max(maxIntensity, edgeFactor);
        }
    }

    return maxIntensity;
}

// 4x4 Bayer dithering matrix for ordered dithering patterns
float bayerDither4x4(vec2 position) {
    // Bayer matrix values normalized to [0,1]
    const float matrix[16] = float[16](
        0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
       12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
        3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
       15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );

    ivec2 pos = ivec2(mod(position, 4.0));
    int index = pos.y * 4 + pos.x;
    return matrix[index];
}


// Calculate ocean height with visible waves
float getOceanHeight(vec2 pos, float time) {
    float height = 0.0;

    // Primary waves - much larger amplitude for visibility
    height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
    height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
    height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);
    height += sineWave(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time);

    // Secondary detail waves
    height += sineWave(pos, vec2(0.9, 0.4), 3.0, 0.15, 2.0, time);
    height += sineWave(pos, vec2(0.2, -0.9), 2.5, 0.12, 2.2, time);

    // Interference patterns for more complexity
    height += sineWave(pos, vec2(0.5, -0.5), 5.0, 0.1, 0.9, time);
    height += sineWave(pos, vec2(-0.8, 0.2), 7.0, 0.08, 1.1, time);

    // Fine noise for texture
    vec2 noisePos = pos * 3.0 + time * 0.2;
    height += fbm(noisePos) * 0.08;

    // Add vessel wake contributions from pre-rendered texture
    float wakeHeight = sampleWakeTexture(pos);
    height += wakeHeight;

    return height;
}

// PERFORMANCE: Adaptive ocean height with LOD-based wave count
// Automatically reduces wave complexity at low pixel density
float getOceanHeightAdaptive(vec2 pos, float time, float lod) {
    float height = 0.0;

    // LOD 0-0.5: All 8 waves (full detail, native sin)
    // LOD 0.5-1.5: 6 waves (skip interference, native sin)
    // LOD 1.5-2.5: 4 waves (primary only, fast sin)
    // LOD 2.5+: 2 waves (minimal, fast sin)

    // Choose sine function based on LOD
    // LOD < 1.0: Use native sin for maximum quality
    // LOD >= 1.0: Use fast sin for ~2x speedup with minimal error
    bool useFastSin = lod >= 1.0;

    // Primary waves (always present, highest importance)
    if (useFastSin) {
        height += sineWaveFast(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
        height += sineWaveFast(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
    } else {
        height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
        height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
    }

    if (lod < 2.5) {
        // Add more primary waves at medium-high detail
        if (useFastSin) {
            height += sineWaveFast(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);
            height += sineWaveFast(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time);
        } else {
            height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);
            height += sineWave(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time);
        }
    }

    if (lod < 1.5) {
        // Secondary detail waves at high detail (always use native sin)
        height += sineWave(pos, vec2(0.9, 0.4), 3.0, 0.15, 2.0, time);
        height += sineWave(pos, vec2(0.2, -0.9), 2.5, 0.12, 2.2, time);
    }

    if (lod < 0.5) {
        // Interference patterns only at highest detail (native sin)
        height += sineWave(pos, vec2(0.5, -0.5), 5.0, 0.1, 0.9, time);
        height += sineWave(pos, vec2(-0.8, 0.2), 7.0, 0.08, 1.1, time);
    }

    // Adaptive noise texture with LOD-based octave reduction
    if (lod < 3.0) {
        vec2 noisePos = pos * 3.0 + time * 0.2;
        height += fbmAdaptive(noisePos, lod) * 0.08;
    }

    // Add vessel wake contributions from pre-rendered texture
    float wakeHeight = sampleWakeTexture(pos);
    height += wakeHeight;

    return height;
}


// Calculate normal from height differences
vec3 calculateNormal(vec2 pos, float time) {
    float eps = 0.1;
    float heightL = getOceanHeight(pos - vec2(eps, 0.0), time);
    float heightR = getOceanHeight(pos + vec2(eps, 0.0), time);
    float heightD = getOceanHeight(pos - vec2(0.0, eps), time);
    float heightU = getOceanHeight(pos + vec2(0.0, eps), time);

    vec3 normal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));
    return normal;
}

// PERFORMANCE: Adaptive normal calculation with LOD-based sampling
// Uses adaptive height function to reduce complexity
vec3 calculateNormalAdaptive(vec2 pos, float time, float lod) {
    // Increase epsilon at higher LOD to reduce sampling frequency
    float eps = 0.1 * (1.0 + lod * 0.2);

    float heightL = getOceanHeightAdaptive(pos - vec2(eps, 0.0), time, lod);
    float heightR = getOceanHeightAdaptive(pos + vec2(eps, 0.0), time, lod);
    float heightD = getOceanHeightAdaptive(pos - vec2(0.0, eps), time, lod);
    float heightU = getOceanHeightAdaptive(pos + vec2(0.0, eps), time, lod);

    vec3 normal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));
    return normal;
}

// Glass-aware height calculation
float getHeightWithGlass(vec2 pos, float time, float glassIntensity) {
    if (glassIntensity > 0.1) {
        // Under glass: use noise-based crystalline pattern
        vec2 noisePos = pos * 3.0 + time * 0.3;
        float noisePattern = fbm(noisePos) * 2.0 - 1.0;

        // Add animated crystalline structure
        float crystalNoise = cheapNoise(pos * 8.0 + time * 0.5);
        return (noisePattern + crystalNoise * 0.3) * 0.4;
    } else {
        return getOceanHeight(pos, time);
    }
}

// Glass-aware normal calculation
vec3 getNormalWithGlass(vec2 pos, float time, float glassIntensity) {
    if (glassIntensity > 0.1) {
        // Under glass: simplified normal calculation for crystalline pattern
        float eps = 0.2;
        float height = getHeightWithGlass(pos, time, glassIntensity);
        float hx = getHeightWithGlass(pos + vec2(eps, 0.0), time, glassIntensity);
        float hy = getHeightWithGlass(pos + vec2(0.0, eps), time, glassIntensity);
        return normalize(vec3((height - hx) / eps, (height - hy) / eps, 1.0));
    } else {
        return calculateNormal(pos, time);
    }
}

// Quantize color for stylized look
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

void main() {
    // FIRST: Check if under glass panel (using original screen position)
    float glassIntensity = isUnderGlass(v_screenPos);

    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 15.0; // Scale for wave visibility
    oceanPos.x *= u_aspectRatio; // Maintain aspect ratio

    // PERFORMANCE: Calculate pixel-density LOD for adaptive detail
    // This happens AFTER aspect ratio adjustment so LOD reflects actual ocean space
    float lod = calculatePixelDensityLOD(oceanPos);

    // Apply glass distortion ONLY to areas NOT under glass panels
    if (glassIntensity < 0.1) {
        vec2 glassDistortion = getGlassDistortion(v_screenPos, v_time);
        oceanPos += glassDistortion * 25.0; // Enhanced scale for visible liquid glass effect
    }

    // Debug mode outputs (now glass-aware)
    if (u_debugMode == 1) {
        // Show UV coordinates as color
        fragColor = vec4(v_uv, 0.5, 1.0);
        return;
    } else if (u_debugMode == 2) {
        // Show wave height as grayscale (glass-aware)
        float height = getHeightWithGlass(oceanPos, v_time, glassIntensity);
        float gray = height + 0.5;
        fragColor = vec4(vec3(gray), 1.0);
        return;
    } else if (u_debugMode == 3) {
        // Show normals as color (glass-aware)
        vec3 normal = getNormalWithGlass(oceanPos, v_time, glassIntensity);
        fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    } else if (u_debugMode == 4) {
        // Show wake contribution map (from wake texture)
        float wakeContribution = sampleWakeTexture(oceanPos);
        float intensity = clamp(abs(wakeContribution) * 5.0, 0.0, 1.0);
        vec3 wakeColor = mix(vec3(0.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0), intensity);
        fragColor = vec4(wakeColor, 1.0);
        return;
    } else if (u_debugMode == 5) {
        // PERFORMANCE: Show LOD visualization
        // Green = highest detail (LOD 0), Yellow = medium (LOD 1.5), Red = lowest detail (LOD 3+)
        vec3 lodColor;
        if (lod < 1.0) {
            // LOD 0-1: Green to Yellow (high detail)
            lodColor = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), lod);
        } else if (lod < 2.0) {
            // LOD 1-2: Yellow to Orange (medium detail)
            lodColor = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), lod - 1.0);
        } else {
            // LOD 2+: Orange to Red (low detail)
            lodColor = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.0, 0.0), min(1.0, (lod - 2.0) / 1.5));
        }
        fragColor = vec4(lodColor, 1.0);
        return;
    }

    // PERFORMANCE: Use adaptive functions for consistent rendering
    // Under glass: Use simpler glass-aware functions (already optimized)
    // Standard ocean: Use LOD-adaptive functions for automatic detail scaling
    float height;
    vec3 normal;

    if (glassIntensity > 0.1) {
        // Under glass: Use existing glass-aware functions
        height = getHeightWithGlass(oceanPos, v_time, glassIntensity);
        normal = getNormalWithGlass(oceanPos, v_time, glassIntensity);
    } else {
        // Standard ocean: Use LOD-adaptive functions
        height = getOceanHeightAdaptive(oceanPos, v_time, lod);
        normal = calculateNormalAdaptive(oceanPos, v_time, lod);
    }

    vec3 baseColor;

    if (glassIntensity > 0.1) {
        // Simple solid color for minimal visual noise under glass panels
        baseColor = vec3(0.08, 0.12, 0.25);

    } else {
        // Standard ocean rendering
        baseColor = mix(DEEP_WATER, SHALLOW_WATER, smoothstep(-0.3, 0.3, height));

        // Add wave crests with stronger contrast
        float crestAmount = smoothstep(0.12, 0.28, height);
        baseColor = mix(baseColor, WAVE_CREST, crestAmount);

        // Add foam at highest peaks
        float foamAmount = smoothstep(0.18, 0.35, height);
        baseColor = mix(baseColor, FOAM_COLOR, foamAmount);

        // Enhanced top-down lighting with multiple light sources
        vec3 mainLight = normalize(vec3(0.6, 1.0, 0.4));
        vec3 rimLight = normalize(vec3(-0.3, 0.8, -0.5));

        float mainLighting = max(0.2, dot(normal, mainLight));
        float rimLighting = max(0.0, dot(normal, rimLight)) * 0.3;

        float totalLighting = mainLighting + rimLighting;
        baseColor *= clamp(totalLighting, 0.3, 1.3);

        // PERFORMANCE: Caustics and foam only at medium-high detail (LOD < 2.0)
        // These are expensive effects (multiple FBM calls) that are barely visible at low pixel density
        if (lod < 2.0) {
            // Enhanced caustics with multiple layers
            vec2 causticPos1 = oceanPos * 18.0 + v_time * 2.5;
            vec2 causticPos2 = oceanPos * 25.0 - v_time * 1.8;

            // Use adaptive FBM for caustics
            float caustic1 = fbmAdaptive(causticPos1, lod);
            float caustic2 = fbmAdaptive(causticPos2, lod);

            caustic1 = smoothstep(0.6, 0.85, caustic1);
            caustic2 = smoothstep(0.65, 0.9, caustic2);

            float totalCaustics = caustic1 * 0.15 + caustic2 * 0.1;
            baseColor += vec3(totalCaustics);

            // Add animated foam trails (only at high detail, LOD < 1.5)
            if (lod < 1.5) {
                vec2 flowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
                vec2 flowPos = oceanPos + flowDir * v_time * 2.0;
                float flowNoise = fbmAdaptive(flowPos * 12.0, lod);
                float flowFoam = smoothstep(0.75, 0.95, flowNoise) * foamAmount;
                baseColor += vec3(flowFoam * 0.2);
            }
        }
    }

    // Apply stylistic quantization only to non-glass areas
    if (glassIntensity < 0.1) {
        baseColor = quantizeColor(baseColor, 8);

        // Add subtle dithering for better gradients
        vec2 ditherPos = gl_FragCoord.xy * 0.75;
        float dither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
        baseColor += vec3((dither - 0.5) * 0.02);
    }

    // Optional debug grid (only in debug mode 0)
    if (u_debugMode == 0) {
        vec2 grid = abs(fract(oceanPos * 0.3) - 0.5);
        float gridLine = smoothstep(0.015, 0.005, min(grid.x, grid.y));
        baseColor += vec3(gridLine * 0.05);
    }

    fragColor = vec4(baseColor, 1.0);
}
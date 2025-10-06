#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;

uniform vec2 u_resolution;
uniform sampler2D u_textTexture;
uniform float u_blurRadius;         // Blur radius in pixels (e.g., 60.0 for tight wrap)
uniform float u_blurFalloffPower;   // Falloff power (e.g., 2.5 for sharp fade)

out vec4 fragColor;

const float PI = 3.14159265359;

// Multi-zone blur configuration
// These define the boundaries and intensities of different frost zones
const float INNER_ZONE_END = 0.25;      // Inner 25% of radius: full frost
const float MID_ZONE_END = 0.67;        // Mid 42% of radius: main frost effect
const float OUTER_ZONE_END = 1.0;       // Outer 33% of radius: fade to clear

const float INNER_INTENSITY = 1.0;      // 100% frost in inner zone
const float MID_INTENSITY_START = 1.0;  // 100% at mid zone start
const float MID_INTENSITY_END = 0.6;    // 60% at mid zone end
const float OUTER_INTENSITY_END = 0.0;  // 0% at outer zone end

// Crystalline pattern configuration
const float CRYSTAL_SCALE = 30.0;       // Hexagonal pattern scale
const float CRYSTAL_INTENSITY = 0.08;   // Subtle crystalline effect (8%)

// Edge highlighting configuration
const float EDGE_HIGHLIGHT_WIDTH = 0.15; // Inner 15% of radius gets edge glow
const float EDGE_HIGHLIGHT_BOOST = 0.25; // 25% brighter at text edges

/**
 * Calculate distance to nearest text using multi-ring distance field sampling
 * OPTIMIZED: Tight sampling pattern for 60px radius blur
 * - 4 rings (reduced from 5) for tight radius
 * - 10 samples per ring (reduced from 12) for performance
 * - Adaptive density: denser near text edges
 */
float calculateTextDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_blurRadius;

    // Optimized multi-ring sampling for tight blur map
    // 4 rings × 10 samples = 40 total samples (reduced from 60 for tight radius)
    const int numSamples = 10;
    const float angleStep = 2.0 * PI / float(numSamples);
    const int numRings = 4;

    // Adaptive ring spacing optimized for tight 60px radius
    // Spacing: 1, 2, 4, 7 pixels (denser near edges)
    float radii[4] = float[4](1.0, 2.0, 4.0, 7.0);

    for (int ring = 0; ring < numRings; ring++) {
        float radius = radii[ring];
        vec2 radiusOffset = pixelSize * radius;

        // Jittered sampling for super-sampling anti-aliasing
        // Different rings use different angle offsets to avoid aliasing patterns
        float angleJitter = float(ring) * 0.13; // Prime-based jitter

        for (int i = 0; i < numSamples; i++) {
            float angle = float(i) * angleStep + angleJitter;
            vec2 direction = vec2(cos(angle), sin(angle));
            vec2 sampleUV = uv + direction * radiusOffset;

            // Sample text alpha with bilinear filtering
            float sampleAlpha = texture(u_textTexture, sampleUV).a;

            if (sampleAlpha > 0.01) {
                // Found text - calculate distance
                float dist = length(direction * radiusOffset * u_resolution.x);
                minDistance = min(minDistance, dist);
            }
        }
    }

    return minDistance;
}

/**
 * Sample text at multiple scales to detect text size
 * Returns approximate text scale factor (1.0 = medium text)
 */
float detectTextScale(vec2 uv, vec2 pixelSize) {
    // Sample text alpha at current position
    float centerAlpha = texture(u_textTexture, uv).a;

    if (centerAlpha < 0.01) {
        return 1.0; // Not on text, use default scale
    }

    // Sample text in cardinal directions at different distances
    // to estimate text size
    float sampleDist1 = 5.0;  // Small text detection
    float sampleDist2 = 15.0; // Large text detection

    vec2 offset1 = pixelSize * sampleDist1;
    vec2 offset2 = pixelSize * sampleDist2;

    // Count how many nearby samples hit text
    float hits1 = 0.0;
    float hits2 = 0.0;

    hits1 += texture(u_textTexture, uv + vec2(offset1.x, 0.0)).a > 0.01 ? 1.0 : 0.0;
    hits1 += texture(u_textTexture, uv + vec2(-offset1.x, 0.0)).a > 0.01 ? 1.0 : 0.0;
    hits1 += texture(u_textTexture, uv + vec2(0.0, offset1.y)).a > 0.01 ? 1.0 : 0.0;
    hits1 += texture(u_textTexture, uv + vec2(0.0, -offset1.y)).a > 0.01 ? 1.0 : 0.0;

    hits2 += texture(u_textTexture, uv + vec2(offset2.x, 0.0)).a > 0.01 ? 1.0 : 0.0;
    hits2 += texture(u_textTexture, uv + vec2(-offset2.x, 0.0)).a > 0.01 ? 1.0 : 0.0;
    hits2 += texture(u_textTexture, uv + vec2(0.0, offset2.y)).a > 0.01 ? 1.0 : 0.0;
    hits2 += texture(u_textTexture, uv + vec2(0.0, -offset2.y)).a > 0.01 ? 1.0 : 0.0;

    // Estimate scale based on hit patterns
    if (hits2 >= 3.0) {
        return 1.3; // Large text (h1, h2)
    } else if (hits1 >= 3.0) {
        return 1.0; // Medium text (p, default)
    } else {
        return 0.8; // Small text (labels, tags)
    }
}

/**
 * Generate hexagonal crystalline pattern for frost effect
 */
float hexagonalPattern(vec2 uv) {
    // Create hexagonal tiling using trigonometry
    vec2 scaled = uv * CRYSTAL_SCALE;

    // Hexagonal grid basis vectors
    vec2 r = vec2(1.0, 1.732); // sqrt(3)
    vec2 h = r * 0.5;

    vec2 a = mod(scaled, r) - h;
    vec2 b = mod(scaled - h, r) - h;

    // Distance to nearest hexagon center
    float distA = dot(a, a);
    float distB = dot(b, b);

    return smoothstep(0.3, 0.4, min(distA, distB));
}

/**
 * Calculate radial gradient variation for natural frost
 */
float radialVariation(vec2 uv, float distance) {
    // Subtle radial variation based on angle from text
    vec2 center = vec2(0.5);
    vec2 toCenter = uv - center;
    float angle = atan(toCenter.y, toCenter.x);

    // 3-fold rotational variation for organic feel
    float variation = sin(angle * 3.0 + distance * 0.1) * 0.1;

    return 1.0 + variation;
}

/**
 * Multi-zone blur intensity calculation with enhanced effects
 */
float calculateMultiZoneIntensity(float distance, float normalizedDist, vec2 uv) {
    float intensity = 0.0;

    // ZONE 1: Inner glow (0-25% of radius) - Full frost, tight around text
    if (normalizedDist <= INNER_ZONE_END) {
        intensity = INNER_INTENSITY;

        // Edge highlighting: boost intensity near text boundary
        if (normalizedDist >= EDGE_HIGHLIGHT_WIDTH) {
            float edgeBoost = (normalizedDist - EDGE_HIGHLIGHT_WIDTH) / (INNER_ZONE_END - EDGE_HIGHLIGHT_WIDTH);
            edgeBoost = 1.0 - edgeBoost; // Invert: higher near EDGE_HIGHLIGHT_WIDTH
            intensity += edgeBoost * EDGE_HIGHLIGHT_BOOST;
        }
    }
    // ZONE 2: Mid frost (25-67% of radius) - Main frosted glass effect
    else if (normalizedDist <= MID_ZONE_END) {
        float midProgress = (normalizedDist - INNER_ZONE_END) / (MID_ZONE_END - INNER_ZONE_END);
        intensity = mix(MID_INTENSITY_START, MID_INTENSITY_END, midProgress);

        // Apply falloff power to mid zone for smoother transition
        intensity *= 1.0 - pow(midProgress, u_blurFalloffPower * 0.5);
    }
    // ZONE 3: Outer fade (67-100% of radius) - Smooth transition to clear glass
    else {
        float outerProgress = (normalizedDist - MID_ZONE_END) / (OUTER_ZONE_END - MID_ZONE_END);
        intensity = mix(MID_INTENSITY_END, OUTER_INTENSITY_END, outerProgress);

        // Sharp exponential falloff in outer zone
        intensity *= 1.0 - pow(outerProgress, u_blurFalloffPower);
    }

    // Add crystalline pattern (subtle hexagonal structure)
    float crystal = hexagonalPattern(uv);
    intensity += crystal * CRYSTAL_INTENSITY * (1.0 - normalizedDist);

    // Add radial variation for natural frost appearance
    float variation = radialVariation(uv, distance);
    intensity *= variation;

    // Triple smoothstep for ultra-smooth gradients
    intensity = smoothstep(0.0, 1.0, intensity);
    intensity = smoothstep(0.0, 1.0, intensity);
    intensity = smoothstep(0.0, 1.0, intensity);

    // Clamp to valid range
    return clamp(intensity, 0.0, 1.2); // Allow slight over-brightness for highlights
}

void main() {
    // Convert screen position to UV [0,1]
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Sample text alpha directly
    float textAlpha = texture(u_textTexture, screenUV).a;

    float blurIntensity = 0.0;

    if (textAlpha > 0.01) {
        // Inside text: maximum blur intensity with slight variation
        vec2 pixelSize = 1.0 / u_resolution;

        // Add subtle crystalline pattern even inside text
        float crystal = hexagonalPattern(screenUV);
        blurIntensity = 1.0 + crystal * CRYSTAL_INTENSITY * 0.5;
    } else {
        // Outside text: calculate distance-based multi-zone blur
        vec2 pixelSize = 1.0 / u_resolution;

        // Detect text scale for adaptive blur sizing
        float textScale = detectTextScale(screenUV, pixelSize);
        float effectiveRadius = u_blurRadius * textScale;

        float distance = calculateTextDistance(screenUV, pixelSize);

        // TIGHTENED: Only sample within 1.05× radius (was 1.2×)
        // This creates much cleaner outer edge
        if (distance < effectiveRadius * 1.05) {
            // Convert distance to normalized [0,1] range
            float normalizedDist = distance / effectiveRadius;

            // Calculate multi-zone intensity with enhanced effects
            blurIntensity = calculateMultiZoneIntensity(distance, normalizedDist, screenUV);

            // TIGHTENED: Sharper outer edge fade (0.90-1.05 instead of 0.85-1.2)
            // Narrower range creates crisper boundary
            float outerEdgeFade = 1.0 - smoothstep(effectiveRadius * 0.90, effectiveRadius * 1.05, distance);
            blurIntensity *= outerEdgeFade;

            // Final cubic ease-out for natural fade
            blurIntensity = blurIntensity * blurIntensity * (3.0 - 2.0 * blurIntensity);
        }
    }

    // Output blur intensity to R channel (clamped to [0,1] for proper rendering)
    // R = blur intensity, G/B = unused, A = 1.0
    fragColor = vec4(clamp(blurIntensity, 0.0, 1.0), 0.0, 0.0, 1.0);
}

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

/**
 * Calculate distance to nearest text using multi-ring distance field sampling
 * OPTIMIZED: Tight sampling pattern for small radius blur
 * - 4 rings for performance and quality balance
 * - 10 samples per ring for smooth circular coverage
 * - Adaptive ring spacing for accuracy near text edges
 */
float calculateTextDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_blurRadius;

    // Multi-ring sampling for smooth distance field
    // 4 rings × 10 samples = 40 total samples
    const int numSamples = 10;
    const float angleStep = 2.0 * PI / float(numSamples);
    const int numRings = 4;

    // Adaptive ring spacing: denser near text edges for accuracy
    // Spacing: 1, 2, 4, 7 pixels
    float radii[4] = float[4](1.0, 2.0, 4.0, 7.0);

    for (int ring = 0; ring < numRings; ring++) {
        float radius = radii[ring];
        vec2 radiusOffset = pixelSize * radius;

        // Jittered sampling for anti-aliasing
        // Different rings use different angle offsets to reduce aliasing
        float angleJitter = float(ring) * 0.13;

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

void main() {
    // Convert screen position to UV [0,1]
    vec2 screenUV = vec2(
        (v_screenPos.x + 1.0) * 0.5,
        (1.0 - v_screenPos.y) * 0.5
    );

    // Sample text alpha directly
    float textAlpha = texture(u_textTexture, screenUV).a;

    float blurIntensity = 0.0;

    if (textAlpha > 0.01) {
        // Inside text: maximum blur intensity
        blurIntensity = 1.0;
    } else {
        // Outside text: calculate distance-based blur falloff
        vec2 pixelSize = 1.0 / u_resolution;
        float distance = calculateTextDistance(screenUV, pixelSize);

        // TIGHT BOUND: Only sample within 1.05× radius (was 1.2×)
        // This creates much cleaner outer edge
        if (distance < u_blurRadius * 1.05) {
            // Convert distance to normalized [0,1] range
            float normalizedDist = distance / u_blurRadius;

            // Apply falloff power for sharp fade
            // power 2.5 = dramatic exponential falloff
            blurIntensity = 1.0 - pow(normalizedDist, u_blurFalloffPower);

            // TIGHT OUTER EDGE FADE: 0.90-1.05 range (was 0.85-1.2)
            // Narrower range creates crisper boundary
            float outerEdgeFade = 1.0 - smoothstep(u_blurRadius * 0.90, u_blurRadius * 1.05, distance);
            blurIntensity *= outerEdgeFade;

            // Triple smoothstep for ultra-smooth gradients
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);
        }
    }

    // Output blur intensity to R channel
    // Clean [0,1] range, no over-brightness
    fragColor = vec4(clamp(blurIntensity, 0.0, 1.0), 0.0, 0.0, 1.0);
}

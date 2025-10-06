#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;

uniform vec2 u_resolution;
uniform sampler2D u_textTexture;
uniform float u_blurRadius;         // Blur radius in pixels (e.g., 128.0)
uniform float u_blurFalloffPower;   // Falloff power (e.g., 1.5)

out vec4 fragColor;

const float PI = 3.14159265359;

/**
 * Calculate distance to nearest text using multi-ring distance field sampling
 * IMPROVED: Higher quality sampling for smoother blur gradients
 * - 5 rings (was 3) for better distance accuracy
 * - 12 samples per ring (was 8) for smoother circular coverage
 * - Adaptive density: denser near edges, sparser far away
 */
float calculateTextDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_blurRadius;

    // Enhanced multi-ring sampling for ultra-smooth distance field
    // 5 rings × 12 samples = 60 total samples (was 24)
    const int numSamples = 12;
    const float angleStep = 2.0 * PI / float(numSamples);
    const int numRings = 5;

    // Adaptive ring spacing: denser near text edges (1, 2, 4, 7, 11)
    // Creates smooth gradients where they matter most
    float radii[5] = float[5](1.0, 2.0, 4.0, 7.0, 11.0);

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

void main() {
    // Convert screen position to UV [0,1]
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

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

        // Extended sampling radius for ultra-smooth outer edge (1.2× instead of 1.15×)
        if (distance < u_blurRadius * 1.2) {
            // Convert distance to blur intensity [0,1]
            // Close to text = high blur, far from text = no blur
            float normalizedDist = distance / u_blurRadius;

            // Apply falloff power for control over blur spread
            // power < 1.0: softer falloff, more spread
            // power = 1.0: linear falloff
            // power > 1.0: sharper falloff, tighter around text
            blurIntensity = 1.0 - pow(normalizedDist, u_blurFalloffPower);

            // IMPROVED: Double smoothstep for extra-smooth gradients
            // First smoothstep: shape the overall curve
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);

            // Second smoothstep: smooth out any remaining steps
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);

            // IMPROVED: Gentler outer edge fade with wider transition zone
            // Creates smooth transition zone from 0.85× to 1.2× radius
            // Wider range = softer fade, no visible cutoff
            float outerEdgeFade = 1.0 - smoothstep(u_blurRadius * 0.85, u_blurRadius * 1.2, distance);
            blurIntensity *= outerEdgeFade;

            // Final polish: apply cubic ease-out to the entire intensity
            // Makes the fade-out even more natural
            blurIntensity = blurIntensity * blurIntensity * (3.0 - 2.0 * blurIntensity);
        }
    }

    // Output blur intensity to R channel
    // R = blur intensity, G/B = unused, A = 1.0
    fragColor = vec4(blurIntensity, 0.0, 0.0, 1.0);
}

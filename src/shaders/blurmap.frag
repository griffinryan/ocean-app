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
 * Reuses the same approach as glow calculation in text.frag for consistency
 */
float calculateTextDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_blurRadius;

    // Multi-ring sampling for smooth distance field
    // 3 rings at different radii for accurate distance estimation
    const int numSamples = 8;
    const float angleStep = 2.0 * PI / float(numSamples);
    const int numRings = 3;
    float radii[3] = float[3](1.0, 3.0, 5.0);

    for (int ring = 0; ring < numRings; ring++) {
        float radius = radii[ring];
        vec2 radiusOffset = pixelSize * radius;

        for (int i = 0; i < numSamples; i++) {
            float angle = float(i) * angleStep;
            vec2 direction = vec2(cos(angle), sin(angle));
            vec2 sampleUV = uv + direction * radiusOffset;

            // Sample text alpha
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

        // Extend sampling radius slightly for smooth outer edge transition
        if (distance < u_blurRadius * 1.15) {
            // Convert distance to blur intensity [0,1]
            // Close to text = high blur, far from text = no blur
            float normalizedDist = distance / u_blurRadius;

            // Apply falloff power for control over blur spread
            // power < 1.0: softer falloff, more spread
            // power = 1.0: linear falloff
            // power > 1.0: sharper falloff, tighter around text
            blurIntensity = 1.0 - pow(normalizedDist, u_blurFalloffPower);

            // Smooth the inner gradient transition
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);

            // CRITICAL FIX: Add smooth fade at outer edge to eliminate harsh cutoff
            // Creates smooth transition zone from 0.9× to 1.15× radius
            float outerEdgeFade = 1.0 - smoothstep(u_blurRadius * 0.9, u_blurRadius * 1.15, distance);
            blurIntensity *= outerEdgeFade;
        }
    }

    // Output blur intensity to R channel
    // R = blur intensity, G/B = unused, A = 1.0
    fragColor = vec4(blurIntensity, 0.0, 0.0, 1.0);
}

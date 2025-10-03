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
 * Calculate distance to nearest text using proportional multi-ring sampling
 * Uses ring radii that scale with blur radius for accurate large-radius measurements
 */
float calculateTextDistance(vec2 uv, vec2 pixelSize) {
    float minDistance = u_blurRadius;

    // Proportional multi-ring sampling that scales with blur radius
    // Rings at 20%, 40%, 70%, and 100% of blur radius
    // For 384px blur: rings at [77px, 154px, 269px, 384px]
    const int numSamples = 8;
    const float angleStep = 2.0 * PI / float(numSamples);
    const int numRings = 4;
    float ringProportions[4] = float[4](0.2, 0.4, 0.7, 1.0);

    for (int ring = 0; ring < numRings; ring++) {
        // Calculate ring radius as proportion of blur radius
        float ringRadiusPixels = u_blurRadius * ringProportions[ring];
        vec2 radiusOffset = vec2(ringRadiusPixels) / u_resolution;

        for (int i = 0; i < numSamples; i++) {
            float angle = float(i) * angleStep;
            vec2 direction = vec2(cos(angle), sin(angle));
            vec2 sampleUV = uv + direction * radiusOffset;

            // Sample text alpha
            float sampleAlpha = texture(u_textTexture, sampleUV).a;

            if (sampleAlpha > 0.01) {
                // Found text - calculate actual pixel distance
                float dist = length(direction * ringRadiusPixels);
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

        if (distance < u_blurRadius) {
            // Convert distance to blur intensity [0,1]
            // Close to text = high blur, far from text = no blur
            float normalizedDist = distance / u_blurRadius;

            // Apply falloff power for control over blur spread
            // power < 1.0: softer falloff, more spread
            // power = 1.0: linear falloff
            // power > 1.0: sharper falloff, tighter around text
            blurIntensity = 1.0 - pow(normalizedDist, u_blurFalloffPower);

            // Smooth the transition for clean gradient
            blurIntensity = smoothstep(0.0, 1.0, blurIntensity);
        }
    }

    // Output blur intensity to R channel
    // R = blur intensity, G/B = unused, A = 1.0
    fragColor = vec4(blurIntensity, 0.0, 0.0, 1.0);
}

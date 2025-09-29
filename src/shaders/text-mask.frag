#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_uv;               // UV coordinates for the current region
in vec2 v_screenPos;        // Screen position for sampling ocean texture
in vec2 v_regionUV;         // UV within the text region (0-1)
in float v_time;            // Time for animations

// Uniforms
uniform vec2 u_resolution;
uniform sampler2D u_oceanTexture;        // The rendered ocean scene
uniform vec2 u_regionPosition;           // Text region position in screen space (0-1)
uniform vec2 u_regionSize;               // Text region size in screen space (0-1)
uniform float u_adaptationStrength;     // How strongly to adapt (0.0-1.0)
uniform float u_contrastThreshold;      // Brightness threshold for switching (0.0-1.0)
uniform float u_transitionSmoothness;   // How smooth the transition is (0.0-1.0)
uniform vec4 u_lightTextColor;          // RGBA for light text on dark backgrounds
uniform vec4 u_darkTextColor;           // RGBA for dark text on light backgrounds
uniform float u_shadowIntensity;        // Text shadow strength
uniform float u_gradientSamples;        // Number of samples for gradient generation

// Output
out vec4 fragColor;

// Luminance calculation (ITU-R BT.709)
const vec3 LUMINANCE_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);

// Adaptive sampling configuration
const float SAMPLE_RADIUS = 0.03;       // Radius for gradient sampling
const float EDGE_SOFTNESS = 0.02;       // Soft edge transition
const float TEMPORAL_SMOOTHING = 0.1;   // Temporal smoothing factor

/**
 * Hash function for pseudo-random sampling
 */
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

/**
 * Sample ocean luminance at a given screen position
 */
float sampleOceanLuminance(vec2 screenPos) {
    // Clamp to valid texture coordinates
    vec2 clampedPos = clamp(screenPos, vec2(0.001), vec2(0.999));

    // Sample ocean texture
    vec3 oceanColor = texture(u_oceanTexture, clampedPos).rgb;

    // Calculate perceptual luminance
    return dot(oceanColor, LUMINANCE_WEIGHTS);
}

/**
 * Advanced gradient sampling for smooth text adaptation
 * Uses multi-scale sampling to create intelligent gradients
 */
float calculateAdaptiveLuminance(vec2 screenPos, vec2 regionUV) {
    float totalLuminance = 0.0;
    float totalWeight = 0.0;
    int samples = int(u_gradientSamples);

    // Multi-scale sampling for better gradient detection
    vec2 sampleScales[3];
    sampleScales[0] = vec2(SAMPLE_RADIUS * 0.5);      // Fine detail
    sampleScales[1] = vec2(SAMPLE_RADIUS * 1.0);      // Medium detail
    sampleScales[2] = vec2(SAMPLE_RADIUS * 2.0);      // Coarse detail

    float scaleWeights[3];
    scaleWeights[0] = 0.5;    // Fine detail gets more weight
    scaleWeights[1] = 0.3;    // Medium detail
    scaleWeights[2] = 0.2;    // Coarse detail for context

    // Sample at multiple scales
    for (int scale = 0; scale < 3; scale++) {
        vec2 currentScale = sampleScales[scale];
        float scaleWeight = scaleWeights[scale];

        // Sample in a pattern around the current position
        for (int i = 0; i < samples; i++) {
            float angle = float(i) * 6.28318530718 / float(samples);

            // Add some randomness to break up patterns
            float randomOffset = hash21(screenPos + float(i) * 0.1) * 0.3;
            angle += randomOffset;

            // Calculate sample position
            vec2 offset = vec2(cos(angle), sin(angle)) * currentScale;
            vec2 samplePos = screenPos + offset;

            // Weight samples based on distance from center
            float distance = length(offset);
            float weight = exp(-distance * 3.0) * scaleWeight;

            // Sample luminance
            float luminance = sampleOceanLuminance(samplePos);

            totalLuminance += luminance * weight;
            totalWeight += weight;
        }
    }

    // Also sample the center point with high weight
    float centerLuminance = sampleOceanLuminance(screenPos);
    totalLuminance += centerLuminance * 2.0;
    totalWeight += 2.0;

    return totalWeight > 0.0 ? totalLuminance / totalWeight : centerLuminance;
}

/**
 * Calculate smooth transition factor based on luminance
 */
float calculateTransitionFactor(float luminance) {
    float threshold = u_contrastThreshold;
    float smoothness = u_transitionSmoothness * 0.3; // Scale smoothness

    // Create smooth transition around threshold
    float transition = smoothstep(threshold - smoothness, threshold + smoothness, luminance);

    // Apply adaptation strength
    return mix(0.5, transition, u_adaptationStrength);
}

/**
 * Generate soft edges for text regions
 */
float calculateRegionMask(vec2 regionUV) {
    // Calculate distance from edges
    vec2 edgeDist = min(regionUV, vec2(1.0) - regionUV);
    float minEdgeDist = min(edgeDist.x, edgeDist.y);

    // Create soft edges
    float edgeFactor = smoothstep(0.0, EDGE_SOFTNESS, minEdgeDist);

    // Ensure we're within the region bounds
    float regionMask = step(0.0, regionUV.x) * step(regionUV.x, 1.0) *
                       step(0.0, regionUV.y) * step(regionUV.y, 1.0);

    return edgeFactor * regionMask;
}

/**
 * Calculate enhanced text shadow based on luminance
 */
vec4 calculateTextShadow(float luminance, float transitionFactor) {
    vec4 shadowColor;

    if (transitionFactor > 0.5) {
        // Light background: dark shadow
        float shadowStrength = (transitionFactor - 0.5) * 2.0 * u_shadowIntensity;
        shadowColor = vec4(0.0, 0.0, 0.0, shadowStrength * 0.4);
    } else {
        // Dark background: light glow
        float glowStrength = (0.5 - transitionFactor) * 2.0 * u_shadowIntensity;
        shadowColor = vec4(1.0, 1.0, 1.0, glowStrength * 0.3);
    }

    return shadowColor;
}

/**
 * Main fragment shader
 */
void main() {
    // Calculate region mask for soft edges
    float regionMask = calculateRegionMask(v_regionUV);

    // Early exit if outside region
    if (regionMask < 0.01) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    // Sample adaptive luminance with gradient analysis
    float luminance = calculateAdaptiveLuminance(v_screenPos, v_regionUV);

    // Apply temporal smoothing to reduce flickering
    float smoothedLuminance = luminance; // Can add temporal smoothing here if needed

    // Calculate transition factor
    float transitionFactor = calculateTransitionFactor(smoothedLuminance);

    // Interpolate between light and dark text colors
    vec4 textColor = mix(u_lightTextColor, u_darkTextColor, transitionFactor);

    // Calculate text shadow
    vec4 shadowColor = calculateTextShadow(smoothedLuminance, transitionFactor);

    // Combine text color and shadow
    vec4 finalColor = textColor;

    // Add subtle shadow offset simulation
    vec2 shadowOffset = vec2(1.0 / u_resolution.x, 1.0 / u_resolution.y) * 2.0;
    vec2 shadowUV = v_regionUV + shadowOffset;
    float shadowMask = calculateRegionMask(shadowUV);

    // Blend shadow with text color
    finalColor.rgb += shadowColor.rgb * shadowColor.a;
    finalColor.a = max(finalColor.a, shadowColor.a * shadowMask);

    // Apply region mask for soft edges
    finalColor.a *= regionMask;

    // Add subtle animation for visual feedback (optional)
    float pulseAnimation = 1.0 + sin(v_time * 2.0) * 0.02 * u_adaptationStrength;
    finalColor.rgb *= pulseAnimation;

    // Output final color
    fragColor = finalColor;
}
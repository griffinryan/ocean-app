#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;

uniform sampler2D u_textTexture;    // Text rendered to texture (alpha channel contains text)
uniform sampler2D u_oceanTexture;   // Ocean color texture for background analysis
uniform vec2 u_resolution;          // Screen resolution
uniform float u_time;               // Time for animated effects
uniform float u_contrastThreshold;  // Luminance threshold for color switching
uniform float u_transitionWidth;    // Smoothness of color transitions
uniform int u_debugMode;            // Debug visualization mode (0=off, 1=text, 2=ocean, 3=analysis)

out vec4 fragColor;

// Calculate relative luminance for contrast analysis
float getLuminance(vec3 color) {
    // ITU-R BT.709 luminance coefficients (sRGB)
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

// Calculate perceived brightness (alternative to luminance)
float getPerceivedBrightness(vec3 color) {
    // Alternative brightness calculation that may feel more natural
    return sqrt(0.299 * color.r * color.r + 0.587 * color.g * color.g + 0.114 * color.b * color.b);
}

// Detect foam/wave crest areas for enhanced contrast
float getFoamFactor(vec3 oceanColor) {
    float brightness = getLuminance(oceanColor);

    // Calculate saturation (foam is bright but desaturated)
    float maxChannel = max(max(oceanColor.r, oceanColor.g), oceanColor.b);
    float minChannel = min(min(oceanColor.r, oceanColor.g), oceanColor.b);
    float saturation = (maxChannel > 0.0) ? (maxChannel - minChannel) / maxChannel : 0.0;

    // Foam is bright with low saturation
    float foamFactor = brightness * (1.0 - saturation);

    // Boost detection for very bright areas
    float brightnessFactor = smoothstep(0.7, 1.0, brightness);

    return max(foamFactor, brightnessFactor * 0.8);
}

// Detect wave activity based on color variation
float getWaveActivity(vec2 uv) {
    vec2 texelSize = 1.0 / u_resolution;
    vec3 centerColor = texture(u_oceanTexture, uv).rgb;

    float variation = 0.0;
    int sampleCount = 0;

    // Sample surrounding pixels to detect wave activity
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            if (x == 0 && y == 0) continue;

            vec2 sampleUV = uv + vec2(float(x), float(y)) * texelSize;

            // Ensure we stay within texture bounds
            if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
                sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {

                vec3 sampleColor = texture(u_oceanTexture, sampleUV).rgb;
                variation += distance(centerColor, sampleColor);
                sampleCount++;
            }
        }
    }

    return sampleCount > 0 ? variation / float(sampleCount) : 0.0;
}

// Calculate optimal text color based on background
vec4 calculateAdaptiveTextColor(vec3 oceanColor, float foamFactor, float waveActivity) {
    float luminance = getLuminance(oceanColor);
    float perceivedBrightness = getPerceivedBrightness(oceanColor);

    // Use perceived brightness for more natural color switching
    float backgroundBrightness = mix(luminance, perceivedBrightness, 0.3);

    // Adjust threshold based on foam and wave activity
    float dynamicThreshold = u_contrastThreshold;
    dynamicThreshold += foamFactor * 0.2;        // Lower threshold in foam areas
    dynamicThreshold -= waveActivity * 0.1;      // Higher threshold in active wave areas

    // Calculate smooth transition factor
    float transition = smoothstep(
        dynamicThreshold - u_transitionWidth * 0.5,
        dynamicThreshold + u_transitionWidth * 0.5,
        backgroundBrightness
    );

    // Define text colors
    vec3 darkTextColor = vec3(0.05, 0.05, 0.05);    // Very dark for light backgrounds
    vec3 lightTextColor = vec3(0.95, 0.95, 0.95);   // Very light for dark backgrounds

    // Enhanced contrast in foam areas
    if (foamFactor > 0.3) {
        darkTextColor = vec3(0.0, 0.0, 0.0);        // Pure black on foam
        lightTextColor = vec3(1.0, 1.0, 1.0);       // Pure white on dark water
    }

    // Interpolate between dark and light text based on background
    vec3 textColor = mix(lightTextColor, darkTextColor, transition);

    // Calculate shadow/outline color for enhanced readability
    vec3 shadowColor = mix(darkTextColor, lightTextColor, transition);
    float shadowIntensity = mix(0.3, 0.6, foamFactor); // Stronger shadow in foam areas

    return vec4(textColor, shadowIntensity);
}

// Generate subtle text outline for enhanced readability
float getTextOutline(vec2 uv, float textAlpha) {
    if (textAlpha > 0.5) return 1.0; // Already on text

    vec2 texelSize = 1.0 / textureSize(u_textTexture, 0);
    float outline = 0.0;

    // Check surrounding pixels for text presence
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            if (x == 0 && y == 0) continue;

            vec2 sampleUV = uv + vec2(float(x), float(y)) * texelSize;
            float sampleAlpha = texture(u_textTexture, sampleUV).a;

            if (sampleAlpha > 0.1) {
                outline = max(outline, sampleAlpha * 0.3); // Subtle outline
            }
        }
    }

    return outline;
}

void main() {
    // Convert screen position to UV for ocean texture sampling
    vec2 oceanUV = (v_screenPos + 1.0) * 0.5;

    // Sample text texture (alpha channel contains text presence)
    vec4 textSample = texture(u_textTexture, v_uv);
    float textAlpha = textSample.a;

    // Early exit if no text at this pixel
    if (textAlpha < 0.01) {
        discard;
        return;
    }

    // Sample ocean color at this pixel position
    vec3 oceanColor = texture(u_oceanTexture, oceanUV).rgb;

    // Analyze background characteristics
    float foamFactor = getFoamFactor(oceanColor);
    float waveActivity = getWaveActivity(oceanUV);

    // Calculate adaptive text color
    vec4 colorAndShadow = calculateAdaptiveTextColor(oceanColor, foamFactor, waveActivity);
    vec3 adaptiveTextColor = colorAndShadow.rgb;
    float shadowIntensity = colorAndShadow.a;

    // Add subtle outline for enhanced readability
    float outlineAlpha = getTextOutline(v_uv, textAlpha);

    // Combine text and outline
    float finalAlpha = max(textAlpha, outlineAlpha);
    vec3 finalColor = adaptiveTextColor;

    // Apply outline darkening where appropriate
    if (outlineAlpha > textAlpha) {
        float outlineFactor = (outlineAlpha - textAlpha) / max(outlineAlpha, 0.001);
        vec3 outlineColor = mix(adaptiveTextColor, vec3(0.0), shadowIntensity);
        finalColor = mix(adaptiveTextColor, outlineColor, outlineFactor);
    }

    // Debug visualization modes
    if (u_debugMode == 1) {
        // Mode 1: Show raw text texture (white on transparent)
        finalColor = vec3(1.0, 1.0, 1.0); // Pure white text
        finalAlpha = textAlpha; // Use original text alpha

    } else if (u_debugMode == 2) {
        // Mode 2: Show ocean texture sampling
        finalColor = oceanColor; // Show sampled ocean color
        finalAlpha = textAlpha; // Only where text exists

    } else if (u_debugMode == 3) {
        // Mode 3: Show background analysis with color coding
        float luminance = getLuminance(oceanColor);

        // Color-code the analysis
        if (foamFactor > 0.3) {
            finalColor = mix(finalColor, vec3(1.0, 0.0, 0.0), 0.3); // Red tint for foam
        } else if (waveActivity > 0.1) {
            finalColor = mix(finalColor, vec3(0.0, 1.0, 0.0), 0.2); // Green tint for wave activity
        } else if (luminance > u_contrastThreshold) {
            finalColor = mix(finalColor, vec3(0.0, 0.0, 1.0), 0.2); // Blue tint for bright areas
        }

        // Show transition zones
        float transition = smoothstep(
            u_contrastThreshold - u_transitionWidth * 0.5,
            u_contrastThreshold + u_transitionWidth * 0.5,
            luminance
        );
        if (transition > 0.1 && transition < 0.9) {
            finalColor = mix(finalColor, vec3(1.0, 1.0, 0.0), 0.3); // Yellow for transition zones
        }
    }

    // Add subtle time-based shimmer for visual interest
    float shimmer = sin(u_time * 3.0 + v_uv.x * 10.0 + v_uv.y * 7.0) * 0.02 + 1.0;
    finalColor *= shimmer;

    // Output final color with proper alpha
    fragColor = vec4(finalColor, finalAlpha);

    // Ensure we have visible text
    if (fragColor.a < 0.01) {
        discard;
    }
}
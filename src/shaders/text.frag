#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_texCoord;               // Font texture coordinates
in vec2 v_screenPos;              // Screen position for ocean sampling
in vec2 v_localPos;               // Local position within text bounds
in float v_time;                  // Time for animations

// Uniforms
uniform sampler2D u_fontTexture;  // Font atlas texture
uniform sampler2D u_oceanTexture; // Ocean scene texture for color sampling
uniform vec2 u_resolution;        // Screen resolution
uniform float u_textOpacity;      // Overall text opacity
uniform float u_fontSize;         // Font size for edge enhancement
uniform bool u_enableWaveSync;    // Enable wave-synchronized breathing effect

// Output
out vec4 fragColor;

// Constants for color analysis and inversion
const vec3 LUMINANCE_WEIGHTS = vec3(0.299, 0.587, 0.114);
const float CONTRAST_THRESHOLD = 0.5;
const float MIN_CONTRAST_RATIO = 4.5; // WCAG AA standard
const float EDGE_SMOOTHNESS = 0.1;

// Perceptual contrast calculation
float calculateContrast(vec3 color1, vec3 color2) {
    float lum1 = dot(color1, LUMINANCE_WEIGHTS);
    float lum2 = dot(color2, LUMINANCE_WEIGHTS);

    float lighter = max(lum1, lum2);
    float darker = min(lum1, lum2);

    return (lighter + 0.05) / (darker + 0.05);
}

// Enhanced inverse color calculation with dynamic contrast
vec3 calculateInverseColor(vec3 oceanColor, float intensity) {
    // Calculate perceptual luminance
    float luminance = dot(oceanColor, LUMINANCE_WEIGHTS);

    // Dynamic color selection based on ocean color characteristics
    vec3 textColor;

    if (luminance > CONTRAST_THRESHOLD) {
        // Ocean is bright - use dark text
        // Create a complementary dark color with slight blue tint
        float darknessAmount = (1.0 - luminance) * 0.8 + 0.15;
        textColor = vec3(0.05, 0.08, 0.12) * darknessAmount;

        // Add subtle warm contrast to cool ocean tones
        if (oceanColor.b > oceanColor.r) {
            textColor.r += 0.02;
        }
    } else {
        // Ocean is dark - use light text
        // Create a bright color with enhanced contrast
        float brightnessAmount = luminance + 0.85;
        textColor = vec3(0.95, 0.97, 1.0) * brightnessAmount;

        // Add slight blue tint for ocean harmony
        textColor.b = min(textColor.b + 0.05, 1.0);
    }

    // Ensure minimum contrast ratio
    float currentContrast = calculateContrast(textColor, oceanColor);
    if (currentContrast < MIN_CONTRAST_RATIO) {
        if (luminance > CONTRAST_THRESHOLD) {
            // Make text darker
            textColor *= 0.5;
        } else {
            // Make text brighter
            textColor = min(textColor * 1.5, vec3(1.0));
        }
    }

    // Apply intensity modulation
    return textColor * intensity;
}

// Sample ocean color with slight offset for edge detection
vec3 sampleOceanColorWithEdgeDetection(vec2 screenPos) {
    // Convert screen position to UV coordinates for ocean texture sampling
    vec2 oceanUV = (screenPos + 1.0) * 0.5;

    // Ensure UV coordinates are within bounds
    oceanUV = clamp(oceanUV, vec2(0.001), vec2(0.999));

    // Sample base ocean color
    vec3 baseColor = texture(u_oceanTexture, oceanUV).rgb;

    // Sample surrounding pixels for edge detection
    float texelSize = 1.0 / min(u_resolution.x, u_resolution.y);
    vec3 colorUp = texture(u_oceanTexture, oceanUV + vec2(0.0, texelSize)).rgb;
    vec3 colorDown = texture(u_oceanTexture, oceanUV + vec2(0.0, -texelSize)).rgb;
    vec3 colorLeft = texture(u_oceanTexture, oceanUV + vec2(-texelSize, 0.0)).rgb;
    vec3 colorRight = texture(u_oceanTexture, oceanUV + vec2(texelSize, 0.0)).rgb;

    // Calculate color variation for edge enhancement
    vec3 colorVariation = abs(colorUp - colorDown) + abs(colorLeft - colorRight);
    float edgeIntensity = dot(colorVariation, LUMINANCE_WEIGHTS);

    // Use the color that provides best contrast
    if (edgeIntensity > 0.1) {
        // High variation area - use average for stability
        return (baseColor + colorUp + colorDown + colorLeft + colorRight) * 0.2;
    } else {
        // Low variation area - use base color
        return baseColor;
    }
}

void main() {
    // Sample font texture for character shape
    float fontSample = texture(u_fontTexture, v_texCoord).r;

    // Early discard for transparent areas
    if (fontSample < 0.1) {
        discard;
    }

    // Sample ocean color at current screen position
    vec3 oceanColor = sampleOceanColorWithEdgeDetection(v_screenPos);

    // Calculate wave-synchronized breathing effect
    float breathingIntensity = 1.0;
    if (u_enableWaveSync) {
        float wavePhase = length(v_screenPos) * 5.0 - v_time * 2.0;
        breathingIntensity = 0.9 + 0.1 * sin(wavePhase);
    }

    // Calculate optimal inverse color
    vec3 textColor = calculateInverseColor(oceanColor, breathingIntensity);

    // SDF-based edge calculation for smooth rendering
    float edgeDistance = fontSample;
    float edgeWidth = fwidth(edgeDistance) * 0.5;
    float alpha = smoothstep(0.5 - edgeWidth, 0.5 + edgeWidth, edgeDistance);

    // Edge enhancement based on font size
    float sizeBasedEdge = clamp(u_fontSize / 32.0, 0.5, 2.0);
    alpha = pow(alpha, 1.0 / sizeBasedEdge);

    // Character outline for improved readability in complex backgrounds
    float outlineWidth = edgeWidth * 2.0;
    float outlineAlpha = smoothstep(0.4 - outlineWidth, 0.4 + outlineWidth, edgeDistance);

    // Combine main character with subtle outline
    vec3 outlineColor = calculateInverseColor(oceanColor, breathingIntensity * 0.3);
    vec3 finalColor = mix(outlineColor, textColor, alpha);
    float finalAlpha = max(alpha, outlineAlpha * 0.3) * u_textOpacity;

    // Add subtle glow effect for enhanced visibility
    float glowIntensity = smoothstep(0.2, 0.6, edgeDistance) * 0.1;
    finalColor += textColor * glowIntensity;

    // Apply subtle animation to alpha for living feel
    if (u_enableWaveSync) {
        float alphaAnimation = 0.95 + 0.05 * sin(v_time * 3.0 + v_localPos.x * 0.1);
        finalAlpha *= alphaAnimation;
    }

    fragColor = vec4(finalColor, finalAlpha);
}
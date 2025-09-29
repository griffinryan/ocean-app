#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_sceneTexture;   // Combined ocean + glass scene
uniform sampler2D u_textTexture;    // Text mask texture from Canvas
uniform vec2 u_textPosition;        // Text position in screen space
uniform vec2 u_textSize;           // Text size in screen space
uniform float u_adaptiveStrength;   // Strength of adaptive coloring

out vec4 fragColor;

// Adaptive coloring constants
const float LUMINANCE_THRESHOLD = 0.5;
const float CONTRAST_STRENGTH = 8.0;
const float EDGE_SMOOTHING = 0.1;
const vec3 DARK_TEXT_COLOR = vec3(0.0, 0.0, 0.0);   // Black for light backgrounds
const vec3 LIGHT_TEXT_COLOR = vec3(1.0, 1.0, 1.0);  // White for dark backgrounds

// Enhanced luminance calculation with blue emphasis for ocean scenes
float calculateLuminance(vec3 color) {
    // Standard luminance weights with slight blue emphasis for ocean
    return dot(color, vec3(0.299, 0.587, 0.200));
}

// Smooth adaptive color transition
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength) {
    float luminance = calculateLuminance(backgroundColor);

    // Create smooth transition around threshold
    float colorMix = smoothstep(
        LUMINANCE_THRESHOLD - EDGE_SMOOTHING,
        LUMINANCE_THRESHOLD + EDGE_SMOOTHING,
        luminance
    );

    // Enhanced contrast around the threshold
    colorMix = pow(colorMix, CONTRAST_STRENGTH);

    // Mix between dark and light text colors
    vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);

    // Apply adaptive strength (allows for less aggressive adaptation if needed)
    return mix(LIGHT_TEXT_COLOR, adaptiveColor, adaptiveStrength);
}

// Add subtle outline effect for better text visibility
vec3 addTextOutline(vec2 uv, sampler2D textTexture, vec3 textColor) {
    float textAlpha = texture(textTexture, uv).a;

    // Sample surrounding pixels for outline detection
    float outlineRadius = 2.0 / 1024.0; // Adjust based on texture resolution

    float outline = 0.0;
    outline += texture(textTexture, uv + vec2(-outlineRadius, -outlineRadius)).a;
    outline += texture(textTexture, uv + vec2(0.0, -outlineRadius)).a;
    outline += texture(textTexture, uv + vec2(outlineRadius, -outlineRadius)).a;
    outline += texture(textTexture, uv + vec2(-outlineRadius, 0.0)).a;
    outline += texture(textTexture, uv + vec2(outlineRadius, 0.0)).a;
    outline += texture(textTexture, uv + vec2(-outlineRadius, outlineRadius)).a;
    outline += texture(textTexture, uv + vec2(0.0, outlineRadius)).a;
    outline += texture(textTexture, uv + vec2(outlineRadius, outlineRadius)).a;

    outline /= 8.0;

    // Create outline effect
    float outlineStrength = smoothstep(0.1, 0.3, outline) * (1.0 - textAlpha);
    vec3 outlineColor = 1.0 - textColor; // Inverse color for outline

    return mix(textColor, outlineColor, outlineStrength * 0.3);
}

void main() {
    // Convert screen position to UV coordinates
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Sample the background scene (ocean + glass combined)
    vec3 backgroundColor = texture(u_sceneTexture, screenUV).rgb;

    // Sample the text mask texture
    float textAlpha = texture(u_textTexture, v_uv).a;

    // Early discard for areas with no text
    if (textAlpha < 0.01) {
        discard;
    }

    // Calculate adaptive text color based on background
    vec3 adaptiveTextColor = calculateAdaptiveTextColor(backgroundColor, u_adaptiveStrength);

    // Add subtle outline for better visibility
    vec3 finalTextColor = addTextOutline(v_uv, u_textTexture, adaptiveTextColor);

    // Apply smooth anti-aliasing to text edges
    float smoothAlpha = smoothstep(0.0, 0.1, textAlpha);

    // Add subtle glow effect for better visibility in complex backgrounds
    float glowRadius = 4.0 / 1024.0;
    float glow = 0.0;

    // Sample surrounding area for glow
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            if (x == 0 && y == 0) continue;
            vec2 offset = vec2(float(x), float(y)) * glowRadius;
            glow += texture(u_textTexture, v_uv + offset).a;
        }
    }

    glow /= 24.0; // 5x5 grid minus center
    glow = smoothstep(0.0, 0.5, glow) * (1.0 - textAlpha);

    // Create subtle glow with inverse color
    vec3 glowColor = 1.0 - finalTextColor;
    finalTextColor = mix(finalTextColor, glowColor, glow * 0.2);

    // Enhance alpha with glow
    float finalAlpha = max(smoothAlpha, glow * 0.3);

    // Add slight color enhancement for better contrast
    finalTextColor = mix(finalTextColor, finalTextColor * 1.1, 0.3);

    // Ensure text maintains good visibility
    finalTextColor = clamp(finalTextColor, vec3(0.0), vec3(1.0));

    fragColor = vec4(finalTextColor, finalAlpha);
}
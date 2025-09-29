#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_sceneTexture;   // Combined ocean + glass scene
uniform sampler2D u_textTexture;    // Text mask texture from Canvas
uniform float u_adaptiveStrength;   // Strength of adaptive coloring

out vec4 fragColor;

// Adaptive coloring constants
const float LUMINANCE_THRESHOLD = 0.5;
const vec3 DARK_TEXT_COLOR = vec3(0.0, 0.0, 0.0);   // Black for light backgrounds
const vec3 LIGHT_TEXT_COLOR = vec3(1.0, 1.0, 1.0);  // White for dark backgrounds

// 4x4 Bayer dithering matrix for ordered dithering patterns (from ocean.frag)
float bayerDither4x4(vec2 position) {
    // Bayer matrix values normalized to [0,1]
    int x = int(mod(position.x, 4.0));
    int y = int(mod(position.y, 4.0));

    // 4x4 Bayer matrix
    float bayerMatrix[16] = float[16](
        0.0/16.0,  8.0/16.0,  2.0/16.0,  10.0/16.0,
        12.0/16.0, 4.0/16.0,  14.0/16.0, 6.0/16.0,
        3.0/16.0,  11.0/16.0, 1.0/16.0,  9.0/16.0,
        15.0/16.0, 7.0/16.0,  13.0/16.0, 5.0/16.0
    );

    return bayerMatrix[y * 4 + x];
}

// Enhanced luminance calculation with blue emphasis for ocean scenes
float calculateLuminance(vec3 color) {
    // Standard luminance weights with slight blue emphasis for ocean
    return dot(color, vec3(0.299, 0.587, 0.200));
}

// Quantize color for stylized look (from ocean.frag)
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

// Fast adaptive color selection using step function
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength) {
    float luminance = calculateLuminance(backgroundColor);

    // Simple step function for performance (instead of smoothstep)
    float colorMix = step(LUMINANCE_THRESHOLD, luminance);

    // Mix between dark and light text colors
    vec3 adaptiveColor = mix(LIGHT_TEXT_COLOR, DARK_TEXT_COLOR, colorMix);

    // Apply adaptive strength
    return mix(LIGHT_TEXT_COLOR, adaptiveColor, adaptiveStrength);
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

    // Apply Bayer dithering for stylized quantization (like ocean.frag)
    float dither = bayerDither4x4(gl_FragCoord.xy);

    // Quantize the adaptive color to match ocean's stylized look
    vec3 quantizedColor = quantizeColor(adaptiveTextColor, 8);

    // Add subtle dithering for smooth gradients
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float animatedDither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    quantizedColor += vec3((animatedDither - 0.5) * 0.02);

    // Create range from black to white based on background luminance
    float luminance = calculateLuminance(backgroundColor);
    float colorLevel = luminance + dither * 0.3 + animatedDither * 0.2;

    // Map to black-white range with dithering
    vec3 ditherColor = vec3(clamp(colorLevel, 0.0, 1.0));

    // Mix between quantized adaptive color and dithered grayscale
    vec3 finalTextColor = mix(quantizedColor, ditherColor, 0.3);

    // Simple anti-aliasing using step function (more performant than smoothstep)
    float smoothAlpha = step(0.05, textAlpha);

    // Ensure proper contrast
    finalTextColor = clamp(finalTextColor, vec3(0.0), vec3(1.0));

    fragColor = vec4(finalTextColor, smoothAlpha);
}
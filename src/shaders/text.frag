#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_textTexture;    // Text mask texture from Canvas
uniform float u_adaptiveStrength;   // Strength of adaptive coloring

// Single panel uniforms (since we render one panel at a time)
uniform vec2 u_panelPosition;      // Panel center position in screen space [-1,1]
uniform vec2 u_panelSize;          // Panel size in screen space

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

// Check if current fragment is within the panel boundary
bool isWithinPanel(vec2 screenPos, out vec2 panelUV) {
    // Convert screen position to panel-relative coordinates
    vec2 panelCenter = (u_panelPosition + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
    vec2 panelHalfSize = u_panelSize * 0.5;

    // Calculate position relative to panel center
    vec2 deltaFromCenter = screenPos - panelCenter;
    vec2 localPanelUV = deltaFromCenter / panelHalfSize + 0.5;

    // Check if within panel bounds
    if (localPanelUV.x >= 0.0 && localPanelUV.x <= 1.0 &&
        localPanelUV.y >= 0.0 && localPanelUV.y <= 1.0) {
        panelUV = localPanelUV;
        return true;
    }
    return false;
}

void main() {
    // Convert screen position to UV coordinates
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Check if we're within the panel boundary
    vec2 panelUV;
    if (!isWithinPanel(screenUV, panelUV)) {
        discard; // Only render text within this panel
    }

    // Sample the text mask texture using panel-relative UV coordinates
    // Map panel UV to texture UV (since the texture contains this panel's text)
    float textAlpha = texture(u_textTexture, panelUV).a;

    // Early discard for areas with no text
    if (textAlpha < 0.01) {
        discard;
    }

    // For now, use simple white text - we can add adaptive coloring later
    vec3 finalTextColor = vec3(1.0, 1.0, 1.0);

    // Apply Bayer dithering for stylized quantization to match ocean style
    float dither = bayerDither4x4(gl_FragCoord.xy);

    // Quantize the color to match ocean's stylized look
    vec3 quantizedColor = quantizeColor(finalTextColor, 8);

    // Add subtle dithering for smooth gradients
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float animatedDither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    quantizedColor += vec3((animatedDither - 0.5) * 0.02);

    // Simple anti-aliasing
    float smoothAlpha = smoothstep(0.1, 0.9, textAlpha);

    // Add soft edge fade for panel boundaries
    float edgeFade = 1.0;
    float fadeWidth = 0.05; // 5% fade at edges
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);

    // Apply edge fade to alpha
    smoothAlpha *= edgeFade;

    // Ensure proper contrast
    quantizedColor = clamp(quantizedColor, vec3(0.0), vec3(1.0));

    fragColor = vec4(quantizedColor, smoothAlpha);
}
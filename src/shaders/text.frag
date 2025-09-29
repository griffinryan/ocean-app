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

// Panel positions and sizes for boundary checking (matching GlassRenderer approach)
uniform vec2 u_panelPositions[5];  // Panel center positions in screen space [-1,1]
uniform vec2 u_panelSizes[5];      // Panel sizes in screen space
uniform int u_panelCount;

// Glass-inspired adaptive coloring constants (matching liquid glass system)
const float LUMINANCE_THRESHOLD = 0.45;

// Glass color palette (inspired by glass.frag)
const vec3 GLASS_TINT_BASE = vec3(0.92, 0.96, 1.0);
const vec3 GLASS_EDGE_LIGHT = vec3(0.8, 0.9, 1.0);
const vec3 GLASS_CAUSTIC = vec3(0.7, 0.9, 1.0);
const vec3 GLASS_RIM = vec3(0.9, 0.95, 1.0);
const vec3 GLASS_REFLECTION = vec3(0.85, 0.92, 1.0);

// Enhanced text color range for higher fidelity tracking
const vec3 DARK_TEXT_BASE = vec3(0.15, 0.25, 0.35);    // Dark blue-tinted for light backgrounds
const vec3 LIGHT_TEXT_BASE = vec3(0.85, 0.92, 1.0);    // Glass-tinted white for dark backgrounds

// Intermediate colors for smooth transitions
const vec3 MID_DARK = vec3(0.3, 0.45, 0.6);           // Medium blue for mid-tone backgrounds
const vec3 MID_LIGHT = vec3(0.75, 0.85, 0.95);        // Light blue-white
const vec3 ACCENT_COLOR = vec3(0.6, 0.8, 1.0);        // Bright blue accent

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

// Enhanced adaptive color selection with glass-inspired transitions
vec3 calculateAdaptiveTextColor(vec3 backgroundColor, float adaptiveStrength, vec2 uv, float time) {
    float luminance = calculateLuminance(backgroundColor);

    // Multi-level color selection for higher fidelity
    vec3 adaptiveColor;

    if (luminance < 0.25) {
        // Very dark background - use bright glass-tinted text
        adaptiveColor = mix(LIGHT_TEXT_BASE, GLASS_RIM, 0.3);

        // Add subtle blue accent for very dark areas
        float blueBoost = (0.25 - luminance) * 2.0; // 0-2 range
        adaptiveColor = mix(adaptiveColor, ACCENT_COLOR, blueBoost * 0.2);

    } else if (luminance < LUMINANCE_THRESHOLD) {
        // Medium-dark background - transition to mid-light
        float t = (luminance - 0.25) / (LUMINANCE_THRESHOLD - 0.25);
        adaptiveColor = mix(LIGHT_TEXT_BASE, MID_LIGHT, t * 0.6);

    } else if (luminance < 0.7) {
        // Medium background - use balanced colors
        float t = (luminance - LUMINANCE_THRESHOLD) / (0.7 - LUMINANCE_THRESHOLD);
        adaptiveColor = mix(MID_LIGHT, MID_DARK, t);

        // Add glass caustic effect for medium tones
        float causticPattern = sin(uv.x * 15.0 + time * 2.0) * cos(uv.y * 12.0 + time * 1.5);
        causticPattern = max(0.0, causticPattern) * 0.05;
        adaptiveColor = mix(adaptiveColor, GLASS_CAUSTIC, causticPattern);

    } else {
        // Bright background - use darker glass-tinted text
        float t = (luminance - 0.7) / 0.3;
        adaptiveColor = mix(MID_DARK, DARK_TEXT_BASE, t);

        // Add glass tint for bright backgrounds
        adaptiveColor = mix(adaptiveColor, GLASS_TINT_BASE * 0.5, 0.3);
    }

    // Apply glass edge enhancement at panel boundaries
    vec2 edgeDist = min(uv, 1.0 - uv);
    float edgeEffect = 1.0 - smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));
    adaptiveColor = mix(adaptiveColor, GLASS_EDGE_LIGHT, edgeEffect * 0.15);

    // Apply adaptive strength with glass enhancement
    vec3 baseColor = mix(MID_LIGHT, adaptiveColor, adaptiveStrength);

    return baseColor;
}

// Add chromatic aberration effect (inspired by glass.frag)
vec3 applyTextChromaticAberration(sampler2D sceneTexture, vec2 uv, float strength) {
    float aberration = strength * 0.002;

    vec3 color = vec3(
        texture(sceneTexture, uv + vec2(aberration, 0.0)).r,
        texture(sceneTexture, uv).g,
        texture(sceneTexture, uv - vec2(aberration, 0.0)).b
    );

    return color * GLASS_TINT_BASE;
}

// Check if current fragment is within any panel boundary (from GlassRenderer)
bool isWithinPanel(vec2 screenPos, out vec2 panelUV) {
    for (int i = 0; i < u_panelCount && i < 5; i++) {
        // Convert screen position to panel-relative coordinates
        vec2 panelCenter = (u_panelPositions[i] + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
        vec2 panelHalfSize = u_panelSizes[i] * 0.5;

        // Calculate position relative to panel center
        vec2 deltaFromCenter = screenPos - panelCenter;
        vec2 localPanelUV = deltaFromCenter / panelHalfSize + 0.5;

        // Check if within panel bounds
        if (localPanelUV.x >= 0.0 && localPanelUV.x <= 1.0 &&
            localPanelUV.y >= 0.0 && localPanelUV.y <= 1.0) {
            panelUV = localPanelUV;
            return true;
        }
    }
    return false;
}

void main() {
    // Convert screen position to UV coordinates
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Check if we're within any panel boundary
    vec2 panelUV;
    if (!isWithinPanel(screenUV, panelUV)) {
        discard; // Only render text within panels
    }

    // Sample the background scene (ocean + glass combined)
    vec3 backgroundColor = texture(u_sceneTexture, screenUV).rgb;

    // Apply chromatic aberration to background sampling for glass effect
    vec3 chromaticBackground = applyTextChromaticAberration(u_sceneTexture, screenUV, 1.0);
    backgroundColor = mix(backgroundColor, chromaticBackground, 0.15);

    // Sample the text mask texture using corrected UV coordinates
    float textAlpha = texture(u_textTexture, v_uv).a;

    // Early discard for areas with no text
    if (textAlpha < 0.01) {
        discard;
    }

    // Calculate enhanced adaptive text color with glass effects
    vec3 adaptiveTextColor = calculateAdaptiveTextColor(backgroundColor, u_adaptiveStrength, panelUV, v_time);

    // Apply flowing glass distortion patterns to text color
    vec2 flowingUV = panelUV + vec2(
        sin(panelUV.y * 8.0 + v_time * 1.5) * 0.02,
        cos(panelUV.x * 6.0 + v_time * 1.2) * 0.02
    );

    // Add liquid glass surface variations
    float surfaceVariation = sin(flowingUV.x * 12.0) * cos(flowingUV.y * 10.0 + v_time * 0.8);
    surfaceVariation = max(0.0, surfaceVariation) * 0.08;
    adaptiveTextColor = mix(adaptiveTextColor, GLASS_REFLECTION, surfaceVariation);

    // Apply Bayer dithering for stylized quantization with reduced levels for smoother glass look
    float dither = bayerDither4x4(gl_FragCoord.xy);

    // Quantize with more levels for glass-like smoothness (12 vs 8)
    vec3 quantizedColor = quantizeColor(adaptiveTextColor, 12);

    // Add subtle animated dithering for liquid glass movement
    vec2 ditherPos = gl_FragCoord.xy * 0.75 + v_time * 0.1;
    float animatedDither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);

    // Reduce dither strength for cleaner glass appearance
    quantizedColor += vec3((animatedDither - 0.5) * 0.01);

    // Create glass-tinted range based on background luminance
    float luminance = calculateLuminance(backgroundColor);
    float colorLevel = luminance + dither * 0.15 + animatedDither * 0.1;

    // Map to glass-tinted range instead of pure black-white
    vec3 glassRange = mix(DARK_TEXT_BASE, LIGHT_TEXT_BASE, clamp(colorLevel, 0.0, 1.0));

    // Mix quantized adaptive color with glass-tinted range (reduced mixing for cleaner result)
    vec3 finalTextColor = mix(quantizedColor, glassRange, 0.15);

    // Enhanced anti-aliasing with smoothstep for better text edges
    float smoothAlpha = smoothstep(0.02, 0.08, textAlpha);

    // Add soft edge fade for panel boundaries with glass-like transition
    float edgeFade = 1.0;
    float fadeWidth = 0.03; // Tighter fade for glass clarity
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);

    // Add glass rim lighting at text edges
    float rimEffect = 1.0 - smoothstep(0.85, 1.0, textAlpha);
    finalTextColor = mix(finalTextColor, GLASS_RIM, rimEffect * 0.1);

    // Apply edge fade to alpha with enhanced glass opacity
    smoothAlpha *= edgeFade;

    // Add glass-style inner glow
    float innerGlow = smoothstep(0.3, 0.7, textAlpha);
    finalTextColor = mix(finalTextColor, finalTextColor * 1.2, innerGlow * 0.1);

    // Ensure proper contrast with glass-enhanced clamping
    finalTextColor = clamp(finalTextColor, DARK_TEXT_BASE * 0.5, LIGHT_TEXT_BASE * 1.1);

    fragColor = vec4(finalTextColor, smoothAlpha);
}
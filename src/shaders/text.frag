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
uniform float u_textIntroProgress;  // Text intro animation progress (0.0 = start, 1.0 = complete)

out vec4 fragColor;

// Panel positions and sizes for boundary checking (matching GlassRenderer approach)
uniform vec2 u_panelPositions[5];  // Panel center positions in screen space [-1,1]
uniform vec2 u_panelSizes[5];      // Panel sizes in screen space
uniform int u_panelCount;

// Wake texture uniform (rendered by WakeRenderer)
uniform sampler2D u_wakeTexture;
uniform bool u_wakesEnabled;

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

// Cubic ease-out function for smooth intro animation settling
float cubicEaseOut(float t) {
    float f = t - 1.0;
    return f * f * f + 1.0;
}

// Hash function for procedural noise (from ocean.frag)
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Improved noise function for organic distortion
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// ===== WAVE PHYSICS FUNCTIONS =====

const float PI = 3.14159265359;

// Simple sine wave for procedural ocean
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * PI / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// Sample wake texture (rendered by WakeRenderer at lower resolution)
float sampleWakeTexture(vec2 oceanPos) {
    if (!u_wakesEnabled) return 0.0;

    // Convert ocean coordinates to UV space [0,1]
    // Ocean space is [-15*aspectRatio, 15*aspectRatio] x [-15, 15]
    vec2 wakeUV = vec2(
        (oceanPos.x / (15.0 * u_aspectRatio)) * 0.5 + 0.5,
        (oceanPos.y / 15.0) * 0.5 + 0.5
    );

    // Sample wake texture (R channel contains wake height)
    return texture(u_wakeTexture, wakeUV).r;
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
    // Convert screen position to UV coordinates [0,1]
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // Check if we're within any panel boundary
    vec2 panelUV;
    if (!isWithinPanel(screenUV, panelUV)) {
        discard; // Only render text within panels
    }

    // Sample the background scene (ocean + glass combined)
    vec3 backgroundColor = texture(u_sceneTexture, screenUV).rgb;

    // ===== SAMPLE WAKE TEXTURE FOR CONTINUOUS MOTION =====
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 15.0;
    oceanPos.x *= u_aspectRatio;

    // Sample wake texture (rendered by WakeRenderer)
    // Returns height values from vessel wakes + ocean waves
    float wakeHeight = sampleWakeTexture(oceanPos);

    // ===== TEXT INTRO ANIMATION =====
    // Calculate distortion amount based on intro progress
    float eased = cubicEaseOut(u_textIntroProgress);
    float distortionAmount = 1.0 - eased; // 1.0 at start, 0.0 at end

    // Multi-frequency sine waves for organic wiggly motion
    float wave1 = sin(screenUV.y * 30.0 + v_time * 8.0) * 0.12;
    float wave2 = sin(screenUV.x * 20.0 - v_time * 6.0) * 0.08;
    float wave3 = sin((screenUV.x + screenUV.y) * 25.0 + v_time * 7.0) * 0.06;

    // Low-frequency wave for deep amplitude sway
    float deepWave = sin(screenUV.y * 8.0 + v_time * 3.0) * 0.20;

    // Organic noise variation
    float noiseValue = noise(screenUV * 12.0 + v_time * 1.5) * 0.04;

    // Combine all distortions for intro animation
    vec2 introDistortion = vec2(
        wave1 + wave3 + deepWave + noiseValue,
        wave2 + wave3 + noiseValue
    );

    // ===== CONTINUOUS WAVE-BASED DISTORTION (ALWAYS ACTIVE) =====
    // Create flowing distortion based on wake height and ocean position
    // This provides continuous floating motion even after intro completes
    vec2 waveDistortionVec = vec2(
        sin(oceanPos.y * 0.5 + v_time * 1.2) * wakeHeight,
        cos(oceanPos.x * 0.5 + v_time * 1.0) * wakeHeight
    ) * 0.015; // Gentle continuous motion (1.5% of screen)

    // Add gentle ambient motion even when no wakes present
    vec2 ambientMotion = vec2(
        sin(oceanPos.y * 0.3 + v_time * 0.8) * 0.003,
        cos(oceanPos.x * 0.3 + v_time * 0.6) * 0.003
    );

    // Apply combined distortion: intro animation (fades out) + continuous wave motion (always on)
    vec2 totalDistortion = introDistortion * distortionAmount + waveDistortionVec + ambientMotion;
    vec2 distortedUV = screenUV + totalDistortion;

    // Sample the text texture with distorted UV coordinates
    float textAlpha = texture(u_textTexture, distortedUV).a;

    // ===== RENDER TEXT OR GLOW =====
    vec3 finalColor;
    float finalAlpha;

    if (textAlpha > 0.01) {
        // ===== TEXT RENDERING PATH =====

        // Calculate adaptive text color based on background
        vec3 adaptiveTextColor = calculateAdaptiveTextColor(backgroundColor, u_adaptiveStrength);

        // Quantize the adaptive color to match ocean's stylized look
        vec3 quantizedColor = quantizeColor(adaptiveTextColor, 8);

        // Use clean quantized color as base
        finalColor = quantizedColor;

        // ===== WAKE-REACTIVE EFFECTS =====
        // Add subtle brightness boost and shimmer when vessels pass
        if (u_wakesEnabled) {
            // Wake intensity (0.0 = no wake, positive = wake present)
            float wakeIntensity = abs(wakeHeight) * 2.0; // Amplify for visibility
            wakeIntensity = clamp(wakeIntensity, 0.0, 1.0);

            // Pulsing shimmer based on wake intensity
            float shimmerPhase = v_time * 4.0 + oceanPos.x * 0.5 + oceanPos.y * 0.3;
            float shimmer = sin(shimmerPhase) * 0.5 + 0.5; // [0, 1]
            float wakeShimmer = wakeIntensity * shimmer * 0.12; // Gentle 12% max boost

            // Brightness boost in wake regions
            float wakeBrightness = wakeIntensity * 0.08; // 8% brightness boost

            // Apply wake effects to text color
            finalColor += vec3(wakeBrightness + wakeShimmer);

            // Add subtle blue-white tint in high-intensity wake regions
            // Mimics light refracting through disturbed water
            if (wakeIntensity > 0.3) {
                vec3 wakeTint = vec3(0.85, 0.92, 1.0); // Cool blue-white
                float tintStrength = (wakeIntensity - 0.3) * 0.15; // Fade in above threshold
                finalColor = mix(finalColor, wakeTint, tintStrength);
            }

            // Ensure color stays in valid range
            finalColor = clamp(finalColor, vec3(0.0), vec3(1.0));
        }

        // Gentle anti-aliasing for text edges
        finalAlpha = smoothstep(0.1, 0.5, textAlpha);

    } else {
        // ===== NO GLOW - DISCARD NON-TEXT PIXELS =====
        // Let the blur map (frosted glass effect) handle visual interest around text
        discard;
    }

    // ===== APPLY PANEL EDGE FADE =====
    float edgeFade = 1.0;
    float fadeWidth = 0.05; // 5% fade at edges
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);

    // Apply edge fade to alpha
    finalAlpha *= edgeFade;

    // Ensure proper values
    finalColor = clamp(finalColor, vec3(0.0), vec3(1.0));

    fragColor = vec4(finalColor, finalAlpha);
}
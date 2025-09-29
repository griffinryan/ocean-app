#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_oceanTexture; // The rendered ocean scene

// Panel arrays for full-screen rendering
uniform int u_panelCount;           // Number of active panels
uniform vec2 u_panelPositions[10];  // Panel positions in screen space
uniform vec2 u_panelSizes[10];      // Panel sizes in screen space
uniform float u_distortionStrengths[10]; // Distortion strength per panel

// Legacy single-panel uniforms (kept for compatibility)
uniform vec2 u_panelPosition;     // Panel position in screen space
uniform vec2 u_panelSize;         // Panel size in screen space
uniform float u_distortionStrength; // How strong the distortion is
uniform float u_refractionIndex;    // Index of refraction for glass

out vec4 fragColor;

// Glass properties
const float GLASS_THICKNESS = 0.05;
const float SURFACE_ROUGHNESS = 0.25;
const vec3 GLASS_TINT = vec3(0.92, 0.96, 1.0);
const float FRESNEL_POWER = 1.8;
const float LIQUID_FLOW_SPEED = 0.4;
const float DISTORTION_SCALE = 15.0;

// Hash function for noise
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Improved noise function for surface distortion
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

// Advanced liquid glass surface calculation with flow
vec3 calculateLiquidGlassNormal(vec2 uv, float time) {
    // Multi-scale liquid distortion
    float flow1 = time * LIQUID_FLOW_SPEED;
    float flow2 = time * LIQUID_FLOW_SPEED * 1.7;

    // Create flowing liquid patterns
    vec2 flowDir1 = vec2(cos(flow1 * 0.8), sin(flow1 * 1.2));
    vec2 flowDir2 = vec2(cos(flow2 * 1.3), sin(flow2 * 0.9));

    // Flowing noise layers for liquid effect
    float h = noise(uv * DISTORTION_SCALE + flowDir1 * 2.0) * 0.08;
    h += noise(uv * DISTORTION_SCALE * 1.5 + flowDir2 * 1.5) * 0.05;
    h += noise(uv * DISTORTION_SCALE * 2.5 + time * 0.6) * 0.03;

    // Add ripple patterns for liquid surface
    float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
    h += ripple * exp(-length(uv - 0.5) * 3.0);

    // Voronio-like cell patterns for liquid bubbles
    vec2 cellUv = uv * 8.0 + time * 0.2;
    vec2 cellId = floor(cellUv);
    vec2 cellPos = fract(cellUv);
    float cellDist = length(cellPos - 0.5);
    h += (0.5 - cellDist) * 0.01;

    // Calculate enhanced gradient for stronger normal perturbation
    float epsilon = 0.002;
    float hx = noise((uv + vec2(epsilon, 0.0)) * DISTORTION_SCALE + flowDir1 * 2.0) * 0.08;
    float hy = noise((uv + vec2(0.0, epsilon)) * DISTORTION_SCALE + flowDir1 * 2.0) * 0.08;

    vec3 normal = normalize(vec3(
        (h - hx) / epsilon * 2.0,
        (h - hy) / epsilon * 2.0,
        1.0
    ));

    return normal;
}

// Fresnel effect calculation
float fresnel(float cosTheta, float refractionIndex) {
    float f0 = pow((refractionIndex - 1.0) / (refractionIndex + 1.0), 2.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, FRESNEL_POWER);
}

// Calculate refraction vector using Snell's law
vec3 calculateRefraction(vec3 incident, vec3 normal, float eta) {
    float cosI = -dot(normal, incident);
    float sinT2 = eta * eta * (1.0 - cosI * cosI);

    if (sinT2 > 1.0) {
        return vec3(0.0); // Total internal reflection
    }

    float cosT = sqrt(1.0 - sinT2);
    return eta * incident + (eta * cosI - cosT) * normal;
}

void main() {
    // Convert screen position to UV coordinates
    vec2 screenUV = (v_screenPos + 1.0) * 0.5;

    // For initial testing: just show the ocean texture
    vec3 oceanColor = texture(u_oceanTexture, screenUV).rgb;

    // Add a subtle tint to verify glass shader is working
    oceanColor += vec3(0.05, 0.1, 0.15) * sin(v_time) * 0.1;

    fragColor = vec4(oceanColor, 1.0);
}
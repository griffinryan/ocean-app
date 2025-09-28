#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_oceanTexture; // The rendered ocean scene
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
    screenUV.y = 1.0 - screenUV.y; // Flip Y coordinate

    // Calculate position relative to panel with corrected coordinate mapping
    vec2 panelCenter = (u_panelPosition + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
    vec2 panelHalfSize = u_panelSize * 0.5; // Half-size for center-based calculation

    // Calculate panel UV coordinates directly
    vec2 deltaFromCenter = screenUV - panelCenter;
    vec2 panelUV = deltaFromCenter / panelHalfSize + 0.5; // Direct mapping to [0,1] range

    // Strict boundary enforcement - only render within exact panel bounds
    if (panelUV.x < 0.0 || panelUV.x > 1.0 || panelUV.y < 0.0 || panelUV.y > 1.0) {
        discard;
    }

    // Add soft edge fade for smoother transitions at boundaries
    float edgeFade = 1.0;
    float fadeWidth = 0.02; // 2% fade at edges
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, panelUV.y);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.x);
    edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - panelUV.y);

    // Calculate liquid glass surface normal with flowing animation
    vec3 glassNormal = calculateLiquidGlassNormal(panelUV, v_time);

    // View direction (looking into the screen)
    vec3 viewDir = vec3(0.0, 0.0, -1.0);

    // Calculate incident angle
    float cosTheta = dot(-viewDir, glassNormal);

    // Calculate Fresnel reflectance
    float fresnelReflection = fresnel(cosTheta, u_refractionIndex);

    // Calculate refraction direction
    vec3 refractionDir = calculateRefraction(viewDir, glassNormal, 1.0 / u_refractionIndex);

    // Calculate uniform distorted UV coordinates with consistent liquid warping
    vec2 distortedUV = screenUV;

    if (length(refractionDir) > 0.0) {
        // Apply uniform refraction offset
        vec2 refractionOffset = refractionDir.xy * u_distortionStrength;

        // Enhanced flowing liquid distortion patterns
        vec2 liquidOffset = vec2(
            sin(panelUV.y * 12.0 + v_time * 2.5) * 0.04,
            cos(panelUV.x * 10.0 + v_time * 2.0) * 0.04
        );

        // Multiple ripple layers for complexity
        float ripplePhase1 = length(panelUV - 0.5) * 15.0 - v_time * 4.0;
        float ripplePhase2 = length(panelUV - 0.3) * 20.0 - v_time * 3.5;
        vec2 rippleOffset = normalize(panelUV - 0.5) * (sin(ripplePhase1) * 0.025 + sin(ripplePhase2) * 0.015);

        // Add noise-based distortion for more organic feel
        vec2 noisePos = panelUV * 8.0 + v_time * 0.8;
        vec2 noiseOffset = vec2(
            noise(noisePos) - 0.5,
            noise(noisePos + vec2(100.0)) - 0.5
        ) * 0.03;

        // Combine all distortion effects with enhanced strength
        vec2 totalOffset = refractionOffset + liquidOffset + rippleOffset + noiseOffset;

        // Much stronger distortion for clear visibility
        totalOffset *= u_distortionStrength * 3.0;

        distortedUV += totalOffset;
    }

    // Ensure UV coordinates stay within bounds
    distortedUV = clamp(distortedUV, vec2(0.001), vec2(0.999));

    // Sample the ocean texture with distortion
    vec3 oceanColor = texture(u_oceanTexture, distortedUV).rgb;

    // Apply glass tinting
    oceanColor *= GLASS_TINT;

    // Uniform chromatic aberration across entire panel
    float chromaticAberration = u_distortionStrength * 0.006;
    float chromaticFlow = sin(v_time * 1.0) * 0.001;

    vec3 chromaticColor = vec3(
        texture(u_oceanTexture, distortedUV + vec2(chromaticAberration + chromaticFlow, 0.0)).r,
        texture(u_oceanTexture, distortedUV).g,
        texture(u_oceanTexture, distortedUV - vec2(chromaticAberration - chromaticFlow, 0.0)).b
    );

    // Apply uniform chromatic aberration mixing
    oceanColor = mix(oceanColor, chromaticColor * GLASS_TINT, 0.35);

    // Enhanced glass surface reflection with flow
    vec3 reflection = vec3(0.85, 0.92, 1.0) * fresnelReflection * 0.15;

    // Add flowing highlights
    float flowHighlight = sin(panelUV.x * 8.0 + v_time * 3.0) * cos(panelUV.y * 6.0 + v_time * 2.0);
    reflection += vec3(0.9, 0.95, 1.0) * flowHighlight * 0.03;

    // Enhanced edge glow with liquid-like variation
    float edgeGlow = 1.0 - smoothstep(0.0, 0.08, min(
        min(panelUV.x, 1.0 - panelUV.x),
        min(panelUV.y, 1.0 - panelUV.y)
    ));

    // Add pulsing edge effect
    float edgePulse = 0.5 + 0.5 * sin(v_time * 4.0);
    edgeGlow *= (0.7 + 0.3 * edgePulse);

    // Stronger edge illumination with blue tint
    vec3 edgeLight = vec3(0.8, 0.9, 1.0) * edgeGlow * 0.12;

    // Add caustic light patterns for underwater glass effect
    vec2 causticUV = panelUV * 3.0 + v_time * 0.1;
    float caustic1 = sin(causticUV.x * 12.0) * sin(causticUV.y * 8.0);
    float caustic2 = cos(causticUV.x * 8.0 + v_time * 2.0) * cos(causticUV.y * 10.0 + v_time * 1.5);
    float causticPattern = (caustic1 + caustic2) * 0.5;
    causticPattern = max(0.0, causticPattern) * 0.08;

    vec3 causticLight = vec3(0.7, 0.9, 1.0) * causticPattern * fresnelReflection;

    // Add surface imperfections and micro-scratches
    float scratchPattern = noise(panelUV * 50.0 + v_time * 0.05);
    scratchPattern = smoothstep(0.4, 0.6, scratchPattern) * 0.02;
    vec3 scratches = vec3(1.0, 1.0, 1.0) * scratchPattern;

    // Apple-style rim lighting
    float rimIntensity = pow(1.0 - abs(dot(normalize(vec3(0, 0, 1)), glassNormal)), 2.0);
    vec3 rimLight = vec3(0.9, 0.95, 1.0) * rimIntensity * 0.1;

    // Depth-based color tinting (thicker glass appears more blue)
    float depth = length(panelUV - 0.5) * GLASS_THICKNESS;
    vec3 depthTint = mix(vec3(1.0), vec3(0.85, 0.92, 1.0), depth * 2.0);

    // Combine all effects with proper layering
    vec3 finalColor = oceanColor * depthTint + reflection + edgeLight + causticLight + scratches + rimLight;

    // Enhanced glass opacity with much stronger visibility
    float alpha = 0.4 + fresnelReflection * 0.15;

    // Add flowing opacity variation
    float opacityFlow = sin(panelUV.x * 5.0 + v_time * 1.8) * cos(panelUV.y * 4.0 + v_time * 1.2);
    alpha += opacityFlow * 0.05;

    // Much stronger edge opacity for clear borders
    alpha += edgeGlow * 0.3;

    // Add depth-based opacity
    alpha += depth * 0.15;

    // Add a subtle glass tint to the background
    vec3 glassTint = vec3(0.9, 0.95, 1.0);
    finalColor = mix(finalColor, finalColor * glassTint, 0.2);

    // Add visible crystalline patterns
    float crystalPattern = sin(panelUV.x * 30.0) * sin(panelUV.y * 30.0) * 0.1;
    finalColor += vec3(crystalPattern * 0.15);

    // Apply edge fade to final alpha for smooth boundaries
    alpha *= edgeFade;

    // Ensure minimum visibility only within bounds
    alpha = max(alpha, 0.2 * edgeFade);

    fragColor = vec4(finalColor, alpha);
}
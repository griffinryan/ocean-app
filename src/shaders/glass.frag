#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;
in vec2 v_panelSize;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_oceanTexture; // The rendered ocean scene
uniform vec2 u_panelPosition;     // Panel position in screen space
uniform vec2 u_panelSize;         // Panel size in screen space
uniform float u_distortionStrength; // How strong the distortion is
uniform float u_refractionIndex;    // Index of refraction for glass
uniform float u_borderRadius;       // Border radius in pixels for rounded corners

// Blur map uniforms for frosted glass effect around text
uniform sampler2D u_blurMapTexture;
uniform bool u_blurMapEnabled;
uniform float u_blurOpacityBoost;      // How much to increase opacity (0.0-0.5)
uniform float u_blurDistortionBoost;   // How much to reduce distortion (0.0-1.0)
uniform float u_textPresence;             // Text visibility factor (0 = hidden, 1 = fully visible)

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

// Signed Distance Field for rounded rectangle
// Returns distance to rounded box boundary (negative = inside, positive = outside)
// p: point to test (relative to box center)
// size: half-size of the box (from center to edge)
// radius: corner radius
float sdRoundedBox(vec2 p, vec2 size, float radius) {
    vec2 d = abs(p) - size + radius;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - radius;
}

// PERFORMANCE: Calculate pixel-density LOD for adaptive detail
// Similar to ocean shader, uses screen-space derivatives
float calculateGlassLOD(vec2 panelUV) {
    vec2 dx = dFdx(panelUV);
    vec2 dy = dFdy(panelUV);

    // Derivative represents UV units per pixel
    float maxDerivative = max(length(dx), length(dy));

    // CRITICAL FIX: Invert derivative to get pixels per UV unit
    // Small derivative (high pixel density) → high LOD (less detail)
    // Large derivative (low pixel density) → low LOD (more detail)
    float pixelsPerUVUnit = 1.0 / max(0.001, maxDerivative);

    // Map to LOD range [0, 2.5]
    // Glass panels are smaller than ocean, so use different tuning
    float lod = log2(pixelsPerUVUnit) - 8.0;

    return clamp(lod, 0.0, 2.5);
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

// PERFORMANCE: Adaptive liquid glass normal with LOD-based noise reduction
vec3 calculateLiquidGlassNormalAdaptive(vec2 uv, float time, float lod) {
    float flow1 = time * LIQUID_FLOW_SPEED;
    float flow2 = time * LIQUID_FLOW_SPEED * 1.7;

    vec2 flowDir1 = vec2(cos(flow1 * 0.8), sin(flow1 * 1.2));
    vec2 flowDir2 = vec2(cos(flow2 * 1.3), sin(flow2 * 0.9));

    // Adaptive noise octaves based on LOD
    // LOD 0-1: 3 noise layers (full detail)
    // LOD 1-2: 2 noise layers
    // LOD 2+: 1 noise layer (minimal)
    float h = noise(uv * DISTORTION_SCALE + flowDir1 * 2.0) * 0.08;

    if (lod < 2.0) {
        h += noise(uv * DISTORTION_SCALE * 1.5 + flowDir2 * 1.5) * 0.05;
    }

    if (lod < 1.0) {
        h += noise(uv * DISTORTION_SCALE * 2.5 + time * 0.6) * 0.03;
    }

    // Ripple and cell patterns only at high detail
    if (lod < 1.5) {
        float ripple = sin(length(uv - 0.5) * 20.0 - time * 4.0) * 0.02;
        h += ripple * exp(-length(uv - 0.5) * 3.0);

        vec2 cellUv = uv * 8.0 + time * 0.2;
        vec2 cellPos = fract(cellUv);
        float cellDist = length(cellPos - 0.5);
        h += (0.5 - cellDist) * 0.01;
    }

    // Simplified gradient calculation at higher LOD
    float epsilon = 0.002 * (1.0 + lod * 0.3);
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

    // Sample blur map EARLY (before boundary check for efficiency)
    float blurIntensity = 0.0;
    if (u_blurMapEnabled) {
        blurIntensity = texture(u_blurMapTexture, clamp(screenUV, vec2(0.0), vec2(1.0))).r;
        blurIntensity *= u_textPresence;
    }

    // Calculate position relative to panel with corrected coordinate mapping
    vec2 panelCenter = (u_panelPosition + 1.0) * 0.5; // Convert from [-1,1] to [0,1]
    vec2 panelHalfSize = u_panelSize * 0.5; // Half-size for center-based calculation

    // Calculate panel UV coordinates directly
    vec2 deltaFromCenter = screenUV - panelCenter;
    vec2 panelUV = deltaFromCenter / panelHalfSize + 0.5; // Direct mapping to [0,1] range

    // Convert panel size from normalized coordinates to pixels for accurate radius calculation
    vec2 panelSizePixels = v_panelSize * u_resolution;
    vec2 panelPosPixels = (panelUV - 0.5) * panelSizePixels;
    vec2 panelSizeHalf = panelSizePixels * 0.5;

    // Use inner border radius (CSS: calc(var(--panel-radius) - 2px))
    // This matches the ::after element's inner border
    float innerRadius = u_borderRadius - 2.0;

    // Calculate distance to rounded rectangle boundary
    float dist = sdRoundedBox(panelPosPixels, panelSizeHalf, innerRadius);

    // Discard pixels outside rounded rectangle
    if (dist > 0.0) {
        discard;
    }

    // Distance-based edge fade for smooth antialiasing (2px fade at boundary)
    float edgeFade = smoothstep(2.0, -2.0, dist);

    // PERFORMANCE: Calculate pixel-density LOD for adaptive detail
    float lod = calculateGlassLOD(panelUV);

    // Calculate liquid glass surface normal with adaptive detail
    vec3 glassNormal = calculateLiquidGlassNormalAdaptive(panelUV, v_time, lod);

    // View direction (looking into the screen)
    vec3 viewDir = vec3(0.0, 0.0, -1.0);

    // Calculate incident angle
    float cosTheta = dot(-viewDir, glassNormal);

    // Calculate Fresnel reflectance
    float fresnelReflection = fresnel(cosTheta, u_refractionIndex);

    // Calculate refraction direction
    vec3 refractionDir = calculateRefraction(viewDir, glassNormal, 1.0 / u_refractionIndex);

    // MODULATE DISTORTION based on blur intensity
    // In text regions: reduce distortion for cleaner frosted effect
    float effectiveDistortion = u_distortionStrength;
    if (u_blurMapEnabled && blurIntensity > 0.01) {
        // Simple distortion reduction in blur regions
        effectiveDistortion *= (1.0 - blurIntensity * u_blurDistortionBoost);
    }

    // Calculate uniform distorted UV coordinates with consistent liquid warping
    vec2 distortedUV = screenUV;

    if (length(refractionDir) > 0.0) {
        // Apply uniform refraction offset with MODULATED distortion
        vec2 refractionOffset = refractionDir.xy * effectiveDistortion;

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

        // Enhanced distortion balanced with opacity (use effectiveDistortion)
        totalOffset *= effectiveDistortion * 2.5;

        distortedUV += totalOffset;
    }

    // Ensure UV coordinates stay within bounds
    distortedUV = clamp(distortedUV, vec2(0.001), vec2(0.999));

    // Sample the ocean texture with distortion
    vec2 oceanUV = clamp(vec2(distortedUV.x, 1.0 - distortedUV.y), vec2(0.0), vec2(1.0));
    vec3 oceanColor = texture(u_oceanTexture, oceanUV).rgb;

    // Apply orientation fix for chromatic aberration sampling using same flipped UV base
    vec2 baseUV = oceanUV;


    // Apply glass tinting
    oceanColor *= GLASS_TINT;

    // Uniform chromatic aberration across entire panel
    float chromaticAberration = u_distortionStrength * 0.006;
    float chromaticFlow = sin(v_time * 1.0) * 0.001;

    vec3 chromaticColor = vec3(
        texture(u_oceanTexture, clamp(baseUV + vec2(chromaticAberration + chromaticFlow, 0.0), vec2(0.0), vec2(1.0))).r,
        texture(u_oceanTexture, baseUV).g,
        texture(u_oceanTexture, clamp(baseUV - vec2(chromaticAberration - chromaticFlow, 0.0), vec2(0.0), vec2(1.0))).b
    );

    // Apply uniform chromatic aberration mixing
    oceanColor = mix(oceanColor, chromaticColor * GLASS_TINT, 0.35);

    // Enhanced glass surface reflection with flow
    vec3 reflection = vec3(0.85, 0.92, 1.0) * fresnelReflection * 0.15;

    // Add flowing highlights
    float flowHighlight = sin(panelUV.x * 8.0 + v_time * 3.0) * cos(panelUV.y * 6.0 + v_time * 2.0);
    reflection += vec3(0.9, 0.95, 1.0) * flowHighlight * 0.03;

    // Enhanced edge glow with liquid-like variation (distance-based for rounded corners)
    // Distance to edge: negative dist means we're inside, closer to 0 means closer to edge
    float distanceToEdge = abs(dist);
    float edgeGlow = exp(-distanceToEdge * 0.15);  // Exponential falloff from edge

    // Add pulsing edge effect
    float edgePulse = 0.5 + 0.5 * sin(v_time * 4.0);
    edgeGlow *= (0.7 + 0.3 * edgePulse);

    // Stronger edge illumination with blue tint
    vec3 edgeLight = vec3(0.8, 0.9, 1.0) * edgeGlow * 0.12;

    // PERFORMANCE: Caustic light patterns only at high detail (LOD < 1.5)
    // These sin/cos patterns are expensive and barely visible at low pixel density
    vec3 causticLight = vec3(0.0);
    if (lod < 1.5) {
        vec2 causticUV = panelUV * 3.0 + v_time * 0.1;
        float caustic1 = sin(causticUV.x * 12.0) * sin(causticUV.y * 8.0);
        float caustic2 = cos(causticUV.x * 8.0 + v_time * 2.0) * cos(causticUV.y * 10.0 + v_time * 1.5);
        float causticPattern = (caustic1 + caustic2) * 0.5;
        causticPattern = max(0.0, causticPattern) * 0.08;
        causticLight = vec3(0.7, 0.9, 1.0) * causticPattern * fresnelReflection;
    }

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

    // Increased opacity for cleaner glass panels (reduced ocean bleed-through)
    float alpha = 0.85 + fresnelReflection * 0.15;

    // Add flowing opacity variation
    float opacityFlow = sin(panelUV.x * 5.0 + v_time * 1.8) * cos(panelUV.y * 4.0 + v_time * 1.2);
    alpha += opacityFlow * 0.05;

    // Reduced edge opacity addition for cleaner look
    alpha += edgeGlow * 0.15;

    // Reduced depth-based opacity
    alpha += depth * 0.1;

    // Add a subtle glass tint to the background
    vec3 glassTint = vec3(0.9, 0.95, 1.0);
    finalColor = mix(finalColor, finalColor * glassTint, 0.2);

    // Add visible crystalline patterns
    float crystalPattern = sin(panelUV.x * 30.0) * sin(panelUV.y * 30.0) * 0.1;
    finalColor += vec3(crystalPattern * 0.15);

    // MODULATE OPACITY and add FROST TINT based on blur intensity
    if (u_blurMapEnabled && blurIntensity > 0.01) {
        // Boost opacity in text regions for stronger frosted effect
        alpha += blurIntensity * u_blurOpacityBoost;

        // Add subtle blue-white frost tint (KEEP SUBTLE at 0.10 for text coloring preservation)
        // Reduced from original 0.12 to minimize background luminance impact
        float frostTint = blurIntensity * 0.10;
        vec3 frostColor = vec3(0.92, 0.96, 1.0);
        finalColor = mix(finalColor, frostColor, frostTint);
    }

    // Apply edge fade to final alpha for smooth boundaries
    alpha *= edgeFade;

    // Ensure high minimum visibility (85% opaque minimum)
    alpha = max(alpha, 0.85 * edgeFade);

    fragColor = vec4(finalColor, alpha);
}

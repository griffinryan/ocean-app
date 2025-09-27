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
const float GLASS_THICKNESS = 0.02;
const float SURFACE_ROUGHNESS = 0.1;
const vec3 GLASS_TINT = vec3(0.95, 0.98, 1.0);
const float FRESNEL_POWER = 2.0;

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

// Calculate normal from height function for glass surface
vec3 calculateGlassNormal(vec2 uv, float time) {
    float scale = 8.0;
    float speed = 0.3;

    // Create subtle surface distortion
    float h = noise(uv * scale + time * speed) * 0.02;
    h += noise(uv * scale * 2.0 + time * speed * 1.5) * 0.01;
    h += noise(uv * scale * 4.0 - time * speed * 0.8) * 0.005;

    // Calculate gradient for normal
    float epsilon = 0.001;
    float hx = noise((uv + vec2(epsilon, 0.0)) * scale + time * speed) * 0.02;
    float hy = noise((uv + vec2(0.0, epsilon)) * scale + time * speed) * 0.02;

    vec3 normal = normalize(vec3(
        (h - hx) / epsilon,
        (h - hy) / epsilon,
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
vec3 refract(vec3 incident, vec3 normal, float eta) {
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

    // Calculate position relative to panel
    vec2 panelUV = (screenUV - u_panelPosition) / u_panelSize;

    // Only render within panel bounds
    if (panelUV.x < 0.0 || panelUV.x > 1.0 || panelUV.y < 0.0 || panelUV.y > 1.0) {
        discard;
    }

    // Calculate glass surface normal with subtle animation
    vec3 glassNormal = calculateGlassNormal(panelUV, v_time);

    // View direction (looking into the screen)
    vec3 viewDir = vec3(0.0, 0.0, -1.0);

    // Calculate incident angle
    float cosTheta = dot(-viewDir, glassNormal);

    // Calculate Fresnel reflectance
    float fresnelReflection = fresnel(cosTheta, u_refractionIndex);

    // Calculate refraction direction
    vec3 refractionDir = refract(viewDir, glassNormal, 1.0 / u_refractionIndex);

    // Calculate distorted UV coordinates for sampling ocean texture
    vec2 distortedUV = screenUV;

    if (length(refractionDir) > 0.0) {
        // Apply refraction offset
        vec2 refractionOffset = refractionDir.xy * u_distortionStrength;

        // Add position-dependent distortion based on distance from panel center
        vec2 centerOffset = panelUV - 0.5;
        float distanceFromCenter = length(centerOffset);
        float edgeFalloff = smoothstep(0.3, 0.5, distanceFromCenter);

        // Reduce distortion near edges for realistic glass effect
        refractionOffset *= (1.0 - edgeFalloff * 0.6);

        distortedUV += refractionOffset;
    }

    // Ensure UV coordinates stay within bounds
    distortedUV = clamp(distortedUV, vec2(0.001), vec2(0.999));

    // Sample the ocean texture with distortion
    vec3 oceanColor = texture(u_oceanTexture, distortedUV).rgb;

    // Apply glass tinting
    oceanColor *= GLASS_TINT;

    // Add chromatic aberration for more realistic glass effect
    float chromaticAberration = u_distortionStrength * 0.003;
    vec3 chromaticColor = vec3(
        texture(u_oceanTexture, distortedUV + vec2(chromaticAberration, 0.0)).r,
        texture(u_oceanTexture, distortedUV).g,
        texture(u_oceanTexture, distortedUV - vec2(chromaticAberration, 0.0)).b
    );

    // Mix chromatic aberration based on distance from center
    vec2 centerOffset = panelUV - 0.5;
    float distanceFromCenter = length(centerOffset);
    float chromaticMix = smoothstep(0.2, 0.5, distanceFromCenter);
    oceanColor = mix(oceanColor, chromaticColor * GLASS_TINT, chromaticMix * 0.3);

    // Add subtle glass surface reflection
    vec3 reflection = vec3(0.9, 0.95, 1.0) * fresnelReflection * 0.1;

    // Calculate edge glow effect
    float edgeGlow = 1.0 - smoothstep(0.0, 0.1, min(
        min(panelUV.x, 1.0 - panelUV.x),
        min(panelUV.y, 1.0 - panelUV.y)
    ));

    // Add subtle edge illumination
    vec3 edgeLight = vec3(1.0, 1.0, 1.0) * edgeGlow * 0.05;

    // Combine all effects
    vec3 finalColor = oceanColor + reflection + edgeLight;

    // Apply glass opacity based on Fresnel and position
    float alpha = 0.15 + fresnelReflection * 0.05;

    // Increase opacity near edges for border effect
    alpha += edgeGlow * 0.1;

    fragColor = vec4(finalColor, alpha);
}
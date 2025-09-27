#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

// Uniforms
uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform sampler2D u_oceanTexture; // The rendered ocean scene

// Liquid glass panel uniforms
uniform int u_panelCount;
uniform vec4 u_panelBounds[8]; // xy: min, zw: max in normalized coordinates
uniform vec2 u_panelCenters[8];
uniform float u_panelDistortionStrength[8];
uniform float u_panelStates[8]; // 0=hidden, 1=visible, 0-1=transition
uniform int u_liquidGlassEnabled;

// Liquid glass parameters
uniform float u_liquidViscosity;
uniform float u_surfaceTension;
uniform float u_refractionIndex;
uniform float u_chromaticStrength;
uniform float u_flowSpeed;

// Output
out vec4 fragColor;

// ===== MATH UTILITIES =====

// Hash function for noise
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Improved noise function
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

// Curl noise for turbulent flow
float curlNoise(vec2 p) {
    float eps = 0.1;
    float n1 = noise(p + vec2(eps, 0.0));
    float n2 = noise(p - vec2(eps, 0.0));
    float n3 = noise(p + vec2(0.0, eps));
    float n4 = noise(p - vec2(0.0, eps));

    return ((n1 - n2) - (n3 - n4)) / (2.0 * eps);
}

// ===== LIQUID GLASS PHYSICS =====

// Signed distance function to rectangle
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Calculate signed distance to nearest panel boundary
float computeSignedDistanceToNearestPanel(vec2 screenPos) {
    float minDistance = 999.0;

    for (int i = 0; i < u_panelCount && i < 8; i++) {
        if (u_panelStates[i] < 0.01) continue; // Skip hidden panels

        vec4 bounds = u_panelBounds[i];
        vec2 center = u_panelCenters[i];
        vec2 size = vec2(bounds.z - bounds.x, bounds.w - bounds.y) * 0.5;

        // Calculate distance to this panel
        vec2 localPos = screenPos - center;
        float distance = sdBox(localPos, size);

        minDistance = min(minDistance, distance);
    }

    return minDistance;
}

// Meniscus curvature based on Young-Laplace equation
float meniscusCurvature(float d, float time) {
    float contactAngle = 0.785; // ~45 degrees for glass-water interface
    float surfaceTension = u_surfaceTension;

    // Young-Laplace pressure difference
    float pressure = surfaceTension * cos(contactAngle);

    // Exponential decay from edge with temporal variation
    float timeVar = 1.0 + 0.15 * sin(time * 3.0 + d * 12.0);
    return pressure * exp(-d * 8.0) * timeVar;
}

// Viscous boundary layer profile using Prandtl theory
float viscousProfile(float d, float time) {
    float reynolds = 1000.0 / u_liquidViscosity;
    float boundaryThickness = 5.0 / sqrt(reynolds);

    // Blasius solution approximation
    float profile = 1.0 - exp(-d / boundaryThickness);

    // Add time-dependent perturbations for living liquid effect
    float perturbation = 0.12 * sin(time * 2.5 + d * 18.0);
    perturbation += 0.06 * sin(time * 4.2 - d * 25.0);

    return profile * (1.0 + perturbation);
}

// Liquid flow field simulation around panels
vec2 liquidFlowField(vec2 pos, float time) {
    vec2 totalFlow = vec2(0.0);

    for (int i = 0; i < u_panelCount && i < 8; i++) {
        if (u_panelStates[i] < 0.01) continue; // Skip hidden panels

        vec2 center = u_panelCenters[i];
        vec2 toCenter = pos - center;
        float distance = length(toCenter);

        if (distance > 1.5) continue; // Only affect nearby areas

        float angle = atan(toCenter.y, toCenter.x);

        // Curl noise for turbulence
        float curl = curlNoise(pos * 4.0 + time * u_flowSpeed);

        // Combine rotational and turbulent flow
        vec2 flow = vec2(
            -sin(angle + curl * 0.8),
            cos(angle + curl * 0.8)
        );

        // Modulate by distance from panel and panel state
        float falloff = exp(-distance * 0.5) * u_panelStates[i];
        totalFlow += flow * falloff * u_panelDistortionStrength[i];
    }

    return totalFlow;
}

// Calculate surface normal for refraction
vec3 calculateLiquidSurfaceNormal(vec2 pos, float time) {
    float eps = 0.01;
    float scale = 6.0;

    // Sample height at current position and neighbors
    float h = meniscusCurvature(computeSignedDistanceToNearestPanel(pos), time);
    float hx = meniscusCurvature(computeSignedDistanceToNearestPanel(pos + vec2(eps, 0.0)), time);
    float hy = meniscusCurvature(computeSignedDistanceToNearestPanel(pos + vec2(0.0, eps)), time);

    // Add flow-based surface perturbations
    vec2 flow = liquidFlowField(pos, time);
    h += dot(flow, flow) * 0.5;
    hx += dot(liquidFlowField(pos + vec2(eps, 0.0), time), flow) * 0.5;
    hy += dot(liquidFlowField(pos + vec2(0.0, eps), time), flow) * 0.5;

    // Calculate gradient for normal
    vec3 normal = normalize(vec3(
        (h - hx) / eps * scale,
        (h - hy) / eps * scale,
        1.0
    ));

    return normal;
}

// Optimized liquid glass distortion calculation with cached distance
vec2 calculateLiquidGlassDistortionCached(vec2 screenPos, float panelSDF, float time) {
    // Early exit for distant pixels
    if (panelSDF > 0.4) {
        return vec2(0.0);
    }

    // Calculate surface normal for refraction
    vec3 surfaceNormal = calculateLiquidSurfaceNormal(screenPos, time);

    // View direction (looking into the screen)
    vec3 viewDir = vec3(0.0, 0.0, -1.0);

    // Calculate refraction using Snell's law
    float eta = 1.0 / u_refractionIndex; // Air to liquid ratio
    vec3 refractedDir = refract(viewDir, surfaceNormal, eta);

    // If total internal reflection, use reflection
    if (length(refractedDir) == 0.0) {
        refractedDir = reflect(viewDir, surfaceNormal);
    }

    // Convert refraction to UV offset
    vec2 distortion = refractedDir.xy;

    // Distance-based intensity modulation
    float boundaryEffect = 1.0 - smoothstep(0.0, 0.3, abs(panelSDF));
    float intensity = pow(boundaryEffect, 1.8);

    // Layer-based strength variation
    float layerStrength = 1.0;
    if (abs(panelSDF) < 0.05) {
        // Meniscus layer - maximum distortion
        layerStrength = 2.5;
    } else if (abs(panelSDF) < 0.15) {
        // Viscous layer - strong distortion
        layerStrength = 1.8;
    } else {
        // Bulk liquid - moderate distortion
        layerStrength = 1.0;
    }

    // Apply flow field influence
    vec2 flowInfluence = liquidFlowField(screenPos, time) * 0.3;
    distortion += flowInfluence;

    // Scale and apply intensity
    distortion *= intensity * layerStrength * 0.08; // Increased strength for visibility

    return distortion;
}

// Fresnel effect calculation
float fresnel(float cosTheta, float refractionIndex) {
    float f0 = pow((refractionIndex - 1.0) / (refractionIndex + 1.0), 2.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 3.0);
}

void main() {
    vec2 screenPos = v_screenPos;
    vec2 uv = v_uv;

    // Early exit if liquid glass disabled or no panels
    if (u_liquidGlassEnabled == 0 || u_panelCount == 0) {
        vec3 oceanColor = texture(u_oceanTexture, uv).rgb;
        fragColor = vec4(oceanColor, 1.0);
        return;
    }

    // Calculate distance to nearest panel once for efficiency
    float panelSDF = computeSignedDistanceToNearestPanel(screenPos);

    // Early discard for fragments far from any panel
    if (panelSDF > 0.6) {
        vec3 oceanColor = texture(u_oceanTexture, uv).rgb;
        fragColor = vec4(oceanColor, 1.0);
        return;
    }

    // Calculate liquid glass distortion using cached distance
    vec2 distortion = calculateLiquidGlassDistortionCached(screenPos, panelSDF, v_time);

    // Apply distortion to UV coordinates for sampling ocean texture
    vec2 distortedUV = uv + distortion;

    // Ensure UV coordinates stay within bounds
    distortedUV = clamp(distortedUV, vec2(0.001), vec2(0.999));

    // Sample the ocean texture with distortion
    vec3 oceanColor = texture(u_oceanTexture, distortedUV).rgb;

    // Add chromatic aberration near panel edges using cached distance
    if (abs(panelSDF) < 0.1 && u_chromaticStrength > 0.0) {
        float chromaticEffect = (1.0 - abs(panelSDF) / 0.1) * u_chromaticStrength;
        vec2 chromaticOffset = distortion * chromaticEffect * 0.002;

        // Sample RGB channels with slight offsets
        float r = texture(u_oceanTexture, distortedUV + chromaticOffset).r;
        float g = texture(u_oceanTexture, distortedUV).g;
        float b = texture(u_oceanTexture, distortedUV - chromaticOffset).b;

        oceanColor = vec3(r, g, b);
    }

    // Apply glass tinting
    vec3 glassTint = vec3(0.95, 0.98, 1.02);
    oceanColor *= glassTint;

    // Add surface reflections using Fresnel
    if (u_liquidGlassEnabled != 0 && u_panelCount > 0 && abs(panelSDF) < 0.3) {
        vec3 surfaceNormal = calculateLiquidSurfaceNormal(screenPos, v_time);
        float cosTheta = dot(vec3(0.0, 0.0, -1.0), surfaceNormal);
        float fresnelReflection = fresnel(cosTheta, u_refractionIndex);

        // Simple sky/environment reflection
        vec3 reflectionColor = vec3(0.7, 0.85, 1.0);
        float reflectionStrength = fresnelReflection * 0.15;

        oceanColor = mix(oceanColor, reflectionColor, reflectionStrength);
    }

    // Add subtle surface highlights at panel edges
    if (abs(panelSDF) < 0.02) {
        float edgeGlow = 1.0 - abs(panelSDF) / 0.02;
        vec3 highlight = vec3(1.0, 1.0, 1.0) * edgeGlow * 0.1;
        oceanColor += highlight;
    }

    fragColor = vec4(oceanColor, 1.0);
}
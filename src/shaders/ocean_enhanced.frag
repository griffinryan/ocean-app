#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Environmental parameters
uniform float u_windSpeed;
uniform vec2 u_windDirection;
uniform float u_oceanDepth;
uniform float u_waveAmplitude;

// Texture inputs from various systems
uniform sampler2D u_heightField;     // FFT-generated height displacement
uniform sampler2D u_normalField;     // FFT-generated normals
uniform sampler2D u_velocityField;   // Navier-Stokes velocity field
uniform sampler2D u_foamTexture;     // Accumulated foam texture
uniform sampler2D u_rippleTexture;   // Surface ripples

// Wave parameters
uniform float u_time_scale;
uniform float u_wave_choppiness;
uniform float u_foam_coverage;

out vec4 fragColor;

// Enhanced ocean color palette
const vec3 DEEP_OCEAN = vec3(0.02, 0.10, 0.3);
const vec3 SHALLOW_WATER = vec3(0.08, 0.35, 0.65);
const vec3 SURF_WATER = vec3(0.15, 0.55, 0.85);
const vec3 FOAM_COLOR = vec3(0.95, 0.98, 1.0);
const vec3 FOAM_SHADOW = vec3(0.7, 0.85, 0.95);
const vec3 CAUSTIC_COLOR = vec3(0.4, 0.8, 1.0);

// Improved noise functions
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

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

float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for(int i = 0; i < 8; i++) {
        if(i >= octaves) break;
        value += amplitude * noise(frequency * p);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Gerstner wave function (for fallback/additional waves)
vec2 gerstnerWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float steepness, float time) {
    float k = 2.0 * 3.14159265 / wavelength;
    float c = sqrt(9.8 / k); // Wave speed from physics
    vec2 d = normalize(direction);
    float f = k * (dot(d, pos) - c * speed * time);
    float a = steepness / k;

    return vec2(
        d.x * (a * amplitude * sin(f)),
        amplitude * cos(f)
    );
}

// Enhanced wave height calculation combining FFT and procedural
float getOceanHeight(vec2 pos, float time) {
    // Sample FFT-generated height field
    float fftHeight = texture(u_heightField, v_uv).r;

    // Add procedural Gerstner waves for additional detail
    vec2 gerstner1 = gerstnerWave(pos, u_windDirection, 12.0, 0.8, 1.0, 0.5, time);
    vec2 gerstner2 = gerstnerWave(pos, u_windDirection + vec2(0.3, -0.2), 8.0, 0.6, 1.2, 0.4, time);
    vec2 gerstner3 = gerstnerWave(pos, u_windDirection + vec2(-0.4, 0.5), 15.0, 0.7, 0.8, 0.3, time);

    float proceduralHeight = gerstner1.y + gerstner2.y + gerstner3.y;

    // Combine FFT and procedural waves
    float totalHeight = fftHeight * u_waveAmplitude + proceduralHeight * 0.3;

    // Add fine-scale noise for texture
    vec2 noisePos = pos * 5.0 + time * 0.5;
    totalHeight += fbm(noisePos, 4) * 0.05;

    return totalHeight;
}

// Calculate enhanced normal with multiple sources
vec3 calculateNormal(vec2 pos, float time) {
    // Sample FFT-generated normal
    vec3 fftNormal = texture(u_normalField, v_uv).rgb * 2.0 - 1.0;

    // Calculate procedural normal from height differences
    float eps = 0.1;
    float heightL = getOceanHeight(pos - vec2(eps, 0.0), time);
    float heightR = getOceanHeight(pos + vec2(eps, 0.0), time);
    float heightD = getOceanHeight(pos - vec2(0.0, eps), time);
    float heightU = getOceanHeight(pos + vec2(0.0, eps), time);

    vec3 proceduralNormal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));

    // Sample surface ripples normal
    vec3 rippleNormal = texture(u_rippleTexture, v_uv).rgb * 2.0 - 1.0;

    // Combine normals
    vec3 finalNormal = normalize(fftNormal * 0.6 + proceduralNormal * 0.3 + rippleNormal * 0.1);

    return finalNormal;
}

// Advanced foam calculation
float calculateFoam(vec2 pos, float time, float waveHeight, vec2 velocity) {
    // Sample pre-computed foam texture
    float baseFoam = texture(u_foamTexture, v_uv).r;

    // Dynamic foam based on wave conditions
    float speed = length(velocity);
    float foamFromVelocity = smoothstep(0.15, 0.4, speed);
    float foamFromHeight = smoothstep(0.3, 0.6, waveHeight + 0.5);

    // Foam streaks along wind direction
    vec2 windNorm = normalize(u_windDirection);
    vec2 streakPos = pos + windNorm * time * 2.0;
    float foamStreaks = fbm(streakPos * 8.0, 3);
    foamStreaks = smoothstep(0.7, 0.9, foamStreaks) * 0.3;

    // Breaking wave foam (based on wave steepness)
    float steepness = length(vec2(
        getOceanHeight(pos + vec2(0.1, 0.0), time) - getOceanHeight(pos - vec2(0.1, 0.0), time),
        getOceanHeight(pos + vec2(0.0, 0.1), time) - getOceanHeight(pos - vec2(0.0, 0.1), time)
    ));
    float breakingFoam = smoothstep(0.8, 1.2, steepness) * 0.5;

    // Combine all foam sources
    float totalFoam = clamp(baseFoam + foamFromVelocity + foamFromHeight + foamStreaks + breakingFoam, 0.0, 1.0);

    return totalFoam * u_foam_coverage;
}

// Enhanced caustics calculation
float calculateCaustics(vec2 pos, float time, vec3 normal) {
    // Multiple layers of caustics with different scales and speeds
    vec2 causticPos1 = pos * 25.0 + time * 3.0;
    vec2 causticPos2 = pos * 40.0 - time * 2.5;
    vec2 causticPos3 = pos * 15.0 + time * 4.0;

    float caustic1 = fbm(causticPos1, 3);
    float caustic2 = fbm(causticPos2, 3);
    float caustic3 = fbm(causticPos3, 3);

    caustic1 = smoothstep(0.65, 0.9, caustic1);
    caustic2 = smoothstep(0.7, 0.95, caustic2);
    caustic3 = smoothstep(0.6, 0.85, caustic3);

    // Modulate caustics based on surface normal (focus light)
    float lightFocus = max(0.0, dot(normal, vec3(0.0, 1.0, 0.0)));
    lightFocus = pow(lightFocus, 2.0);

    float totalCaustics = (caustic1 * 0.4 + caustic2 * 0.3 + caustic3 * 0.3) * lightFocus;

    return totalCaustics;
}

// Depth-based color calculation
vec3 calculateDepthColor(float depth, float waveHeight) {
    // Simulate water depth effects
    float normalizedDepth = clamp(depth / 50.0, 0.0, 1.0);

    // Color transition based on depth
    vec3 depthColor = mix(SHALLOW_WATER, DEEP_OCEAN, normalizedDepth);

    // Wave height affects perceived depth
    float waveInfluence = waveHeight * 0.5 + 0.5;
    depthColor = mix(depthColor, SURF_WATER, (1.0 - normalizedDepth) * waveInfluence);

    return depthColor;
}

// Quantize color for stylized look
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 30.0;
    oceanPos.x *= u_aspectRatio;

    // Debug mode outputs
    if (u_debugMode == 1) {
        // Show FFT height field
        float height = texture(u_heightField, v_uv).r;
        fragColor = vec4(vec3(height + 0.5), 1.0);
        return;
    } else if (u_debugMode == 2) {
        // Show velocity field
        vec2 velocity = texture(u_velocityField, v_uv).rg;
        fragColor = vec4(velocity * 0.5 + 0.5, 0.0, 1.0);
        return;
    } else if (u_debugMode == 3) {
        // Show surface normals
        vec3 normal = calculateNormal(oceanPos, v_time);
        fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }

    // Sample velocity field
    vec2 velocity = texture(u_velocityField, v_uv).rg;

    // Calculate wave height
    float waveHeight = getOceanHeight(oceanPos, v_time);

    // Calculate surface normal
    vec3 normal = calculateNormal(oceanPos, v_time);

    // Calculate base ocean color based on depth
    vec3 baseColor = calculateDepthColor(u_oceanDepth, waveHeight);

    // Apply wave height influence on color
    float heightInfluence = waveHeight * 0.5 + 0.5;
    baseColor = mix(baseColor, SURF_WATER, heightInfluence * 0.3);

    // Calculate foam
    float foam = calculateFoam(oceanPos, v_time, waveHeight, velocity);

    // Calculate caustics
    float caustics = calculateCaustics(oceanPos, v_time, normal);

    // Multi-source lighting
    vec3 sunDir = normalize(vec3(0.6, 1.0, 0.4));
    vec3 moonDir = normalize(vec3(-0.3, 0.8, -0.5));
    vec3 ambientDir = normalize(vec3(0.0, 1.0, 0.0));

    float sunLight = max(0.0, dot(normal, sunDir));
    float moonLight = max(0.0, dot(normal, moonDir)) * 0.3;
    float ambientLight = max(0.2, dot(normal, ambientDir)) * 0.5;

    float totalLighting = sunLight + moonLight + ambientLight;
    totalLighting = clamp(totalLighting, 0.3, 1.5);

    // Apply lighting to base color
    baseColor *= totalLighting;

    // Add caustics
    baseColor += CAUSTIC_COLOR * caustics * 0.2;

    // Apply foam
    vec3 foamColor = mix(FOAM_SHADOW, FOAM_COLOR, foam);
    baseColor = mix(baseColor, foamColor, foam);

    // Add specular highlights
    vec3 viewDir = normalize(vec3(0.0, 1.0, 0.0)); // Top-down view
    vec3 reflectDir = reflect(-sunDir, normal);
    float specular = pow(max(0.0, dot(viewDir, reflectDir)), 64.0);
    baseColor += vec3(specular * 0.5);

    // Add shimmer from surface ripples
    vec3 rippleNormal = texture(u_rippleTexture, v_uv).rgb * 2.0 - 1.0;
    float shimmer = pow(max(0.0, dot(rippleNormal, sunDir)), 16.0);
    baseColor += vec3(shimmer * 0.2);

    // Stylistic quantization
    baseColor = quantizeColor(baseColor, 12);

    // Add subtle noise for texture
    vec2 noisePos = gl_FragCoord.xy * 0.5;
    float dither = hash21(noisePos + v_time) * 0.02 - 0.01;
    baseColor += vec3(dither);

    // Atmospheric perspective (distance fog)
    float distance = length(oceanPos) / 30.0;
    float fog = 1.0 - exp(-distance * 0.1);
    vec3 fogColor = vec3(0.7, 0.8, 0.9);
    baseColor = mix(baseColor, fogColor, fog * 0.2);

    fragColor = vec4(baseColor, 1.0);
}
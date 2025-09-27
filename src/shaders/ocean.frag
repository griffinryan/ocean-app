#version 300 es

precision highp float;
precision highp int;

in vec2 v_uv;
in vec2 v_oceanPos;
in vec3 v_worldPos;
in float v_time;
in vec3 v_vertexNormal;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Wave pattern uniforms
uniform int u_wavePatternType;
uniform float u_waveScale;
uniform float u_foamThreshold;
uniform float u_transitionFactor;

// Primary Gerstner waves (up to 8 waves)
uniform float u_primaryAmplitudes[8];
uniform float u_primaryWavelengths[8];
uniform float u_primarySpeeds[8];
uniform vec2 u_primaryDirections[8];
uniform float u_primarySteepness[8];
uniform float u_primaryPhases[8];
uniform int u_numPrimaryWaves;

// Swell systems (up to 3 systems with 4 waves each)
uniform float u_swellAmplitudes[12];
uniform float u_swellWavelengths[12];
uniform float u_swellSpeeds[12];
uniform vec2 u_swellDirections[12];
uniform float u_swellSteepness[12];
uniform float u_swellPhases[12];
uniform int u_numSwellWaves;

// Choppy wave layer
uniform vec2 u_choppyWindDirection;
uniform float u_choppyWindSpeed;
uniform float u_choppyFrequency;
uniform float u_choppyAmplitude;
uniform float u_choppyModulation;

// Performance optimization
uniform float u_lodBias;
uniform vec2 u_cameraPosition;

// Environmental uniforms for natural rendering
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_horizonColor;
uniform float u_sunIntensity;

out vec4 fragColor;

// Natural ocean color palette
const vec3 DEEP_OCEAN = vec3(0.006, 0.024, 0.058);
const vec3 SHALLOW_OCEAN = vec3(0.013, 0.094, 0.169);
const vec3 SURFACE_SCATTER = vec3(0.004, 0.016, 0.047);
const vec3 FOAM_COLOR = vec3(0.95, 0.98, 1.0);
const vec3 WAVE_TIP = vec3(0.8, 0.9, 0.95);

// Physical constants
const float FRESNEL_POWER = 5.0;
const float WATER_IOR = 1.333;
const float AIR_IOR = 1.0;

// Hash function for procedural noise
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

// Multiple octaves of noise
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;

    for(int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// Gerstner wave calculation
struct GerstnerResult {
    float height;
    vec2 displacement;
    vec3 normal;
};

GerstnerResult gerstnerWave(vec2 pos, vec2 direction, float amplitude, float wavelength, float speed, float steepness, float phase, float time) {
    float k = 2.0 * 3.14159 / wavelength;
    float w = speed * k;
    float phi = k * dot(direction, pos) - w * time + phase;

    float sinPhi = sin(phi);
    float cosPhi = cos(phi);

    // Steepness control (Q factor)
    float Q = steepness / (k * amplitude + 0.001); // Prevent division by zero
    Q = min(Q, 0.95); // Prevent loops

    GerstnerResult result;

    // Height displacement
    result.height = amplitude * sinPhi;

    // Horizontal displacement (creates the sharp crests)
    result.displacement = Q * amplitude * direction * cosPhi;

    // Normal calculation
    float dPhi_dx = k * direction.x;
    float dPhi_dy = k * direction.y;

    float normalX = -dPhi_dx * Q * amplitude * sinPhi;
    float normalY = -dPhi_dy * Q * amplitude * sinPhi;
    float normalZ = 1.0 - dPhi_dx * Q * amplitude * cosPhi * direction.x
                       - dPhi_dy * Q * amplitude * cosPhi * direction.y;

    result.normal = vec3(normalX, normalZ, normalY);

    return result;
}

// Fresnel reflection calculation
float calculateFresnel(vec3 normal, vec3 viewDir) {
    float cosTheta = max(0.0, dot(normal, viewDir));
    float fresnel = pow(1.0 - cosTheta, FRESNEL_POWER);

    // Schlick's approximation
    float f0 = pow((AIR_IOR - WATER_IOR) / (AIR_IOR + WATER_IOR), 2.0);
    return f0 + (1.0 - f0) * fresnel;
}

// Calculate distance-based LOD factor
float calculateLOD(vec2 pos) {
    float distance = length(pos - u_cameraPosition);
    float lodFactor = 1.0 - clamp((distance - 10.0) / 50.0, 0.0, 0.8);
    return mix(u_lodBias, 1.0, lodFactor);
}

// Subsurface scattering approximation
vec3 calculateSubsurfaceScattering(vec3 normal, vec3 lightDir, vec3 viewDir) {
    float backlight = max(0.0, dot(-lightDir, viewDir));
    float scatter = pow(backlight, 4.0);
    return SURFACE_SCATTER * scatter * 0.5;
}

// Enhanced wave interference calculation
float calculateWaveInterference(vec2 pos, float time, float lodFactor) {
    float totalHeight = 0.0;
    vec2 totalDisplacement = vec2(0.0);
    vec3 totalNormal = vec3(0.0, 1.0, 0.0);

    // Apply wave scale
    float scale = u_waveScale * lodFactor;

    // Primary Gerstner waves
    for (int i = 0; i < u_numPrimaryWaves && i < 8; i++) {
        GerstnerResult wave = gerstnerWave(
            pos + totalDisplacement,
            u_primaryDirections[i],
            u_primaryAmplitudes[i] * scale,
            u_primaryWavelengths[i],
            u_primarySpeeds[i],
            u_primarySteepness[i],
            u_primaryPhases[i],
            time
        );

        totalHeight += wave.height;
        totalDisplacement += wave.displacement;
        totalNormal += wave.normal;
    }

    // Swell waves with reduced LOD impact
    float swellLOD = max(lodFactor, 0.3);
    for (int i = 0; i < u_numSwellWaves && i < 12; i++) {
        GerstnerResult wave = gerstnerWave(
            pos + totalDisplacement * 0.5,
            u_swellDirections[i],
            u_swellAmplitudes[i] * scale * swellLOD,
            u_swellWavelengths[i],
            u_swellSpeeds[i],
            u_swellSteepness[i],
            u_swellPhases[i],
            time
        );

        totalHeight += wave.height;
        totalDisplacement += wave.displacement * 0.3;
        totalNormal += wave.normal * 0.5;
    }

    return totalHeight;
}

// Choppy wave layer for high-frequency detail
float calculateChoppyWaves(vec2 pos, float time) {
    vec2 windDir = normalize(u_choppyWindDirection);
    float windStrength = u_choppyWindSpeed / 10.0;

    // Multiple octaves of choppy waves
    float choppyHeight = 0.0;
    float frequency = u_choppyFrequency;
    float amplitude = u_choppyAmplitude * windStrength;

    for (int i = 0; i < 3; i++) {
        vec2 waveDir = windDir + vec2(sin(time * 0.1 + float(i)), cos(time * 0.1 + float(i))) * 0.3;
        waveDir = normalize(waveDir);

        float phase = dot(waveDir, pos) * frequency - time * (2.0 + float(i) * 0.5);
        float wave = sin(phase) * amplitude;

        // Add modulation for more organic feeling
        float modulation = 1.0 + sin(time * u_choppyModulation + float(i)) * 0.2;
        choppyHeight += wave * modulation;

        frequency *= 1.7;
        amplitude *= 0.6;
    }

    return choppyHeight;
}

// Enhanced noise with temporal coherence
float enhancedNoise(vec2 pos, float time) {
    // Slower temporal changes for more stability
    vec2 noisePos = pos * 2.5 + vec2(cos(time * 0.05), sin(time * 0.07)) * 2.0;

    float noise1 = fbm(noisePos);
    float noise2 = fbm(noisePos * 1.3 + vec2(time * 0.1));

    return (noise1 * 0.7 + noise2 * 0.3) * 0.06;
}

// Main wave height calculation
float getOceanHeight(vec2 pos, float time) {
    float lodFactor = calculateLOD(pos);

    // Primary wave interference
    float waveHeight = calculateWaveInterference(pos, time, lodFactor);

    // Add choppy waves (reduced with distance)
    waveHeight += calculateChoppyWaves(pos, time) * lodFactor;

    // Add enhanced noise for fine detail
    waveHeight += enhancedNoise(pos, time) * lodFactor;

    return waveHeight;
}

// Calculate normal from height differences
vec3 calculateNormal(vec2 pos, float time) {
    float eps = 0.1;
    float heightL = getOceanHeight(pos - vec2(eps, 0.0), time);
    float heightR = getOceanHeight(pos + vec2(eps, 0.0), time);
    float heightD = getOceanHeight(pos - vec2(0.0, eps), time);
    float heightU = getOceanHeight(pos + vec2(0.0, eps), time);

    vec3 normal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));
    return normal;
}

// Natural foam calculation with persistence
float calculateNaturalFoam(vec2 pos, float height, float time) {
    // Base foam from wave crests
    float foamFromHeight = smoothstep(u_foamThreshold * 0.8, u_foamThreshold * 1.2, height);

    // Dynamic foam patterns with wind direction
    vec2 windDir = normalize(u_choppyWindDirection);
    vec2 foamFlow = pos + windDir * time * u_choppyWindSpeed * 0.08;

    // Multi-scale foam noise
    float foamNoise1 = fbm(foamFlow * 12.0);
    float foamNoise2 = fbm(foamFlow * 24.0) * 0.5;
    float foamPattern = foamNoise1 + foamNoise2;

    // Foam persistence based on wave energy
    float waveEnergy = clamp(height * u_waveScale, 0.0, 1.0);
    float foamPersistence = smoothstep(0.6, 0.9, foamPattern) * waveEnergy;

    return foamFromHeight + foamPersistence * 0.3;
}

// Natural caustics calculation
vec3 calculateNaturalCaustics(vec2 pos, vec3 normal, float time) {
    vec2 causticUV = pos * 0.15 + normal.xz * 0.3;
    causticUV += vec2(cos(time * 0.3), sin(time * 0.4)) * 0.5;

    float caustic1 = fbm(causticUV * 8.0);
    float caustic2 = fbm(causticUV * 16.0) * 0.7;

    float causticPattern = caustic1 + caustic2;
    float causticMask = smoothstep(0.7, 1.0, causticPattern);

    vec3 causticColor = u_sunColor * causticMask * 0.4;
    return causticColor * (1.0 + sin(time * 2.0) * 0.2); // Gentle animation
}

void main() {
    // Use ocean position from vertex shader
    vec2 oceanPos = v_oceanPos;

    // Debug mode outputs
    if (u_debugMode == 1) {
        fragColor = vec4(v_uv, 0.5, 1.0);
        return;
    } else if (u_debugMode == 2) {
        float height = getOceanHeight(oceanPos, v_time);
        float gray = height + 0.5;
        fragColor = vec4(vec3(gray), 1.0);
        return;
    } else if (u_debugMode == 3) {
        vec3 normal = normalize(v_vertexNormal);
        fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }

    // Get wave properties
    float height = getOceanHeight(oceanPos, v_time);
    vec3 normal = normalize(v_vertexNormal);

    // Calculate view direction (top-down view)
    vec3 viewDir = normalize(vec3(0.0, 1.0, 0.0));

    // Sun direction (use default if not provided)
    vec3 sunDir = normalize(mix(vec3(0.3, 0.8, 0.5), u_sunDirection, step(0.1, length(u_sunDirection))));
    vec3 sunColor = mix(vec3(1.0, 0.95, 0.8), u_sunColor, step(0.1, length(u_sunColor)));
    vec3 skyColor = mix(vec3(0.4, 0.7, 1.0), u_skyColor, step(0.1, length(u_skyColor)));

    // Base ocean color with depth variation
    float depth = 1.0 - smoothstep(-0.5, 0.5, height);
    vec3 baseWaterColor = mix(SHALLOW_OCEAN, DEEP_OCEAN, depth);

    // Fresnel reflection
    float fresnel = calculateFresnel(normal, viewDir);

    // Sky reflection with distortion
    vec2 reflectionUV = oceanPos * 0.02 + normal.xz * 0.1;
    vec3 skyReflection = skyColor * (1.0 + fbm(reflectionUV + v_time * 0.1) * 0.2);

    // Subsurface scattering
    vec3 subsurface = calculateSubsurfaceScattering(normal, sunDir, viewDir);

    // Combine water color with physics
    vec3 waterColor = mix(baseWaterColor + subsurface, skyReflection, fresnel);

    // Natural lighting
    float sunlight = max(0.3, dot(normal, sunDir));
    float skylight = 0.6 + 0.4 * normal.y; // Ambient sky lighting

    vec3 lighting = sunColor * sunlight + skyColor * skylight * 0.5;
    waterColor *= lighting;

    // Natural caustics
    vec3 caustics = calculateNaturalCaustics(oceanPos, normal, v_time);
    waterColor += caustics;

    // Natural foam
    float foamAmount = calculateNaturalFoam(oceanPos, height, v_time);
    waterColor = mix(waterColor, FOAM_COLOR, foamAmount);

    // Wave tips highlighting
    float waveTip = smoothstep(u_foamThreshold * 1.1, u_foamThreshold * 1.3, height);
    waterColor = mix(waterColor, WAVE_TIP, waveTip * 0.4);

    // Natural color grading (remove artificial quantization)
    waterColor = pow(waterColor, vec3(0.95)); // Slight gamma adjustment

    // Subtle atmospheric perspective
    float distance = length(oceanPos) * 0.01;
    vec3 atmosphericColor = mix(skyColor, vec3(0.8, 0.9, 1.0), 0.3);
    waterColor = mix(waterColor, atmosphericColor, clamp(distance * 0.1, 0.0, 0.3));

    fragColor = vec4(waterColor, 1.0);
}
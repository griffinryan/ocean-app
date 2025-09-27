#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

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

out vec4 fragColor;

// Ocean color palette
const vec3 DEEP_WATER = vec3(0.05, 0.15, 0.4);
const vec3 SHALLOW_WATER = vec3(0.1, 0.4, 0.7);
const vec3 FOAM_COLOR = vec3(0.9, 0.95, 1.0);
const vec3 WAVE_CREST = vec3(0.3, 0.6, 0.9);

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

// Calculate distance-based LOD factor
float calculateLOD(vec2 pos) {
    float distance = length(pos - u_cameraPosition);
    float lodFactor = 1.0 - clamp((distance - 10.0) / 50.0, 0.0, 0.8);
    return mix(u_lodBias, 1.0, lodFactor);
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

// Quantize color for stylized look
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 15.0; // Scale for wave visibility
    oceanPos.x *= u_aspectRatio; // Maintain aspect ratio

    // Debug mode outputs
    if (u_debugMode == 1) {
        // Show UV coordinates as color
        fragColor = vec4(v_uv, 0.5, 1.0);
        return;
    } else if (u_debugMode == 2) {
        // Show wave height as grayscale
        float height = getOceanHeight(oceanPos, v_time);
        float gray = height + 0.5;
        fragColor = vec4(vec3(gray), 1.0);
        return;
    } else if (u_debugMode == 3) {
        // Show normals as color
        vec3 normal = calculateNormal(oceanPos, v_time);
        fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }

    // Get wave height
    float height = getOceanHeight(oceanPos, v_time);

    // Calculate normal for lighting
    vec3 normal = calculateNormal(oceanPos, v_time);

    // Base ocean color based on height with dynamic scaling
    float heightRange = u_waveScale * 0.6;
    vec3 baseColor = mix(DEEP_WATER, SHALLOW_WATER, smoothstep(-heightRange, heightRange, height));

    // Dynamic wave crests based on wave pattern
    float crestThreshold = u_foamThreshold * 0.6;
    float crestAmount = smoothstep(crestThreshold, crestThreshold + 0.15, height);
    baseColor = mix(baseColor, WAVE_CREST, crestAmount);

    // Dynamic foam based on pattern-specific threshold
    float foamAmount = smoothstep(u_foamThreshold, u_foamThreshold + 0.2, height);

    // Enhanced foam for higher wave patterns
    if (u_wavePatternType >= 3) { // Rough seas and above
        float extraFoam = smoothstep(u_foamThreshold * 0.7, u_foamThreshold, height) * 0.3;
        foamAmount += extraFoam;
    }

    baseColor = mix(baseColor, FOAM_COLOR, foamAmount);

    // Enhanced top-down lighting with multiple light sources
    vec3 mainLight = normalize(vec3(0.6, 1.0, 0.4));
    vec3 rimLight = normalize(vec3(-0.3, 0.8, -0.5));

    float mainLighting = max(0.2, dot(normal, mainLight));
    float rimLighting = max(0.0, dot(normal, rimLight)) * 0.3;

    float totalLighting = mainLighting + rimLighting;
    baseColor *= clamp(totalLighting, 0.3, 1.3);

    // Enhanced caustics with pattern-aware behavior
    float causticScale = mix(18.0, 25.0, float(u_wavePatternType) / 7.0);
    vec2 causticFlow = u_choppyWindDirection * v_time * 0.8;

    vec2 causticPos1 = oceanPos * causticScale + causticFlow;
    vec2 causticPos2 = oceanPos * (causticScale * 1.4) - causticFlow * 0.7;

    float caustic1 = fbm(causticPos1);
    float caustic2 = fbm(causticPos2);

    // Dynamic caustic thresholds based on wave conditions
    float causticThreshold1 = mix(0.6, 0.75, float(u_wavePatternType) / 7.0);
    float causticThreshold2 = mix(0.65, 0.8, float(u_wavePatternType) / 7.0);

    caustic1 = smoothstep(causticThreshold1, causticThreshold1 + 0.25, caustic1);
    caustic2 = smoothstep(causticThreshold2, causticThreshold2 + 0.25, caustic2);

    float causticIntensity = mix(0.1, 0.2, u_waveScale);
    float totalCaustics = caustic1 * causticIntensity + caustic2 * (causticIntensity * 0.7);
    baseColor += vec3(totalCaustics);

    // Enhanced foam trails with wind direction
    vec2 flowDir = normalize(u_choppyWindDirection + vec2(cos(v_time * 0.2), sin(v_time * 0.15)) * 0.3);
    vec2 flowPos = oceanPos + flowDir * v_time * u_choppyWindSpeed * 0.1;
    float flowNoise = fbm(flowPos * 8.0);

    // Multi-scale foam trails
    float flowFoam1 = smoothstep(0.7, 0.95, flowNoise) * foamAmount;
    float flowFoam2 = smoothstep(0.75, 0.85, fbm(flowPos * 15.0)) * foamAmount * 0.5;
    baseColor += vec3((flowFoam1 + flowFoam2) * 0.25);

    // Add pattern-specific visual effects
    if (u_wavePatternType >= 4) { // Storm conditions
        // Enhanced storm effects
        float stormIntensity = (float(u_wavePatternType) - 3.0) / 4.0;
        vec2 stormPos = oceanPos * 30.0 + v_time * 3.0;
        float stormNoise = fbm(stormPos) * stormIntensity;
        baseColor += vec3(stormNoise * 0.1) * vec3(0.8, 0.9, 1.0);
    }

    // Stylistic quantization with dithering
    baseColor = quantizeColor(baseColor, 8);

    // Add subtle dithering for better gradients
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float dither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    baseColor += vec3((dither - 0.5) * 0.02);

    // Optional debug grid (only in debug mode 0)
    if (u_debugMode == 0) {
        vec2 grid = abs(fract(oceanPos * 0.3) - 0.5);
        float gridLine = smoothstep(0.015, 0.005, min(grid.x, grid.y));
        baseColor += vec3(gridLine * 0.05);
    }

    fragColor = vec4(baseColor, 1.0);
}
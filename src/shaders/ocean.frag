#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Wave pattern controls
uniform float u_gerstnerWeight;
uniform float u_phillipsWeight;
uniform float u_caWeight;
uniform float u_windSpeed;
uniform float u_windDirection;
uniform float u_gerstnerSteepness;
uniform float u_waveQuality;
uniform sampler2D u_caTexture;

out vec4 fragColor;

// Constants
const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;
const float GRAVITY = 9.81;

// Ocean color palette
const vec3 DEEP_WATER = vec3(0.05, 0.15, 0.4);
const vec3 SHALLOW_WATER = vec3(0.1, 0.4, 0.7);
const vec3 FOAM_COLOR = vec3(0.9, 0.95, 1.0);
const vec3 WAVE_CREST = vec3(0.3, 0.6, 0.9);

// Utilities (integrated from utils.glsl)
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(vec2(p.x * p.y, p.x + p.y));
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
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

float waveNumber(float wavelength) {
    return TWO_PI / wavelength;
}

vec2 angleToDirection(float angle) {
    return vec2(cos(angle), sin(angle));
}

// Original sine wave function
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = TWO_PI / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// Gerstner wave implementation
struct GerstnerWave {
    vec2 direction;
    float amplitude;
    float wavelength;
    float speed;
    float steepness;
};

vec3 gerstnerWave(vec2 position, float time, GerstnerWave wave) {
    float k = waveNumber(wave.wavelength);
    float c = sqrt(GRAVITY / k);
    float f = k * (dot(wave.direction, position) - c * time);
    float a = wave.steepness / k;

    vec2 displacement = a * wave.direction * sin(f);
    float height = wave.amplitude * cos(f);

    return vec3(displacement, height);
}

vec3 getGerstnerWaves(vec2 pos, float time) {
    vec3 totalDisplacement = vec3(0.0);

    GerstnerWave waves[6];
    waves[0] = GerstnerWave(normalize(vec2(1.0, 0.0)), 0.4, 8.0, sqrt(GRAVITY * TWO_PI / 8.0), u_gerstnerSteepness);
    waves[1] = GerstnerWave(normalize(vec2(0.7, 0.7)), 0.3, 6.0, sqrt(GRAVITY * TWO_PI / 6.0), u_gerstnerSteepness * 0.8);
    waves[2] = GerstnerWave(normalize(vec2(0.0, 1.0)), 0.35, 10.0, sqrt(GRAVITY * TWO_PI / 10.0), u_gerstnerSteepness * 0.9);
    waves[3] = GerstnerWave(normalize(vec2(-0.6, 0.8)), 0.2, 4.0, sqrt(GRAVITY * TWO_PI / 4.0), u_gerstnerSteepness * 0.6);
    waves[4] = GerstnerWave(normalize(vec2(0.9, 0.4)), 0.15, 3.0, sqrt(GRAVITY * TWO_PI / 3.0), u_gerstnerSteepness * 0.5);
    waves[5] = GerstnerWave(normalize(vec2(0.2, -0.9)), 0.12, 2.5, sqrt(GRAVITY * TWO_PI / 2.5), u_gerstnerSteepness * 0.4);

    for(int i = 0; i < 6; i++) {
        totalDisplacement += gerstnerWave(pos, time, waves[i]);
    }

    return totalDisplacement;
}

// Phillips spectrum implementation
float phillipsSpectrum(vec2 k_vec, float windSpeed, vec2 windDir) {
    float k = length(k_vec);
    if(k < 0.001) return 0.0;

    float L = windSpeed * windSpeed / GRAVITY;
    float w = dot(normalize(k_vec), windDir);

    float phillips = exp(-1.0 / (k * L * k * L)) / (k * k * k * k);
    phillips *= w * w;
    phillips *= exp(-k * 0.74);

    return phillips;
}

float getPhillipsWaves(vec2 pos, float time) {
    float height = 0.0;
    vec2 windDir = angleToDirection(u_windDirection);

    for(float i = 0.0; i < 8.0; i += 1.0) {
        for(float j = 0.0; j < 8.0; j += 1.0) {
            vec2 samplePos = vec2(i, j) / 8.0;
            vec2 k_vec = (samplePos - 0.5) * 10.0;

            float phillips = phillipsSpectrum(k_vec, u_windSpeed, windDir);
            float k = length(k_vec);
            float omega = sqrt(GRAVITY * k);

            float phase = hash21(samplePos) * TWO_PI;
            float wavePhase = dot(k_vec, pos) - omega * time + phase;

            height += sqrt(phillips) * cos(wavePhase) * 0.1;
        }
    }

    return height;
}

// Cellular automaton sampling
float getCellularAutomatonWaves(vec2 pos) {
    vec2 texCoord = (pos + 15.0) / 30.0;
    float caValue = texture(u_caTexture, texCoord).r;

    // Handle both float and uint8 texture formats
    // For float textures: caValue ranges around 0.0 ± small amounts
    // For uint8 textures: caValue ranges 0-1, with 0.5 being neutral
    // For fallback texture: caValue is always ~0.5

    return (caValue - 0.5) * 0.3;
}

// Combined wave system
float getOceanHeight(vec2 pos, float time) {
    float height = 0.0;

    // Calculate weights - ensure they don't exceed 1.0 total
    float totalWeight = u_gerstnerWeight + u_phillipsWeight + u_caWeight;
    float originalWeight = max(0.0, 1.0 - totalWeight);

    // Original sine waves (reduced weight to make room for new patterns)
    if(originalWeight > 0.0) {
        height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time) * originalWeight;
        height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time) * originalWeight;
        height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time) * originalWeight;
        height += sineWave(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time) * originalWeight;
        height += sineWave(pos, vec2(0.9, 0.4), 3.0, 0.15, 2.0, time) * originalWeight;
        height += sineWave(pos, vec2(0.2, -0.9), 2.5, 0.12, 2.2, time) * originalWeight;
        height += sineWave(pos, vec2(0.5, -0.5), 5.0, 0.1, 0.9, time) * originalWeight;
        height += sineWave(pos, vec2(-0.8, 0.2), 7.0, 0.08, 1.1, time) * originalWeight;

        // Fine noise for texture
        vec2 noisePos = pos * 3.0 + time * 0.2;
        height += fbm(noisePos, 5) * 0.08 * originalWeight;
    }

    // Gerstner waves
    if(u_gerstnerWeight > 0.0) {
        vec3 gerstnerResult = getGerstnerWaves(pos, time);
        height += gerstnerResult.z * u_gerstnerWeight;
    }

    // Phillips spectrum waves
    if(u_phillipsWeight > 0.0) {
        height += getPhillipsWaves(pos, time) * u_phillipsWeight;
    }

    // Cellular automaton waves
    if(u_caWeight > 0.0) {
        height += getCellularAutomatonWaves(pos) * u_caWeight;
    }

    return height;
}

// Calculate normal from height differences
vec3 calculateNormal(vec2 pos, float time) {
    float eps = u_waveQuality > 1.5 ? 0.05 : 0.1; // Higher quality uses smaller epsilon
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

// Quality-based enhancement
vec3 applyQualityEnhancements(vec3 baseColor, vec2 oceanPos, float height) {
    vec3 color = baseColor;

    if(u_waveQuality > 1.5) {
        // High quality: add extra detail
        vec2 detailPos = oceanPos * 8.0 + v_time * 0.5;
        float detailNoise = fbm(detailPos, 3) * 0.02;

        // Enhanced caustics for high quality
        vec2 causticPos3 = oceanPos * 30.0 + v_time * 3.0;
        float caustic3 = fbm(causticPos3, 4);
        caustic3 = smoothstep(0.7, 0.95, caustic3);
        color += vec3(caustic3 * 0.08);
    }

    return color;
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

    // Base ocean color based on height
    vec3 baseColor = mix(DEEP_WATER, SHALLOW_WATER, smoothstep(-0.3, 0.3, height));

    // Add wave crests with stronger contrast
    float crestAmount = smoothstep(0.12, 0.28, height);
    baseColor = mix(baseColor, WAVE_CREST, crestAmount);

    // Add foam at highest peaks
    float foamAmount = smoothstep(0.18, 0.35, height);
    baseColor = mix(baseColor, FOAM_COLOR, foamAmount);

    // Enhanced top-down lighting with multiple light sources
    vec3 mainLight = normalize(vec3(0.6, 1.0, 0.4));
    vec3 rimLight = normalize(vec3(-0.3, 0.8, -0.5));

    float mainLighting = max(0.2, dot(normal, mainLight));
    float rimLighting = max(0.0, dot(normal, rimLight)) * 0.3;

    float totalLighting = mainLighting + rimLighting;
    baseColor *= clamp(totalLighting, 0.3, 1.3);

    // Enhanced caustics with multiple layers
    vec2 causticPos1 = oceanPos * 18.0 + v_time * 2.5;
    vec2 causticPos2 = oceanPos * 25.0 - v_time * 1.8;

    float caustic1 = fbm(causticPos1, 5);
    float caustic2 = fbm(causticPos2, 5);

    caustic1 = smoothstep(0.6, 0.85, caustic1);
    caustic2 = smoothstep(0.65, 0.9, caustic2);

    float totalCaustics = caustic1 * 0.15 + caustic2 * 0.1;
    baseColor += vec3(totalCaustics);

    // Add animated foam trails following wave direction
    vec2 flowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
    vec2 flowPos = oceanPos + flowDir * v_time * 2.0;
    float flowNoise = fbm(flowPos * 12.0, 5);
    float flowFoam = smoothstep(0.75, 0.95, flowNoise) * foamAmount;
    baseColor += vec3(flowFoam * 0.2);

    // Apply quality-based enhancements
    baseColor = applyQualityEnhancements(baseColor, oceanPos, height);

    // Stylistic quantization with dithering (quality-dependent)
    int quantizationLevels = u_waveQuality > 1.5 ? 12 : (u_waveQuality > 0.5 ? 8 : 6);
    baseColor = quantizeColor(baseColor, quantizationLevels);

    // Add subtle dithering for better gradients
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float dither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    float ditherStrength = u_waveQuality > 1.5 ? 0.015 : 0.02;
    baseColor += vec3((dither - 0.5) * ditherStrength);

    // Optional debug grid (only in debug mode 0)
    if (u_debugMode == 0) {
        vec2 grid = abs(fract(oceanPos * 0.3) - 0.5);
        float gridLine = smoothstep(0.015, 0.005, min(grid.x, grid.y));
        baseColor += vec3(gridLine * 0.05);
    }

    fragColor = vec4(baseColor, 1.0);
}
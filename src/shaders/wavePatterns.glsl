#version 300 es

precision highp float;

// Wave pattern weights and controls
uniform float u_gerstnerWeight;
uniform float u_phillipsWeight;
uniform float u_caWeight;
uniform float u_windSpeed;
uniform float u_windDirection;
uniform float u_gerstnerSteepness;
uniform float u_waveQuality;

// Cellular automaton texture
uniform sampler2D u_caTexture;

// Original sine wave function (from current implementation)
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

    // Horizontal displacement
    vec2 displacement = a * wave.direction * sin(f);

    // Vertical displacement
    float height = wave.amplitude * cos(f);

    return vec3(displacement, height);
}

// Get Gerstner wave system height and displacement
vec3 getGerstnerWaves(vec2 pos, float time) {
    vec3 totalDisplacement = vec3(0.0);

    // Multiple Gerstner waves with different parameters
    GerstnerWave waves[6];

    // Primary waves
    waves[0] = GerstnerWave(normalize(vec2(1.0, 0.0)), 0.4, 8.0, sqrt(GRAVITY * TWO_PI / 8.0), u_gerstnerSteepness);
    waves[1] = GerstnerWave(normalize(vec2(0.7, 0.7)), 0.3, 6.0, sqrt(GRAVITY * TWO_PI / 6.0), u_gerstnerSteepness * 0.8);
    waves[2] = GerstnerWave(normalize(vec2(0.0, 1.0)), 0.35, 10.0, sqrt(GRAVITY * TWO_PI / 10.0), u_gerstnerSteepness * 0.9);

    // Secondary waves
    waves[3] = GerstnerWave(normalize(vec2(-0.6, 0.8)), 0.2, 4.0, sqrt(GRAVITY * TWO_PI / 4.0), u_gerstnerSteepness * 0.6);
    waves[4] = GerstnerWave(normalize(vec2(0.9, 0.4)), 0.15, 3.0, sqrt(GRAVITY * TWO_PI / 3.0), u_gerstnerSteepness * 0.5);
    waves[5] = GerstnerWave(normalize(vec2(0.2, -0.9)), 0.12, 2.5, sqrt(GRAVITY * TWO_PI / 2.5), u_gerstnerSteepness * 0.4);

    for(int i = 0; i < 6; i++) {
        totalDisplacement += gerstnerWave(pos, time, waves[i]);
    }

    return totalDisplacement;
}

// Phillips spectrum implementation (simplified for real-time)
float phillipsSpectrum(vec2 k_vec, float windSpeed, vec2 windDir) {
    float k = length(k_vec);
    if(k < 0.001) return 0.0;

    float L = windSpeed * windSpeed / GRAVITY;
    float w = dot(normalize(k_vec), windDir);

    // Simplified Phillips spectrum
    float phillips = exp(-1.0 / (k * L * k * L)) / (k * k * k * k);
    phillips *= w * w;
    phillips *= exp(-k * 0.74); // Small wave suppression

    return phillips;
}

// Generate Phillips spectrum-based waves
float getPhillipsWaves(vec2 pos, float time) {
    float height = 0.0;
    vec2 windDir = angleToDirection(u_windDirection);

    // Sample multiple wave vectors
    for(float i = 0.0; i < 8.0; i += 1.0) {
        for(float j = 0.0; j < 8.0; j += 1.0) {
            vec2 samplePos = vec2(i, j) / 8.0;
            vec2 k_vec = (samplePos - 0.5) * 10.0; // Wave vector sampling

            float phillips = phillipsSpectrum(k_vec, u_windSpeed, windDir);
            float k = length(k_vec);
            float omega = sqrt(GRAVITY * k);

            // Random phase
            float phase = hash21(samplePos) * TWO_PI;
            float wavePhase = dot(k_vec, pos) - omega * time + phase;

            height += sqrt(phillips) * cos(wavePhase) * 0.1;
        }
    }

    return height;
}

// Cellular automaton wave propagation sample
float getCellularAutomatonWaves(vec2 pos, vec2 resolution) {
    // Convert world position to texture coordinates
    vec2 texCoord = (pos + 15.0) / 30.0; // Map from [-15,15] to [0,1]

    // Sample the cellular automaton texture
    float caValue = texture(u_caTexture, texCoord).r;

    // Convert CA value to wave displacement
    return (caValue - 0.5) * 0.3; // Scale and center around 0
}

// Combined wave system
float getCombinedWaveHeight(vec2 pos, float time, vec2 resolution) {
    float height = 0.0;

    // Original sine waves (reduced weight to make room for new patterns)
    float originalWeight = 1.0 - (u_gerstnerWeight + u_phillipsWeight + u_caWeight);
    originalWeight = max(0.0, originalWeight);

    if(originalWeight > 0.0) {
        // Primary waves - much larger amplitude for visibility
        height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time) * originalWeight;
        height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time) * originalWeight;
        height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time) * originalWeight;
        height += sineWave(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time) * originalWeight;

        // Secondary detail waves
        height += sineWave(pos, vec2(0.9, 0.4), 3.0, 0.15, 2.0, time) * originalWeight;
        height += sineWave(pos, vec2(0.2, -0.9), 2.5, 0.12, 2.2, time) * originalWeight;

        // Interference patterns for more complexity
        height += sineWave(pos, vec2(0.5, -0.5), 5.0, 0.1, 0.9, time) * originalWeight;
        height += sineWave(pos, vec2(-0.8, 0.2), 7.0, 0.08, 1.1, time) * originalWeight;
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
        height += getCellularAutomatonWaves(pos, resolution) * u_caWeight;
    }

    // Fine noise for texture (reduced to make room for new patterns)
    vec2 noisePos = pos * 3.0 + time * 0.2;
    height += fbm(noisePos, 5) * 0.08 * originalWeight;

    return height;
}

// Calculate normal from combined wave system
vec3 calculateCombinedNormal(vec2 pos, float time, vec2 resolution) {
    float eps = 0.1;
    float heightL = getCombinedWaveHeight(pos - vec2(eps, 0.0), time, resolution);
    float heightR = getCombinedWaveHeight(pos + vec2(eps, 0.0), time, resolution);
    float heightD = getCombinedWaveHeight(pos - vec2(0.0, eps), time, resolution);
    float heightU = getCombinedWaveHeight(pos + vec2(0.0, eps), time, resolution);

    vec3 normal = normalize(vec3(heightL - heightR, 2.0 * eps, heightD - heightU));
    return normal;
}

// Quality-based wave computation
float getQualityAdjustedWaveHeight(vec2 pos, float time, vec2 resolution) {
    if(u_waveQuality < 0.5) {
        // Low quality: simplified computation
        return getCombinedWaveHeight(pos, time, resolution);
    } else if(u_waveQuality < 1.5) {
        // Medium quality: standard computation
        return getCombinedWaveHeight(pos, time, resolution);
    } else {
        // High quality: enhanced computation with additional detail
        float height = getCombinedWaveHeight(pos, time, resolution);

        // Add extra high-frequency detail for high quality
        vec2 detailPos = pos * 8.0 + time * 0.5;
        height += fbm(detailPos, 3) * 0.02;

        return height;
    }
}
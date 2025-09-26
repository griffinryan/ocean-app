#version 300 es

precision highp float;

in vec2 v_uv;
in vec3 v_worldPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;

out vec4 fragColor;

// Ocean color palette
const vec3 DEEP_WATER = vec3(0.05, 0.15, 0.4);
const vec3 SHALLOW_WATER = vec3(0.1, 0.4, 0.7);
const vec3 FOAM_COLOR = vec3(0.9, 0.95, 1.0);
const vec3 HIGHLIGHT_COLOR = vec3(0.6, 0.8, 1.0);

// Wave parameters
const int NUM_WAVES = 4;

struct Wave {
    float amplitude;
    float wavelength;
    float speed;
    vec2 direction;
    float steepness;
};

// Hash function for procedural noise
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Smooth noise function
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

// Fractal noise
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(frequency * p);
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value;
}

// Gerstner wave function
float gerstnerWave(vec2 pos, Wave wave, float time, out vec2 tangent) {
    float k = 2.0 * 3.14159 / wave.wavelength;
    float c = sqrt(9.8 / k); // wave speed from physics
    vec2 d = normalize(wave.direction);
    float f = k * (dot(d, pos) - c * wave.speed * time);
    float a = wave.steepness / k;

    tangent.x = -d.x * d.x * wave.steepness * sin(f);
    tangent.y = -d.x * d.y * wave.steepness * sin(f);

    return a * sin(f);
}

// Calculate wave height and surface normal
float calculateWaves(vec2 pos, float time, out vec3 normal) {
    Wave waves[NUM_WAVES];

    // Define wave parameters
    waves[0] = Wave(0.8, 8.0, 1.0, vec2(1.0, 0.3), 0.6);
    waves[1] = Wave(0.4, 4.0, 1.2, vec2(0.7, -0.8), 0.4);
    waves[2] = Wave(0.3, 6.0, 0.8, vec2(-0.5, 0.9), 0.5);
    waves[3] = Wave(0.2, 2.0, 1.5, vec2(0.9, 0.4), 0.3);

    float height = 0.0;
    vec2 totalTangent = vec2(0.0);

    // Sum up all waves (wave interference)
    for (int i = 0; i < NUM_WAVES; i++) {
        vec2 tangent;
        height += gerstnerWave(pos, waves[i], time, tangent);
        totalTangent += tangent;
    }

    // Add some noise for fine detail
    vec2 noisePos = pos * 2.0 + time * 0.1;
    height += fbm(noisePos) * 0.1;

    // Calculate normal from tangent
    vec3 tangentX = normalize(vec3(1.0, totalTangent.x, 0.0));
    vec3 tangentY = normalize(vec3(0.0, totalTangent.y, 1.0));
    normal = normalize(cross(tangentX, tangentY));

    return height;
}

// Quantize color for stylized look
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels)) / float(levels);
}

void main() {
    // Convert UV to world coordinates
    vec2 worldPos = (v_uv - 0.5) * 20.0; // Scale factor for ocean size
    worldPos.x *= u_aspectRatio;

    vec3 normal;
    float waveHeight = calculateWaves(worldPos, v_time, normal);

    // Normalize wave height for visualization (-1 to 1 range)
    float normalizedHeight = waveHeight * 0.5 + 0.5;

    // Create base ocean color based on wave height
    vec3 baseColor = mix(DEEP_WATER, SHALLOW_WATER, normalizedHeight);

    // Add foam at wave peaks
    float foamThreshold = 0.7;
    float foamAmount = smoothstep(foamThreshold, foamThreshold + 0.2, normalizedHeight);
    baseColor = mix(baseColor, FOAM_COLOR, foamAmount);

    // Add highlights based on normal
    float highlight = max(0.0, dot(normal, normalize(vec3(0.5, 1.0, 0.5))));
    highlight = pow(highlight, 3.0);
    baseColor += HIGHLIGHT_COLOR * highlight * 0.3;

    // Stylistic quantization for pixel art look
    baseColor = quantizeColor(baseColor, 8);

    // Add some animated sparkles
    vec2 sparklePos = worldPos * 15.0 + v_time * 2.0;
    float sparkle = fbm(sparklePos);
    sparkle = smoothstep(0.85, 0.9, sparkle);
    baseColor += vec3(sparkle * 0.3);

    // Final color output
    fragColor = vec4(baseColor, 1.0);
}
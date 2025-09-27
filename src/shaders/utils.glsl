#version 300 es

precision highp float;

// Constants
const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;
const float GRAVITY = 9.81;

// Hash functions for procedural noise
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

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
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

// Fractional Brownian Motion
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

// Wave dispersion relation: ω = sqrt(gk) for deep water
float waveFrequency(float wavelength) {
    float k = TWO_PI / wavelength;
    return sqrt(GRAVITY * k);
}

// Convert wavelength to wave number
float waveNumber(float wavelength) {
    return TWO_PI / wavelength;
}

// Smooth minimum function for wave blending
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Smooth maximum function
float smax(float a, float b, float k) {
    return -smin(-a, -b, k);
}

// Cubic smoothstep function
float smootherstep(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

// Rotation matrix for 2D vectors
mat2 rotate2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

// Convert normalized direction to angle
float directionToAngle(vec2 direction) {
    return atan(direction.y, direction.x);
}

// Convert angle to normalized direction
vec2 angleToDirection(float angle) {
    return vec2(cos(angle), sin(angle));
}

// Wind-wave relationship: fetch-limited wave height
float fetchLimitedWaveHeight(float windSpeed, float fetch) {
    // Empirical relationship for significant wave height
    float dimensionlessFetch = GRAVITY * fetch / (windSpeed * windSpeed);
    float dimensionlessHeight = 0.283 * tanh(0.0125 * pow(dimensionlessFetch, 0.42));
    return dimensionlessHeight * windSpeed * windSpeed / GRAVITY;
}

// Peak frequency for JONSWAP spectrum
float jonswapPeakFrequency(float windSpeed, float fetch) {
    float dimensionlessFetch = GRAVITY * fetch / (windSpeed * windSpeed);
    float dimensionlessFreq = 0.877 * tanh(0.077 * pow(dimensionlessFetch, 0.25));
    return dimensionlessFreq * GRAVITY / windSpeed;
}

// Quantize color for stylized look (reused utility)
vec3 quantizeColor(vec3 color, int levels) {
    return floor(color * float(levels) + 0.5) / float(levels);
}

// Dithering function for smooth gradients
float dither(vec2 screenPos) {
    return fract(sin(dot(screenPos, vec2(12.9898, 78.233))) * 43758.5453);
}

// Advanced smooth interpolation
float quinticStep(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}
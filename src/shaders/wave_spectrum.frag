#version 300 es

precision highp float;

in vec2 v_uv;

uniform float u_time;
uniform float u_windSpeed;
uniform vec2 u_windDirection;
uniform float u_amplitude;
uniform float u_gravity;
uniform float u_size;
uniform int u_spectrumType; // 0 = Phillips, 1 = JONSWAP

out vec4 fragColor;

// Random number generation
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Box-Muller transform for Gaussian random numbers
vec2 gaussianRandom(vec2 seed) {
    float u1 = hash21(seed);
    float u2 = hash21(seed + vec2(1.0, 1.0));

    // Ensure u1 is not zero to avoid log(0)
    u1 = max(u1, 1e-6);

    float magnitude = sqrt(-2.0 * log(u1));
    float z0 = magnitude * cos(2.0 * 3.14159265359 * u2);
    float z1 = magnitude * sin(2.0 * 3.14159265359 * u2);

    return vec2(z0, z1);
}

// Phillips spectrum
float phillipsSpectrum(vec2 k, float windSpeed, vec2 windDir, float amplitude, float gravity) {
    float kLength = length(k);
    if (kLength < 0.000001) return 0.0;

    float L = windSpeed * windSpeed / gravity;
    float l = L / 1000.0; // Small wave cutoff

    float kDotWind = dot(normalize(k), normalize(windDir));

    float phillips = amplitude *
                    exp(-1.0 / (kLength * kLength * L * L)) /
                    (kLength * kLength * kLength * kLength) *
                    (kDotWind * kDotWind) *
                    exp(-kLength * kLength * l * l);

    return phillips;
}

// JONSWAP spectrum
float jonswapSpectrum(vec2 k, float windSpeed, float fetch, float gamma) {
    float kLength = length(k);
    if (kLength < 0.000001) return 0.0;

    float g = 9.81;
    float omega = sqrt(g * kLength);

    // JONSWAP parameters
    float alpha = 0.076 * pow(windSpeed * windSpeed / (fetch * g), 0.22);
    float wp = 22.0 * pow(g * g / (windSpeed * fetch), 1.0/3.0);
    float sigma = omega <= wp ? 0.07 : 0.09;

    float jonswap = alpha * g * g * pow(omega, -5.0) *
                   exp(-1.25 * pow(wp / omega, 4.0)) *
                   pow(gamma, exp(-pow(omega - wp, 2.0) / (2.0 * sigma * sigma * wp * wp)));

    return jonswap;
}

void main() {
    // Convert UV to wave vector k
    vec2 coord = (v_uv - 0.5) * u_size;
    vec2 k = vec2(2.0 * 3.14159265359 * coord.x / u_size,
                  2.0 * 3.14159265359 * coord.y / u_size);

    float spectrum;

    if (u_spectrumType == 0) {
        // Phillips spectrum
        spectrum = phillipsSpectrum(k, u_windSpeed, u_windDirection, u_amplitude, u_gravity);
    } else {
        // JONSWAP spectrum
        float fetch = 100000.0; // 100km fetch
        float gamma = 3.3;
        spectrum = jonswapSpectrum(k, u_windSpeed, fetch, gamma);
    }

    // Generate Gaussian random amplitudes
    vec2 xi = gaussianRandom(v_uv + fract(u_time * 0.001));

    // Initial wave amplitude
    vec2 h0 = xi * sqrt(spectrum / 2.0);

    // Time evolution using dispersion relation
    float kLength = length(k);
    float omega = sqrt(u_gravity * kLength);
    float phase = omega * u_time;

    // Complex exponential for time evolution
    // h(k,t) = h0(k) * exp(i*ω*t) + h0*(-k) * exp(-i*ω*t)
    vec2 expPos = vec2(cos(phase), sin(phase));
    vec2 expNeg = vec2(cos(-phase), sin(-phase));

    // Calculate conjugate for -k
    vec2 coordConj = -coord;
    vec2 kConj = -k;
    float spectrumConj = u_spectrumType == 0 ?
                        phillipsSpectrum(kConj, u_windSpeed, u_windDirection, u_amplitude, u_gravity) :
                        jonswapSpectrum(kConj, u_windSpeed, 100000.0, 3.3);

    vec2 xiConj = gaussianRandom(-v_uv + fract(u_time * 0.001));
    vec2 h0Conj = vec2(xiConj.x * sqrt(spectrumConj / 2.0), -xiConj.y * sqrt(spectrumConj / 2.0));

    // Time-evolved amplitude
    vec2 h = vec2(
        h0.x * expPos.x - h0.y * expPos.y + h0Conj.x * expNeg.x - h0Conj.y * expNeg.y,
        h0.x * expPos.y + h0.y * expPos.x + h0Conj.x * expNeg.y + h0Conj.y * expNeg.x
    );

    fragColor = vec4(h, 0.0, 1.0);
}
#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform vec2 u_windDirection;
uniform float u_windSpeed;
uniform float u_rippleIntensity;
uniform sampler2D u_velocityField; // Velocity texture from Navier-Stokes
uniform sampler2D u_heightField;   // Primary wave height field

out vec4 fragColor;

// Advanced noise functions for ripple generation
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

// Ridged noise for more organic wave patterns
float ridgedNoise(vec2 p) {
    return 1.0 - abs(noise(p) * 2.0 - 1.0);
}

// Fractal Brownian Motion with domain warping
vec2 domainWarp(vec2 p, float strength) {
    vec2 q = vec2(
        noise(p + vec2(0.0, 0.0)),
        noise(p + vec2(5.2, 1.3))
    );

    vec2 r = vec2(
        noise(p + 4.0 * q + vec2(1.7, 9.2)),
        noise(p + 4.0 * q + vec2(8.3, 2.8))
    );

    return p + strength * r;
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

// Flow-based ripple animation
float flowRipples(vec2 pos, vec2 flowDir, float time, float scale) {
    // Create multiple scales of ripples that follow the flow
    vec2 flow = flowDir * time * 0.3;

    float ripple1 = sin(dot(pos * scale + flow, normalize(flowDir)) * 50.0) * 0.5 + 0.5;
    float ripple2 = sin(dot(pos * scale * 1.3 - flow * 0.7, normalize(flowDir + vec2(0.3, -0.2))) * 75.0) * 0.5 + 0.5;
    float ripple3 = sin(dot(pos * scale * 0.8 + flow * 0.5, normalize(flowDir + vec2(-0.1, 0.4))) * 60.0) * 0.5 + 0.5;

    return (ripple1 + ripple2 + ripple3) / 3.0;
}

// Capillary wave simulation
float capillaryWaves(vec2 pos, float time, vec2 windDir, float windSpeed) {
    float capillary = 0.0;
    vec2 windNorm = normalize(windDir);

    // Multiple capillary wave frequencies
    float freq1 = 200.0; // High frequency ripples
    float freq2 = 350.0; // Ultra-fine ripples
    float freq3 = 150.0; // Medium ripples

    // Wind-aligned capillary waves
    float wave1 = sin(dot(pos, windNorm) * freq1 - time * windSpeed * 5.0);
    float wave2 = sin(dot(pos, windNorm) * freq2 - time * windSpeed * 7.0);
    float wave3 = sin(dot(pos, windNorm) * freq3 - time * windSpeed * 4.0);

    // Cross-wind ripples (weaker)
    vec2 crossWind = vec2(-windNorm.y, windNorm.x);
    float crossWave = sin(dot(pos, crossWind) * 180.0 - time * windSpeed * 3.0) * 0.3;

    capillary = (wave1 * 0.4 + wave2 * 0.2 + wave3 * 0.3 + crossWave) * 0.01;

    return capillary;
}

// Surface tension effects
float surfaceTension(vec2 pos, float time) {
    // Simulate micro-ripples caused by surface tension
    vec2 warpedPos = domainWarp(pos * 100.0, 0.02);
    float tension = ridgedNoise(warpedPos + time * 2.0) * 0.005;

    // Add interference patterns
    float interference = sin(pos.x * 300.0 + time * 10.0) * sin(pos.y * 280.0 + time * 8.0) * 0.002;

    return tension + interference;
}

// Calculate surface ripple normal perturbation
vec3 calculateRippleNormal(vec2 pos, float time, vec2 windDir, float windSpeed) {
    float eps = 0.01;

    // Sample height at neighboring points
    float h0 = capillaryWaves(pos, time, windDir, windSpeed) + surfaceTension(pos, time);
    float hX = capillaryWaves(pos + vec2(eps, 0.0), time, windDir, windSpeed) + surfaceTension(pos + vec2(eps, 0.0), time);
    float hY = capillaryWaves(pos + vec2(0.0, eps), time, windDir, windSpeed) + surfaceTension(pos + vec2(0.0, eps), time);

    // Calculate gradient
    vec2 gradient = vec2(hX - h0, hY - h0) / eps;

    // Convert to normal (small perturbation)
    return normalize(vec3(-gradient.x, 1.0, -gradient.y));
}

// Foam generation based on wave activity
float generateFoam(vec2 pos, float time, vec2 velocity, float waveHeight) {
    // Foam appears where waves are breaking (high velocity + height)
    float speed = length(velocity);
    float foamFromVelocity = smoothstep(0.1, 0.3, speed);
    float foamFromHeight = smoothstep(0.2, 0.4, waveHeight);

    // Add noise for organic foam distribution
    vec2 foamPos = pos * 50.0 + time * 3.0;
    float foamNoise = fbm(foamPos, 4);
    foamNoise = smoothstep(0.6, 0.9, foamNoise);

    float foam = max(foamFromVelocity, foamFromHeight) * foamNoise;

    // Foam persistence (fades over time)
    float persistence = 1.0 - smoothstep(0.0, 2.0, time - floor(time));

    return foam * persistence;
}

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 20.0;
    oceanPos.x *= u_aspectRatio;

    // Sample velocity field and primary waves
    vec2 velocity = texture(u_velocityField, v_uv).rg;
    float primaryHeight = texture(u_heightField, v_uv).r;

    // Calculate wind-driven flow
    vec2 windFlow = u_windDirection * u_windSpeed * 0.1;
    vec2 totalFlow = velocity + windFlow;

    // Generate multiple layers of surface ripples
    float rippleLayer1 = flowRipples(oceanPos, totalFlow, v_time, 1.0);
    float rippleLayer2 = flowRipples(oceanPos, totalFlow * 0.7, v_time, 1.5);
    float rippleLayer3 = flowRipples(oceanPos, totalFlow * 1.3, v_time, 0.8);

    // Capillary waves
    float capillary = capillaryWaves(oceanPos, v_time, u_windDirection, u_windSpeed);

    // Surface tension effects
    float tension = surfaceTension(oceanPos, v_time);

    // Combine all ripple layers
    float totalRipples = (rippleLayer1 * 0.4 + rippleLayer2 * 0.3 + rippleLayer3 * 0.3 + capillary + tension) * u_rippleIntensity;

    // Calculate perturbed normal
    vec3 rippleNormal = calculateRippleNormal(oceanPos, v_time, u_windDirection, u_windSpeed);

    // Generate foam
    float foam = generateFoam(oceanPos, v_time, velocity, primaryHeight + totalRipples);

    // Color based on ripple height and foam
    vec3 baseColor = vec3(0.1, 0.3, 0.6); // Base water color
    vec3 rippleColor = vec3(0.2, 0.5, 0.8); // Lighter for ripple peaks
    vec3 foamColor = vec3(0.9, 0.95, 1.0); // White foam

    // Mix colors based on ripple height
    vec3 finalColor = mix(baseColor, rippleColor, smoothstep(-0.01, 0.01, totalRipples));
    finalColor = mix(finalColor, foamColor, foam);

    // Add shimmer effect
    float shimmer = pow(max(0.0, dot(rippleNormal, normalize(vec3(0.5, 1.0, 0.3)))), 32.0);
    finalColor += vec3(shimmer * 0.3);

    // Output: RGB = color, A = ripple height for blending
    fragColor = vec4(finalColor, totalRipples * 10.0 + 0.5);
}
#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;
uniform int u_debugMode;

// Vessel wake uniforms
uniform int u_vesselCount;
uniform vec3 u_vesselPositions[5];
uniform vec3 u_vesselVelocities[5];
uniform float u_vesselWeights[5];
uniform float u_vesselClasses[5];
uniform float u_vesselHullLengths[5];
uniform float u_vesselStates[5];
uniform bool u_wakesEnabled;

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

// Simple sine wave for visible patterns
float sineWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    float k = 2.0 * 3.14159 / wavelength;
    float phase = k * dot(direction, pos) - speed * time;
    return amplitude * sin(phase);
}

// Constants for wake physics
const float PI = 3.14159265359;
const float KELVIN_ANGLE = 0.34; // ~19.47 degrees in radians
const float GRAVITY = 9.81;

// Rotate a 2D vector by angle (in radians)
vec2 rotate2D(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Calculate wave number from wavelength
float waveNumber(float wavelength) {
    return 2.0 * PI / wavelength;
}

// Deep water dispersion relation: omega = sqrt(g * k)
float waveFrequency(float k) {
    return sqrt(GRAVITY * k);
}

// ===== SPLINE-WAVELET FUNCTIONS =====

// Cubic B-spline basis function for smooth interpolation
float cubicBSplineBasis(float t, int i) {
    float u = t - float(i);

    if (u < -2.0 || u >= 2.0) return 0.0;

    if (u >= -2.0 && u < -1.0) {
        float v = u + 2.0;
        return v * v * v / 6.0;
    } else if (u >= -1.0 && u < 0.0) {
        float v = u + 1.0;
        return (-3.0 * v * v * v + 3.0 * v * v + 3.0 * v + 1.0) / 6.0;
    } else if (u >= 0.0 && u < 1.0) {
        return (-3.0 * u * u * u + 3.0 * u * u + 3.0 * u + 1.0) / 6.0;
    } else {
        float v = 1.0 - u;
        return v * v * v / 6.0;
    }
}

// Morlet wavelet for amplitude modulation
float morletWavelet(float t, float sigma, float omega) {
    float gaussian = exp(-(t * t) / (2.0 * sigma * sigma));
    float oscillation = cos(omega * t);
    return gaussian * oscillation;
}

// Enhanced wake decay with spline smoothing
float enhancedWakeDecay(float wakeAge, float vesselWeight) {
    float maxAge = 45.0;
    if (wakeAge >= maxAge) return 0.0;
    if (wakeAge <= 0.0) return 1.0;

    // Normalized age [0, 1]
    float normalizedAge = wakeAge / maxAge;

    // Three-stage spline decay based on control points
    float stage1 = 0.25; // 25% of lifetime - full intensity
    float stage2 = 0.60; // 60% of lifetime - gradual decay

    if (normalizedAge < stage1) {
        // Stage 1: Minimal decay (100% to 95%)
        return mix(1.0, 0.95, normalizedAge / stage1);
    } else if (normalizedAge < stage2) {
        // Stage 2: Gradual decay (95% to weight-dependent value)
        float t = (normalizedAge - stage1) / (stage2 - stage1);
        float midPoint = 0.6 + vesselWeight * 0.2;
        return mix(0.95, midPoint, smoothstep(0.0, 1.0, t));
    } else {
        // Stage 3: Rapid fade (mid-point to 0)
        float t = (normalizedAge - stage2) / (1.0 - stage2);
        float midPoint = 0.6 + vesselWeight * 0.2;
        return mix(midPoint, 0.0, smoothstep(0.0, 1.0, t));
    }
}

// Calculate wavelet-based amplitude modulation
float calculateWaveletAmplitude(float trailAge, float vesselWeight, float baseAmplitude) {
    // Adaptive parameters based on vessel weight
    float sigma = 3.0 + vesselWeight * 2.0; // Heavier vessels have longer-lasting wakes
    float omega = 2.0 - vesselWeight * 0.5; // Heavier vessels have lower frequency oscillations

    // Time scaling for wake persistence
    float scaledTime = trailAge / sigma;

    // Apply Morlet wavelet for natural decay with oscillations
    float waveletValue = morletWavelet(scaledTime, 1.0, omega);

    // Combine with exponential decay for realistic physics
    float exponentialDecay = exp(-trailAge / (15.0 + vesselWeight * 10.0));

    return baseAmplitude * waveletValue * exponentialDecay;
}

// Calculate shear mapping for wake spreading
vec2 calculateShearMapping(float distance, float vesselWeight, float baseWidth) {
    // Logarithmic spreading for realistic wake behavior
    float spreadFactor = 1.0 + log(1.0 + distance * 0.1) * (0.3 + vesselWeight * 0.2);

    // Dynamic shear angle based on wake physics
    float shearAngle = atan(0.05 + vesselWeight * 0.03) * min(distance / 20.0, 1.0);

    // Calculate effective width with shear
    float width = baseWidth * spreadFactor;

    return vec2(width, shearAngle);
}


// Multi-stage decay function for extended trails
float getTrailDecay(float wakeAge, float weight) {
    float stage1 = 5.0;  // First 5 seconds - minimal decay
    float stage2 = 15.0; // Next 10 seconds - gradual decay
    float stage3 = 30.0; // Final 15 seconds - rapid fade

    float decay = 1.0;

    if (wakeAge < stage1) {
        // Stage 1: Almost no decay (95-100%)
        decay = 1.0 - wakeAge * 0.01;
    } else if (wakeAge < stage2) {
        // Stage 2: Gradual decay (95% to 30%)
        float t = (wakeAge - stage1) / (stage2 - stage1);
        decay = mix(0.95, 0.3, t);
    } else if (wakeAge < stage3) {
        // Stage 3: Rapid fade to zero
        float t = (wakeAge - stage2) / (stage3 - stage2);
        decay = mix(0.3, 0.0, smoothstep(0.0, 1.0, t));
    } else {
        decay = 0.0;
    }

    // Heavier vessels decay slower
    return decay * (1.0 + weight * 0.3);
}

// Calculate vessel wake contribution using dynamic vessel properties
float calculateVesselWake(vec2 pos, vec3 vesselPos, vec3 vesselVel, float weight, float hullLength, float vesselState, float time) {
    // Get 2D position relative to vessel
    vec2 delta = pos - vesselPos.xz;
    float distance = length(delta);

    vec2 vesselDir = normalize(vesselVel.xz);
    float vesselSpeed = length(vesselVel.xz);

    // Skip if vessel is stationary
    if (vesselSpeed < 0.1) return 0.0;

    // Extended wake range for longer trails
    float maxTrailDistance = 50.0 + weight * 20.0; // Up to 70 units for heavy vessels
    float wakeRange = 15.0 + weight * 10.0 + vesselSpeed * 3.0; // Immediate wake range

    // Quick rejection for very distant points
    if (distance > 80.0) return 0.0;

    // Calculate dot product for wake positioning
    float dotProduct = dot(delta, vesselDir);

    // Only generate wake behind vessel
    if (dotProduct > 0.0) return 0.0;

    // Distance along vessel's path (behind vessel)
    float pathDistance = abs(dotProduct);

    // Early exit if beyond trail range
    if (pathDistance > maxTrailDistance) return 0.0;

    // Calculate Froude number for dynamic wake angle
    float froudeNumber = vesselSpeed / sqrt(GRAVITY * hullLength);

    // Enhanced dynamic wake angle with improved weight scaling
    // Base angle increases significantly with weight (heavier vessels push water laterally)
    float weightFactor = 1.0 + weight * 1.2; // More pronounced effect for heavy vessels

    // Speed-based adjustment with square root scaling
    float speedFactor = sqrt(1.0 + froudeNumber * 0.3);

    // Combined dynamic angle with clamping
    float dynamicAngle = clamp(KELVIN_ANGLE * weightFactor * speedFactor, KELVIN_ANGLE, KELVIN_ANGLE * 2.0);

    // Calculate wake arms with dynamic angle
    vec2 leftArm = rotate2D(vesselDir, dynamicAngle);
    vec2 rightArm = rotate2D(vesselDir, -dynamicAngle);

    // Calculate shear transformation early for consistent usage
    float baseWakeWidth = 1.5 + weight * 2.0;
    vec2 shearData = calculateShearMapping(pathDistance, weight, baseWakeWidth);
    float shearAngle = shearData.y;

    // Apply shear transformation to wake arms
    vec2 shearTransform = vec2(cos(shearAngle), sin(shearAngle));
    vec2 leftArmSheared = leftArm + shearTransform * (pathDistance / 20.0);
    vec2 rightArmSheared = rightArm - shearTransform * (pathDistance / 20.0);

    // Distance from sheared wake arm lines
    float leftDist = abs(dot(delta, vec2(-leftArmSheared.y, leftArmSheared.x)));
    float rightDist = abs(dot(delta, vec2(-rightArmSheared.y, rightArmSheared.x)));

    // Vessel state-based intensity modulation
    float stateIntensity = 1.0;
    if (vesselState > 0.5 && vesselState < 1.5) { // Ghost
        stateIntensity = 0.7;
    } else if (vesselState > 1.5) { // Fading
        float fadeFactor = (vesselState - 2.0); // Extract fade progress
        stateIntensity = 0.7 * (1.0 - fadeFactor);
    }

    // Dynamic wake amplitude based on weight and speed
    float baseAmplitude = vesselSpeed * (0.08 + weight * 0.12) * stateIntensity;

    // Decay slower for heavier vessels
    float decayRate = 0.08 - weight * 0.04; // Range: 0.04-0.08
    float decay = exp(-distance * decayRate);

    // Smooth fade as vessel approaches edge of wake range
    float edgeFade = 1.0;
    if (distance > wakeRange * 0.7) {
        // Smooth sigmoid fade from 70% to 100% of range
        float t = (distance - wakeRange * 0.7) / (wakeRange * 0.3);
        edgeFade = 1.0 - smoothstep(0.0, 1.0, t);
    }

    // Enhanced wake decay using spline-wavelet transform
    float wakeAge = pathDistance / vesselSpeed;
    float ageFactor = enhancedWakeDecay(wakeAge, weight);

    // Get effective width from pre-calculated shear data
    float effectiveWidth = shearData.x;

    float wakeHeight = 0.0;

    // Golden ratio for fibonacci wave patterns
    float phi = 1.618;

    // Left wake arm with enhanced spline-wavelet properties
    if (leftDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, leftDist);

        // Enhanced wave components with wavelet amplitude modulation
        for (int j = 0; j < 3; j++) {
            float wavelength = (2.0 + vesselSpeed * 0.4) * pow(phi, float(j) * 0.5);
            float k = waveNumber(wavelength);
            float omega = waveFrequency(k);

            // Golden angle phase offset for natural interference
            float phase = k * pathDistance - omega * time + float(j) * 2.39;

            // Enhanced amplitude with wavelet transform
            float baseWaveAmplitude = baseAmplitude * pow(0.618, float(j));
            float waveletAmplitude = calculateWaveletAmplitude(wakeAge, weight, baseWaveAmplitude);

            wakeHeight += waveletAmplitude * armIntensity * decay * ageFactor * sin(phase);
        }
    }

    // Right wake arm with enhanced spline-wavelet properties
    if (rightDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, rightDist);

        // Enhanced wave components with wavelet amplitude modulation
        for (int j = 0; j < 3; j++) {
            float wavelength = (2.0 + vesselSpeed * 0.4) * pow(phi, float(j) * 0.5);
            float k = waveNumber(wavelength);
            float omega = waveFrequency(k);

            // Golden angle phase offset for natural interference
            float phase = k * pathDistance - omega * time + float(j) * 2.39;

            // Enhanced amplitude with wavelet transform
            float baseWaveAmplitude = baseAmplitude * pow(0.618, float(j));
            float waveletAmplitude = calculateWaveletAmplitude(wakeAge, weight, baseWaveAmplitude);

            wakeHeight += waveletAmplitude * armIntensity * decay * ageFactor * sin(phase);
        }
    }

    // Apply edge fade for smooth transition
    return wakeHeight * edgeFade;
}

// Calculate all vessel wake contributions
float getAllVesselWakes(vec2 pos, float time) {
    if (!u_wakesEnabled || u_vesselCount == 0) return 0.0;

    float totalWake = 0.0;

    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        totalWake += calculateVesselWake(pos, u_vesselPositions[i], u_vesselVelocities[i],
                                       u_vesselWeights[i], u_vesselHullLengths[i], u_vesselStates[i], time);
    }

    return totalWake;
}


// Calculate ocean height with visible waves
float getOceanHeight(vec2 pos, float time) {
    float height = 0.0;

    // Primary waves - much larger amplitude for visibility
    height += sineWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
    height += sineWave(pos, vec2(0.7, 0.7), 6.0, 0.3, 1.2, time);
    height += sineWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);
    height += sineWave(pos, vec2(-0.6, 0.8), 4.0, 0.2, 1.5, time);

    // Secondary detail waves
    height += sineWave(pos, vec2(0.9, 0.4), 3.0, 0.15, 2.0, time);
    height += sineWave(pos, vec2(0.2, -0.9), 2.5, 0.12, 2.2, time);

    // Interference patterns for more complexity
    height += sineWave(pos, vec2(0.5, -0.5), 5.0, 0.1, 0.9, time);
    height += sineWave(pos, vec2(-0.8, 0.2), 7.0, 0.08, 1.1, time);

    // Fine noise for texture
    vec2 noisePos = pos * 3.0 + time * 0.2;
    height += fbm(noisePos) * 0.08;

    // Add vessel wake contributions
    float wakeHeight = getAllVesselWakes(pos, time);
    height += wakeHeight;

    return height;
}

// Get vessel position disturbance for visual indication
float getVesselDisturbance(vec2 pos) {
    if (!u_wakesEnabled || u_vesselCount == 0) return 0.0;

    float disturbance = 0.0;
    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        vec2 vesselPos = u_vesselPositions[i].xz;
        float distance = length(pos - vesselPos);

        // Small circular disturbance at vessel position
        if (distance < 1.0) {
            disturbance += (1.0 - distance) * 0.3;
        }
    }

    return disturbance;
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
    } else if (u_debugMode == 4) {
        // Show wake contribution map
        float wakeContribution = getAllVesselWakes(oceanPos, v_time);
        float intensity = clamp(abs(wakeContribution) * 5.0, 0.0, 1.0);
        vec3 wakeColor = mix(vec3(0.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0), intensity);
        fragColor = vec4(wakeColor, 1.0);
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

    // Add vessel position indicators (subtle disturbance)
    float vesselDisturbance = getVesselDisturbance(oceanPos);
    if (vesselDisturbance > 0.0) {
        vec3 vesselColor = mix(baseColor, FOAM_COLOR, vesselDisturbance * 0.8);
        baseColor = vesselColor;
    }

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

    float caustic1 = fbm(causticPos1);
    float caustic2 = fbm(causticPos2);

    caustic1 = smoothstep(0.6, 0.85, caustic1);
    caustic2 = smoothstep(0.65, 0.9, caustic2);

    float totalCaustics = caustic1 * 0.15 + caustic2 * 0.1;
    baseColor += vec3(totalCaustics);

    // Add animated foam trails following wave direction
    vec2 flowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
    vec2 flowPos = oceanPos + flowDir * v_time * 2.0;
    float flowNoise = fbm(flowPos * 12.0);
    float flowFoam = smoothstep(0.75, 0.95, flowNoise) * foamAmount;
    baseColor += vec3(flowFoam * 0.2);

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
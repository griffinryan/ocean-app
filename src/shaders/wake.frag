#version 300 es

precision highp float;

in vec2 v_uv;
in vec2 v_screenPos;
in float v_time;

uniform float u_aspectRatio;
uniform vec2 u_resolution;

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

// Simplified trail decay function for better performance
float getSimplifiedTrailDecay(float normalizedDistance, float weight) {
    // Simple exponential decay with smooth falloff
    float decay = exp(-normalizedDistance * 2.5);

    // Add subtle wavelet-like modulation
    float modulation = 1.0 - normalizedDistance * 0.3;

    // Weight influence
    float weightFactor = 1.0 + weight * 0.2;

    return max(0.0, decay * modulation * weightFactor);
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

    // Significantly extended wake range for longer, more visible trails
    float maxTrailDistance = 80.0 + weight * 25.0; // Up to 105 units for heavy vessels
    float wakeRange = 25.0 + weight * 15.0 + vesselSpeed * 4.0; // Expanded immediate wake range

    // Quick rejection for very distant points
    if (distance > 120.0) return 0.0;

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

    // Enhanced wake angle calculation including weight
    // Base angle increases with weight (heavy vessels push water laterally)
    float baseAngle = KELVIN_ANGLE * (1.0 + weight * 0.8); // 19.47° to 35°

    // Froude adjustment for speed effects
    float froudeModifier = 1.0 + froudeNumber * 0.2;

    // Progressive shear mapping for outward curling
    // Angle increases logarithmically with distance for natural curling
    float shearRate = 0.15; // Progressive wake curling rate
    float progressiveShear = 1.0 + shearRate * log(1.0 + pathDistance * 0.1);

    // Combined dynamic angle with progressive shear
    float dynamicAngle = baseAngle * froudeModifier * progressiveShear;

    // Calculate wake arms with dynamic angle
    vec2 leftArm = rotate2D(vesselDir, dynamicAngle);
    vec2 rightArm = rotate2D(vesselDir, -dynamicAngle);

    // Distance from wake arm lines
    float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
    float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

    // Vessel state-based intensity modulation
    float stateIntensity = 1.0;
    if (vesselState > 0.5 && vesselState < 1.5) { // Ghost
        stateIntensity = 0.7;
    } else if (vesselState > 1.5) { // Fading
        float fadeFactor = (vesselState - 2.0); // Extract fade progress
        stateIntensity = 0.7 * (1.0 - fadeFactor);
    }

    // Enhanced dynamic wake amplitude with increased intensity
    float baseAmplitude = vesselSpeed * (0.15 + weight * 0.25) * stateIntensity; // Increased for visibility

    // Simplified decay for graceful trail fading
    float normalizedPathDistance = min(pathDistance / maxTrailDistance, 1.0);
    float simplifiedDecay = getSimplifiedTrailDecay(normalizedPathDistance, weight);

    // Smooth fade as vessel approaches edge of wake range with expanded transition
    float edgeFade = 1.0;
    if (distance > wakeRange * 0.6) {
        // Expanded smooth transition from 60% to 100% of range
        float t = (distance - wakeRange * 0.6) / (wakeRange * 0.4);
        edgeFade = 1.0 - smoothstep(0.0, 1.0, t);
    }

    // Combined decay factor using simplified function
    float ageFactor = simplifiedDecay;

    // Enhanced wake width with progressive spreading for curling effect
    float baseWakeWidth = 2.0 + weight * 3.0; // Increased range: 2.0-5.0 units for visibility
    float spreadFactor = 1.0 + log(pathDistance + 1.0) * 0.3; // Enhanced spreading
    float curlSpread = 1.0 + progressiveShear * 0.2; // Additional spreading from curling
    float effectiveWidth = baseWakeWidth * spreadFactor * curlSpread;

    float wakeHeight = 0.0;

    // Golden ratio for fibonacci wave patterns
    float phi = 1.618;

    // Left wake arm with optimized wave components
    if (leftDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, leftDist);

        // Optimized wave components (reduced from 3 to 2 for performance)
        for (int j = 0; j < 2; j++) {
            float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.5);
            float k = waveNumber(wavelength);
            float omega = waveFrequency(k);

            // Golden angle phase offset for natural interference
            float phase = k * pathDistance - omega * time + float(j) * 2.39;
            float amplitude = baseAmplitude * pow(0.618, float(j));

            // Apply enhanced decay and curling effects
            float waveComponent = amplitude * armIntensity * ageFactor * edgeFade * sin(phase);
            wakeHeight += waveComponent;
        }
    }

    // Right wake arm with optimized wave components
    if (rightDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, rightDist);

        // Optimized wave components (reduced from 3 to 2 for performance)
        for (int j = 0; j < 2; j++) {
            float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.5);
            float k = waveNumber(wavelength);
            float omega = waveFrequency(k);

            // Golden angle phase offset for natural interference
            float phase = k * pathDistance - omega * time + float(j) * 2.39;
            float amplitude = baseAmplitude * pow(0.618, float(j));

            // Apply enhanced decay and curling effects
            float waveComponent = amplitude * armIntensity * ageFactor * edgeFade * sin(phase);
            wakeHeight += waveComponent;
        }
    }

    // Enhanced wake intensity multiplier for better visibility
    return wakeHeight * 1.5; // Increased intensity for clearer wake trails
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

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = v_screenPos * 15.0; // Scale for wave visibility
    oceanPos.x *= u_aspectRatio; // Maintain aspect ratio

    // Calculate wake height at this position
    float wakeHeight = getAllVesselWakes(oceanPos, v_time);

    // Output wake height as red channel (R32F format)
    // Using a single channel for efficiency
    fragColor = vec4(wakeHeight, 0.0, 0.0, 1.0);
}

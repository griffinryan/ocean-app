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


// Mexican Hat wavelet function for natural amplitude modulation
float mexicanHat(float x, float sigma) {
    float normalized = x / sigma;
    float x2 = normalized * normalized;
    return (1.0 - x2) * exp(-x2 * 0.5);
}

// Cubic Hermite spline interpolation
float cubicHermite(float t, float p0, float p1, float m0, float m1) {
    float t2 = t * t;
    float t3 = t2 * t;

    float h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    float h10 = t3 - 2.0 * t2 + t;
    float h01 = -2.0 * t3 + 3.0 * t2;
    float h11 = t3 - t2;

    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

// Enhanced spline-wavelet decay function for extended graceful trails
float getEnhancedTrailDecay(float normalizedDistance, float weight) {
    // Spline control points for smooth decay curve
    // Strong start -> gentle initial decay -> mid-trail fade -> rapid final fade -> complete fade
    float splineDecay = 1.0;

    if (normalizedDistance <= 0.3) {
        // Stage 1: Strong start to gentle initial decay
        float t = normalizedDistance / 0.3;
        splineDecay = cubicHermite(t, 1.0, 0.85, -0.5, -0.8);
    } else if (normalizedDistance <= 0.6) {
        // Stage 2: Gentle decay to mid-trail fade
        float t = (normalizedDistance - 0.3) / 0.3;
        splineDecay = cubicHermite(t, 0.85, 0.5, -0.8, -1.2);
    } else if (normalizedDistance <= 0.85) {
        // Stage 3: Mid-trail to rapid fade
        float t = (normalizedDistance - 0.6) / 0.25;
        splineDecay = cubicHermite(t, 0.5, 0.2, -1.2, -2.0);
    } else {
        // Stage 4: Rapid final fade to complete fade
        float t = (normalizedDistance - 0.85) / 0.15;
        splineDecay = cubicHermite(t, 0.2, 0.0, -2.0, -3.0);
    }

    // Apply Mexican Hat wavelet for natural amplitude modulation
    float waveletModulation = mexicanHat(normalizedDistance, 0.35);

    // Combine spline and wavelet with weight influence
    float weightFactor = 1.0 + weight * 0.3;
    return max(0.0, splineDecay * waveletModulation * weightFactor);
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

    // Enhanced spline-wavelet decay for graceful trail fading
    float normalizedPathDistance = min(pathDistance / maxTrailDistance, 1.0);
    float enhancedDecay = getEnhancedTrailDecay(normalizedPathDistance, weight);

    // Smooth fade as vessel approaches edge of wake range with expanded transition
    float edgeFade = 1.0;
    if (distance > wakeRange * 0.6) {
        // Expanded smooth transition from 60% to 100% of range
        float t = (distance - wakeRange * 0.6) / (wakeRange * 0.4);
        edgeFade = 1.0 - smoothstep(0.0, 1.0, t);
    }

    // Combined decay factor using enhanced spline-wavelet function
    float ageFactor = enhancedDecay;

    // Enhanced wake width with progressive spreading for curling effect
    float baseWakeWidth = 2.0 + weight * 3.0; // Increased range: 2.0-5.0 units for visibility
    float spreadFactor = 1.0 + log(pathDistance + 1.0) * 0.3; // Enhanced spreading
    float curlSpread = 1.0 + progressiveShear * 0.2; // Additional spreading from curling
    float effectiveWidth = baseWakeWidth * spreadFactor * curlSpread;

    float wakeHeight = 0.0;

    // Golden ratio for fibonacci wave patterns
    float phi = 1.618;

    // Left wake arm with dynamic properties
    if (leftDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, leftDist);

        // Enhanced wave components with more layers for richer wake patterns
        for (int j = 0; j < 3; j++) {
            float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.4);
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

    // Right wake arm with dynamic properties
    if (rightDist < effectiveWidth) {
        float armIntensity = smoothstep(effectiveWidth, effectiveWidth * 0.3, rightDist);

        // Enhanced wave components with more layers for richer wake patterns
        for (int j = 0; j < 3; j++) {
            float wavelength = (2.5 + vesselSpeed * 0.5) * pow(phi, float(j) * 0.4);
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
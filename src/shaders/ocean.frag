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
uniform bool u_wakesEnabled;

// Wake trail uniforms for historical wake rendering (reduced for performance)
uniform int u_wakeTrailCount;
uniform vec3 u_wakeTrailPositions[15];
uniform vec3 u_wakeTrailVelocities[15];
uniform float u_wakeTrailIntensities[15];
uniform float u_wakeTrailHeadings[15];
uniform float u_wakeTrailCurvatures[15];

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

// Calculate vessel wake contribution using Kelvin pattern with LOD
float calculateVesselWake(vec2 pos, vec3 vesselPos, vec3 vesselVel, float time) {
    // Get 2D position relative to vessel
    vec2 delta = pos - vesselPos.xz;

    // Use squared distance for early exit (avoids expensive sqrt)
    float distanceSquared = dot(delta, delta);
    const float maxDistanceSquared = 400.0; // 20.0 * 20.0

    // Skip if too far from vessel
    if (distanceSquared > maxDistanceSquared) return 0.0;

    // Only calculate actual distance when needed
    float distance = sqrt(distanceSquared);

    // LOD system: different detail levels based on distance
    // Level 0 (0-5 units): Full quality
    // Level 1 (5-12 units): Reduced quality
    // Level 2 (12-20 units): Simple approximation
    int lodLevel = distance < 5.0 ? 0 : (distance < 12.0 ? 1 : 2);

    // Pre-calculate vessel velocity properties
    float vesselSpeedSquared = dot(vesselVel.xz, vesselVel.xz);

    // Skip if vessel is stationary (using squared speed)
    if (vesselSpeedSquared < 0.01) return 0.0; // 0.1 * 0.1

    float vesselSpeed = sqrt(vesselSpeedSquared);
    vec2 vesselDir = vesselVel.xz / vesselSpeed; // Normalize efficiently

    float wakeHeight = 0.0;

    // Calculate dot product for wake positioning
    float dotProduct = dot(delta, vesselDir);

    // Only generate wake behind vessel
    if (dotProduct > 0.0) return 0.0;

    // Distance along vessel's path (negative behind vessel)
    float pathDistance = abs(dotProduct);

    // Pre-compute Kelvin wake arm directions (cache trig calculations)
    const float cosKelvin = cos(KELVIN_ANGLE); // ≈ 0.9435
    const float sinKelvin = sin(KELVIN_ANGLE); // ≈ 0.3311

    // Calculate wake arms efficiently without function calls
    vec2 leftArm = vec2(
        vesselDir.x * cosKelvin - vesselDir.y * sinKelvin,
        vesselDir.x * sinKelvin + vesselDir.y * cosKelvin
    );
    vec2 rightArm = vec2(
        vesselDir.x * cosKelvin + vesselDir.y * sinKelvin,
        -vesselDir.x * sinKelvin + vesselDir.y * cosKelvin
    );

    // Distance from wake arm lines (pre-compute perpendicular vectors)
    vec2 leftPerp = vec2(-leftArm.y, leftArm.x);
    vec2 rightPerp = vec2(-rightArm.y, rightArm.x);
    float leftDist = abs(dot(delta, leftPerp));
    float rightDist = abs(dot(delta, rightPerp));

    // Wake amplitude based on vessel speed
    float baseAmplitude = vesselSpeed * 0.08;

    // Combined decay factors (reduce exp calls)
    float distanceDecay = exp(-distance * 0.15);
    float wakeAge = pathDistance / vesselSpeed;
    float ageFactor = exp(-wakeAge * 0.3);
    float combinedDecay = distanceDecay * ageFactor;

    // Apply LOD-based quality levels
    if (lodLevel == 2) {
        // Level 2: Simple approximation for distant wakes
        float simpleWake = baseAmplitude * combinedDecay * 0.5;
        if (leftDist < 2.0) wakeHeight += simpleWake * (1.0 - leftDist / 2.0);
        if (rightDist < 2.0) wakeHeight += simpleWake * (1.0 - rightDist / 2.0);
        return wakeHeight;
    }

    // Pre-compute wave properties once for both arms
    float wavelength = 2.0 + vesselSpeed * 0.5;
    float k = waveNumber(wavelength);
    float omega = waveFrequency(k);

    // Left wake arm
    if (leftDist < 1.5) {
        float armIntensity = (1.5 - leftDist) / 1.5;
        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * combinedDecay * sin(phase);
    }

    // Right wake arm
    if (rightDist < 1.5) {
        float armIntensity = (1.5 - rightDist) / 1.5;
        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * combinedDecay * sin(phase);
    }

    // Skip transverse waves for LOD level 1 (medium distance)
    if (lodLevel == 1) return wakeHeight;

    // Full quality transverse waves (LOD level 0 only)
    vec2 perpDir = vec2(-vesselDir.y, vesselDir.x);
    float lateralDist = abs(dot(delta, perpDir));

    // Check if point is inside the Kelvin wake V
    float leftArmDot = dot(delta, leftArm);
    float rightArmDot = dot(delta, rightArm);

    if (leftArmDot < 0.0 && rightArmDot < 0.0 && pathDistance < 15.0) {
        // Generate curved transverse waves
        float vIntensity = smoothstep(3.0, 0.5, lateralDist);

        if (vIntensity > 0.0) {
            // Pre-compute common values
            float baseTransverseAmplitude = baseAmplitude * 0.6 * pow(vIntensity, 1.5);
            float curvature = 0.1 / (pathDistance + 1.0);
            float lateralSquared = lateralDist * lateralDist;

            // Simplified wave generation
            float wl1 = 1.5 + vesselSpeed * 0.3;
            float k1 = waveNumber(wl1);
            float omega1 = waveFrequency(k1);
            float curvedPath1 = pathDistance + curvature * lateralSquared;
            float phase1 = k1 * curvedPath1 - omega1 * time;
            wakeHeight += baseTransverseAmplitude * combinedDecay * sin(phase1);

            // Add one more wave for complexity
            float wl2 = 2.3 + vesselSpeed * 0.3;
            float k2 = waveNumber(wl2);
            float omega2 = waveFrequency(k2);
            float phase2 = k2 * curvedPath1 - omega2 * time + 0.5;
            wakeHeight += baseTransverseAmplitude * 0.7 * combinedDecay * sin(phase2);
        }
    }

    // Add turbulent water near vessel
    if (distance < 3.0) {
        float turbulence = (3.0 - distance) / 3.0;
        float noiseScale = 8.0;
        vec2 noisePos = pos * noiseScale + time * vesselSpeed * 2.0;
        float turbNoise = fbm(noisePos) * 0.5 - 0.25;
        wakeHeight += turbNoise * turbulence * baseAmplitude * 1.5;
    }

    return wakeHeight;
}

// Calculate historical wake trail contributions
float calculateWakeTrailContribution(vec2 pos, float time) {
    if (!u_wakesEnabled || u_wakeTrailCount == 0) return 0.0;

    float trailWake = 0.0;

    for (int i = 0; i < u_wakeTrailCount && i < 15; i++) {
        vec3 trailPos = u_wakeTrailPositions[i];
        vec3 trailVel = u_wakeTrailVelocities[i];
        float intensity = u_wakeTrailIntensities[i];
        float heading = u_wakeTrailHeadings[i];
        float curvature = u_wakeTrailCurvatures[i];

        // Skip if intensity is too low
        if (intensity < 0.1) continue;

        vec2 delta = pos - trailPos.xz;

        // Use squared distance for early exit
        float distanceSquared = dot(delta, delta);
        const float maxTrailDistanceSquared = 64.0; // 8.0 * 8.0

        // Skip if too far from trail point
        if (distanceSquared > maxTrailDistanceSquared) continue;

        // Pre-calculate trail velocity properties
        float trailSpeedSquared = dot(trailVel.xz, trailVel.xz);
        if (trailSpeedSquared < 0.01) continue; // Skip stationary trails

        float trailSpeed = sqrt(trailSpeedSquared);
        vec2 trailDir = trailVel.xz / trailSpeed; // Efficient normalize

        // Early check for wake position (only behind trail point)
        float dotProduct = dot(delta, trailDir);
        if (dotProduct > 0.0) continue; // Skip if in front of trail point

        // Only calculate actual distance when needed for later calculations
        float distance = sqrt(distanceSquared);

        // LOD system for trail wakes: reduce quality for distant trails
        bool useSimpleLOD = distance > 4.0;

        // Calculate wake based on distance and curvature
        float baseAmplitude = trailSpeed * 0.04 * intensity;

        // Apply curvature effects for turning vessels
        if (curvature > 0.01) {
            // Calculate lateral displacement based on curvature
            vec2 perpDir = vec2(-trailDir.y, trailDir.x);
            float lateralOffset = dot(delta, perpDir);

            // Wake spreads outward during turns
            float turnFactor = 1.0 + curvature * abs(lateralOffset) * 0.5;
            baseAmplitude *= turnFactor;

            // Add asymmetric wake spreading
            if (lateralOffset > 0.0) {
                baseAmplitude *= (1.0 + curvature * 2.0);
            }
        }

        // Decay with distance
        float decay = exp(-distance * 0.2);
        float pathDistance = abs(dotProduct);

        if (useSimpleLOD) {
            // Simplified LOD for distant trails
            float simpleTrailWake = baseAmplitude * decay * 0.3;
            vec2 perpDir = vec2(-trailDir.y, trailDir.x);
            float lateralDist = abs(dot(delta, perpDir));
            if (lateralDist < 1.5) {
                trailWake += simpleTrailWake * (1.0 - lateralDist / 1.5);
            }
        } else {
            // Full quality for nearby trails
            // Pre-compute Kelvin wake arm directions
            const float cosKelvin = cos(KELVIN_ANGLE);
            const float sinKelvin = sin(KELVIN_ANGLE);

            vec2 leftArm = vec2(
                trailDir.x * cosKelvin - trailDir.y * sinKelvin,
                trailDir.x * sinKelvin + trailDir.y * cosKelvin
            );
            vec2 rightArm = vec2(
                trailDir.x * cosKelvin + trailDir.y * sinKelvin,
                -trailDir.x * sinKelvin + trailDir.y * cosKelvin
            );

            float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
            float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

            // Wake wavelength varies with speed
            float wavelength = 1.5 + trailSpeed * 0.4;
            float k = waveNumber(wavelength);
            float omega = waveFrequency(k);

            // Left wake arm
            if (leftDist < 1.2) {
                float armIntensity = (1.2 - leftDist) / 1.2;
                float phase = k * pathDistance - omega * time;
                trailWake += baseAmplitude * armIntensity * decay * sin(phase);
            }

            // Right wake arm
            if (rightDist < 1.2) {
                float armIntensity = (1.2 - rightDist) / 1.2;
                float phase = k * pathDistance - omega * time;
                trailWake += baseAmplitude * armIntensity * decay * sin(phase);
            }
        }
    }

    return trailWake;
}

// Calculate all vessel wake contributions
float getAllVesselWakes(vec2 pos, float time) {
    if (!u_wakesEnabled) return 0.0;

    float totalWake = 0.0;

    // Add current vessel wakes
    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        totalWake += calculateVesselWake(pos, u_vesselPositions[i], u_vesselVelocities[i], time);
    }

    // Add historical wake trail contributions
    totalWake += calculateWakeTrailContribution(pos, time);

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

    // Add vessel wake contributions (constructive/destructive interference)
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
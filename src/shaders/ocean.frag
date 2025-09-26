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

out vec4 fragColor;

// Enhanced ocean color palette
const vec3 DEEP_WATER = vec3(0.05, 0.15, 0.4);
const vec3 SHALLOW_WATER = vec3(0.1, 0.4, 0.7);
const vec3 FOAM_COLOR = vec3(0.9, 0.95, 1.0);
const vec3 WAVE_CREST = vec3(0.3, 0.6, 0.9);

// Wake-specific colors for disturbed water
const vec3 DISTURBED_DEEP = vec3(0.08, 0.2, 0.45);
const vec3 DISTURBED_SHALLOW = vec3(0.15, 0.45, 0.75);
const vec3 AERATED_WATER = vec3(0.4, 0.7, 0.85);
const vec3 WAKE_FOAM = vec3(0.95, 0.98, 1.0);
const vec3 TURBULENT_WATER = vec3(0.2, 0.5, 0.8);

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

// Wake data structure for enhanced physics
struct WakeData {
    float height;
    float foamIntensity;
    float disturbance;
    vec2 velocity;
};

// Calculate bow wave contribution at vessel front
float calculateBowWave(vec2 pos, vec3 vesselPos, vec3 vesselVel, float time) {
    vec2 delta = pos - vesselPos.xz;
    float distance = length(delta);

    vec2 vesselDir = normalize(vesselVel.xz);
    float vesselSpeed = length(vesselVel.xz);

    if (vesselSpeed < 0.1 || distance > 8.0) return 0.0;

    // Check if point is in front of vessel
    float dotProduct = dot(delta, vesselDir);
    if (dotProduct <= 0.0) return 0.0;

    // Distance perpendicular to vessel direction
    vec2 perpDir = vec2(-vesselDir.y, vesselDir.x);
    float lateralDist = abs(dot(delta, perpDir));

    // Bow wave width scales with speed
    float bowWidth = 1.5 + vesselSpeed * 0.3;
    if (lateralDist > bowWidth) return 0.0;

    // Bow wave amplitude and shape
    float frontDistance = dotProduct;
    float bowDecay = exp(-frontDistance * 0.8) * exp(-lateralDist * 1.2);
    float bowAmplitude = vesselSpeed * 0.12 * bowDecay;

    // Create characteristic "mustache" pattern
    float wavelength = 1.2 + vesselSpeed * 0.2;
    float k = waveNumber(wavelength);
    float omega = waveFrequency(k);

    float phase = k * frontDistance - omega * time;
    float lateralModulation = smoothstep(bowWidth, 0.0, lateralDist);

    return bowAmplitude * lateralModulation * sin(phase);
}

// Enhanced vessel wake calculation with comprehensive physics
WakeData calculateVesselWakeData(vec2 pos, vec3 vesselPos, vec3 vesselVel, float time) {
    WakeData wake;
    wake.height = 0.0;
    wake.foamIntensity = 0.0;
    wake.disturbance = 0.0;
    wake.velocity = vec2(0.0);

    // Get 2D position relative to vessel
    vec2 delta = pos - vesselPos.xz;
    float distance = length(delta);

    // Skip if too far from vessel
    if (distance > 25.0) return wake;

    vec2 vesselDir = normalize(vesselVel.xz);
    float vesselSpeed = length(vesselVel.xz);

    // Skip if vessel is stationary
    if (vesselSpeed < 0.1) return wake;

    // Calculate dot product for wake positioning
    float dotProduct = dot(delta, vesselDir);

    // Add bow wave for front of vessel
    wake.height += calculateBowWave(pos, vesselPos, vesselVel, time);

    // Only generate wake behind vessel for remaining calculations
    if (dotProduct < 0.0) return wake;

    // Distance along vessel's path
    float pathDistance = abs(dotProduct);

    // Calculate wake arms (Kelvin pattern)
    vec2 leftArm = rotate2D(vesselDir, KELVIN_ANGLE);
    vec2 rightArm = rotate2D(vesselDir, -KELVIN_ANGLE);

    // Distance from wake arm lines
    float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
    float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

    // Enhanced amplitude calculation
    float baseAmplitude = vesselSpeed * 0.1;
    float speedBoost = pow(vesselSpeed / 5.0, 1.5); // Non-linear speed scaling

    // Enhanced decay factors
    float distanceDecay = exp(-distance * 0.12);
    float wakeAge = pathDistance / max(vesselSpeed, 0.1);
    float ageDecay = exp(-wakeAge * 0.25);

    // Enhanced left wake arm with phase considerations
    if (leftDist < 2.0) {
        float armIntensity = smoothstep(2.0, 0.3, leftDist);
        float wavelength = 2.2 + vesselSpeed * 0.6;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);

        float phase = k * pathDistance - omega * time;
        float amplitude = baseAmplitude * armIntensity * distanceDecay * ageDecay * speedBoost;

        // Wave amplitude clamping for realism
        amplitude = min(amplitude, 0.8);

        float waveHeight = amplitude * sin(phase);
        wake.height += waveHeight;

        // Generate foam on wave crests
        float crestFactor = smoothstep(0.3, 0.8, abs(sin(phase)));
        wake.foamIntensity += armIntensity * crestFactor * distanceDecay * 0.7;
    }

    // Enhanced right wake arm
    if (rightDist < 2.0) {
        float armIntensity = smoothstep(2.0, 0.3, rightDist);
        float wavelength = 2.2 + vesselSpeed * 0.6;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);

        float phase = k * pathDistance - omega * time;
        float amplitude = baseAmplitude * armIntensity * distanceDecay * ageDecay * speedBoost;

        amplitude = min(amplitude, 0.8);

        float waveHeight = amplitude * sin(phase);
        wake.height += waveHeight;

        float crestFactor = smoothstep(0.3, 0.8, abs(sin(phase)));
        wake.foamIntensity += armIntensity * crestFactor * distanceDecay * 0.7;
    }

    // Enhanced transverse waves inside the V
    vec2 perpDir = vec2(-vesselDir.y, vesselDir.x);
    float lateralDist = abs(dot(delta, perpDir));

    // Check if point is inside the Kelvin wake V
    float leftArmDot = dot(delta, leftArm);
    float rightArmDot = dot(delta, rightArm);

    if (leftArmDot < 0.0 && rightArmDot < 0.0 && pathDistance < 18.0) {
        float vIntensity = smoothstep(4.0, 0.5, lateralDist);

        if (vIntensity > 0.0) {
            // Multiple wavelengths for complexity with better superposition
            for (int i = 0; i < 3; i++) {
                float wl = 1.6 + float(i) * 0.9 + vesselSpeed * 0.4;
                float k = waveNumber(wl);
                float omega = waveFrequency(k);

                // Enhanced curved wave fronts
                float curvature = 0.08 / (pathDistance + 1.0);
                float curvedPath = pathDistance + curvature * lateralDist * lateralDist;

                float phase = k * curvedPath - omega * time + float(i) * 0.6;
                float amplitude = baseAmplitude * 0.5 * pow(vIntensity, 1.2) * speedBoost;

                amplitude = min(amplitude, 0.6);

                float waveHeight = amplitude * distanceDecay * ageDecay * sin(phase);
                wake.height += waveHeight;

                // Add foam for transverse waves
                float crestFactor = smoothstep(0.4, 0.9, abs(sin(phase)));
                wake.foamIntensity += vIntensity * crestFactor * distanceDecay * 0.4;
            }
        }
    }

    // Enhanced turbulent water near vessel with persistent foam
    if (distance < 4.0) {
        float turbulence = smoothstep(4.0, 0.5, distance);
        float noiseScale = 10.0;
        vec2 noisePos = pos * noiseScale + time * vesselSpeed * 1.8;
        float turbNoise = fbm(noisePos) * 0.4 - 0.2;

        wake.height += turbNoise * turbulence * baseAmplitude * 1.2;

        // Persistent foam generation in turbulent wake
        float foamNoise = fbm(noisePos * 1.5 + time * 0.5);
        wake.foamIntensity += turbulence * (0.8 + foamNoise * 0.4);

        // Set water velocity for foam trails
        wake.velocity = vesselDir * vesselSpeed * turbulence * 0.3;
    }

    // General disturbance factor for color blending
    wake.disturbance = clamp(distanceDecay * ageDecay * speedBoost, 0.0, 1.0);

    return wake;
}

// Calculate all vessel wake contributions with enhanced superposition
WakeData getAllVesselWakeData(vec2 pos, float time) {
    WakeData totalWake;
    totalWake.height = 0.0;
    totalWake.foamIntensity = 0.0;
    totalWake.disturbance = 0.0;
    totalWake.velocity = vec2(0.0);

    if (!u_wakesEnabled || u_vesselCount == 0) return totalWake;

    // Collect all wake contributions
    WakeData wakes[5];
    int activeWakes = 0;

    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        wakes[i] = calculateVesselWakeData(pos, u_vesselPositions[i], u_vesselVelocities[i], time);
        if (wakes[i].height != 0.0 || wakes[i].foamIntensity > 0.0) {
            activeWakes++;
        }
    }

    if (activeWakes == 0) return totalWake;

    // Enhanced wave superposition with interference patterns
    float totalPhase = 0.0;
    float totalAmplitude = 0.0;
    float maxFoam = 0.0;
    float maxDisturbance = 0.0;

    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        // Simple addition for now - can be enhanced with phase analysis
        totalWake.height += wakes[i].height;

        // Maximum foam intensity from all wakes
        maxFoam = max(maxFoam, wakes[i].foamIntensity);

        // Maximum disturbance for color blending
        maxDisturbance = max(maxDisturbance, wakes[i].disturbance);

        // Velocity averaging
        totalWake.velocity += wakes[i].velocity;
    }

    // Apply wave amplitude clamping to prevent unrealistic heights
    totalWake.height = clamp(totalWake.height, -1.5, 1.5);

    // Non-linear foam combination for more realistic accumulation
    totalWake.foamIntensity = min(maxFoam * 1.2, 1.0);

    totalWake.disturbance = clamp(maxDisturbance, 0.0, 1.0);

    // Normalize velocity
    if (length(totalWake.velocity) > 0.0) {
        totalWake.velocity /= float(activeWakes);
    }

    return totalWake;
}

// Legacy function for backward compatibility
float getAllVesselWakes(vec2 pos, float time) {
    return getAllVesselWakeData(pos, time).height;
}

// Enhanced ocean height calculation with wake integration
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

    // Get enhanced wake data for superposition
    WakeData wakeData = getAllVesselWakeData(pos, time);

    // Enhanced wave-wake interaction with non-linear effects
    float wakeHeight = wakeData.height;

    // Wave breaking simulation - reduce amplitude when wake is too high
    if (abs(wakeHeight) > 0.6) {
        wakeHeight *= 0.7; // Simulate wave breaking
    }

    // Add wake with proper superposition
    height += wakeHeight;

    // Apply overall wave amplitude limits
    height = clamp(height, -2.0, 2.0);

    return height;
}

// Get complete wake data for rendering
WakeData getOceanWakeData(vec2 pos, float time) {
    return getAllVesselWakeData(pos, time);
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
        // Show enhanced wake contribution map
        WakeData wakeData = getAllVesselWakeData(oceanPos, v_time);
        float intensity = clamp(abs(wakeData.height) * 3.0, 0.0, 1.0);
        float foamVis = clamp(wakeData.foamIntensity, 0.0, 1.0);
        vec3 wakeColor = mix(vec3(0.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0), intensity);
        wakeColor = mix(wakeColor, vec3(1.0, 0.5, 0.5), foamVis);
        fragColor = vec4(wakeColor, 1.0);
        return;
    }

    // Get enhanced wave and wake data
    float height = getOceanHeight(oceanPos, v_time);
    WakeData wakeData = getOceanWakeData(oceanPos, v_time);

    // Calculate normal for lighting
    vec3 normal = calculateNormal(oceanPos, v_time);

    // Enhanced color calculation with wake integration
    vec3 baseColor;

    // Choose base color palette based on wake disturbance
    if (wakeData.disturbance > 0.1) {
        // Use disturbed water colors
        baseColor = mix(DISTURBED_DEEP, DISTURBED_SHALLOW, smoothstep(-0.3, 0.3, height));

        // Add aeration effects for high disturbance
        if (wakeData.disturbance > 0.5) {
            float aerationFactor = (wakeData.disturbance - 0.5) * 2.0;
            baseColor = mix(baseColor, AERATED_WATER, aerationFactor * 0.6);
        }
    } else {
        // Use normal ocean colors
        baseColor = mix(DEEP_WATER, SHALLOW_WATER, smoothstep(-0.3, 0.3, height));
    }

    // Enhanced wave crests with wake consideration
    float crestAmount = smoothstep(0.12, 0.28, height);
    vec3 crestColor = mix(WAVE_CREST, TURBULENT_WATER, wakeData.disturbance);
    baseColor = mix(baseColor, crestColor, crestAmount);

    // Enhanced foam system - separate ocean foam and wake foam
    float oceanFoam = smoothstep(0.18, 0.35, height);
    float wakeFoam = wakeData.foamIntensity;

    // Combine foam types with different characteristics
    vec3 foamColor = mix(FOAM_COLOR, WAKE_FOAM, wakeFoam);
    float totalFoam = clamp(oceanFoam + wakeFoam * 1.5, 0.0, 1.0);
    baseColor = mix(baseColor, foamColor, totalFoam);

    // Persistent foam trails using wake velocity
    if (length(wakeData.velocity) > 0.1) {
        vec2 foamTrailPos = oceanPos + wakeData.velocity * v_time * 3.0;
        float trailNoise = fbm(foamTrailPos * 8.0 + v_time * 0.3);
        float trailFoam = smoothstep(0.6, 0.9, trailNoise) * wakeFoam * 0.6;
        baseColor = mix(baseColor, WAKE_FOAM, trailFoam);
    }

    // Add vessel position indicators (enhanced)
    float vesselDisturbance = getVesselDisturbance(oceanPos);
    if (vesselDisturbance > 0.0) {
        vec3 vesselColor = mix(baseColor, WAKE_FOAM, vesselDisturbance * 0.9);
        baseColor = vesselColor;
    }

    // Enhanced lighting with wake considerations
    vec3 mainLight = normalize(vec3(0.6, 1.0, 0.4));
    vec3 rimLight = normalize(vec3(-0.3, 0.8, -0.5));

    float mainLighting = max(0.2, dot(normal, mainLight));
    float rimLighting = max(0.0, dot(normal, rimLight)) * 0.3;

    // Enhance lighting in wake areas for better visibility
    float wakeLightBoost = 1.0 + wakeData.disturbance * 0.2;
    float totalLighting = (mainLighting + rimLighting) * wakeLightBoost;
    baseColor *= clamp(totalLighting, 0.3, 1.4);

    // Enhanced caustics with wake interaction
    vec2 causticPos1 = oceanPos * 18.0 + v_time * 2.5;
    vec2 causticPos2 = oceanPos * 25.0 - v_time * 1.8;

    // Modify caustics in wake areas
    if (wakeData.disturbance > 0.0) {
        causticPos1 += wakeData.velocity * v_time * 2.0;
        causticPos2 += wakeData.velocity * v_time * 1.5;
    }

    float caustic1 = fbm(causticPos1);
    float caustic2 = fbm(causticPos2);

    caustic1 = smoothstep(0.6, 0.85, caustic1);
    caustic2 = smoothstep(0.65, 0.9, caustic2);

    float causticIntensity = 0.15 + wakeData.disturbance * 0.1;
    float totalCaustics = caustic1 * causticIntensity + caustic2 * 0.1;
    baseColor += vec3(totalCaustics);

    // Enhanced foam trails with better physics
    vec2 flowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
    vec2 flowPos = oceanPos + flowDir * v_time * 2.0;

    // Add wake velocity influence to flow
    if (length(wakeData.velocity) > 0.0) {
        flowPos += normalize(wakeData.velocity) * v_time * 1.5;
    }

    float flowNoise = fbm(flowPos * 12.0);
    float flowFoam = smoothstep(0.75, 0.95, flowNoise) * totalFoam;
    baseColor += vec3(flowFoam * 0.15);

    // Stylistic quantization with enhanced dithering
    baseColor = quantizeColor(baseColor, 8);

    // Enhanced dithering for wake areas
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float dither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    float ditherStrength = 0.02 + wakeData.disturbance * 0.01;
    baseColor += vec3((dither - 0.5) * ditherStrength);

    // Optional debug grid (only in debug mode 0)
    if (u_debugMode == 0) {
        vec2 grid = abs(fract(oceanPos * 0.3) - 0.5);
        float gridLine = smoothstep(0.015, 0.005, min(grid.x, grid.y));
        baseColor += vec3(gridLine * 0.05);
    }

    fragColor = vec4(baseColor, 1.0);
}
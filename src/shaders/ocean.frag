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

// Wake data structure for enhanced physics
struct WakeData {
    float height;
    float foamIntensity;
    float disturbance;
    vec2 velocity;
};

// Wave state structure for directional wave physics
struct WaveState {
    float height;
    vec2 velocity;     // Horizontal particle velocity
    vec2 gradient;     // Height gradient for flow direction
    float energy;      // Wave energy density
};

// Complete ocean state for rendering
struct CompleteOceanState {
    WaveState oceanWaves;
    WakeData vesselWakes;
    float totalHeight;
    vec2 totalVelocity;
};

// Constants for wake physics
const float PI = 3.14159265359;
const float KELVIN_ANGLE = 0.34; // ~19.47 degrees in radians
const float GRAVITY = 9.81;

// Calculate wave number from wavelength
float waveNumber(float wavelength) {
    return 2.0 * PI / wavelength;
}

// Deep water dispersion relation: omega = sqrt(g * k)
float waveFrequency(float k) {
    return sqrt(GRAVITY * k);
}

// Rotate a 2D vector by angle (in radians)
vec2 rotate2D(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

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

// Enhanced directional wave with velocity field
WaveState calculateDirectionalWave(vec2 pos, vec2 direction, float wavelength, float amplitude, float speed, float time) {
    WaveState wave;

    float k = waveNumber(wavelength);
    float omega = waveFrequency(k);
    float phase = k * dot(direction, pos) - omega * time;

    // Wave height
    wave.height = amplitude * sin(phase);

    // Particle velocity using linear wave theory
    // For deep water waves: horizontal velocity = amplitude * omega * cos(phase)
    float velMagnitude = amplitude * omega * cos(phase);
    wave.velocity = direction * velMagnitude;

    // Height gradient for flow direction
    float dHeight_dx = amplitude * k * direction.x * cos(phase);
    float dHeight_dy = amplitude * k * direction.y * cos(phase);
    wave.gradient = vec2(dHeight_dx, dHeight_dy);

    // Wave energy density (proportional to amplitude squared)
    wave.energy = amplitude * amplitude * 0.5;

    return wave;
}

// Combine multiple wave states with proper superposition
WaveState combineWaveStates(WaveState wave1, WaveState wave2) {
    WaveState combined;

    // Linear superposition for height
    combined.height = wave1.height + wave2.height;

    // Vector addition for velocities
    combined.velocity = wave1.velocity + wave2.velocity;

    // Gradient addition
    combined.gradient = wave1.gradient + wave2.gradient;

    // Energy addition
    combined.energy = wave1.energy + wave2.energy;

    return combined;
}


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

// Enhanced vessel wake calculation with wave state integration
WakeData calculateVesselWakeData(vec2 pos, vec3 vesselPos, vec3 vesselVel, float time, WaveState oceanState) {
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
    if (dotProduct > 0.0) return wake;

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

        // Set water velocity for foam trails, influenced by ocean waves
        wake.velocity = vesselDir * vesselSpeed * turbulence * 0.3;

        // Add ocean wave velocity interaction
        wake.velocity += oceanState.velocity * 0.2;
    }

    // Enhanced disturbance calculation including wave energy
    float waveInfluence = min(oceanState.energy * 0.5, 0.3);
    wake.disturbance = clamp(distanceDecay * ageDecay * speedBoost + waveInfluence, 0.0, 1.0);

    // Wave-wake interference: modify wake based on ocean wave direction
    vec2 oceanFlow = normalize(oceanState.velocity + vec2(0.001)); // Avoid zero division
    vec2 wakeFlow = normalize(vesselDir);
    float flowAlignment = dot(oceanFlow, wakeFlow);

    // Enhance wake when aligned with ocean flow, reduce when opposing
    float flowModifier = 1.0 + flowAlignment * 0.3;
    wake.height *= flowModifier;
    wake.foamIntensity *= max(flowModifier, 0.8); // Don't reduce foam too much

    return wake;
}

// Calculate all vessel wake contributions with enhanced superposition
WakeData getAllVesselWakeData(vec2 pos, float time, WaveState oceanState) {
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
        wakes[i] = calculateVesselWakeData(pos, u_vesselPositions[i], u_vesselVelocities[i], time, oceanState);
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

// Calculate complete ocean wave state with velocity field
WaveState getOceanWaveState(vec2 pos, float time) {
    WaveState oceanState;
    oceanState.height = 0.0;
    oceanState.velocity = vec2(0.0);
    oceanState.gradient = vec2(0.0);
    oceanState.energy = 0.0;

    // Primary directional waves with proper velocity fields
    WaveState wave1 = calculateDirectionalWave(pos, vec2(1.0, 0.0), 8.0, 0.4, 1.0, time);
    WaveState wave2 = calculateDirectionalWave(pos, normalize(vec2(0.7, 0.7)), 6.0, 0.3, 1.2, time);
    WaveState wave3 = calculateDirectionalWave(pos, vec2(0.0, 1.0), 10.0, 0.35, 0.8, time);
    WaveState wave4 = calculateDirectionalWave(pos, normalize(vec2(-0.6, 0.8)), 4.0, 0.2, 1.5, time);

    // Secondary detail waves
    WaveState wave5 = calculateDirectionalWave(pos, normalize(vec2(0.9, 0.4)), 3.0, 0.15, 2.0, time);
    WaveState wave6 = calculateDirectionalWave(pos, normalize(vec2(0.2, -0.9)), 2.5, 0.12, 2.2, time);

    // Interference pattern waves
    WaveState wave7 = calculateDirectionalWave(pos, normalize(vec2(0.5, -0.5)), 5.0, 0.1, 0.9, time);
    WaveState wave8 = calculateDirectionalWave(pos, normalize(vec2(-0.8, 0.2)), 7.0, 0.08, 1.1, time);

    // Combine all wave states
    oceanState = combineWaveStates(oceanState, wave1);
    oceanState = combineWaveStates(oceanState, wave2);
    oceanState = combineWaveStates(oceanState, wave3);
    oceanState = combineWaveStates(oceanState, wave4);
    oceanState = combineWaveStates(oceanState, wave5);
    oceanState = combineWaveStates(oceanState, wave6);
    oceanState = combineWaveStates(oceanState, wave7);
    oceanState = combineWaveStates(oceanState, wave8);

    // Add fine noise for texture (affects height only)
    vec2 noisePos = pos * 3.0 + time * 0.2;
    oceanState.height += fbm(noisePos) * 0.08;

    return oceanState;
}

// Legacy function for backward compatibility
float getAllVesselWakes(vec2 pos, float time) {
    WaveState oceanState = getOceanWaveState(pos, time);
    return getAllVesselWakeData(pos, time, oceanState).height;
}

// Enhanced ocean height calculation with wake integration
float getOceanHeight(vec2 pos, float time) {
    // Get complete ocean wave state
    WaveState oceanState = getOceanWaveState(pos, time);

    // Get enhanced wake data for superposition with wave interaction
    WakeData wakeData = getAllVesselWakeData(pos, time, oceanState);

    // Enhanced wave-wake interaction with non-linear effects
    float wakeHeight = wakeData.height;

    // Wave breaking simulation - reduce amplitude when wake is too high
    if (abs(wakeHeight) > 0.6) {
        wakeHeight *= 0.7; // Simulate wave breaking
    }

    // Combine ocean waves and wake with proper superposition
    float totalHeight = oceanState.height + wakeHeight;

    // Apply overall wave amplitude limits
    totalHeight = clamp(totalHeight, -2.0, 2.0);

    return totalHeight;
}


CompleteOceanState getCompleteOceanState(vec2 pos, float time) {
    CompleteOceanState state;

    // Calculate ocean wave state
    state.oceanWaves = getOceanWaveState(pos, time);

    // Calculate vessel wake data with ocean interaction
    state.vesselWakes = getAllVesselWakeData(pos, time, state.oceanWaves);

    // Combined height with wave breaking
    float wakeHeight = state.vesselWakes.height;
    if (abs(wakeHeight) > 0.6) {
        wakeHeight *= 0.7;
    }
    state.totalHeight = clamp(state.oceanWaves.height + wakeHeight, -2.0, 2.0);

    // Combined velocity field
    state.totalVelocity = state.oceanWaves.velocity + state.vesselWakes.velocity;

    return state;
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
        // Show flow field visualization
        CompleteOceanState oceanState = getCompleteOceanState(oceanPos, v_time);
        vec2 flow = normalize(oceanState.totalVelocity + vec2(0.001));
        vec3 flowColor = vec3(flow.x * 0.5 + 0.5, flow.y * 0.5 + 0.5, length(oceanState.totalVelocity) * 0.2);
        fragColor = vec4(flowColor, 1.0);
        return;
    } else if (u_debugMode == 5) {
        // Show enhanced wake contribution map
        CompleteOceanState oceanState = getCompleteOceanState(oceanPos, v_time);
        float intensity = clamp(abs(oceanState.vesselWakes.height) * 3.0, 0.0, 1.0);
        float foamVis = clamp(oceanState.vesselWakes.foamIntensity, 0.0, 1.0);
        vec3 wakeColor = mix(vec3(0.0, 0.0, 0.5), vec3(1.0, 1.0, 0.0), intensity);
        wakeColor = mix(wakeColor, vec3(1.0, 0.5, 0.5), foamVis);
        fragColor = vec4(wakeColor, 1.0);
        return;
    }

    // Get complete ocean state with enhanced wave and wake data
    CompleteOceanState oceanState = getCompleteOceanState(oceanPos, v_time);
    float height = oceanState.totalHeight;

    // Calculate normal for lighting
    vec3 normal = calculateNormal(oceanPos, v_time);

    // Enhanced color calculation with wave and wake integration
    vec3 baseColor;

    // Choose base color palette based on wake disturbance
    if (oceanState.vesselWakes.disturbance > 0.1) {
        // Use disturbed water colors
        baseColor = mix(DISTURBED_DEEP, DISTURBED_SHALLOW, smoothstep(-0.3, 0.3, height));

        // Add aeration effects for high disturbance
        if (oceanState.vesselWakes.disturbance > 0.5) {
            float aerationFactor = (oceanState.vesselWakes.disturbance - 0.5) * 2.0;
            baseColor = mix(baseColor, AERATED_WATER, aerationFactor * 0.6);
        }
    } else {
        // Use normal ocean colors
        baseColor = mix(DEEP_WATER, SHALLOW_WATER, smoothstep(-0.3, 0.3, height));
    }

    // Enhanced wave crests with wake consideration
    float crestAmount = smoothstep(0.12, 0.28, height);
    vec3 crestColor = mix(WAVE_CREST, TURBULENT_WATER, oceanState.vesselWakes.disturbance);
    baseColor = mix(baseColor, crestColor, crestAmount);

    // Enhanced foam system - separate ocean foam and wake foam
    float oceanFoam = smoothstep(0.18, 0.35, height);
    float wakeFoam = oceanState.vesselWakes.foamIntensity;

    // Combine foam types with different characteristics
    vec3 foamColor = mix(FOAM_COLOR, WAKE_FOAM, wakeFoam);
    float totalFoam = clamp(oceanFoam + wakeFoam * 1.5, 0.0, 1.0);
    baseColor = mix(baseColor, foamColor, totalFoam);

    // Enhanced persistent foam trails using directional flow
    if (length(oceanState.totalVelocity) > 0.1) {
        vec2 flowDirection = normalize(oceanState.totalVelocity);
        vec2 foamTrailPos = oceanPos + flowDirection * v_time * 2.5;
        float trailNoise = fbm(foamTrailPos * 8.0 + v_time * 0.3);
        float trailFoam = smoothstep(0.6, 0.9, trailNoise) * totalFoam * 0.4;

        // Add directional streaks based on flow
        float flowStrength = length(oceanState.totalVelocity) * 0.3;
        vec2 streakPos = oceanPos + flowDirection * v_time * 5.0;
        float streakPattern = sin(dot(streakPos, vec2(-flowDirection.y, flowDirection.x)) * 15.0) * 0.5 + 0.5;
        trailFoam *= smoothstep(0.7, 1.0, streakPattern) * flowStrength;

        baseColor = mix(baseColor, WAKE_FOAM, trailFoam);
    }

    // Add vessel position indicators (enhanced)
    float vesselDisturbance = getVesselDisturbance(oceanPos);
    if (vesselDisturbance > 0.0) {
        vec3 vesselColor = mix(baseColor, WAKE_FOAM, vesselDisturbance * 0.9);
        baseColor = vesselColor;
    }

    // Enhanced lighting with wave and wake considerations
    vec3 mainLight = normalize(vec3(0.6, 1.0, 0.4));
    vec3 rimLight = normalize(vec3(-0.3, 0.8, -0.5));

    float mainLighting = max(0.2, dot(normal, mainLight));
    float rimLighting = max(0.0, dot(normal, rimLight)) * 0.3;

    // Enhance lighting in wake areas and high-energy wave areas
    float wakeLightBoost = 1.0 + oceanState.vesselWakes.disturbance * 0.2;
    float waveLightBoost = 1.0 + min(oceanState.oceanWaves.energy, 0.5) * 0.15;
    float totalLighting = (mainLighting + rimLighting) * wakeLightBoost * waveLightBoost;
    baseColor *= clamp(totalLighting, 0.3, 1.4);

    // Enhanced caustics with directional flow interaction
    vec2 causticPos1 = oceanPos * 18.0 + v_time * 2.5;
    vec2 causticPos2 = oceanPos * 25.0 - v_time * 1.8;

    // Modify caustics based on total flow field
    if (length(oceanState.totalVelocity) > 0.0) {
        vec2 flowDirection = normalize(oceanState.totalVelocity);
        float flowMagnitude = length(oceanState.totalVelocity);
        causticPos1 += flowDirection * v_time * flowMagnitude * 1.5;
        causticPos2 += flowDirection * v_time * flowMagnitude * 1.0;
    }

    float caustic1 = fbm(causticPos1);
    float caustic2 = fbm(causticPos2);

    caustic1 = smoothstep(0.6, 0.85, caustic1);
    caustic2 = smoothstep(0.65, 0.9, caustic2);

    float causticIntensity = 0.15 + oceanState.vesselWakes.disturbance * 0.1 + oceanState.oceanWaves.energy * 0.05;
    float totalCaustics = caustic1 * causticIntensity + caustic2 * 0.1;
    baseColor += vec3(totalCaustics);

    // Enhanced foam trails following true ocean flow
    vec2 baseFlowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
    vec2 flowPos = oceanPos + baseFlowDir * v_time * 2.0;

    // Add directional flow influence
    if (length(oceanState.totalVelocity) > 0.0) {
        vec2 realFlowDir = normalize(oceanState.totalVelocity);
        float flowStrength = length(oceanState.totalVelocity) * 0.5;
        flowPos += realFlowDir * v_time * flowStrength * 2.0;
    }

    float flowNoise = fbm(flowPos * 12.0);
    float flowFoam = smoothstep(0.75, 0.95, flowNoise) * totalFoam;
    baseColor += vec3(flowFoam * 0.12);

    // Stylistic quantization with enhanced dithering
    baseColor = quantizeColor(baseColor, 8);

    // Enhanced dithering for wake and high-energy areas
    vec2 ditherPos = gl_FragCoord.xy * 0.75;
    float dither = fract(sin(dot(ditherPos, vec2(12.9898, 78.233))) * 43758.5453);
    float ditherStrength = 0.02 + oceanState.vesselWakes.disturbance * 0.01 + oceanState.oceanWaves.energy * 0.005;
    baseColor += vec3((dither - 0.5) * ditherStrength);

    // Optional debug grid (only in debug mode 0)
    if (u_debugMode == 0) {
        vec2 grid = abs(fract(oceanPos * 0.3) - 0.5);
        float gridLine = smoothstep(0.015, 0.005, min(grid.x, grid.y));
        baseColor += vec3(gridLine * 0.05);
    }

    fragColor = vec4(baseColor, 1.0);
}
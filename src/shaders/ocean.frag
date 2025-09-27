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

// Cellular automata uniforms
uniform bool u_useCellularAutomaton;
uniform sampler2D u_displacementTexture;  // Height displacement from CA
uniform sampler2D u_velocityTexture;      // Velocity field from CA
uniform sampler2D u_energyTexture;        // Energy distribution from CA
uniform sampler2D u_foamTexture;          // Foam generation from CA

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

// Calculate vessel wake contribution using Kelvin pattern
float calculateVesselWake(vec2 pos, vec3 vesselPos, vec3 vesselVel, float time) {
    // Get 2D position relative to vessel
    vec2 delta = pos - vesselPos.xz;
    float distance = length(delta);

    // Skip if too far from vessel
    if (distance > 20.0) return 0.0;

    vec2 vesselDir = normalize(vesselVel.xz);
    float vesselSpeed = length(vesselVel.xz);

    // Skip if vessel is stationary
    if (vesselSpeed < 0.1) return 0.0;

    float wakeHeight = 0.0;

    // Calculate dot product for wake positioning
    float dotProduct = dot(delta, vesselDir);

    // Only generate wake behind vessel
    if (dotProduct < 0.0) return 0.0;

    // Distance along vessel's path (negative behind vessel)
    float pathDistance = abs(dotProduct);

    // Calculate wake arms (Kelvin pattern)
    vec2 leftArm = rotate2D(vesselDir, KELVIN_ANGLE);
    vec2 rightArm = rotate2D(vesselDir, -KELVIN_ANGLE);

    // Distance from wake arm lines
    float leftDist = abs(dot(delta, vec2(-leftArm.y, leftArm.x)));
    float rightDist = abs(dot(delta, vec2(-rightArm.y, rightArm.x)));

    // Wake amplitude based on vessel speed
    float baseAmplitude = vesselSpeed * 0.08;

    // Exponential decay with distance
    float decay = exp(-distance * 0.15);

    // Age-based decay for wake persistence
    float wakeAge = pathDistance / vesselSpeed;
    float ageFactor = exp(-wakeAge * 0.3);

    // Left wake arm
    if (leftDist < 1.5) {
        float armIntensity = (1.5 - leftDist) / 1.5;
        float wavelength = 2.0 + vesselSpeed * 0.5;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);

        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * decay * ageFactor * sin(phase);
    }

    // Right wake arm
    if (rightDist < 1.5) {
        float armIntensity = (1.5 - rightDist) / 1.5;
        float wavelength = 2.0 + vesselSpeed * 0.5;
        float k = waveNumber(wavelength);
        float omega = waveFrequency(k);

        float phase = k * pathDistance - omega * time;
        wakeHeight += baseAmplitude * armIntensity * decay * ageFactor * sin(phase);
    }

    // Transverse waves inside the V
    vec2 perpDir = vec2(-vesselDir.y, vesselDir.x);
    float lateralDist = abs(dot(delta, perpDir));

    // Check if point is inside the Kelvin wake V
    float leftArmDot = dot(delta, leftArm);
    float rightArmDot = dot(delta, rightArm);

    if (leftArmDot < 0.0 && rightArmDot < 0.0 && pathDistance < 15.0) {
        // Generate curved transverse waves
        float vIntensity = smoothstep(3.0, 0.5, lateralDist);

        if (vIntensity > 0.0) {
            // Multiple wavelengths for complexity
            for (int i = 0; i < 3; i++) {
                float wl = 1.5 + float(i) * 0.8 + vesselSpeed * 0.3;
                float k = waveNumber(wl);
                float omega = waveFrequency(k);

                // Curved wave fronts (circular arcs)
                float curvature = 0.1 / (pathDistance + 1.0);
                float curvedPath = pathDistance + curvature * lateralDist * lateralDist;

                float phase = k * curvedPath - omega * time + float(i) * 0.5;
                float amplitude = baseAmplitude * 0.6 * pow(vIntensity, 1.5);

                wakeHeight += amplitude * decay * ageFactor * sin(phase);
            }
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

// Calculate all vessel wake contributions
float getAllVesselWakes(vec2 pos, float time) {
    if (!u_wakesEnabled || u_vesselCount == 0) return 0.0;

    float totalWake = 0.0;

    for (int i = 0; i < u_vesselCount && i < 5; i++) {
        totalWake += calculateVesselWake(pos, u_vesselPositions[i], u_vesselVelocities[i], time);
    }

    return totalWake;
}

// Sample cellular automata displacement data
vec4 sampleCellularAutomaton(vec2 worldPos) {
    if (!u_useCellularAutomaton) return vec4(0.0);

    // Convert world position to texture coordinates
    // Assuming world size of 40 units as defined in the CA system
    vec2 uv = (worldPos / 40.0) + 0.5;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    // Sample displacement texture (height, previous_height, velocity, energy)
    vec4 displacement = texture(u_displacementTexture, uv);

    return displacement;
}

// Get cellular automata wave height
float getCellularAutomatonHeight(vec2 pos) {
    if (!u_useCellularAutomaton) return 0.0;

    vec4 caData = sampleCellularAutomaton(pos);
    return caData.x; // Current height
}

// Get cellular automata energy for effects
float getCellularAutomatonEnergy(vec2 pos) {
    if (!u_useCellularAutomaton) return 0.0;

    vec2 uv = (pos / 40.0) + 0.5;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    vec4 energyData = texture(u_energyTexture, uv);
    return energyData.x; // Total energy
}

// Get cellular automata foam amount
float getCellularAutomatonFoam(vec2 pos) {
    if (!u_useCellularAutomaton) return 0.0;

    vec2 uv = (pos / 40.0) + 0.5;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    vec4 foamData = texture(u_foamTexture, uv);
    return foamData.x; // Foam amount
}

// Get cellular automata velocity for flow effects
vec2 getCellularAutomatonVelocity(vec2 pos) {
    if (!u_useCellularAutomaton) return vec2(0.0);

    vec2 uv = (pos / 40.0) + 0.5;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    vec4 velocityData = texture(u_velocityTexture, uv);
    return velocityData.xy; // 2D velocity field
}

// Calculate ocean height with visible waves
float getOceanHeight(vec2 pos, float time) {
    float height = 0.0;

    // Choose between cellular automata and traditional wave simulation
    if (u_useCellularAutomaton) {
        // Use cellular automata displacement as primary height source
        height = getCellularAutomatonHeight(pos);

        // Add subtle traditional waves for visual richness (reduced amplitude)
        height += sineWave(pos, vec2(1.0, 0.0), 12.0, 0.08, 0.6, time);
        height += sineWave(pos, vec2(0.7, 0.7), 10.0, 0.06, 0.8, time);
        height += sineWave(pos, vec2(0.0, 1.0), 15.0, 0.05, 0.4, time);

        // Fine noise for texture
        vec2 noisePos = pos * 2.0 + time * 0.15;
        height += fbm(noisePos) * 0.03;
    } else {
        // Traditional wave simulation (original behavior)
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
    }

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
    } else if (u_debugMode == 5) {
        // Show cellular automata displacement
        if (u_useCellularAutomaton) {
            float caHeight = getCellularAutomatonHeight(oceanPos);
            float intensity = clamp(caHeight + 0.5, 0.0, 1.0);
            vec3 caColor = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), intensity);
            fragColor = vec4(caColor, 1.0);
        } else {
            fragColor = vec4(0.2, 0.2, 0.2, 1.0); // Gray for disabled CA
        }
        return;
    } else if (u_debugMode == 6) {
        // Show cellular automata energy distribution
        if (u_useCellularAutomaton) {
            float energy = getCellularAutomatonEnergy(oceanPos);
            float intensity = clamp(energy * 0.5, 0.0, 1.0);
            vec3 energyColor = mix(vec3(0.0, 0.0, 0.2), vec3(1.0, 1.0, 0.0), intensity);
            fragColor = vec4(energyColor, 1.0);
        } else {
            fragColor = vec4(0.2, 0.2, 0.2, 1.0);
        }
        return;
    } else if (u_debugMode == 7) {
        // Show cellular automata velocity field
        if (u_useCellularAutomaton) {
            vec2 velocity = getCellularAutomatonVelocity(oceanPos);
            vec3 velColor = vec3(velocity.x * 0.5 + 0.5, velocity.y * 0.5 + 0.5, 0.5);
            fragColor = vec4(velColor, 1.0);
        } else {
            fragColor = vec4(0.2, 0.2, 0.2, 1.0);
        }
        return;
    } else if (u_debugMode == 8) {
        // Show cellular automata foam generation
        if (u_useCellularAutomaton) {
            float foam = getCellularAutomatonFoam(oceanPos);
            vec3 foamColor = mix(vec3(0.0, 0.0, 0.4), FOAM_COLOR, foam);
            fragColor = vec4(foamColor, 1.0);
        } else {
            fragColor = vec4(0.2, 0.2, 0.2, 1.0);
        }
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

    // Enhanced foam with cellular automata data
    if (u_useCellularAutomaton) {
        float caFoam = getCellularAutomatonFoam(oceanPos);
        float caEnergy = getCellularAutomatonEnergy(oceanPos);

        // Combine traditional foam with CA foam
        foamAmount = max(foamAmount, caFoam);

        // Energy-based foam enhancement
        float energyFoam = smoothstep(1.5, 3.0, caEnergy);
        foamAmount = max(foamAmount, energyFoam);
    }

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
    vec2 flowDir;
    if (u_useCellularAutomaton) {
        // Use cellular automata velocity field for realistic flow
        flowDir = getCellularAutomatonVelocity(oceanPos);
        vec2 flowPos = oceanPos + flowDir * v_time * 3.0;
        float flowNoise = fbm(flowPos * 10.0);
        float flowFoam = smoothstep(0.7, 0.9, flowNoise) * foamAmount;

        // Flow-based caustics distortion
        causticPos1 += flowDir * 2.0;
        causticPos2 += flowDir * 1.5;

        baseColor += vec3(flowFoam * 0.25);
    } else {
        // Traditional flow simulation
        flowDir = vec2(cos(v_time * 0.5), sin(v_time * 0.3));
        vec2 flowPos = oceanPos + flowDir * v_time * 2.0;
        float flowNoise = fbm(flowPos * 12.0);
        float flowFoam = smoothstep(0.75, 0.95, flowNoise) * foamAmount;
        baseColor += vec3(flowFoam * 0.2);
    }

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
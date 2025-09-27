#version 300 es

precision highp float;
precision highp int;

in vec3 a_position;
in vec2 a_texcoord;

uniform float u_time;
uniform float u_aspectRatio;
uniform vec2 u_resolution;

// Wave pattern uniforms
uniform float u_waveScale;

// Primary Gerstner waves (up to 8 waves)
uniform float u_primaryAmplitudes[8];
uniform float u_primaryWavelengths[8];
uniform float u_primarySpeeds[8];
uniform vec2 u_primaryDirections[8];
uniform float u_primarySteepness[8];
uniform float u_primaryPhases[8];
uniform int u_numPrimaryWaves;

// Swell systems (up to 12 waves)
uniform float u_swellAmplitudes[12];
uniform float u_swellWavelengths[12];
uniform float u_swellSpeeds[12];
uniform vec2 u_swellDirections[12];
uniform float u_swellSteepness[12];
uniform float u_swellPhases[12];
uniform int u_numSwellWaves;

// Choppy wave layer
uniform vec2 u_choppyWindDirection;
uniform float u_choppyWindSpeed;
uniform float u_choppyFrequency;
uniform float u_choppyAmplitude;

out vec2 v_uv;
out vec2 v_oceanPos;
out vec3 v_worldPos;
out float v_time;
out vec3 v_vertexNormal;

// Hash function for procedural distortion
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Noise function for natural distortion
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

// Gerstner wave calculation for vertex displacement
vec3 gerstnerWave(vec2 pos, vec2 direction, float amplitude, float wavelength, float speed, float steepness, float phase) {
    float k = 2.0 * 3.14159 / wavelength;
    float w = speed * k;
    float phi = k * dot(direction, pos) - w * u_time + phase;

    float sinPhi = sin(phi);
    float cosPhi = cos(phi);

    // Steepness control (Q factor)
    float Q = steepness / (k * amplitude + 0.001);
    Q = min(Q, 0.95); // Prevent loops

    // Height displacement
    float height = amplitude * sinPhi;

    // Horizontal displacement (creates sharp crests)
    vec2 displacement = Q * amplitude * direction * cosPhi;

    return vec3(displacement.x, height, displacement.y);
}

// Calculate total wave displacement
vec3 calculateWaveDisplacement(vec2 oceanPos) {
    vec3 totalDisplacement = vec3(0.0);

    // Primary Gerstner waves
    for (int i = 0; i < u_numPrimaryWaves && i < 8; i++) {
        vec3 wave = gerstnerWave(
            oceanPos,
            u_primaryDirections[i],
            u_primaryAmplitudes[i] * u_waveScale,
            u_primaryWavelengths[i],
            u_primarySpeeds[i],
            u_primarySteepness[i],
            u_primaryPhases[i]
        );
        totalDisplacement += wave;
    }

    // Swell waves with reduced impact
    for (int i = 0; i < u_numSwellWaves && i < 12; i++) {
        vec3 wave = gerstnerWave(
            oceanPos,
            u_swellDirections[i],
            u_swellAmplitudes[i] * u_waveScale * 0.7,
            u_swellWavelengths[i],
            u_swellSpeeds[i],
            u_swellSteepness[i],
            u_swellPhases[i]
        );
        totalDisplacement += wave * 0.6;
    }

    // Add choppy waves for high-frequency detail
    vec2 windDir = normalize(u_choppyWindDirection);
    float windStrength = u_choppyWindSpeed / 10.0;

    for (int i = 0; i < 3; i++) {
        vec2 waveDir = windDir + vec2(sin(u_time * 0.1 + float(i)), cos(u_time * 0.1 + float(i))) * 0.3;
        waveDir = normalize(waveDir);

        float frequency = u_choppyFrequency * (1.0 + float(i) * 0.7);
        float amplitude = u_choppyAmplitude * windStrength * (1.0 - float(i) * 0.3);

        float phase = dot(waveDir, oceanPos) * frequency - u_time * (2.0 + float(i) * 0.5);
        float wave = sin(phase) * amplitude;

        totalDisplacement.y += wave;
        totalDisplacement.xz += waveDir * wave * 0.1; // Small horizontal displacement
    }

    // Add natural distortion patterns
    vec2 distortionPos = oceanPos * 0.05 + u_time * 0.02;
    float distortion1 = noise(distortionPos) * 0.1;
    float distortion2 = noise(distortionPos * 2.3) * 0.05;

    totalDisplacement.y += (distortion1 + distortion2) * u_waveScale;

    return totalDisplacement;
}

// Calculate vertex normal from wave displacement
vec3 calculateVertexNormal(vec2 oceanPos, vec3 displacement) {
    float eps = 0.1;

    // Sample neighboring points
    vec3 dispLeft = calculateWaveDisplacement(oceanPos - vec2(eps, 0.0));
    vec3 dispRight = calculateWaveDisplacement(oceanPos + vec2(eps, 0.0));
    vec3 dispDown = calculateWaveDisplacement(oceanPos - vec2(0.0, eps));
    vec3 dispUp = calculateWaveDisplacement(oceanPos + vec2(0.0, eps));

    // Calculate tangent vectors
    vec3 tangentX = vec3(2.0 * eps, dispRight.y - dispLeft.y, dispRight.z - dispLeft.z);
    vec3 tangentZ = vec3(dispUp.x - dispDown.x, dispUp.y - dispDown.y, 2.0 * eps);

    // Cross product for normal
    vec3 normal = cross(tangentX, tangentZ);
    return normalize(normal);
}

void main() {
    // Convert screen position to ocean coordinates
    vec2 oceanPos = a_position.xy * 15.0; // Scale for wave visibility
    oceanPos.x *= u_aspectRatio; // Maintain aspect ratio

    // Calculate wave displacement
    vec3 waveDisplacement = calculateWaveDisplacement(oceanPos);

    // Apply displacement to vertex position
    vec3 worldPos = vec3(oceanPos.x + waveDisplacement.x, waveDisplacement.y, oceanPos.y + waveDisplacement.z);

    // Calculate vertex normal
    v_vertexNormal = calculateVertexNormal(oceanPos, waveDisplacement);

    // Pass data to fragment shader
    v_uv = a_texcoord;
    v_oceanPos = oceanPos;
    v_worldPos = worldPos;
    v_time = u_time;

    // Project to screen space with height displacement
    vec2 screenPos = a_position.xy;

    // Apply vertical displacement for 3D effect (scaled down for screen space)
    float heightScale = 0.1; // Adjust this for visual effect
    screenPos.y += waveDisplacement.y * heightScale / 15.0;

    // Apply subtle horizontal displacement for more dynamic effect
    screenPos += waveDisplacement.xz * 0.02 / 15.0;

    gl_Position = vec4(screenPos, 0.0, 1.0);
}
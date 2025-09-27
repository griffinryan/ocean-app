#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_currentState;
uniform sampler2D u_previousState;
uniform float u_deltaTime;
uniform float u_waveSpeed;
uniform float u_damping;
uniform float u_sourceStrength;
uniform vec2 u_sourcePosition;
uniform float u_time;

out vec4 fragColor;

// Wave equation parameters
const float WAVE_SPEED_FACTOR = 0.5;
const float DAMPING_FACTOR = 0.98;
const float SOURCE_RADIUS = 0.05;

// Hash function for procedural wave sources
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Get neighbor values for wave equation
float getNeighbor(sampler2D tex, vec2 uv, vec2 offset, vec2 texelSize) {
    vec2 sampleUV = uv + offset * texelSize;

    // Wrap around edges for seamless tiling
    sampleUV = fract(sampleUV);

    return texture(tex, sampleUV).r;
}

// 2D wave equation solver using finite difference method
float solveWaveEquation(vec2 uv, vec2 texelSize) {
    // Current and previous states
    float current = texture(u_currentState, uv).r;
    float previous = texture(u_previousState, uv).r;

    // Sample neighbors for Laplacian
    float left = getNeighbor(u_currentState, uv, vec2(-1.0, 0.0), texelSize);
    float right = getNeighbor(u_currentState, uv, vec2(1.0, 0.0), texelSize);
    float up = getNeighbor(u_currentState, uv, vec2(0.0, 1.0), texelSize);
    float down = getNeighbor(u_currentState, uv, vec2(0.0, -1.0), texelSize);

    // Compute Laplacian (discrete approximation)
    float laplacian = left + right + up + down - 4.0 * current;

    // Wave equation: u_tt = c² * ∇²u
    float waveSpeedSq = u_waveSpeed * u_waveSpeed;
    float acceleration = waveSpeedSq * laplacian;

    // Velocity Verlet integration
    float velocity = (current - previous) / u_deltaTime;
    float newHeight = current + velocity * u_deltaTime + 0.5 * acceleration * u_deltaTime * u_deltaTime;

    // Apply damping to prevent infinite growth
    newHeight *= u_damping;

    return newHeight;
}

// Add wave sources
float addWaveSources(vec2 uv, float currentHeight) {
    float height = currentHeight;

    // Primary animated source
    vec2 sourceUV = u_sourcePosition;
    float sourceDistance = distance(uv, sourceUV);

    if (sourceDistance < SOURCE_RADIUS) {
        float sourceInfluence = smoothstep(SOURCE_RADIUS, 0.0, sourceDistance);
        float sourceWave = sin(u_time * 3.0) * u_sourceStrength * sourceInfluence;
        height += sourceWave;
    }

    // Multiple procedural sources for complexity
    for(float i = 0.0; i < 4.0; i += 1.0) {
        vec2 randomOffset = vec2(hash21(vec2(i, 0.0)), hash21(vec2(i, 1.0)));
        vec2 proceduralSource = randomOffset * 0.8 + 0.1; // Keep sources within [0.1, 0.9]

        float proceduralDistance = distance(uv, proceduralSource);
        float proceduralRadius = SOURCE_RADIUS * 0.5;

        if (proceduralDistance < proceduralRadius) {
            float proceduralInfluence = smoothstep(proceduralRadius, 0.0, proceduralDistance);
            float proceduralPhase = u_time * (2.0 + i * 0.5) + i * 3.14159;
            float proceduralWave = sin(proceduralPhase) * u_sourceStrength * 0.3 * proceduralInfluence;
            height += proceduralWave;
        }
    }

    return height;
}

// Add boundary reflections
float addBoundaryReflections(vec2 uv, float height) {
    // Distance from edges
    float edgeDistance = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeInfluence = 1.0 - smoothstep(0.0, 0.1, edgeDistance);

    // Reflect waves at boundaries by inverting height near edges
    if (edgeInfluence > 0.0) {
        height *= (1.0 - edgeInfluence * 0.5);
    }

    return height;
}

// Add interference patterns
float addInterferencePatterns(vec2 uv, float height) {
    // Create interference from multiple wave sources
    float interference = 0.0;

    // Circular wave pattern 1
    vec2 center1 = vec2(0.3, 0.7);
    float dist1 = distance(uv, center1);
    float wave1 = sin(dist1 * 20.0 - u_time * 2.0) * exp(-dist1 * 2.0);

    // Circular wave pattern 2
    vec2 center2 = vec2(0.7, 0.3);
    float dist2 = distance(uv, center2);
    float wave2 = sin(dist2 * 25.0 - u_time * 2.5) * exp(-dist2 * 2.0);

    interference = (wave1 + wave2) * 0.1;

    return height + interference;
}

void main() {
    vec2 texelSize = 1.0 / textureSize(u_currentState, 0);

    // Solve wave equation
    float newHeight = solveWaveEquation(v_uv, texelSize);

    // Add wave sources
    newHeight = addWaveSources(v_uv, newHeight);

    // Add boundary reflections
    newHeight = addBoundaryReflections(v_uv, newHeight);

    // Add interference patterns for additional complexity
    newHeight = addInterferencePatterns(v_uv, newHeight);

    // Clamp to reasonable range
    newHeight = clamp(newHeight, -1.0, 1.0);

    // Output new state
    // R channel: wave height
    // G channel: velocity (for future use)
    // B channel: reserved
    // A channel: 1.0

    float velocity = (newHeight - texture(u_currentState, v_uv).r) / u_deltaTime;

    fragColor = vec4(newHeight, velocity, 0.0, 1.0);
}
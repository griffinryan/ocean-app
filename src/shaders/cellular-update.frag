#version 300 es

precision highp float;

in vec2 v_uv;

// Input textures from previous frame
uniform sampler2D u_heightTexture;      // RGBA: current_height, previous_height, velocity, energy
uniform sampler2D u_velocityTexture;    // RGBA: vx, vy, momentum, flags
uniform sampler2D u_vesselInfluence;    // Vessel influence map

// Simulation parameters
uniform float u_deltaTime;
uniform float u_dampingFactor;
uniform float u_waveSpeed;
uniform float u_gridSize;
uniform float u_worldSize;

// Output textures for next frame
layout(location = 0) out vec4 outHeight;     // new_height, current_height, new_velocity, new_energy
layout(location = 1) out vec4 outVelocity;   // new_vx, new_vy, new_momentum, flags
layout(location = 2) out vec4 outEnergy;     // total_energy, kinetic_energy, potential_energy, dissipation

// Constants for wave physics
const float PI = 3.14159265359;
const float GRAVITY = 9.81;
const float MIN_ENERGY = 0.001;
const float MAX_ENERGY = 10.0;
const float FOAM_THRESHOLD = 2.0;

// Grid cell size in world units
float getCellSize() {
    return u_worldSize / u_gridSize;
}

// Sample neighboring cells with boundary conditions
vec4 sampleNeighbor(sampler2D tex, vec2 uv, vec2 offset) {
    vec2 neighborUv = uv + offset / u_gridSize;

    // Clamp to edges (reflective boundary)
    neighborUv = clamp(neighborUv, vec2(0.0), vec2(1.0));

    return texture(tex, neighborUv);
}

// Calculate 2D Laplacian for wave propagation
float calculateLaplacian(sampler2D heightTex, vec2 uv) {
    // Sample current and neighbor heights
    float center = texture(heightTex, uv).x;
    float left   = sampleNeighbor(heightTex, uv, vec2(-1.0, 0.0)).x;
    float right  = sampleNeighbor(heightTex, uv, vec2( 1.0, 0.0)).x;
    float up     = sampleNeighbor(heightTex, uv, vec2( 0.0, 1.0)).x;
    float down   = sampleNeighbor(heightTex, uv, vec2( 0.0,-1.0)).x;

    // 5-point stencil Laplacian
    return (left + right + up + down - 4.0 * center);
}

// Enhanced Laplacian with diagonal neighbors for better wave propagation
float calculateEnhancedLaplacian(sampler2D heightTex, vec2 uv) {
    float center = texture(heightTex, uv).x;

    // Orthogonal neighbors (weight = 1.0)
    float left   = sampleNeighbor(heightTex, uv, vec2(-1.0, 0.0)).x;
    float right  = sampleNeighbor(heightTex, uv, vec2( 1.0, 0.0)).x;
    float up     = sampleNeighbor(heightTex, uv, vec2( 0.0, 1.0)).x;
    float down   = sampleNeighbor(heightTex, uv, vec2( 0.0,-1.0)).x;

    // Diagonal neighbors (weight = 0.5)
    float upLeft    = sampleNeighbor(heightTex, uv, vec2(-1.0, 1.0)).x;
    float upRight   = sampleNeighbor(heightTex, uv, vec2( 1.0, 1.0)).x;
    float downLeft  = sampleNeighbor(heightTex, uv, vec2(-1.0,-1.0)).x;
    float downRight = sampleNeighbor(heightTex, uv, vec2( 1.0,-1.0)).x;

    // Weighted 9-point stencil
    float orthogonal = left + right + up + down;
    float diagonal = 0.5 * (upLeft + upRight + downLeft + downRight);

    return (orthogonal + diagonal - 6.0 * center);
}

// Calculate gradient for surface normals and flow
vec2 calculateGradient(sampler2D heightTex, vec2 uv) {
    float left  = sampleNeighbor(heightTex, uv, vec2(-1.0, 0.0)).x;
    float right = sampleNeighbor(heightTex, uv, vec2( 1.0, 0.0)).x;
    float up    = sampleNeighbor(heightTex, uv, vec2( 0.0, 1.0)).x;
    float down  = sampleNeighbor(heightTex, uv, vec2( 0.0,-1.0)).x;

    float dx = (right - left) * 0.5;
    float dy = (up - down) * 0.5;

    return vec2(dx, dy);
}

// Apply vessel influence to the wave field
float applyVesselInfluence(vec2 uv, float currentHeight) {
    vec4 influence = texture(u_vesselInfluence, uv);

    // influence.x = displacement magnitude
    // influence.y = velocity injection
    // influence.z = energy injection
    // influence.w = influence radius factor

    float displacementForce = influence.x * influence.w;
    float velocityBoost = influence.y * influence.w;

    return displacementForce;
}

// Calculate energy dissipation based on wave steepness and activity
float calculateDissipation(float height, vec2 gradient, float energy) {
    // Higher dissipation for steeper waves
    float steepness = length(gradient);
    float steepnessFactor = smoothstep(0.1, 1.0, steepness);

    // Energy-based dissipation (turbulent breakdown)
    float energyFactor = smoothstep(FOAM_THRESHOLD, MAX_ENERGY, energy);

    // Base dissipation factor
    float baseDissipation = 1.0 - u_dampingFactor;

    // Combined dissipation
    return baseDissipation * (1.0 + steepnessFactor * 0.5 + energyFactor * 0.3);
}

// Generate foam based on energy thresholds and wave breaking
float generateFoam(float energy, float velocity, vec2 gradient) {
    // Foam from high energy
    float energyFoam = smoothstep(FOAM_THRESHOLD, MAX_ENERGY, energy);

    // Foam from wave breaking (high gradient)
    float breakingFoam = smoothstep(0.3, 0.8, length(gradient));

    // Foam from high velocity change
    float velocityFoam = smoothstep(2.0, 5.0, abs(velocity));

    return max(energyFoam, max(breakingFoam, velocityFoam));
}

void main() {
    vec2 uv = v_uv;

    // Sample current state
    vec4 heightData = texture(u_heightTexture, uv);
    float currentHeight = heightData.x;
    float previousHeight = heightData.y;
    float currentVelocity = heightData.z;
    float currentEnergy = heightData.w;

    vec4 velocityData = texture(u_velocityTexture, uv);
    vec2 velocity2D = velocityData.xy;
    float momentum = velocityData.z;

    // Calculate cell size for proper scaling
    float cellSize = getCellSize();
    float dt = u_deltaTime;
    float c2 = u_waveSpeed * u_waveSpeed; // Wave speed squared

    // Calculate spatial derivatives
    float laplacian = calculateEnhancedLaplacian(u_heightTexture, uv);
    vec2 gradient = calculateGradient(u_heightTexture, uv);

    // Apply vessel influence
    float vesselForce = applyVesselInfluence(uv, currentHeight);

    // Wave equation: d²h/dt² = c² * ∇²h + F(vessels) - damping * dh/dt
    float acceleration = c2 * laplacian / (cellSize * cellSize) + vesselForce;

    // Update velocity (dh/dt)
    float newVelocity = currentVelocity + acceleration * dt;

    // Apply damping to velocity
    float dissipation = calculateDissipation(currentHeight, gradient, currentEnergy);
    newVelocity *= (1.0 - dissipation);

    // Update height using velocity
    float newHeight = currentHeight + newVelocity * dt;

    // Calculate energy components
    float kineticEnergy = 0.5 * newVelocity * newVelocity;
    float potentialEnergy = 0.5 * GRAVITY * newHeight * newHeight;
    float totalEnergy = kineticEnergy + potentialEnergy;

    // Energy conservation with gradual dissipation
    totalEnergy = clamp(totalEnergy, MIN_ENERGY, MAX_ENERGY);

    // Update 2D velocity field for advanced effects
    vec2 newVelocity2D = velocity2D;
    if (length(gradient) > 0.01) {
        // Velocity follows gradient for flow effects
        vec2 flowDirection = -normalize(gradient);
        float flowStrength = length(gradient) * 0.1;
        newVelocity2D += flowDirection * flowStrength * dt;
        newVelocity2D *= 0.98; // Slight damping
    }

    // Calculate momentum for turbulence
    float newMomentum = momentum + abs(newVelocity - currentVelocity);
    newMomentum *= 0.95; // Momentum decay

    // Generate foam
    float foam = generateFoam(totalEnergy, newVelocity, gradient);

    // Output updated state
    outHeight = vec4(newHeight, currentHeight, newVelocity, totalEnergy);
    outVelocity = vec4(newVelocity2D, newMomentum, foam);
    outEnergy = vec4(totalEnergy, kineticEnergy, potentialEnergy, dissipation);
}
/**
 * WavePhysics - Constants and utilities for realistic wave simulation
 *
 * Contains physical constants, wave equations, and helper functions
 * for the cellular automata ocean simulation system.
 */

import { Vec3 } from './math';

// Physical constants
export const PHYSICS_CONSTANTS = {
  GRAVITY: 9.81,                    // m/s² - gravitational acceleration
  WATER_DENSITY: 1000,              // kg/m³ - density of water
  AIR_DENSITY: 1.225,               // kg/m³ - density of air at sea level
  SURFACE_TENSION: 0.0728,          // N/m - water surface tension
  KINEMATIC_VISCOSITY: 1.004e-6,    // m²/s - water kinematic viscosity
  KELVIN_ANGLE: 19.47 * Math.PI / 180, // radians - Kelvin wake angle
};

// Wave simulation parameters
export const WAVE_PARAMS = {
  // Cellular automata grid settings
  DEFAULT_GRID_SIZE: 512,           // Grid resolution
  DEFAULT_WORLD_SIZE: 40,           // World space coverage (meters)

  // Wave physics
  DEFAULT_WAVE_SPEED: 5.0,          // Base wave propagation speed
  DEFAULT_DAMPING: 0.995,           // Energy damping factor
  MIN_ENERGY_THRESHOLD: 0.001,      // Minimum energy before cell becomes inactive
  MAX_ENERGY_THRESHOLD: 10.0,       // Maximum energy to prevent instability

  // Foam and breaking
  FOAM_ENERGY_THRESHOLD: 2.0,       // Energy threshold for foam generation
  BREAKING_STEEPNESS: 0.14,         // Wave steepness threshold for breaking (H/λ)
  WHITECAP_THRESHOLD: 0.5,          // Threshold for whitecap formation

  // Performance optimization
  ADAPTIVE_TIME_STEP_MIN: 0.008,    // Minimum time step (125 Hz)
  ADAPTIVE_TIME_STEP_MAX: 0.020,    // Maximum time step (50 Hz)
  TARGET_FPS: 60,                   // Target frame rate
};

// Vessel wake parameters
export const WAKE_PARAMS = {
  FROUDE_NUMBER_CRITICAL: 0.4,      // Critical Froude number for wake formation
  KELVIN_WAVE_AMPLITUDE: 0.1,       // Base amplitude for Kelvin waves
  TRANSVERSE_WAVE_SCALE: 0.8,       // Scale factor for transverse waves
  DIVERGENT_WAVE_SCALE: 0.6,        // Scale factor for divergent waves
  WAKE_DECAY_RATE: 0.3,             // Wake energy decay rate
  TURBULENCE_INJECTION_RATE: 0.05,  // Rate of turbulence energy injection
};

/**
 * Calculate deep water wave dispersion relation
 * ω = √(g * k) where ω is frequency, g is gravity, k is wave number
 */
export function calculateWaveFrequency(waveNumber: number): number {
  return Math.sqrt(PHYSICS_CONSTANTS.GRAVITY * waveNumber);
}

/**
 * Calculate wave number from wavelength
 * k = 2π / λ
 */
export function calculateWaveNumber(wavelength: number): number {
  return 2 * Math.PI / wavelength;
}

/**
 * Calculate wavelength from frequency (deep water)
 * λ = g * T² / (2π) where T is period
 */
export function calculateWavelength(frequency: number): number {
  const period = 1 / frequency;
  return PHYSICS_CONSTANTS.GRAVITY * period * period / (2 * Math.PI);
}

/**
 * Calculate phase velocity for deep water waves
 * c = √(g * λ / 2π)
 */
export function calculatePhaseVelocity(wavelength: number): number {
  return Math.sqrt(PHYSICS_CONSTANTS.GRAVITY * wavelength / (2 * Math.PI));
}

/**
 * Calculate group velocity for deep water waves
 * cg = c / 2 for deep water
 */
export function calculateGroupVelocity(wavelength: number): number {
  return calculatePhaseVelocity(wavelength) * 0.5;
}

/**
 * Calculate Froude number for vessel wake analysis
 * Fr = v / √(g * L) where v is velocity, L is vessel length
 */
export function calculateFroudeNumber(velocity: number, vesselLength: number): number {
  return velocity / Math.sqrt(PHYSICS_CONSTANTS.GRAVITY * vesselLength);
}

/**
 * Calculate optimal cellular automata time step based on grid resolution
 * Uses CFL condition: Δt ≤ Δx / (c * √2) for stability
 */
export function calculateStableTimeStep(gridSize: number, worldSize: number, waveSpeed: number): number {
  const cellSize = worldSize / gridSize;
  const cflTimeStep = cellSize / (waveSpeed * Math.sqrt(2));

  return Math.min(
    cflTimeStep * 0.8, // Safety factor
    WAVE_PARAMS.ADAPTIVE_TIME_STEP_MAX
  );
}

/**
 * Convert world coordinates to grid coordinates
 */
export function worldToGrid(worldPos: Vec3, worldSize: number, gridSize: number): { x: number; y: number } {
  const normalizedX = (worldPos.x / worldSize) + 0.5;
  const normalizedZ = (worldPos.z / worldSize) + 0.5;

  return {
    x: Math.floor(normalizedX * gridSize),
    y: Math.floor(normalizedZ * gridSize)
  };
}

/**
 * Convert grid coordinates to world coordinates
 */
export function gridToWorld(gridX: number, gridY: number, worldSize: number, gridSize: number): Vec3 {
  const normalizedX = (gridX / gridSize) - 0.5;
  const normalizedZ = (gridY / gridSize) - 0.5;

  return new Vec3(
    normalizedX * worldSize,
    0,
    normalizedZ * worldSize
  );
}

/**
 * Calculate energy injection for vessel wake
 */
export function calculateWakeEnergyInjection(
  vesselSpeed: number,
  vesselLength: number,
  beamWidth: number
): number {
  const froudeNumber = calculateFroudeNumber(vesselSpeed, vesselLength);

  if (froudeNumber < WAKE_PARAMS.FROUDE_NUMBER_CRITICAL) {
    return 0; // No significant wake at low speeds
  }

  // Energy proportional to speed cubed and beam width
  const baseEnergy = Math.pow(vesselSpeed, 3) * beamWidth * 0.001;
  const froudeScale = Math.min(froudeNumber / WAKE_PARAMS.FROUDE_NUMBER_CRITICAL, 2.0);

  return baseEnergy * froudeScale;
}

/**
 * Calculate Kelvin wake pattern parameters
 */
export function calculateKelvinWakeParams(vesselSpeed: number): {
  divergentAngle: number;
  transverseAngle: number;
  wavelength: number;
} {
  // Wavelength scales with speed squared
  const wavelength = vesselSpeed * vesselSpeed * 0.2;

  return {
    divergentAngle: PHYSICS_CONSTANTS.KELVIN_ANGLE,
    transverseAngle: Math.PI / 2, // Perpendicular to vessel path
    wavelength: wavelength
  };
}

/**
 * Calculate wave steepness (H/λ) for breaking detection
 */
export function calculateWaveSteepness(amplitude: number, wavelength: number): number {
  return (2 * amplitude) / wavelength;
}

/**
 * Check if wave should break based on steepness
 */
export function shouldWaveBreak(amplitude: number, wavelength: number): boolean {
  return calculateWaveSteepness(amplitude, wavelength) > WAVE_PARAMS.BREAKING_STEEPNESS;
}

/**
 * Calculate energy dissipation rate for wave breaking
 */
export function calculateBreakingDissipation(steepness: number): number {
  if (steepness <= WAVE_PARAMS.BREAKING_STEEPNESS) {
    return 0;
  }

  const excessSteepness = steepness - WAVE_PARAMS.BREAKING_STEEPNESS;
  return Math.min(excessSteepness * 10, 0.8); // Cap at 80% energy loss
}

/**
 * Calculate foam generation rate
 */
export function calculateFoamGeneration(
  energy: number,
  steepness: number,
  velocity: number
): number {
  let foamRate = 0;

  // Energy-based foam
  if (energy > WAVE_PARAMS.FOAM_ENERGY_THRESHOLD) {
    foamRate += (energy - WAVE_PARAMS.FOAM_ENERGY_THRESHOLD) * 0.1;
  }

  // Breaking-based foam
  if (steepness > WAVE_PARAMS.BREAKING_STEEPNESS) {
    foamRate += (steepness - WAVE_PARAMS.BREAKING_STEEPNESS) * 5;
  }

  // Velocity-based foam (turbulence)
  if (Math.abs(velocity) > 2.0) {
    foamRate += (Math.abs(velocity) - 2.0) * 0.1;
  }

  return Math.min(foamRate, 1.0);
}

/**
 * Interpolate between wave parameters for smooth transitions
 */
export function interpolateWaveParams(
  param1: number,
  param2: number,
  factor: number
): number {
  return param1 + (param2 - param1) * Math.max(0, Math.min(1, factor));
}

/**
 * Create default displacement configuration
 */
export function createDefaultDisplacementConfig(): {
  gridSize: number;
  worldSize: number;
  dampingFactor: number;
  waveSpeed: number;
  timeStep: number;
  enableFoam: boolean;
} {
  return {
    gridSize: WAVE_PARAMS.DEFAULT_GRID_SIZE,
    worldSize: WAVE_PARAMS.DEFAULT_WORLD_SIZE,
    dampingFactor: WAVE_PARAMS.DEFAULT_DAMPING,
    waveSpeed: WAVE_PARAMS.DEFAULT_WAVE_SPEED,
    timeStep: calculateStableTimeStep(
      WAVE_PARAMS.DEFAULT_GRID_SIZE,
      WAVE_PARAMS.DEFAULT_WORLD_SIZE,
      WAVE_PARAMS.DEFAULT_WAVE_SPEED
    ),
    enableFoam: true
  };
}
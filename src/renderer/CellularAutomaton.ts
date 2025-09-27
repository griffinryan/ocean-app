/**
 * CellularAutomaton - High-level interface for cellular automata wave simulation
 *
 * UNIFIED PIPELINE ARCHITECTURE:
 * This class serves as the single source of truth for all wave dynamics including:
 * - Ocean base waves and interference patterns
 * - Vessel wake generation and propagation (via injection points)
 * - Real-time wave equation solving on GPU
 * - Energy conservation and dissipation
 * - Foam generation from energy thresholds
 *
 * The pipeline is optimized for future mathematical enhancements:
 * - Displacement textures use double-buffering for temporal accuracy
 * - Wave injection system supports complex wake patterns
 * - Adaptive time stepping maintains performance under varying loads
 * - All vessel interactions flow through unified CA physics
 *
 * Mathematical enhancement readiness:
 * - 512x512 cellular grid provides high spatial resolution
 * - RGBA32F textures support high-precision calculations
 * - Configurable physics constants enable parameter tuning
 * - Performance metrics enable automatic quality adaptation
 */

import { DisplacementMapManager, DisplacementConfig } from './DisplacementMapManager';
import { ShaderManager } from './ShaderManager';
import { Vec3 } from '../utils/math';

export interface WaveInjectionPoint {
  worldPosition: Vec3;
  energy: number;
  radius: number;
  frequency: number;
  phase: number;
}

export interface CAPerformanceMetrics {
  averageUpdateTime: number;
  energyDistribution: number;
  activeRegions: number;
  foamCoverage: number;
}

export class CellularAutomaton {
  private displacementManager: DisplacementMapManager;
  private shaderManager: ShaderManager;

  // Performance monitoring
  private updateTimes: number[] = [];
  private performanceMetrics: CAPerformanceMetrics;

  // Wave injection system
  private injectionPoints: WaveInjectionPoint[] = [];
  private maxInjectionPoints: number = 32;

  // Optimization settings
  private adaptiveTimeStep: boolean = true;
  private targetFPS: number = 60;
  private minTimeStep: number = 0.008;
  private maxTimeStep: number = 0.020;

  constructor(
    gl: WebGL2RenderingContext,
    shaderManager: ShaderManager,
    config: DisplacementConfig,
    cellularUpdateVertShader: string,
    cellularUpdateFragShader: string
  ) {
    this.shaderManager = shaderManager;
    this.displacementManager = new DisplacementMapManager(gl, shaderManager, config);

    this.performanceMetrics = {
      averageUpdateTime: 0,
      energyDistribution: 0,
      activeRegions: 0,
      foamCoverage: 0
    };

    this.initializeShaders(cellularUpdateVertShader, cellularUpdateFragShader);
  }

  /**
   * Initialize cellular automata shaders
   */
  private initializeShaders(vertexShader: string, fragmentShader: string): void {
    try {
      // Create CA update program
      this.shaderManager.createProgram(
        'caUpdate',
        vertexShader,
        fragmentShader,
        [
          'u_heightTexture',
          'u_velocityTexture',
          'u_vesselInfluence',
          'u_deltaTime',
          'u_dampingFactor',
          'u_waveSpeed',
          'u_gridSize',
          'u_worldSize'
        ],
        ['a_position', 'a_texcoord']
      );

      // Initialize displacement manager shaders after creating the CA program
      this.displacementManager.initializeShaders();

      console.log('[CellularAutomaton] Shaders initialized successfully');
    } catch (error) {
      console.error('[CellularAutomaton] Failed to initialize shaders:', error);
      throw error;
    }
  }


  /**
   * Update the cellular automata simulation
   */
  update(deltaTime: number): void {
    const startTime = performance.now();

    // Adaptive time stepping for performance
    let actualDeltaTime = deltaTime;
    if (this.adaptiveTimeStep) {
      actualDeltaTime = this.calculateAdaptiveTimeStep(deltaTime);
    }

    // Process wave injection points
    this.processWaveInjections(actualDeltaTime);

    // Update displacement manager (performs CA update)
    this.displacementManager.update(actualDeltaTime);

    // Update performance metrics
    const updateTime = performance.now() - startTime;
    this.updatePerformanceMetrics(updateTime);
  }

  /**
   * Calculate adaptive time step based on performance
   */
  private calculateAdaptiveTimeStep(deltaTime: number): number {
    const targetFrameTime = 1000 / this.targetFPS;
    const averageUpdateTime = this.performanceMetrics.averageUpdateTime;

    if (averageUpdateTime > targetFrameTime * 0.8) {
      // Running slow, increase time step (lower quality but faster)
      return Math.min(deltaTime * 1.1, this.maxTimeStep);
    } else if (averageUpdateTime < targetFrameTime * 0.5) {
      // Running fast, decrease time step (higher quality)
      return Math.max(deltaTime * 0.9, this.minTimeStep);
    }

    return Math.max(this.minTimeStep, Math.min(deltaTime, this.maxTimeStep));
  }

  /**
   * Process wave injection points (vessels, user interactions, etc.)
   */
  private processWaveInjections(deltaTime: number): void {
    // Remove expired injection points and update vessel influence texture
    this.injectionPoints = this.injectionPoints.filter(point => point.energy > 0.01);

    // Update energy levels
    for (const point of this.injectionPoints) {
      point.phase += point.frequency * deltaTime;
      point.energy *= 0.99; // Gradual decay
    }

    // Apply injection points to vessel influence texture
    this.updateVesselInfluenceTexture();
  }

  /**
   * Update vessel influence texture based on injection points
   */
  private updateVesselInfluenceTexture(): void {
    // Convert injection points to vessel data format
    const maxVessels = Math.min(this.injectionPoints.length, this.maxInjectionPoints);
    const vesselData = new Float32Array(maxVessels * 4);

    for (let i = 0; i < maxVessels; i++) {
      const point = this.injectionPoints[i];
      const index = i * 4;

      vesselData[index + 0] = point.worldPosition.x;
      vesselData[index + 1] = point.worldPosition.z; // Y is height, Z is depth
      vesselData[index + 2] = point.energy;
      vesselData[index + 3] = point.radius;
    }

    this.displacementManager.updateVesselInfluence(vesselData, maxVessels);
  }

  /**
   * Add a wave injection point (for vessels, interactions, etc.)
   */
  addWaveInjection(injection: WaveInjectionPoint): void {
    if (this.injectionPoints.length < this.maxInjectionPoints) {
      this.injectionPoints.push({ ...injection });
    } else {
      // Replace oldest/weakest injection point
      let replaceIndex = 0;
      let minEnergy = this.injectionPoints[0].energy;

      for (let i = 1; i < this.injectionPoints.length; i++) {
        if (this.injectionPoints[i].energy < minEnergy) {
          minEnergy = this.injectionPoints[i].energy;
          replaceIndex = i;
        }
      }

      if (injection.energy > minEnergy) {
        this.injectionPoints[replaceIndex] = { ...injection };
      }
    }
  }

  /**
   * Add multiple wave injections from vessel system
   */
  addVesselWakes(vesselPositions: Vec3[], vesselVelocities: Vec3[]): void {
    for (let i = 0; i < vesselPositions.length; i++) {
      const position = vesselPositions[i];
      const velocity = vesselVelocities[i];
      const speed = velocity.magnitude();

      if (speed > 0.1) { // Only create wakes for moving vessels
        this.addWaveInjection({
          worldPosition: position,
          energy: speed * 0.5, // Energy proportional to speed
          radius: 1.5 + speed * 0.3,
          frequency: speed * 2.0,
          phase: 0
        });
      }
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(updateTime: number): void {
    this.updateTimes.push(updateTime);
    if (this.updateTimes.length > 60) {
      this.updateTimes.shift(); // Keep last 60 frames
    }

    this.performanceMetrics.averageUpdateTime =
      this.updateTimes.reduce((sum, time) => sum + time, 0) / this.updateTimes.length;

    // TODO: Calculate other metrics from displacement textures
    // - Energy distribution: analyze energy texture
    // - Active regions: count cells above energy threshold
    // - Foam coverage: analyze foam generation
  }

  /**
   * Get current displacement textures for rendering
   */
  getDisplacementTextures() {
    return this.displacementManager.getDisplacementTextures();
  }

  /**
   * Get combined displacement texture
   */
  getCombinedDisplacementTexture() {
    return this.displacementManager.getCombinedDisplacementTexture();
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): CAPerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Get configuration
   */
  getConfig() {
    return this.displacementManager.getConfig();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DisplacementConfig>): void {
    this.displacementManager.updateConfig(newConfig);
  }

  /**
   * Set adaptive time stepping
   */
  setAdaptiveTimeStep(enabled: boolean): void {
    this.adaptiveTimeStep = enabled;
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    displacementInfo: any;
    injectionPoints: number;
    performanceMetrics: CAPerformanceMetrics;
    adaptiveTimeStep: boolean;
  } {
    return {
      displacementInfo: this.displacementManager.getDebugInfo(),
      injectionPoints: this.injectionPoints.length,
      performanceMetrics: this.performanceMetrics,
      adaptiveTimeStep: this.adaptiveTimeStep
    };
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    this.displacementManager.dispose();
    this.injectionPoints = [];
    this.updateTimes = [];
    console.log('[CellularAutomaton] Disposed');
  }
}
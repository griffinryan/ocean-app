/**
 * Liquid Glass Integration Layer
 * Bridges CSS panels to WebGL ocean shader for real-time distortion
 */

import { ShaderManager, ShaderProgram } from './ShaderManager';
import { PanelTracker } from './PanelTracker';

export interface LiquidGlassConfig {
  enabled: boolean;
  viscosity: number;
  surfaceTension: number;
  refractionIndex: number;
  chromaticStrength: number;
  flowSpeed: number;
}

export class GlassRenderer {
  private shaderManager: ShaderManager;
  private panelTracker: PanelTracker;

  // Liquid glass configuration
  private config: LiquidGlassConfig = {
    enabled: true,
    viscosity: 1.0,
    surfaceTension: 0.072,
    refractionIndex: 1.33,
    chromaticStrength: 0.5,
    flowSpeed: 1.0
  };

  // Performance monitoring
  private lastPanelUpdate: number = 0;
  private readonly UPDATE_INTERVAL = 16; // ~60fps

  constructor(shaderManager: ShaderManager, canvas: HTMLCanvasElement) {
    this.shaderManager = shaderManager;

    // Initialize panel tracker
    this.panelTracker = new PanelTracker(canvas);

    // Set up update callback
    this.panelTracker.onUpdate(() => {
      this.onPanelsUpdated();
    });

    console.log('Liquid glass renderer initialized');
  }

  /**
   * Initialize liquid glass system (no separate shaders needed)
   */
  async initializeShaders(_vertexShader: string, _fragmentShader: string): Promise<void> {
    // Liquid glass is now integrated into the ocean shader
    console.log('Liquid glass system initialized - using integrated ocean shader');
  }

  /**
   * Set liquid glass configuration
   */
  public setConfig(config: Partial<LiquidGlassConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('Liquid glass config updated:', this.config);
  }

  /**
   * Handle resize events
   */
  public resizeFramebuffer(_width: number, _height: number): void {
    // No longer needed - liquid glass is integrated into ocean shader
    this.panelTracker.forceUpdate();
  }

  /**
   * Apply liquid glass uniforms to ocean shader
   */
  public applyLiquidGlassUniforms(program: ShaderProgram): void {
    const panelData = this.panelTracker.getPanelData();

    // Set liquid glass enabled state
    this.shaderManager.setUniform1i(program, 'u_liquidGlassEnabled', this.config.enabled ? 1 : 0);

    // Set panel data
    this.shaderManager.setUniform1i(program, 'u_panelCount', panelData.count);

    // Set panel bounds (vec4 array)
    for (let i = 0; i < 8; i++) {
      const offset = i * 4;
      this.shaderManager.setUniform4f(
        program,
        `u_panelBounds[${i}]`,
        panelData.bounds[offset] || 0,
        panelData.bounds[offset + 1] || 0,
        panelData.bounds[offset + 2] || 0,
        panelData.bounds[offset + 3] || 0
      );
    }

    // Set panel centers (vec2 array)
    for (let i = 0; i < 8; i++) {
      const offset = i * 2;
      this.shaderManager.setUniform2f(
        program,
        `u_panelCenters[${i}]`,
        panelData.centers[offset] || 0,
        panelData.centers[offset + 1] || 0
      );
    }

    // Set panel properties (float arrays)
    for (let i = 0; i < 8; i++) {
      this.shaderManager.setUniform1f(program, `u_panelDistortionStrength[${i}]`, panelData.distortionStrengths[i] || 0);
      this.shaderManager.setUniform1f(program, `u_panelStates[${i}]`, panelData.states[i] || 0);
    }

    // Set liquid glass parameters
    this.shaderManager.setUniform1f(program, 'u_liquidViscosity', this.config.viscosity);
    this.shaderManager.setUniform1f(program, 'u_surfaceTension', this.config.surfaceTension);
    this.shaderManager.setUniform1f(program, 'u_refractionIndex', this.config.refractionIndex);
    this.shaderManager.setUniform1f(program, 'u_chromaticStrength', this.config.chromaticStrength);
    this.shaderManager.setUniform1f(program, 'u_flowSpeed', this.config.flowSpeed);
  }

  /**
   * Handle panel updates from tracker
   */
  private onPanelsUpdated(): void {
    const now = performance.now();
    if (now - this.lastPanelUpdate < this.UPDATE_INTERVAL) {
      return; // Throttle updates for performance
    }
    this.lastPanelUpdate = now;

    // Panel data is automatically tracked by PanelTracker
    // No need to manually manage panels
  }

  /**
   * No longer renders separate panels - liquid glass is integrated into ocean shader
   */
  public render(): void {
    // Liquid glass effect is now applied directly in the ocean shader
    // This method is kept for API compatibility but does nothing
  }

  /**
   * Get liquid glass enabled state
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable/disable liquid glass effect
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Force update panel tracking
   */
  public forceUpdate(): void {
    this.panelTracker.forceUpdate();
  }

  /**
   * Get panel count
   */
  public getPanelCount(): number {
    return this.panelTracker.getPanelCount();
  }

  /**
   * Get panel tracker (for debugging)
   */
  public getPanelTracker(): PanelTracker {
    return this.panelTracker;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    // Clean up panel tracker
    if (this.panelTracker) {
      this.panelTracker.dispose();
    }
  }
}
/**
 * Loading Sequence for Ocean-First Progressive Enhancement
 * Ensures ocean is visible immediately while complex systems initialize in background
 */

import type { OceanRenderer } from '../renderer/OceanRenderer';
import type { PanelManager } from './Panel';

export enum LoadingPhase {
  CSS_OCEAN = 0,           // CSS backdrop visible (instant)
  WEBGL_OCEAN = 1,         // WebGL ocean replaces CSS
  BACKGROUND_INIT = 2,     // Compile shaders, init systems
  GLASS_FADEIN = 3,        // Glass panels fade in
  TEXT_FADEIN = 4,         // Text fades in (staggered)
  COMPLETE = 5             // All systems ready
}

export interface LoadingSequenceConfig {
  showLoadingIndicator: boolean;   // Show loading progress in corner
  glassFadeInDuration: number;     // Duration for glass fade-in (ms)
  textFadeInDuration: number;      // Duration for text fade-in (ms)
  textStaggerDelay: number;        // Delay between text elements (ms)
}

const DEFAULT_CONFIG: LoadingSequenceConfig = {
  showLoadingIndicator: true,
  glassFadeInDuration: 300,
  textFadeInDuration: 300,
  textStaggerDelay: 50
};

/**
 * Loading Sequence Manager
 * Orchestrates progressive enhancement from CSS → WebGL
 */
export class LoadingSequence {
  private config: LoadingSequenceConfig;
  private currentPhase: LoadingPhase = LoadingPhase.CSS_OCEAN;

  private oceanRenderer: OceanRenderer | null = null;
  private panelManager: PanelManager | null = null;

  private loadingIndicator: HTMLElement | null = null;
  private phaseCallbacks: Map<LoadingPhase, () => void> = new Map();

  constructor(config?: Partial<LoadingSequenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set ocean renderer reference
   */
  setOceanRenderer(renderer: OceanRenderer): void {
    this.oceanRenderer = renderer;
  }

  /**
   * Set panel manager reference
   */
  setPanelManager(manager: PanelManager): void {
    this.panelManager = manager;
  }

  /**
   * Register callback for phase completion
   */
  onPhaseComplete(phase: LoadingPhase, callback: () => void): void {
    this.phaseCallbacks.set(phase, callback);
  }

  /**
   * Start loading sequence
   */
  async start(): Promise<void> {
    console.log('LoadingSequence: Starting ocean-first initialization');

    // Show loading indicator if enabled
    if (this.config.showLoadingIndicator) {
      this.showLoadingIndicator();
    }

    // Phase 0: CSS ocean is already visible (from HTML/CSS)
    this.updatePhase(LoadingPhase.CSS_OCEAN);
    console.log('LoadingSequence: Phase 0 - CSS ocean visible');

    // Phase 1: Initialize WebGL ocean
    await this.initializeWebGLOcean();
    this.updatePhase(LoadingPhase.WEBGL_OCEAN);
    console.log('LoadingSequence: Phase 1 - WebGL ocean initialized');

    // Phase 2: Background initialization (shaders, systems)
    await this.backgroundInitialization();
    this.updatePhase(LoadingPhase.BACKGROUND_INIT);
    console.log('LoadingSequence: Phase 2 - Background systems initialized');

    // Phase 3: Glass fade-in
    await this.fadeInGlass();
    this.updatePhase(LoadingPhase.GLASS_FADEIN);
    console.log('LoadingSequence: Phase 3 - Glass panels visible');

    // Phase 4: Text fade-in (staggered)
    await this.fadeInText();
    this.updatePhase(LoadingPhase.TEXT_FADEIN);
    console.log('LoadingSequence: Phase 4 - Text visible');

    // Complete
    this.updatePhase(LoadingPhase.COMPLETE);
    console.log('LoadingSequence: Complete - All systems ready');

    // Hide loading indicator
    if (this.loadingIndicator) {
      this.hideLoadingIndicator();
    }
  }

  /**
   * Update current phase and trigger callback
   */
  private updatePhase(phase: LoadingPhase): void {
    this.currentPhase = phase;

    // Update loading indicator
    if (this.loadingIndicator) {
      this.updateLoadingIndicator(phase);
    }

    // Trigger phase callback
    const callback = this.phaseCallbacks.get(phase);
    if (callback) {
      callback();
    }
  }

  /**
   * Phase 1: Initialize WebGL ocean
   */
  private async initializeWebGLOcean(): Promise<void> {
    // WebGL context is already initialized in main.ts
    // Just need to wait for first frame to render
    return new Promise<void>((resolve) => {
      if (!this.oceanRenderer) {
        resolve();
        return;
      }

      // Set callback for first frame
      this.oceanRenderer.setOnFirstFrameCallback(() => {
        // WebGL ocean is now visible, can remove CSS ocean
        if (this.panelManager) {
          this.panelManager.enableWebGLReady();
        }
        resolve();
      });
    });
  }

  /**
   * Phase 2: Background initialization
   * All shaders are already compiled in main.ts, so this is primarily waiting
   */
  private async backgroundInitialization(): Promise<void> {
    // Shaders are compiled before this sequence starts
    // Just ensure everything is ready
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for safety
  }

  /**
   * Phase 3: Fade in glass panels
   */
  private async fadeInGlass(): Promise<void> {
    if (!this.oceanRenderer) {
      return;
    }

    // Glass is already enabled in main.ts
    // No additional fade-in needed - panels handle their own animations
    await new Promise(resolve => setTimeout(resolve, this.config.glassFadeInDuration));
  }

  /**
   * Phase 4: Fade in text (staggered)
   */
  private async fadeInText(): Promise<void> {
    if (!this.oceanRenderer) {
      return;
    }

    // Text is already enabled in main.ts
    // Text renderer handles intro animation via shader
    await new Promise(resolve => setTimeout(resolve, this.config.textFadeInDuration));
  }

  /**
   * Show loading indicator
   */
  private showLoadingIndicator(): void {
    // Create loading indicator element
    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.id = 'loading-indicator';
    this.loadingIndicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: rgba(255, 255, 255, 0.8);
      padding: 12px 20px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      z-index: 10000;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: opacity 0.3s ease;
    `;
    this.loadingIndicator.textContent = 'Initializing...';

    document.body.appendChild(this.loadingIndicator);
  }

  /**
   * Update loading indicator with current phase
   */
  private updateLoadingIndicator(phase: LoadingPhase): void {
    if (!this.loadingIndicator) {
      return;
    }

    const phaseNames = [
      'CSS Ocean',
      'WebGL Ocean',
      'Systems Init',
      'Glass Panels',
      'Text Rendering',
      'Complete'
    ];

    const phaseName = phaseNames[phase] || 'Unknown';
    const progress = Math.round((phase / LoadingPhase.COMPLETE) * 100);

    this.loadingIndicator.textContent = `${phaseName} (${progress}%)`;
  }

  /**
   * Hide loading indicator
   */
  private hideLoadingIndicator(): void {
    if (!this.loadingIndicator) {
      return;
    }

    this.loadingIndicator.style.opacity = '0';

    setTimeout(() => {
      if (this.loadingIndicator && this.loadingIndicator.parentNode) {
        this.loadingIndicator.parentNode.removeChild(this.loadingIndicator);
      }
      this.loadingIndicator = null;
    }, 300);
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): LoadingPhase {
    return this.currentPhase;
  }

  /**
   * Check if loading is complete
   */
  isComplete(): boolean {
    return this.currentPhase === LoadingPhase.COMPLETE;
  }
}

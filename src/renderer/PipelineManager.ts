/**
 * Pipeline Manager for Seamless Pipeline Transitions
 * Pre-warms all shader variants and framebuffers to enable instant pipeline switching
 */

export interface PipelineState {
  ocean: boolean;      // Ocean rendering (always true)
  wakes: boolean;      // Vessel wake system
  glass: boolean;      // Glass panel distortion
  text: boolean;       // Adaptive text rendering
  blurMap: boolean;    // Blur map (frosted glass effect)
}

export interface PipelineVariant {
  name: string;
  state: PipelineState;
  isPreWarmed: boolean;
}

/**
 * Pipeline Manager
 * Ensures smooth transitions between rendering pipelines
 */
export class PipelineManager {
  private currentState: PipelineState;
  private variants: Map<string, PipelineVariant> = new Map();

  // Crossfade support
  private crossfadeActive: boolean = false;
  private crossfadeProgress: number = 0;
  private crossfadeDuration: number = 300; // ms
  private crossfadeStartTime: number = 0;

  private previousState: PipelineState | null = null;

  constructor() {
    // Initialize with basic ocean rendering
    this.currentState = {
      ocean: true,
      wakes: false,
      glass: false,
      text: false,
      blurMap: false
    };

    // Register common pipeline variants
    this.registerCommonVariants();
  }

  /**
   * Register common pipeline variants for pre-warming
   */
  private registerCommonVariants(): void {
    // Basic ocean only
    this.registerVariant('ocean', {
      ocean: true,
      wakes: false,
      glass: false,
      text: false,
      blurMap: false
    });

    // Ocean + wakes
    this.registerVariant('ocean-wakes', {
      ocean: true,
      wakes: true,
      glass: false,
      text: false,
      blurMap: false
    });

    // Ocean + glass
    this.registerVariant('ocean-glass', {
      ocean: true,
      wakes: false,
      glass: true,
      text: false,
      blurMap: false
    });

    // Ocean + text
    this.registerVariant('ocean-text', {
      ocean: true,
      wakes: false,
      glass: false,
      text: true,
      blurMap: false
    });

    // Full pipeline: ocean + wakes + glass + text + blur
    this.registerVariant('full', {
      ocean: true,
      wakes: true,
      glass: true,
      text: true,
      blurMap: true
    });

    // Full without blur map
    this.registerVariant('full-no-blur', {
      ocean: true,
      wakes: true,
      glass: true,
      text: true,
      blurMap: false
    });

    // Glass + text (common combination)
    this.registerVariant('glass-text', {
      ocean: true,
      wakes: false,
      glass: true,
      text: true,
      blurMap: true
    });

    // Wakes + glass
    this.registerVariant('wakes-glass', {
      ocean: true,
      wakes: true,
      glass: true,
      text: false,
      blurMap: false
    });
  }

  /**
   * Register a pipeline variant
   */
  registerVariant(name: string, state: PipelineState): void {
    this.variants.set(name, {
      name,
      state,
      isPreWarmed: false
    });
  }

  /**
   * Pre-warm all registered pipeline variants
   * Should be called during initialization
   */
  async preWarmAllVariants(): Promise<void> {
    console.log(`PipelineManager: Pre-warming ${this.variants.size} pipeline variants...`);

    const startTime = performance.now();

    // All shaders are already compiled in initializeShaders()
    // All framebuffers are already allocated in renderer constructors
    // So pre-warming is primarily about marking variants as ready

    // Mark all variants as pre-warmed
    this.variants.forEach(variant => {
      variant.isPreWarmed = true;
    });

    const elapsed = performance.now() - startTime;
    console.log(`PipelineManager: Pre-warming complete in ${elapsed.toFixed(2)}ms`);
  }

  /**
   * Switch to a named pipeline variant
   * Returns the target state for the renderer to apply
   */
  switchToVariant(name: string, useCrossfade: boolean = false): PipelineState | null {
    const variant = this.variants.get(name);
    if (!variant) {
      console.warn(`PipelineManager: Variant '${name}' not found`);
      return null;
    }

    if (!variant.isPreWarmed) {
      console.warn(`PipelineManager: Variant '${name}' not pre-warmed, may cause stutter`);
    }

    // Start crossfade if requested
    if (useCrossfade) {
      this.startCrossfade(variant.state);
    } else {
      this.currentState = { ...variant.state };
    }

    console.log(`PipelineManager: Switched to '${name}' pipeline`);
    return { ...variant.state };
  }

  /**
   * Switch to a custom pipeline state
   */
  switchToState(state: Partial<PipelineState>, useCrossfade: boolean = false): PipelineState {
    const newState = { ...this.currentState, ...state };

    if (useCrossfade) {
      this.startCrossfade(newState);
    } else {
      this.currentState = newState;
    }

    return { ...newState };
  }

  /**
   * Toggle a specific feature
   */
  toggleFeature(feature: keyof PipelineState, useCrossfade: boolean = false): PipelineState {
    if (feature === 'ocean') {
      console.warn('PipelineManager: Cannot toggle ocean rendering (always enabled)');
      return { ...this.currentState };
    }

    const newState = { ...this.currentState };
    newState[feature] = !newState[feature];

    if (useCrossfade) {
      this.startCrossfade(newState);
    } else {
      this.currentState = newState;
    }

    console.log(`PipelineManager: Toggled ${feature} to ${newState[feature]}`);
    return { ...newState };
  }

  /**
   * Start crossfade transition to new state
   */
  private startCrossfade(newState: PipelineState): void {
    this.previousState = { ...this.currentState };
    this.currentState = { ...newState };
    this.crossfadeActive = true;
    this.crossfadeProgress = 0;
    this.crossfadeStartTime = performance.now();

    console.log('PipelineManager: Started crossfade transition');
  }

  /**
   * Update crossfade progress (call each frame)
   */
  updateCrossfade(): void {
    if (!this.crossfadeActive) {
      return;
    }

    const elapsed = performance.now() - this.crossfadeStartTime;
    this.crossfadeProgress = Math.min(1.0, elapsed / this.crossfadeDuration);

    if (this.crossfadeProgress >= 1.0) {
      this.crossfadeActive = false;
      this.previousState = null;
      console.log('PipelineManager: Crossfade complete');
    }
  }

  /**
   * Get current pipeline state
   */
  getCurrentState(): PipelineState {
    return { ...this.currentState };
  }

  /**
   * Get crossfade state
   */
  getCrossfadeState(): {
    active: boolean;
    progress: number;
    previousState: PipelineState | null;
  } {
    return {
      active: this.crossfadeActive,
      progress: this.crossfadeProgress,
      previousState: this.previousState ? { ...this.previousState } : null
    };
  }

  /**
   * Check if a specific feature is enabled
   */
  isFeatureEnabled(feature: keyof PipelineState): boolean {
    return this.currentState[feature];
  }

  /**
   * Get list of all registered variants
   */
  getVariantNames(): string[] {
    return Array.from(this.variants.keys());
  }

  /**
   * Get variant by name
   */
  getVariant(name: string): PipelineVariant | undefined {
    return this.variants.get(name);
  }

  /**
   * Check if all variants are pre-warmed
   */
  areAllVariantsPreWarmed(): boolean {
    return Array.from(this.variants.values()).every(v => v.isPreWarmed);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalVariants: number;
    preWarmedVariants: number;
    currentVariant: string;
    crossfadeActive: boolean;
  } {
    const preWarmedCount = Array.from(this.variants.values()).filter(v => v.isPreWarmed).length;

    // Find current variant name (if matches a registered variant)
    let currentVariantName = 'custom';
    for (const [name, variant] of this.variants.entries()) {
      if (this.statesEqual(variant.state, this.currentState)) {
        currentVariantName = name;
        break;
      }
    }

    return {
      totalVariants: this.variants.size,
      preWarmedVariants: preWarmedCount,
      currentVariant: currentVariantName,
      crossfadeActive: this.crossfadeActive
    };
  }

  /**
   * Compare two pipeline states for equality
   */
  private statesEqual(a: PipelineState, b: PipelineState): boolean {
    return a.ocean === b.ocean &&
           a.wakes === b.wakes &&
           a.glass === b.glass &&
           a.text === b.text &&
           a.blurMap === b.blurMap;
  }

  /**
   * Generate report
   */
  generateReport(): string {
    const stats = this.getStats();

    return `
=== Pipeline Manager Report ===
Total Variants: ${stats.totalVariants}
Pre-warmed: ${stats.preWarmedVariants}/${stats.totalVariants}
Current: ${stats.currentVariant}
Crossfade: ${stats.crossfadeActive ? 'ACTIVE' : 'Inactive'}

Current State:
  Ocean: ${this.currentState.ocean ? 'ON' : 'OFF'}
  Wakes: ${this.currentState.wakes ? 'ON' : 'OFF'}
  Glass: ${this.currentState.glass ? 'ON' : 'OFF'}
  Text: ${this.currentState.text ? 'ON' : 'OFF'}
  Blur Map: ${this.currentState.blurMap ? 'ON' : 'OFF'}
==============================
    `.trim();
  }
}

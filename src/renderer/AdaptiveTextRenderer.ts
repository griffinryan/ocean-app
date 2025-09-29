/**
 * AdaptiveTextRenderer - Manages dynamic text color adaptation based on ocean brightness
 */

import { BrightnessAnalyzer, BrightnessData } from './BrightnessAnalyzer';

export interface TextColorConfig {
  lightText: string;        // Color for dark backgrounds
  darkText: string;         // Color for light backgrounds
  transitionDuration: number; // Transition time in ms
  luminanceThreshold: number; // Switch threshold (0-1)
  contrastRatio: number;    // Minimum contrast ratio
}

export interface TextElement {
  element: HTMLElement;
  id: string;
  lastBrightness?: number;
  currentColor?: string;
  targetColor?: string;
  isTransitioning?: boolean;
}

export class AdaptiveTextRenderer {
  private brightnessAnalyzer: BrightnessAnalyzer;
  private textElements = new Map<string, TextElement>();
  private isEnabled = true;
  private rafId?: number;

  // Color configuration
  private config: TextColorConfig = {
    lightText: 'rgba(240, 245, 255, 0.95)',   // For dark backgrounds
    darkText: 'rgba(20, 30, 50, 0.9)',        // For light backgrounds
    transitionDuration: 200,                   // Smooth transitions
    luminanceThreshold: 0.5,                   // 50% brightness threshold
    contrastRatio: 4.5                         // WCAG AA standard
  };

  // Performance settings
  private readonly UPDATE_INTERVAL = 33;      // ~30fps updates
  private lastUpdateTime = 0;

  // Integration with render pipeline
  private isIntegratedWithRenderer = false;

  // Debug system
  private debugMode = false;
  private debugOverlay: HTMLElement | null = null;

  constructor(brightnessAnalyzer: BrightnessAnalyzer) {
    this.brightnessAnalyzer = brightnessAnalyzer;
    this.initializeCSSProperties();
    this.setupResizeObserver();
  }

  /**
   * Register text elements for adaptive color management
   */
  public registerElement(element: HTMLElement): void {
    if (!element.id) {
      console.warn('AdaptiveTextRenderer: Element must have an ID');
      return;
    }

    const textElement: TextElement = {
      element,
      id: element.id,
      lastBrightness: 0.5,
      currentColor: this.config.lightText
    };

    this.textElements.set(element.id, textElement);

    // Apply initial adaptive color properties
    this.applyAdaptiveProperties(element);

    console.log(`AdaptiveTextRenderer: Registered element ${element.id}`);
  }

  /**
   * Unregister a text element
   */
  public unregisterElement(elementId: string): void {
    const textElement = this.textElements.get(elementId);
    if (textElement) {
      // Reset to original styling
      this.resetElementStyling(textElement.element);
      this.textElements.delete(elementId);
    }
  }

  /**
   * Register common text elements automatically
   */
  public registerCommonElements(): void {
    const elementIds = [
      'landing-panel',
      'app-panel',
      'portfolio-panel',
      'resume-panel',
      'navbar'
    ];

    elementIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        this.registerElement(element);
      }
    });
  }

  /**
   * Start adaptive text rendering loop
   */
  public start(): void {
    if (this.rafId) {
      return; // Already running
    }

    this.isEnabled = true;
    this.updateLoop();
    console.log('AdaptiveTextRenderer: Started');
  }

  /**
   * Stop adaptive text rendering
   */
  public stop(): void {
    this.isEnabled = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    console.log('AdaptiveTextRenderer: Stopped');
  }

  /**
   * Update text colors based on current ocean brightness
   */
  public update(): void {
    if (!this.isEnabled || this.textElements.size === 0) {
      return;
    }

    const now = performance.now();

    // Throttle updates for performance (only when not integrated with renderer)
    if (!this.isIntegratedWithRenderer && now - this.lastUpdateTime < this.UPDATE_INTERVAL) {
      return;
    }

    // Get brightness data - use immediate sampling if integrated with renderer
    const brightnessData = this.isIntegratedWithRenderer
      ? this.brightnessAnalyzer.sampleTextElementsImmediate()
      : this.brightnessAnalyzer.sampleTextElements();

    // Update each element's color
    this.textElements.forEach((textElement, id) => {
      const brightness = brightnessData.get(id);
      if (brightness && this.isElementVisible(textElement.element)) {
        this.updateElementColor(textElement, brightness);
      }
    });

    // Update debug overlay if in debug mode
    if (this.debugMode) {
      this.updateDebugOverlay();
    }

    this.lastUpdateTime = now;
  }

  /**
   * Enable integration with ocean renderer pipeline
   */
  public enableRendererIntegration(): void {
    this.isIntegratedWithRenderer = true;
    // Stop the independent animation loop since we'll be called from the renderer
    this.stop();
    console.log('AdaptiveTextRenderer: Integrated with render pipeline');
  }

  /**
   * Disable integration and fall back to independent loop
   */
  public disableRendererIntegration(): void {
    this.isIntegratedWithRenderer = false;
    // Restart the independent animation loop
    if (this.isEnabled) {
      this.start();
    }
    console.log('AdaptiveTextRenderer: Fallback to independent loop');
  }

  /**
   * Update from render pipeline callback (immediate, no throttling)
   */
  public updateFromRenderer(): void {
    if (!this.isEnabled || this.textElements.size === 0) {
      return;
    }

    // Force immediate update
    this.lastUpdateTime = 0;
    this.update();
  }

  /**
   * Configure color settings
   */
  public configure(config: Partial<TextColorConfig>): void {
    this.config = { ...this.config, ...config };

    // Update CSS properties
    this.updateCSSProperties();

    // Force update all elements
    this.forceUpdateAllElements();
  }

  /**
   * Main update loop
   */
  private updateLoop = (): void => {
    if (this.isEnabled) {
      this.update();
      this.rafId = requestAnimationFrame(this.updateLoop);
    }
  };

  /**
   * Update a single element's color based on brightness data
   */
  private updateElementColor(textElement: TextElement, brightnessData: BrightnessData): void {
    const luminance = brightnessData.averageLuminance;

    // Determine target color based on luminance threshold
    const shouldUseDarkText = luminance > this.config.luminanceThreshold;
    const targetColor = shouldUseDarkText ? this.config.darkText : this.config.lightText;

    // Check if color needs to change
    if (textElement.targetColor !== targetColor) {
      textElement.targetColor = targetColor;
      textElement.lastBrightness = luminance;

      // Apply the color change with CSS custom properties
      this.applyColorTransition(textElement, targetColor, luminance);
    }
  }

  /**
   * Apply color transition to an element
   */
  private applyColorTransition(textElement: TextElement, targetColor: string, luminance: number): void {
    const element = textElement.element;
    const shadowColor = this.calculateTextShadow(luminance);

    // STRATEGY 1: Set properties on document root for global effect
    const root = document.documentElement;
    root.style.setProperty('--adaptive-text-color', targetColor);
    root.style.setProperty('--adaptive-text-shadow', shadowColor);

    // STRATEGY 2: Set properties on the element itself for local cascade
    element.style.setProperty('--adaptive-text-color', targetColor);
    element.style.setProperty('--adaptive-text-shadow', shadowColor);
    element.style.setProperty('--adaptive-transition-duration', `${this.config.transitionDuration}ms`);

    // STRATEGY 3: Direct child element targeting as fallback
    this.applyDirectStyling(element, targetColor, shadowColor);

    // Debug logging
    console.log(`AdaptiveTextRenderer: Applied color ${targetColor} to ${element.id} (luminance: ${luminance.toFixed(3)})`);

    textElement.currentColor = targetColor;
    textElement.isTransitioning = true;

    // Clear transition flag after animation completes
    setTimeout(() => {
      textElement.isTransitioning = false;
    }, this.config.transitionDuration);
  }

  /**
   * Apply styling directly to child text elements as fallback
   */
  private applyDirectStyling(parentElement: HTMLElement, color: string, shadow: string): void {
    const textSelectors = 'h1, h2, h3, h4, h5, h6, p, span, a, .nav-label, .brand-text';
    const textElements = parentElement.querySelectorAll(textSelectors);

    textElements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.color = color;
      htmlEl.style.textShadow = shadow;
      htmlEl.style.transition = `color ${this.config.transitionDuration}ms ease, text-shadow ${this.config.transitionDuration}ms ease`;
    });
  }

  /**
   * Calculate appropriate text shadow for contrast
   */
  private calculateTextShadow(luminance: number): string {
    if (luminance > this.config.luminanceThreshold) {
      // Light background: use dark shadow
      const opacity = Math.min(0.4, (luminance - 0.5) * 0.8);
      return `0 1px 3px rgba(0, 0, 0, ${opacity})`;
    } else {
      // Dark background: use light shadow/glow
      const opacity = Math.min(0.3, (0.5 - luminance) * 0.6);
      return `0 0 8px rgba(255, 255, 255, ${opacity})`;
    }
  }

  /**
   * Check if element is visible and should be updated
   */
  private isElementVisible(element: HTMLElement): boolean {
    return !element.classList.contains('hidden') &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0;
  }

  /**
   * Initialize CSS custom properties for adaptive text
   */
  private initializeCSSProperties(): void {
    const root = document.documentElement;

    root.style.setProperty('--adaptive-text-color', this.config.lightText);
    root.style.setProperty('--adaptive-text-shadow', '0 1px 2px rgba(0, 0, 0, 0.2)');
    root.style.setProperty('--adaptive-transition-duration', `${this.config.transitionDuration}ms`);
    root.style.setProperty('--adaptive-light-text', this.config.lightText);
    root.style.setProperty('--adaptive-dark-text', this.config.darkText);
  }

  /**
   * Update CSS properties when config changes
   */
  private updateCSSProperties(): void {
    const root = document.documentElement;

    root.style.setProperty('--adaptive-transition-duration', `${this.config.transitionDuration}ms`);
    root.style.setProperty('--adaptive-light-text', this.config.lightText);
    root.style.setProperty('--adaptive-dark-text', this.config.darkText);
  }

  /**
   * Apply adaptive properties to an element
   */
  private applyAdaptiveProperties(element: HTMLElement): void {
    // Add adaptive text class
    element.classList.add('adaptive-text');

    // Set CSS custom properties for smooth transitions
    element.style.transition = `color var(--adaptive-transition-duration) ease,
                                text-shadow var(--adaptive-transition-duration) ease`;
    element.style.color = 'var(--adaptive-text-color)';
    element.style.textShadow = 'var(--adaptive-text-shadow)';
  }

  /**
   * Reset element styling to original state
   */
  private resetElementStyling(element: HTMLElement): void {
    element.classList.remove('adaptive-text');
    element.style.removeProperty('color');
    element.style.removeProperty('text-shadow');
    element.style.removeProperty('transition');
    element.style.removeProperty('--adaptive-text-color');
    element.style.removeProperty('--adaptive-text-shadow');
    element.style.removeProperty('--adaptive-transition-duration');

    // Reset direct styling on child elements
    const textSelectors = 'h1, h2, h3, h4, h5, h6, p, span, a, .nav-label, .brand-text';
    const textElements = element.querySelectorAll(textSelectors);

    textElements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.removeProperty('color');
      htmlEl.style.removeProperty('text-shadow');
      htmlEl.style.removeProperty('transition');
    });
  }

  /**
   * Force update all registered elements
   */
  private forceUpdateAllElements(): void {
    const brightnessData = this.brightnessAnalyzer.sampleTextElements();

    this.textElements.forEach((textElement, id) => {
      const brightness = brightnessData.get(id);
      if (brightness && this.isElementVisible(textElement.element)) {
        this.updateElementColor(textElement, brightness);
      }
    });
  }

  /**
   * Handle window resize events
   */
  private setupResizeObserver(): void {
    // Clear brightness cache when window resizes
    const resizeObserver = new ResizeObserver(() => {
      this.brightnessAnalyzer.clearCache();

      // Force update after resize with small delay
      setTimeout(() => {
        if (this.isEnabled) {
          this.forceUpdateAllElements();
        }
      }, 100);
    });

    resizeObserver.observe(document.documentElement);
  }

  /**
   * Enable/disable debug mode with visual indicators
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;

    if (enabled) {
      this.createDebugOverlay();
      this.addDebugIndicators();
      console.log('AdaptiveTextRenderer: Debug mode enabled');
    } else {
      this.removeDebugOverlay();
      this.removeDebugIndicators();
      console.log('AdaptiveTextRenderer: Debug mode disabled');
    }
  }

  /**
   * Create debug overlay for real-time information
   */
  private createDebugOverlay(): void {
    if (this.debugOverlay) return;

    this.debugOverlay = document.createElement('div');
    this.debugOverlay.id = 'adaptive-text-debug-overlay';
    this.debugOverlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      font-size: 12px;
      z-index: 10000;
      min-width: 250px;
      backdrop-filter: blur(5px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;

    document.body.appendChild(this.debugOverlay);
    this.updateDebugOverlay();
  }

  /**
   * Remove debug overlay
   */
  private removeDebugOverlay(): void {
    if (this.debugOverlay) {
      document.body.removeChild(this.debugOverlay);
      this.debugOverlay = null;
    }
  }

  /**
   * Add visual debug indicators to text elements
   */
  private addDebugIndicators(): void {
    this.textElements.forEach((textElement) => {
      textElement.element.classList.add('adaptive-text-debug');
    });
  }

  /**
   * Remove visual debug indicators
   */
  private removeDebugIndicators(): void {
    this.textElements.forEach((textElement) => {
      textElement.element.classList.remove('adaptive-text-debug');
    });
  }

  /**
   * Update debug overlay with current information
   */
  private updateDebugOverlay(): void {
    if (!this.debugOverlay || !this.debugMode) return;

    const brightnessValues = this.brightnessAnalyzer.getDebugBrightnessValues();
    const analyzerStats = this.brightnessAnalyzer.getStats();

    const debugInfo = Array.from(brightnessValues.entries())
      .map(([id, brightness]) => {
        const textElement = this.textElements.get(id);
        const currentColor = textElement?.currentColor || 'unknown';
        const shouldUseDark = brightness > this.config.luminanceThreshold;
        const colorType = shouldUseDark ? 'DARK' : 'LIGHT';

        return `${id}: ${brightness.toFixed(3)} → ${colorType} (${currentColor})`;
      })
      .join('<br>');

    this.debugOverlay.innerHTML = `
      <strong>🎨 Adaptive Text Debug</strong><br>
      Status: ${this.isEnabled ? '✅ ACTIVE' : '❌ INACTIVE'}<br>
      Mode: ${this.isIntegratedWithRenderer ? 'RENDER-SYNC' : 'INDEPENDENT'}<br>
      Elements: ${this.textElements.size}<br>
      Threshold: ${this.config.luminanceThreshold}<br>
      Total Samples: ${analyzerStats.totalSamples}<br>
      Avg Brightness: ${analyzerStats.averageBrightness.toFixed(3)}<br>
      <hr style="margin: 5px 0; border: 1px solid #555;">
      <strong>Element Brightness:</strong><br>
      ${debugInfo || 'No data available'}
    `;
  }

  /**
   * Get current status and statistics
   */
  public getStats(): {
    registeredElements: number;
    isEnabled: boolean;
    lastUpdateTime: number;
    config: TextColorConfig;
    debugMode: boolean;
    isIntegratedWithRenderer: boolean;
  } {
    return {
      registeredElements: this.textElements.size,
      isEnabled: this.isEnabled,
      lastUpdateTime: this.lastUpdateTime,
      config: { ...this.config },
      debugMode: this.debugMode,
      isIntegratedWithRenderer: this.isIntegratedWithRenderer
    };
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.stop();

    // Clean up debug mode
    this.setDebugMode(false);

    // Reset all elements
    this.textElements.forEach((textElement) => {
      this.resetElementStyling(textElement.element);
    });

    this.textElements.clear();
    console.log('AdaptiveTextRenderer: Disposed');
  }
}
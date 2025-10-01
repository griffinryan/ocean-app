/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';
import { PanelManager } from './components/Panel';
import { Router } from './components/Router';
import { NavigationManager } from './components/Navigation';
import { PerformanceManager } from './renderer/PerformanceManager';

// Import shaders as strings
import oceanVertexShader from './shaders/ocean.vert';
import oceanFragmentShader from './shaders/ocean.frag';
import glassVertexShader from './shaders/glass.vert';
import glassFragmentShader from './shaders/glass.frag';
import textVertexShader from './shaders/text.vert';
import textFragmentShader from './shaders/text.frag';

class OceanApp {
  public renderer: OceanRenderer | null = null;
  public panelManager: PanelManager | null = null;
  public router: Router | null = null;
  public navigationManager: NavigationManager | null = null;
  public performanceManager: PerformanceManager | null = null;

  async init(): Promise<void> {
    try {
      // Get canvas element
      const canvas = document.getElementById('ocean-canvas') as HTMLCanvasElement;
      if (!canvas) {
        throw new Error('Canvas element not found');
      }

      console.log('Initializing Ocean Portfolio...');

      // Initialize UI components first
      this.initializeUI();

      // Create renderer
      this.renderer = new OceanRenderer({
        canvas,
        antialias: true,
        alpha: false
      });

      // Initialize shaders (ocean, glass, and text)
      await this.renderer.initializeShaders(
        oceanVertexShader,
        oceanFragmentShader,
        glassVertexShader,
        glassFragmentShader,
        textVertexShader,
        textFragmentShader
      );

      // Initialize performance management system
      this.initializePerformanceManagement();

      // Start rendering
      this.renderer.start();

      // Connect UI to glass renderer
      this.connectUIToRenderer();

      // CRITICAL: Wait for landing panel animation before enabling text rendering
      // Landing panel has `animation: fadeInUp 1.2s` that moves elements
      // Text positions must NOT be captured during this animation
      this.waitForInitialAnimation();

      console.log('Ocean Portfolio initialized successfully!');

      // Set up keyboard controls for debugging
      this.setupControls();

    } catch (error) {
      console.error('Failed to initialize Ocean Portfolio:', error);
      this.showError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Initialize performance management system
   */
  private initializePerformanceManagement(): void {
    if (!this.renderer) {
      console.warn('PerformanceManager: Cannot initialize - renderer not available');
      return;
    }

    try {
      // Create PerformanceManager
      const gl = this.renderer['gl']; // Access private gl context
      this.performanceManager = new PerformanceManager(gl);

      // Register callback for performance changes
      this.performanceManager.onChange((settings, preset) => {
        console.log(`PerformanceManager: Quality changed to ${preset}`);

        if (this.renderer) {
          // Apply settings to renderer
          this.renderer.applyPerformanceSettings(settings);

          // Apply settings to text renderer
          const textRenderer = this.renderer.getTextRenderer();
          if (textRenderer) {
            textRenderer.setGlowQuality(settings.glowSampleRings);
          }

          // Apply settings to glass renderer
          const glassRenderer = this.renderer.getGlassRenderer();
          if (glassRenderer) {
            glassRenderer.setGlassQuality(settings.glassNoiseOctaves, settings.enableChromaticAberration);
          }
        }
      });

      // Apply initial settings
      const initialSettings = this.performanceManager.getCurrentSettings();
      this.renderer.applyPerformanceSettings(initialSettings);

      const textRenderer = this.renderer.getTextRenderer();
      if (textRenderer) {
        textRenderer.setGlowQuality(initialSettings.glowSampleRings);
      }

      const glassRenderer = this.renderer.getGlassRenderer();
      if (glassRenderer) {
        glassRenderer.setGlassQuality(initialSettings.glassNoiseOctaves, initialSettings.enableChromaticAberration);
      }

      // Start FPS monitoring (hook into render loop via interval)
      setInterval(() => {
        if (this.renderer && this.performanceManager) {
          const fps = this.renderer.getFPS();
          this.performanceManager.updateFPS(fps);
        }
      }, 100); // Update every 100ms

      console.log('PerformanceManager initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize PerformanceManager:', error);
    }
  }

  /**
   * Initialize UI components (panels, router, and navigation)
   */
  private initializeUI(): void {
    try {
      // Initialize panel manager
      this.panelManager = new PanelManager();

      // Initialize router with panel manager
      this.router = new Router(this.panelManager);

      // Initialize navigation manager with router
      this.navigationManager = new NavigationManager(this.router);

      // Connect navigation visibility to panel state changes
      this.setupNavigationIntegration();

      console.log('UI components initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize UI components:', error);
      throw error;
    }
  }

  /**
   * Setup navigation integration with panel state changes
   */
  private setupNavigationIntegration(): void {
    if (!this.navigationManager || !this.panelManager) {
      return;
    }

    // Listen for panel state changes and update navigation visibility
    const originalTransitionTo = this.panelManager.transitionTo.bind(this.panelManager);
    this.panelManager.transitionTo = (newState) => {
      // Call original transition
      originalTransitionTo(newState);

      // Update navigation visibility based on panel state
      this.navigationManager!.updateVisibilityForPanelState(newState);
    };
  }

  /**
   * Connect UI components to the WebGL renderer
   */
  private connectUIToRenderer(): void {
    if (!this.renderer || !this.panelManager) {
      return;
    }

    // Enable glass rendering if available
    const glassRenderer = this.renderer.getGlassRenderer();
    if (glassRenderer) {
      this.renderer.setGlassEnabled(true);

      // Enable WebGL enhancement on panels
      this.panelManager.enableWebGLDistortion();

      console.log('UI connected to glass renderer successfully!');
    } else {
      console.warn('Glass renderer not available, falling back to CSS-only effects');
    }

    // Enable text rendering if available
    const textRenderer = this.renderer.getTextRenderer();
    if (textRenderer) {
      this.renderer.setTextEnabled(true);

      // Connect TextRenderer to PanelManager for visibility updates
      this.panelManager.setTextRenderer(textRenderer);

      console.log('UI connected to text renderer successfully!');
    } else {
      console.warn('Text renderer not available, falling back to CSS-only text');
    }
  }

  /**
   * Wait for initial landing page animation before enabling text rendering
   * Prevents capturing text positions during CSS animation
   */
  private waitForInitialAnimation(): void {
    if (!this.renderer) {
      return;
    }

    const textRenderer = this.renderer.getTextRenderer();
    if (!textRenderer) {
      return;
    }

    // Block text rendering during initial animation
    textRenderer.setTransitioning(true);

    console.log('OceanApp: Waiting for landing panel animation to complete...');

    // Listen for animationend event on landing panel
    const landingPanel = document.getElementById('landing-panel');
    if (landingPanel) {
      landingPanel.addEventListener('animationend', () => {
        console.log('OceanApp: Landing panel animation complete, enabling text rendering');

        // Enable text rendering now that animation is complete
        textRenderer.setTransitioning(false);
        textRenderer.forceTextureUpdate();
        textRenderer.markSceneDirty();
      }, { once: true });
    } else {
      // Fallback: Enable after timeout if landing panel not found
      setTimeout(() => {
        console.warn('OceanApp: Landing panel not found, enabling text after timeout');
        textRenderer.setTransitioning(false);
        textRenderer.forceTextureUpdate();
        textRenderer.markSceneDirty();
      }, 1300); // 1.2s animation + 100ms safety
    }
  }

  /**
   * Set up keyboard controls for debugging
   */
  private setupControls(): void {
    document.addEventListener('keydown', (event) => {
      switch (event.key) {
        case ' ': // Spacebar
          event.preventDefault();
          if (this.renderer) {
            // Toggle between play/pause (for debugging)
            console.log('Spacebar pressed - Toggle functionality could be added here');
          }
          break;
        case 'f':
        case 'F':
          // Toggle fullscreen
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
          break;
        case 'Escape':
          // Exit fullscreen
          if (document.fullscreenElement) {
            document.exitFullscreen();
          }
          break;
        case 'd':
        case 'D':
          // Cycle through debug modes
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const currentMode = this.renderer.getDebugMode();
            const nextMode = (currentMode + 1) % 5; // 0-4 debug modes (added wake debug)
            this.renderer.setDebugMode(nextMode);
            this.updateDebugInfo(nextMode);
          }
          break;
        case 'v':
        case 'V':
          // Toggle vessel wake system
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            this.renderer.toggleWakes();
            this.updateVesselInfo();
          }
          break;
        case 'g':
        case 'G':
          // Toggle glass panel rendering
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const isEnabled = this.renderer.getGlassEnabled();
            this.renderer.setGlassEnabled(!isEnabled);
            this.updateGlassInfo(!isEnabled);
          }
          break;
        case 't':
        case 'T':
          // Toggle text rendering
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const isEnabled = this.renderer.getTextEnabled();
            this.renderer.setTextEnabled(!isEnabled);
            this.updateTextInfo(!isEnabled);
          }
          break;
        case 'q':
        case 'Q':
          // Cycle quality preset
          event.preventDefault();
          event.stopPropagation();
          if (this.performanceManager) {
            const newPreset = this.performanceManager.cycleQuality();
            this.updateQualityInfo(newPreset);
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '0':
          // Direct debug mode selection
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const mode = parseInt(event.key);
            this.renderer.setDebugMode(mode);
            this.updateDebugInfo(mode);
          }
          break;
      }
    });

    // Add some helpful info
    console.log('Controls:');
    console.log('  F - Toggle fullscreen');
    console.log('  Escape - Exit fullscreen / Return to landing');
    console.log('  Q - Cycle quality preset (Auto/Low/Medium/High/Ultra)');
    console.log('  D - Cycle debug modes');
    console.log('  0-4 - Select debug mode directly');
    console.log('  V - Toggle vessel wake system');
    console.log('  G - Toggle glass panel rendering');
    console.log('  T - Toggle text rendering');
  }

  /**
   * Update debug info display
   */
  private updateDebugInfo(mode: number): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      const modeNames = ['Normal', 'UV Coords', 'Wave Height', 'Normals', 'Wake Map'];
      const modeName = modeNames[mode] || 'Unknown';

      // Update the existing info or add debug info
      let debugElement = document.getElementById('debug-mode');
      if (!debugElement) {
        debugElement = document.createElement('div');
        debugElement.id = 'debug-mode';
        infoElement.appendChild(debugElement);
      }
      debugElement.innerHTML = `<br>Debug Mode: ${modeName} (${mode})`;
    }
  }

  /**
   * Update vessel system info display
   */
  private updateVesselInfo(): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.renderer) {
      const wakesEnabled = this.renderer.getWakesEnabled();
      const stats = this.renderer.getVesselStats();

      // Update the existing info or add vessel info
      let vesselElement = document.getElementById('vessel-info');
      if (!vesselElement) {
        vesselElement = document.createElement('div');
        vesselElement.id = 'vessel-info';
        infoElement.appendChild(vesselElement);
      }

      vesselElement.innerHTML = `<br>Vessel Wakes: ${wakesEnabled ? 'ON' : 'OFF'}<br>Active Vessels: ${stats.activeVessels}<br>Wake Points: ${stats.totalWakePoints}`;
    }
  }

  /**
   * Update glass system info display
   */
  private updateGlassInfo(enabled: boolean): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.renderer) {
      // Update the existing info or add glass info
      let glassElement = document.getElementById('glass-info');
      if (!glassElement) {
        glassElement = document.createElement('div');
        glassElement.id = 'glass-info';
        infoElement.appendChild(glassElement);
      }

      glassElement.innerHTML = `<br>Glass Panels: ${enabled ? 'ON' : 'OFF'}`;
    }
  }

  /**
   * Update text rendering info display
   */
  private updateTextInfo(enabled: boolean): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.renderer) {
      // Update the existing info or add text info
      let textElement = document.getElementById('text-info');
      if (!textElement) {
        textElement = document.createElement('div');
        textElement.id = 'text-info';
        infoElement.appendChild(textElement);
      }

      textElement.innerHTML = `<br>Adaptive Text: ${enabled ? 'ON' : 'OFF'}`;
    }
  }

  /**
   * Update quality preset info display
   */
  private updateQualityInfo(preset: string): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.performanceManager) {
      // Update the existing info or add quality info
      let qualityElement = document.getElementById('quality-info');
      if (!qualityElement) {
        qualityElement = document.createElement('div');
        qualityElement.id = 'quality-info';
        infoElement.appendChild(qualityElement);
      }

      const settings = this.performanceManager.getCurrentSettings();
      const battery = this.performanceManager.getBatteryStatus();
      const avgFPS = Math.round(this.performanceManager.getAverageFPS());

      qualityElement.innerHTML = `<br>Quality: ${preset.toUpperCase()}<br>Resolution: ${Math.round(settings.resolutionScale * 100)}%<br>FPS: ${avgFPS}<br>Battery: ${battery.charging ? 'Charging' : 'On Battery'}`;
    }
  }

  /**
   * Show error message to user
   */
  private showError(message: string): void {
    const canvas = document.getElementById('ocean-canvas');
    if (canvas) {
      canvas.style.display = 'none';
    }

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 20px;
      border-radius: 10px;
      font-family: Arial, sans-serif;
      text-align: center;
      z-index: 1000;
    `;
    errorDiv.innerHTML = `
      <h2>Ocean Renderer Error</h2>
      <p>${message}</p>
      <p><small>Please check the console for more details.</small></p>
    `;

    document.body.appendChild(errorDiv);
  }

  /**
   * Clean up when page unloads
   */
  dispose(): void {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.navigationManager) {
      this.navigationManager.dispose();
      this.navigationManager = null;
    }

    if (this.panelManager) {
      this.panelManager.dispose();
      this.panelManager = null;
    }

    if (this.router) {
      this.router.dispose();
      this.router = null;
    }

    if (this.performanceManager) {
      this.performanceManager.dispose();
      this.performanceManager = null;
    }
  }
}

// Initialize the application when the page loads
const app = new OceanApp();

// Handle page lifecycle
window.addEventListener('load', () => {
  app.init();
});

window.addEventListener('beforeunload', () => {
  app.dispose();
});

// Handle visibility changes for performance
document.addEventListener('visibilitychange', () => {
  if (app.renderer) {
    if (document.hidden) {
      app.renderer.stop();
    } else {
      app.renderer.start();
    }
  }
});

// Export for potential external use
export default app;
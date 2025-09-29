/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';
import { PanelManager } from './components/Panel';
import { Router } from './components/Router';
import { NavigationManager } from './components/Navigation';
// import { BrightnessAnalyzer } from './renderer/BrightnessAnalyzer'; // REMOVED: Legacy adaptive text system
// import { AdaptiveTextRenderer } from './renderer/AdaptiveTextRenderer'; // REMOVED: Legacy adaptive text system

// Import shaders as strings
import oceanVertexShader from './shaders/ocean.vert';
import oceanFragmentShader from './shaders/ocean.frag';
import glassVertexShader from './shaders/glass.vert';
import glassFragmentShader from './shaders/glass.frag';
import textMaskVertexShader from './shaders/text-mask.vert';
import textMaskFragmentShader from './shaders/text-mask.frag';

class OceanApp {
  public renderer: OceanRenderer | null = null;
  public panelManager: PanelManager | null = null;
  public router: Router | null = null;
  public navigationManager: NavigationManager | null = null;
  // public brightnessAnalyzer: BrightnessAnalyzer | null = null; // REMOVED: Legacy adaptive text system
  // public adaptiveTextRenderer: AdaptiveTextRenderer | null = null; // REMOVED: Legacy adaptive text system

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

      // Initialize shaders (ocean, glass, and text mask)
      await this.renderer.initializeShaders(
        oceanVertexShader,
        oceanFragmentShader,
        glassVertexShader,
        glassFragmentShader,
        textMaskVertexShader,
        textMaskFragmentShader
      );

      // Initialize new text mask system
      this.initializeTextMaskSystem();

      // Legacy adaptive text system has been removed in favor of shader-based text masking
      // this.initializeAdaptiveTextSystem(); // REMOVED

      // Start rendering
      this.renderer.start();

      // Connect UI to glass renderer
      this.connectUIToRenderer();

      console.log('Ocean Portfolio initialized successfully!');

      // Set up keyboard controls for debugging
      this.setupControls();

    } catch (error) {
      console.error('Failed to initialize Ocean Portfolio:', error);
      this.showError(error instanceof Error ? error.message : 'Unknown error');
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
   * Initialize text mask system for shader-based adaptive text
   */
  private initializeTextMaskSystem(): void {
    if (!this.renderer) {
      console.warn('Cannot initialize text mask system: renderer not available');
      return;
    }

    try {
      const textMaskRenderer = this.renderer.getTextMaskRenderer();
      if (!textMaskRenderer) {
        console.warn('Text mask renderer not available');
        return;
      }

      // Enable text mask rendering
      this.renderer.setTextMaskEnabled(true);

      // Get the mask canvas and attach it to the DOM
      const maskCanvas = textMaskRenderer.getMaskCanvas();
      if (maskCanvas) {
        // Find the canvas container and add the mask canvas
        const canvasContainer = document.body; // or find a more specific container
        canvasContainer.appendChild(maskCanvas);

        // Position the mask canvas to overlay the main canvas
        const mainCanvas = this.renderer.getCanvas();
        if (mainCanvas) {
          const mainCanvasRect = mainCanvas.getBoundingClientRect();
          maskCanvas.style.position = 'fixed';
          maskCanvas.style.left = mainCanvasRect.left + 'px';
          maskCanvas.style.top = mainCanvasRect.top + 'px';
          maskCanvas.style.width = mainCanvasRect.width + 'px';
          maskCanvas.style.height = mainCanvasRect.height + 'px';
          maskCanvas.style.pointerEvents = 'none';
          maskCanvas.style.zIndex = '1000';

          // Set appropriate blend mode for text masking
          maskCanvas.style.mixBlendMode = 'multiply';
        }
      }

      console.log('Text mask system initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize text mask system:', error);
    }
  }

  /*
   * REMOVED: Legacy adaptive text system replaced by shader-based TextMaskRenderer
   * This method has been disabled as the new system provides better performance
   * and more granular text adaptation using WebGL shaders
   */
  /*
  private initializeAdaptiveTextSystem(): void {
    if (!this.renderer) {
      console.warn('Cannot initialize adaptive text system: renderer not available');
      return;
    }

    try {
      // Create brightness analyzer
      const gl = this.renderer.getWebGLContext();
      if (!gl) {
        console.warn('Cannot initialize adaptive text system: WebGL context not available');
        return;
      }

      this.brightnessAnalyzer = new BrightnessAnalyzer(gl);

      // Create adaptive text renderer
      this.adaptiveTextRenderer = new AdaptiveTextRenderer(this.brightnessAnalyzer);

      // Register common text elements for adaptive color management
      this.adaptiveTextRenderer.registerCommonElements();

      // Enable debug mode for initial testing
      this.brightnessAnalyzer.setDebugMode(true);
      this.adaptiveTextRenderer.setDebugMode(true);

      // Integrate with render pipeline instead of independent loop
      this.adaptiveTextRenderer.enableRendererIntegration();

      // Register brightness callback with renderer
      this.renderer.setBrightnessCallback(() => {
        if (this.adaptiveTextRenderer) {
          this.adaptiveTextRenderer.updateFromRenderer();
        }
      });

      console.log('Adaptive text system initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize adaptive text system:', error);
      this.brightnessAnalyzer = null;
      this.adaptiveTextRenderer = null;
    }
  }
  */

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

    // REMOVED: Legacy adaptive text system
    // Text mask system is now automatically connected via shaders
    console.log('New shader-based text mask system active');
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
        /* REMOVED: Legacy adaptive text controls
        case 't':
        case 'T':
          // Toggle adaptive text system
          event.preventDefault();
          event.stopPropagation();
          if (this.adaptiveTextRenderer) {
            const stats = this.adaptiveTextRenderer.getStats();
            if (stats.isEnabled) {
              this.adaptiveTextRenderer.stop();
            } else {
              this.adaptiveTextRenderer.start();
            }
            this.updateAdaptiveTextInfo(!stats.isEnabled);
          }
          break;
        case 'b':
        case 'B':
          // Toggle adaptive text debug mode
          event.preventDefault();
          event.stopPropagation();
          if (this.adaptiveTextRenderer && this.brightnessAnalyzer) {
            const stats = this.adaptiveTextRenderer.getStats();
            const newDebugMode = !stats.debugMode;
            this.adaptiveTextRenderer.setDebugMode(newDebugMode);
            this.brightnessAnalyzer.setDebugMode(newDebugMode);
            this.updateTextDebugInfo(newDebugMode);
          }
          break;
        */
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
    console.log('  Escape - Exit fullscreen');
    console.log('  D - Cycle debug modes');
    console.log('  0-4 - Select debug mode directly');
    console.log('  V - Toggle vessel wake system');
    console.log('  G - Toggle glass panel rendering');
    console.log('  T - Toggle adaptive text system');
    console.log('  B - Toggle adaptive text debug mode');
    console.log('  Space - Reserved for future controls');
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

  /*
   * REMOVED: Legacy adaptive text info display
   * The new shader-based system doesn't need manual toggling
   */
  /*
  private updateAdaptiveTextInfo(enabled: boolean): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.adaptiveTextRenderer) {
      // Update the existing info or add adaptive text info
      let adaptiveElement = document.getElementById('adaptive-text-info');
      if (!adaptiveElement) {
        adaptiveElement = document.createElement('div');
        adaptiveElement.id = 'adaptive-text-info';
        infoElement.appendChild(adaptiveElement);
      }

      const stats = this.adaptiveTextRenderer.getStats();
      adaptiveElement.innerHTML = `<br>Adaptive Text: ${enabled ? 'ON' : 'OFF'}<br>Text Elements: ${stats.registeredElements}`;
    }
  }
  */

  /**
   * Update debug system info display
   */
  /*
   * REMOVED: Legacy text debug info method
   */
  /*
  private updateTextDebugInfo(enabled: boolean): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      // Update the existing info or add debug info
      let debugElement = document.getElementById('debug-text-info');
      if (!debugElement) {
        debugElement = document.createElement('div');
        debugElement.id = 'debug-text-info';
        infoElement.appendChild(debugElement);
      }

      debugElement.innerHTML = `<br>Text Debug: ${enabled ? 'ON' : 'OFF'}`;
    }
  }
  */

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
    // REMOVED: Legacy adaptive text system cleanup
    // The new text mask system is cleaned up with the renderer
    /*
    if (this.adaptiveTextRenderer) {
      this.adaptiveTextRenderer.dispose();
      this.adaptiveTextRenderer = null;
    }

    if (this.brightnessAnalyzer) {
      this.brightnessAnalyzer.dispose();
      this.brightnessAnalyzer = null;
    }
    */

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
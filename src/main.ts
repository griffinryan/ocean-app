/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';
import { PanelManager } from './components/Panel';
import { Router } from './components/Router';
import { NavigationManager } from './components/Navigation';

// Import shaders as strings
import oceanVertexShader from './shaders/ocean.vert';
import oceanFragmentShader from './shaders/ocean.frag';
import glassVertexShader from './shaders/glass.vert';
import glassFragmentShader from './shaders/glass.frag';
import textSamplingVertexShader from './shaders/text-sampling.vert';
import textSamplingFragmentShader from './shaders/text-sampling.frag';
import textCompositeVertexShader from './shaders/text-composite.vert';
import textCompositeFragmentShader from './shaders/text-composite.frag';

class OceanApp {
  public renderer: OceanRenderer | null = null;
  public panelManager: PanelManager | null = null;
  public router: Router | null = null;
  public navigationManager: NavigationManager | null = null;

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

      // Initialize shaders (ocean, glass, text sampling, and text composite)
      await this.renderer.initializeShaders(
        oceanVertexShader,
        oceanFragmentShader,
        glassVertexShader,
        glassFragmentShader,
        textSamplingVertexShader,
        textSamplingFragmentShader,
        textCompositeVertexShader,
        textCompositeFragmentShader
      );

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

    // Initialize new per-pixel adaptive text system
    const textRenderLayer = this.renderer.getTextRenderLayer();
    if (textRenderLayer) {
      // Register all text elements for per-pixel rendering
      this.registerAllTextElementsForRendering();

      // Enable text render system
      this.renderer.setTextRenderEnabled(true);

      console.log('Per-pixel adaptive text system initialized successfully!');
    } else {
      console.warn('Text render layer not available');
    }

    // Keep legacy text analyzer for comparison (disabled by default)
    const textAnalyzer = this.renderer.getTextAnalyzer();
    if (textAnalyzer) {
      // Don't enable by default - only for debugging/comparison
      this.renderer.setTextAnalyzerEnabled(false);
      console.log('Legacy text analyzer available for debugging');
    }
  }

  /**
   * Register all text elements for per-pixel adaptive rendering
   */
  private registerAllTextElementsForRendering(): void {
    if (!this.renderer) return;

    // Define text elements to register for per-pixel rendering
    const textElementConfigs = [
      // Landing panel text
      { id: 'landing-title', selector: '#landing-panel h1', type: 'heading' },
      { id: 'landing-subtitle', selector: '#landing-panel .subtitle', type: 'body' },
      { id: 'landing-buttons', selector: '#landing-panel .glass-button', type: 'button' },

      // Navigation elements
      { id: 'nav-brand', selector: '.brand-text', type: 'navigation' },
      { id: 'nav-items', selector: '.nav-label', type: 'navigation' },

      // App panel text
      { id: 'app-title', selector: '#app-panel h2', type: 'heading' },
      { id: 'app-content', selector: '#app-panel p', type: 'body' },
      { id: 'app-projects', selector: '#app-panel .project-card h3', type: 'heading' },

      // Portfolio panel text
      { id: 'portfolio-title', selector: '#portfolio-panel h2', type: 'heading' },
      { id: 'portfolio-content', selector: '#portfolio-panel p', type: 'body' },
      { id: 'portfolio-projects', selector: '#portfolio-panel .project-detail h3', type: 'heading' },

      // Resume panel text
      { id: 'resume-title', selector: '#resume-panel h2', type: 'heading' },
      { id: 'resume-sections', selector: '#resume-panel h3', type: 'heading' },
      { id: 'resume-content', selector: '#resume-panel p', type: 'body' },
      { id: 'resume-skills', selector: '.skill-tag', type: 'body' }
    ];

    textElementConfigs.forEach(config => {
      const elements = document.querySelectorAll(config.selector);
      elements.forEach((element, index) => {
        if (element instanceof HTMLElement) {
          const uniqueId = elements.length > 1 ? `${config.id}-${index}` : config.id;

          // Start with HTML text visible as fallback
          element.classList.add('webgl-text-fallback');

          // Register with text render layer
          this.renderer!.registerTextForRendering(uniqueId, element);

          console.log(`Registered text element for per-pixel rendering: ${uniqueId}`);
        }
      });
    });
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
          // Toggle new per-pixel text rendering system
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const isEnabled = this.renderer.getTextRenderEnabled();
            this.renderer.setTextRenderEnabled(!isEnabled);
            this.updateTextRenderInfo(!isEnabled);
          }
          break;
        case 'r':
        case 'R':
          // Cycle text render debug modes
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const textRenderLayer = this.renderer.getTextRenderLayer();
            if (textRenderLayer) {
              // Cycle through debug modes (state is tracked in renderer)
              this.renderer.setTextRenderDebugMode(true);
            }
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
    console.log('  Escape - Exit fullscreen');
    console.log('  D - Cycle debug modes');
    console.log('  0-4 - Select debug mode directly');
    console.log('  V - Toggle vessel wake system');
    console.log('  G - Toggle glass panel rendering');
    console.log('  T - Toggle per-pixel text rendering');
    console.log('  R - Cycle text render debug modes (Off/Text/Ocean/Analysis)');
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

  /**
   * Update text render info display
   */
  private updateTextRenderInfo(enabled: boolean): void {
    const infoElement = document.getElementById('info');
    if (infoElement && this.renderer) {
      // Update the existing info or add text render info
      let textElement = document.getElementById('text-render-info');
      if (!textElement) {
        textElement = document.createElement('div');
        textElement.id = 'text-render-info';
        infoElement.appendChild(textElement);
      }

      let statusText = `<br>Per-Pixel Text: ${enabled ? 'ON' : 'OFF'}`;

      // Add performance metrics if enabled
      if (enabled) {
        const metrics = this.renderer.getTextRenderMetrics();
        if (metrics) {
          statusText += `<br>Text Elements: ${metrics.elementCount}`;
          statusText += `<br>Render Time: ${metrics.lastRenderTime.toFixed(2)}ms`;
          statusText += `<br>Texture: ${metrics.textureSize.width}x${metrics.textureSize.height}`;
        }
      }

      textElement.innerHTML = statusText;
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
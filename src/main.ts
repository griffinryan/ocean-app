/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';
import { PanelManager } from './components/Panel';
import { Router } from './components/Router';
import { NavigationManager } from './components/Navigation';
import { LoadingSequence } from './components/LoadingSequence';
import { PanelLayoutTracker } from './utils/PanelLayoutTracker';

// Import shaders as strings
import oceanVertexShader from './shaders/ocean.vert';
import oceanFragmentShader from './shaders/ocean.frag';
import wakeVertexShader from './shaders/wake.vert';
import wakeFragmentShader from './shaders/wake.frag';
import glassVertexShader from './shaders/glass.vert';
import glassFragmentShader from './shaders/glass.frag';
import textVertexShader from './shaders/text.vert';
import textFragmentShader from './shaders/text.frag';
import blurMapVertexShader from './shaders/blurmap.vert';
import blurMapFragmentShader from './shaders/blurmap.frag';
import upscaleVertexShader from './shaders/upscale.vert';
import upscaleFragmentShader from './shaders/upscale.frag';

class OceanApp {
  public renderer: OceanRenderer | null = null;
  public panelManager: PanelManager | null = null;
  public router: Router | null = null;
  public navigationManager: NavigationManager | null = null;
  private loadingSequence: LoadingSequence | null = null;
  private debugOverlayVisible = false;
  private debugOverlayFields: {
    mode: HTMLElement | null;
    wakes: HTMLElement | null;
    glass: HTMLElement | null;
    text: HTMLElement | null;
    blur: HTMLElement | null;
  } = {
    mode: null,
    wakes: null,
    glass: null,
    text: null,
    blur: null
  };
  private layoutTracker: PanelLayoutTracker | null = null;

  async init(): Promise<void> {
    try {
      // Get canvas element
      const canvas = document.getElementById('ocean-canvas') as HTMLCanvasElement;
      if (!canvas) {
        throw new Error('Canvas element not found');
      }

      console.log('Initializing Ocean Portfolio with ocean-first loading sequence...');

      // Initialize UI components first
      this.initializeUI();

      this.layoutTracker = new PanelLayoutTracker();
      if (this.panelManager) {
        this.panelManager.setLayoutTracker(this.layoutTracker);
      }
      if (this.navigationManager) {
        this.navigationManager.setLayoutTracker(this.layoutTracker);
      }

      // Create loading sequence
      this.loadingSequence = new LoadingSequence({
        showLoadingIndicator: false, // Disable indicator for cleaner UX
        glassFadeInDuration: 300,
        textFadeInDuration: 300,
        textStaggerDelay: 50
      });

      // Create renderer
      this.renderer = new OceanRenderer({
        canvas,
        antialias: true,
        alpha: false,
        layoutTracker: this.layoutTracker
      });

      // Set references for loading sequence
      this.loadingSequence.setOceanRenderer(this.renderer);
      if (this.panelManager) {
        this.loadingSequence.setPanelManager(this.panelManager);
      }

      // Initialize shaders (ocean, wake, glass, text, blur map, and upscaling)
      // Phase 2: Background initialization (shaders)
      await this.renderer.initializeShaders(
        oceanVertexShader,
        oceanFragmentShader,
        wakeVertexShader,
        wakeFragmentShader,
        glassVertexShader,
        glassFragmentShader,
        textVertexShader,
        textFragmentShader,
        blurMapVertexShader,
        blurMapFragmentShader,
        upscaleVertexShader,
        upscaleFragmentShader
      );

      // Connect UI to glass renderer BEFORE starting render loop
      // This ensures consistent multi-pass pipeline from frame 0
      // Prevents visual "jump" when switching from simple→complex pipeline
      this.connectUIToRenderer();

      // Start rendering - this enables Phase 1 (WebGL ocean)
      this.renderer.start();

      // CRITICAL: Wait for landing panel animation before enabling text rendering
      // Landing panel has `animation: fadeInUp 1.2s` that moves elements
      // Text positions must NOT be captured during this animation
      this.waitForInitialAnimation();

      // Start loading sequence (ocean-first progressive enhancement)
      await this.loadingSequence.start();

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

      // Connect GlassRenderer to PanelManager for position updates during transitions
      this.panelManager.setGlassRenderer(glassRenderer);

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

    const glassRenderer = this.renderer.getGlassRenderer();
    const textRenderer = this.renderer.getTextRenderer();

    if (textRenderer) {
      // Block text rendering during initial animation
      textRenderer.setTransitioning(true);
    }

    // Keep liquid glass perfectly aligned during landing animation
    if (glassRenderer) {
      glassRenderer.startTransitionMode();
      glassRenderer.markPositionsDirty();
    }

    console.log('OceanApp: Waiting for landing panel animation to complete...');

    const handleLandingReady = () => {
      if (textRenderer) {
        console.log('OceanApp: Landing panel animation complete, enabling text rendering');
        textRenderer.setTransitioning(false);
        textRenderer.forceTextureUpdate();
        textRenderer.markSceneDirty();
      }

      if (glassRenderer) {
        glassRenderer.endTransitionMode();
        glassRenderer.markPositionsDirty();
      }
    };

    // Listen for animationend event on landing panel
    const landingPanel = document.getElementById('landing-panel');
    if (landingPanel) {
      landingPanel.addEventListener('animationend', handleLandingReady, { once: true });
    } else {
      // Fallback: Enable after timeout if landing panel not found
      setTimeout(() => {
        console.warn('OceanApp: Landing panel not found, enabling text after timeout');
        handleLandingReady();
      }, 1300); // 1.2s animation + 100ms safety
    }
  }

  /**
   * Set up keyboard controls for debugging
   */
  private setupControls(): void {
    this.initializeDebugOverlay();

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
        case 'b':
        case 'B':
          // Toggle blur map effect (frosted glass around text)
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const isEnabled = this.renderer.getBlurMapEnabled();
            this.renderer.setBlurMapEnabled(!isEnabled);
            this.updateBlurMapInfo(!isEnabled);
          }
          break;
        case 'n':
        case 'N':
          // Decrease blur radius (tighter frost)
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const currentRadius = this.renderer.getBlurRadius();
            const newRadius = Math.max(20, currentRadius - 10);
            this.renderer.setBlurRadius(newRadius);
            console.log(`Blur radius: ${newRadius}px`);
          }
          break;
        case 'm':
        case 'M':
          // Increase blur radius (wider frost)
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const currentRadius = this.renderer.getBlurRadius();
            const newRadius = Math.min(256, currentRadius + 10);
            this.renderer.setBlurRadius(newRadius);
            console.log(`Blur radius: ${newRadius}px`);
          }
          break;
        case ',':
          // Decrease falloff power (softer fade)
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const currentPower = this.renderer.getBlurFalloffPower();
            const newPower = Math.max(0.5, currentPower - 0.25);
            this.renderer.setBlurFalloffPower(newPower);
            console.log(`Blur falloff power: ${newPower.toFixed(2)}`);
          }
          break;
        case '.':
          // Increase falloff power (sharper fade)
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const currentPower = this.renderer.getBlurFalloffPower();
            const newPower = Math.min(5.0, currentPower + 0.25);
            this.renderer.setBlurFalloffPower(newPower);
            console.log(`Blur falloff power: ${newPower.toFixed(2)}`);
          }
          break;
        case 'o':
        case 'O':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            this.toggleDebugOverlay();
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '0':
          // Direct debug mode selection (without modifier keys)
          if (!event.ctrlKey && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            if (this.renderer) {
              const mode = parseInt(event.key);
              this.renderer.setDebugMode(mode);
              this.updateDebugInfo(mode);
            }
          }
          break;
      }
    });

    // Add some helpful info
    console.log('=== CONTROLS ===');
    console.log('General:');
    console.log('  F - Toggle fullscreen');
    console.log('  Escape - Exit fullscreen / Return to landing');
    console.log('');
    console.log('Debug:');
    console.log('  D - Cycle debug modes');
    console.log('  0-4 - Select debug mode directly');
    console.log('');
    console.log('Effects:');
    console.log('  V - Toggle vessel wake system');
    console.log('  G - Toggle glass panel rendering');
    console.log('  T - Toggle text rendering');
    console.log('  B - Toggle blur map (frosted glass)');
    console.log('  O - Toggle debug overlay');
    console.log('');
    console.log('Blur Tuning:');
    console.log('  N - Decrease blur radius (tighter)');
    console.log('  M - Increase blur radius (wider)');
    console.log('  , - Decrease falloff power (softer)');
    console.log('  . - Increase falloff power (sharper)');
    console.log('================');
  }

  /**
   * Initialize minimal debug overlay without runtime overhead
   */
  private initializeDebugOverlay(): void {
    const existing = document.getElementById('debug-overlay');
    if (existing && existing.parentElement) {
      existing.parentElement.removeChild(existing);
    }

    const overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    overlay.className = 'debug-overlay';
    overlay.innerHTML = `
      <div class="debug-overlay-title">Debug Panel</div>
      <div class="debug-overlay-row">
        <span class="debug-label">Mode</span>
        <span class="debug-value" data-debug-field="mode">Normal (0)</span>
      </div>
      <div class="debug-overlay-row">
        <span class="debug-label">Wakes</span>
        <span class="debug-value" data-debug-field="wakes">ON</span>
      </div>
      <div class="debug-overlay-row">
        <span class="debug-label">Glass</span>
        <span class="debug-value" data-debug-field="glass">ON</span>
      </div>
      <div class="debug-overlay-row">
        <span class="debug-label">Text</span>
        <span class="debug-value" data-debug-field="text">ON</span>
      </div>
      <div class="debug-overlay-row">
        <span class="debug-label">Frost</span>
        <span class="debug-value" data-debug-field="blur">ON</span>
      </div>
      <div class="debug-overlay-divider"></div>
      <div class="debug-overlay-footnote">
        D: cycle modes · V/G/T/B: toggle systems · N/M,./: blur tuning
      </div>
    `;

    document.body.appendChild(overlay);
    this.debugOverlayFields = {
      mode: overlay.querySelector('[data-debug-field="mode"]'),
      wakes: overlay.querySelector('[data-debug-field="wakes"]'),
      glass: overlay.querySelector('[data-debug-field="glass"]'),
      text: overlay.querySelector('[data-debug-field="text"]'),
      blur: overlay.querySelector('[data-debug-field="blur"]')
    };

    this.refreshDebugOverlayState();
    this.setDebugOverlayVisibility(false);
  }

  private setDebugOverlayField(field: keyof OceanApp['debugOverlayFields'], value: string): void {
    const element = this.debugOverlayFields[field];
    if (element) {
      element.textContent = value;
    }
  }

  private setDebugOverlayVisibility(visible: boolean): void {
    this.debugOverlayVisible = visible;
    const overlay = document.getElementById('debug-overlay');
    if (!overlay) return;

    if (visible) {
      overlay.classList.add('is-visible');
    } else {
      overlay.classList.remove('is-visible');
    }
  }

  private toggleDebugOverlay(): void {
    const newVisibility = !this.debugOverlayVisible;
    if (newVisibility) {
      this.refreshDebugOverlayState();
    }
    this.setDebugOverlayVisibility(newVisibility);
  }

  private refreshDebugOverlayState(): void {
    if (!this.renderer) {
      this.setDebugOverlayField('wakes', '—');
      this.setDebugOverlayField('glass', '—');
      this.setDebugOverlayField('text', '—');
      this.setDebugOverlayField('blur', '—');
      return;
    }

    this.setDebugOverlayField('wakes', this.renderer.getWakesEnabled() ? 'ON' : 'OFF');
    this.setDebugOverlayField('glass', this.renderer.getGlassEnabled() ? 'ON' : 'OFF');
    this.setDebugOverlayField('text', this.renderer.getTextEnabled() ? 'ON' : 'OFF');
    this.setDebugOverlayField('blur', this.renderer.getBlurMapEnabled() ? 'ON' : 'OFF');
  }

  /**
   * Update debug info display
   */
  private updateDebugInfo(mode: number): void {
    const modeNames = ['Normal', 'UV Coords', 'Wave Height', 'Normals', 'Wake Map'];
    const modeName = modeNames[mode] || 'Unknown';
    this.setDebugOverlayField('mode', `${modeName} (${mode})`);
  }

  /**
   * Update vessel system info display
   */
  private updateVesselInfo(): void {
    if (this.renderer) {
      const wakesEnabled = this.renderer.getWakesEnabled();
      this.setDebugOverlayField('wakes', wakesEnabled ? 'ON' : 'OFF');
    }
  }

  /**
   * Update glass system info display
   */
  private updateGlassInfo(enabled: boolean): void {
    this.setDebugOverlayField('glass', enabled ? 'ON' : 'OFF');
  }

  /**
   * Update text rendering info display
   */
  private updateTextInfo(enabled: boolean): void {
    this.setDebugOverlayField('text', enabled ? 'ON' : 'OFF');
  }

  /**
   * Update blur map info display
   */
  private updateBlurMapInfo(enabled: boolean): void {
    this.setDebugOverlayField('blur', enabled ? 'ON' : 'OFF');
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

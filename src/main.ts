/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';

// Import shaders as strings
import vertexShader from './shaders/ocean.vert';
import fragmentShader from './shaders/ocean.frag';

class OceanApp {
  private renderer: OceanRenderer | null = null;

  async init(): Promise<void> {
    try {
      // Get canvas element
      const canvas = document.getElementById('ocean-canvas') as HTMLCanvasElement;
      if (!canvas) {
        throw new Error('Canvas element not found');
      }

      console.log('Initializing Ocean Renderer...');

      // Create renderer
      this.renderer = new OceanRenderer({
        canvas,
        antialias: true,
        alpha: false
      });

      // Initialize shaders
      await this.renderer.initializeShaders(vertexShader, fragmentShader);

      // Start rendering
      this.renderer.start();

      console.log('Ocean Renderer initialized successfully!');

      // Set up keyboard controls for debugging
      this.setupControls();

    } catch (error) {
      console.error('Failed to initialize Ocean Renderer:', error);
      this.showError(error instanceof Error ? error.message : 'Unknown error');
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
          if (this.renderer) {
            const currentMode = this.renderer.getDebugMode();
            const nextMode = (currentMode + 1) % 4; // 0-3 debug modes
            this.renderer.setDebugMode(nextMode);
            this.updateDebugInfo(nextMode);
          }
          break;
        case '1':
        case '2':
        case '3':
        case '0':
          // Direct debug mode selection
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
    console.log('  0-3 - Select debug mode directly');
    console.log('  Space - Reserved for future controls');
  }

  /**
   * Update debug info display
   */
  private updateDebugInfo(mode: number): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      const modeNames = ['Normal', 'UV Coords', 'Wave Height', 'Normals'];
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
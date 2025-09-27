/**
 * Main application entry point
 */

import { OceanRenderer } from './renderer/OceanRenderer';

// Import shaders as strings
import vertexShader from './shaders/ocean.vert';
import fragmentShader from './shaders/ocean.frag';

class OceanApp {
  public renderer: OceanRenderer | null = null;

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
   * Set up keyboard controls for debugging and wave pattern control
   */
  private setupControls(): void {
    document.addEventListener('keydown', (event) => {
      switch (event.key) {
        case ' ': // Spacebar - cycle through wave presets
          event.preventDefault();
          if (this.renderer) {
            this.cycleWavePresets();
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
        case 'q':
        case 'Q':
          // Cycle wave quality
          if (this.renderer) {
            this.cycleWaveQuality();
          }
          break;
        case 'g':
        case 'G':
          // Toggle Gerstner waves
          if (this.renderer) {
            this.toggleWavePattern('gerstner');
          }
          break;
        case 'p':
        case 'P':
          // Toggle Phillips spectrum
          if (this.renderer) {
            this.toggleWavePattern('phillips');
          }
          break;
        case 'c':
        case 'C':
          // Toggle cellular automaton
          if (this.renderer) {
            this.toggleWavePattern('cellularAutomaton');
          }
          break;
        case 'r':
        case 'R':
          // Reset cellular automaton
          if (this.renderer) {
            this.renderer.resetCellularAutomaton();
            console.log('Cellular automaton reset');
          }
          break;
        case 'ArrowUp':
          // Increase wind speed
          if (this.renderer) {
            this.adjustWindSpeed(2.0);
          }
          break;
        case 'ArrowDown':
          // Decrease wind speed
          if (this.renderer) {
            this.adjustWindSpeed(-2.0);
          }
          break;
        case 'ArrowLeft':
          // Rotate wind direction left
          if (this.renderer) {
            this.adjustWindDirection(-0.2);
          }
          break;
        case 'ArrowRight':
          // Rotate wind direction right
          if (this.renderer) {
            this.adjustWindDirection(0.2);
          }
          break;
      }
    });

    // Add helpful info
    this.updateControlsInfo();
  }

  /**
   * Current wave preset index
   */
  private currentPreset: number = 1; // Start with 'moderate'
  private presets: string[] = ['calm', 'moderate', 'rough', 'chaotic'];

  /**
   * Current quality level
   */
  private currentQuality: number = 1; // Medium quality

  /**
   * Current wind parameters
   */
  private currentWindSpeed: number = 10.0;
  private currentWindDirection: number = 0.0;

  /**
   * Cycle through wave presets
   */
  private cycleWavePresets(): void {
    if (!this.renderer) return;

    this.currentPreset = (this.currentPreset + 1) % this.presets.length;
    const presetName = this.presets[this.currentPreset];
    this.renderer.applyWavePreset(presetName);

    console.log(`Applied wave preset: ${presetName}`);
    this.updatePresetInfo(presetName);
  }

  /**
   * Cycle through wave quality levels
   */
  private cycleWaveQuality(): void {
    if (!this.renderer) return;

    this.currentQuality = (this.currentQuality + 1) % 3; // 0, 1, 2
    this.renderer.setWaveQuality(this.currentQuality);

    const qualityNames = ['Low', 'Medium', 'High'];
    console.log(`Wave quality: ${qualityNames[this.currentQuality]}`);
    this.updateQualityInfo(qualityNames[this.currentQuality]);
  }

  /**
   * Toggle wave pattern on/off
   */
  private toggleWavePattern(patternName: string): void {
    if (!this.renderer) return;

    const waveManager = this.renderer.getWaveSystemManager();
    const currentWeight = waveManager.getPatternWeight(patternName);
    const newWeight = currentWeight > 0 ? 0 : 0.3; // Toggle between 0 and 0.3

    waveManager.setPatternWeight(patternName, newWeight);

    const status = newWeight > 0 ? 'enabled' : 'disabled';
    console.log(`${patternName} waves ${status}`);
    this.updatePatternInfo(patternName, status);
  }

  /**
   * Adjust wind speed
   */
  private adjustWindSpeed(delta: number): void {
    if (!this.renderer) return;

    this.currentWindSpeed = Math.max(0, this.currentWindSpeed + delta);
    this.renderer.setWindParameters(this.currentWindSpeed, this.currentWindDirection);

    console.log(`Wind speed: ${this.currentWindSpeed.toFixed(1)} m/s`);
    this.updateWindInfo();
  }

  /**
   * Adjust wind direction
   */
  private adjustWindDirection(delta: number): void {
    if (!this.renderer) return;

    this.currentWindDirection += delta;
    this.renderer.setWindParameters(this.currentWindSpeed, this.currentWindDirection);

    const degrees = (this.currentWindDirection * 180 / Math.PI) % 360;
    console.log(`Wind direction: ${degrees.toFixed(1)}°`);
    this.updateWindInfo();
  }

  /**
   * Update debug info display
   */
  private updateDebugInfo(mode: number): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      const modeNames = ['Normal', 'UV Coords', 'Wave Height', 'Normals'];
      const modeName = modeNames[mode] || 'Unknown';

      let debugElement = document.getElementById('debug-mode');
      if (!debugElement) {
        debugElement = document.createElement('div');
        debugElement.id = 'debug-mode';
        infoElement.appendChild(debugElement);
      }
      debugElement.innerHTML = `Debug Mode: ${modeName} (${mode})`;
    }
  }

  /**
   * Update controls info display
   */
  private updateControlsInfo(): void {
    console.log('Ocean Wave System Controls:');
    console.log('  SPACE - Cycle wave presets (calm/moderate/rough/chaotic)');
    console.log('  Q - Cycle quality (low/medium/high)');
    console.log('  G - Toggle Gerstner waves');
    console.log('  P - Toggle Phillips spectrum');
    console.log('  C - Toggle cellular automaton');
    console.log('  R - Reset cellular automaton');
    console.log('  Arrow Keys - Control wind (Up/Down: speed, Left/Right: direction)');
    console.log('  F - Toggle fullscreen');
    console.log('  D - Cycle debug modes');
    console.log('  0-3 - Select debug mode directly');
  }

  /**
   * Update preset info display
   */
  updatePresetInfo(presetName: string): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      let presetElement = document.getElementById('wave-preset');
      if (!presetElement) {
        presetElement = document.createElement('div');
        presetElement.id = 'wave-preset';
        infoElement.appendChild(presetElement);
      }
      presetElement.innerHTML = `Wave Preset: ${presetName}`;
    }
  }

  /**
   * Update quality info display
   */
  updateQualityInfo(qualityName: string): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      let qualityElement = document.getElementById('wave-quality');
      if (!qualityElement) {
        qualityElement = document.createElement('div');
        qualityElement.id = 'wave-quality';
        infoElement.appendChild(qualityElement);
      }
      qualityElement.innerHTML = `Quality: ${qualityName}`;
    }
  }

  /**
   * Update pattern info display
   */
  private updatePatternInfo(patternName: string, status: string): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      let patternElement = document.getElementById(`pattern-${patternName}`);
      if (!patternElement) {
        patternElement = document.createElement('div');
        patternElement.id = `pattern-${patternName}`;
        infoElement.appendChild(patternElement);
      }
      const displayName = patternName.charAt(0).toUpperCase() + patternName.slice(1);
      patternElement.innerHTML = `${displayName}: ${status}`;
    }
  }

  /**
   * Update wind info display
   */
  updateWindInfo(): void {
    const infoElement = document.getElementById('info');
    if (infoElement) {
      let windElement = document.getElementById('wind-info');
      if (!windElement) {
        windElement = document.createElement('div');
        windElement.id = 'wind-info';
        infoElement.appendChild(windElement);
      }
      const degrees = (this.currentWindDirection * 180 / Math.PI) % 360;
      windElement.innerHTML = `Wind: ${this.currentWindSpeed.toFixed(1)}m/s @ ${degrees.toFixed(0)}°`;
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

// Initialize with default wave preset and settings
window.addEventListener('load', () => {
  setTimeout(() => {
    if (app.renderer) {
      // Apply initial moderate preset
      app.renderer.applyWavePreset('moderate');

      // Set initial info displays
      app.updatePresetInfo('moderate');
      app.updateQualityInfo('Medium');
      app.updateWindInfo();

      console.log('Ocean Wave System initialized with moderate preset');
      console.log('Press SPACE to cycle through presets, Q for quality, G/P/C for wave patterns');
    }
  }, 100); // Small delay to ensure renderer is ready
});

// Export for potential external use
export default app;
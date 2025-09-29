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
// Try standard import first, then fallback to raw import
import textCompositeVertexShader from './shaders/text-composite.vert';
import textCompositeFragmentShader from './shaders/text-composite.frag';

// Backup raw imports if vite-plugin-glsl fails
import textCompositeVertexShaderRaw from './shaders/text-composite.vert?raw';
import textCompositeFragmentShaderRaw from './shaders/text-composite.frag?raw';

// CRITICAL: Test shader imports and provide fallback
console.log('=== CRITICAL SHADER IMPORT TEST ===');

let finalTextCompositeVertexShader = textCompositeVertexShader;
let finalTextCompositeFragmentShader = textCompositeFragmentShader;

// Test and fallback for vertex shader
if (typeof textCompositeVertexShader === 'undefined' || !textCompositeVertexShader) {
  console.error('CRITICAL: textCompositeVertexShader is UNDEFINED - trying fallback');
  if (typeof textCompositeVertexShaderRaw !== 'undefined' && textCompositeVertexShaderRaw) {
    console.log('✓ Using raw import fallback for vertex shader');
    finalTextCompositeVertexShader = textCompositeVertexShaderRaw;
  } else {
    console.error('✗ Both standard and raw imports failed for vertex shader');
  }
} else {
  console.log('✓ textCompositeVertexShader imported successfully via plugin');
}

// Test and fallback for fragment shader
if (typeof textCompositeFragmentShader === 'undefined' || !textCompositeFragmentShader) {
  console.error('CRITICAL: textCompositeFragmentShader is UNDEFINED - trying fallback');
  if (typeof textCompositeFragmentShaderRaw !== 'undefined' && textCompositeFragmentShaderRaw) {
    console.log('✓ Using raw import fallback for fragment shader');
    finalTextCompositeFragmentShader = textCompositeFragmentShaderRaw;
  } else {
    console.error('✗ Both standard and raw imports failed for fragment shader');
  }
} else {
  console.log('✓ textCompositeFragmentShader imported successfully via plugin');
}

// Log final status
console.log('Final shader status:');
console.log('- Vertex shader length:', finalTextCompositeVertexShader?.length || 0);
console.log('- Fragment shader length:', finalTextCompositeFragmentShader?.length || 0);
console.log('- Both shaders available:', !!(finalTextCompositeVertexShader && finalTextCompositeFragmentShader));

// Log first few characters to verify content
if (finalTextCompositeVertexShader) {
  console.log('- Vertex shader preview:', finalTextCompositeVertexShader.substring(0, 50) + '...');
}
if (finalTextCompositeFragmentShader) {
  console.log('- Fragment shader preview:', finalTextCompositeFragmentShader.substring(0, 50) + '...');
}

// Ultimate fallback: inline shader strings if all imports fail
const INLINE_TEXT_COMPOSITE_VERTEX = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_texcoord;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
out vec2 v_uv;
out vec2 v_screenPos;
void main() {
    v_uv = a_texcoord;
    vec4 worldPos = vec4(a_position, 0.0, 1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
    v_screenPos = gl_Position.xy / gl_Position.w;
}`;

const INLINE_TEXT_COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_screenPos;
uniform sampler2D u_textTexture;
uniform sampler2D u_oceanTexture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_contrastThreshold;
uniform float u_transitionWidth;
uniform int u_debugMode;
out vec4 fragColor;

float getLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 oceanUV = (v_screenPos + 1.0) * 0.5;
    vec4 textSample = texture(u_textTexture, v_uv);
    float textAlpha = textSample.a;

    if (textAlpha < 0.01) {
        discard;
        return;
    }

    vec3 oceanColor = texture(u_oceanTexture, oceanUV).rgb;
    float luminance = getLuminance(oceanColor);

    float transition = smoothstep(
        u_contrastThreshold - u_transitionWidth * 0.5,
        u_contrastThreshold + u_transitionWidth * 0.5,
        luminance
    );

    vec3 darkTextColor = vec3(0.05, 0.05, 0.05);
    vec3 lightTextColor = vec3(0.95, 0.95, 0.95);
    vec3 textColor = mix(lightTextColor, darkTextColor, transition);

    fragColor = vec4(textColor, textAlpha);

    if (fragColor.a < 0.01) {
        discard;
    }
}`;

// Apply ultimate fallback if needed
if (!finalTextCompositeVertexShader || finalTextCompositeVertexShader.length < 50) {
  console.warn('⚠️ Using inline fallback for vertex shader');
  finalTextCompositeVertexShader = INLINE_TEXT_COMPOSITE_VERTEX;
}

if (!finalTextCompositeFragmentShader || finalTextCompositeFragmentShader.length < 50) {
  console.warn('⚠️ Using inline fallback for fragment shader');
  finalTextCompositeFragmentShader = INLINE_TEXT_COMPOSITE_FRAGMENT;
}

console.log('=== END SHADER IMPORT TEST ===');

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
        finalTextCompositeVertexShader,
        finalTextCompositeFragmentShader
      );

      // Start rendering
      this.renderer.start();

      // Connect UI to glass renderer
      this.connectUIToRenderer();

      // Start debug overlay updates
      this.startDebugOverlayUpdates();

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
    console.log('[INIT DEBUG] Starting text system initialization in connectUIToRenderer...');
    const textRenderLayer = this.renderer.getTextRenderLayer();
    console.log('[INIT DEBUG] getTextRenderLayer() returned:', !!textRenderLayer);

    if (textRenderLayer) {
      console.log('[INIT DEBUG] TextRenderLayer is available, enabling text render system...');

      // Check initial state
      const initialState = this.renderer.getTextRenderEnabled();
      console.log('[INIT DEBUG] Initial textRenderEnabled state:', initialState);

      // Enable text render system first
      this.renderer.setTextRenderEnabled(true);

      // Check final state
      const finalState = this.renderer.getTextRenderEnabled();
      console.log('[INIT DEBUG] Final textRenderEnabled state:', finalState);

      if (finalState) {
        console.log('[INIT DEBUG] ✓ Text render system successfully enabled!');

        // Defer text element registration until DOM is ready and panels are visible
        this.deferredTextElementRegistration();

        console.log('Per-pixel adaptive text system initialized successfully!');
      } else {
        console.error('[INIT DEBUG] ✗ Failed to enable text render system despite having TextRenderLayer');
      }
    } else {
      console.error('[INIT DEBUG] ✗ Text render layer not available - initialization failed');
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
   * Deferred text element registration with visibility monitoring
   */
  private deferredTextElementRegistration(): void {
    console.log('[TEXT DEBUG] Setting up deferred text element registration...');

    // Try immediate registration with relaxed checks
    this.registerAllTextElementsForRendering(true);

    // Set up mutation observer to watch for panel visibility changes
    this.setupPanelVisibilityObserver();

    // Set up periodic re-registration to catch elements that become visible later
    setInterval(() => {
      console.log('[TEXT DEBUG] Periodic re-registration check...');
      this.registerAllTextElementsForRendering(true);
    }, 5000); // Check every 5 seconds
  }

  /**
   * Set up mutation observer to watch for panel visibility changes
   */
  private setupPanelVisibilityObserver(): void {
    const targetPanels = ['landing-panel', 'app-panel', 'portfolio-panel', 'resume-panel'];

    const observer = new MutationObserver((mutations) => {
      let shouldReregister = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as HTMLElement;
          if (targetPanels.includes(target.id)) {
            console.log(`[TEXT DEBUG] Panel visibility changed: ${target.id}`);
            shouldReregister = true;
          }
        }
      });

      if (shouldReregister) {
        console.log('[TEXT DEBUG] Re-registering text elements due to panel visibility change...');
        this.registerAllTextElementsForRendering(true);
      }
    });

    // Observe all panels for class changes (hidden/visible)
    targetPanels.forEach(panelId => {
      const panel = document.getElementById(panelId);
      if (panel) {
        observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
        console.log(`[TEXT DEBUG] Set up visibility observer for panel: ${panelId}`);
      }
    });
  }

  /**
   * Register all text elements for per-pixel adaptive rendering
   */
  private registerAllTextElementsForRendering(relaxedVisibility = false): void {
    if (!this.renderer) {
      console.error('[TEXT DEBUG] No renderer available for text registration');
      return;
    }

    console.log('[TEXT DEBUG] Starting text element registration...');

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

    let totalRegistered = 0;
    let totalFound = 0;

    textElementConfigs.forEach(config => {
      const elements = document.querySelectorAll(config.selector);
      console.log(`[TEXT DEBUG] Config "${config.id}" - Found ${elements.length} elements with selector "${config.selector}"`);
      totalFound += elements.length;

      elements.forEach((element, index) => {
        if (element instanceof HTMLElement) {
          const uniqueId = elements.length > 1 ? `${config.id}-${index}` : config.id;

          // Get element visibility info for debugging
          const computedStyle = window.getComputedStyle(element);
          const visibility = {
            offsetParent: element.offsetParent !== null,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            display: computedStyle.display,
            bounds: element.getBoundingClientRect()
          };

          const strictVisibility = element.offsetParent !== null &&
                                  !element.classList.contains('hidden') &&
                                  computedStyle.visibility !== 'hidden' &&
                                  computedStyle.opacity !== '0';

          const relaxedVisibilityCheck = !element.classList.contains('hidden') &&
                                        computedStyle.visibility !== 'hidden' &&
                                        computedStyle.display !== 'none';

          const shouldRegister = relaxedVisibility ? relaxedVisibilityCheck : strictVisibility;

          console.log(`[TEXT DEBUG] Element "${uniqueId}":`, {
            selector: config.selector,
            textContent: element.textContent?.slice(0, 50) + '...',
            visibility: visibility,
            strictVisibility: strictVisibility,
            relaxedVisibilityCheck: relaxedVisibilityCheck,
            shouldRegister: shouldRegister,
            relaxedMode: relaxedVisibility
          });

          // Start with HTML text visible as fallback
          element.classList.add('webgl-text-fallback');

          // Only register if element should be registered and isn't already registered
          if (shouldRegister) {
            // Check if already registered to avoid duplicates
            const isAlreadyRegistered = element.hasAttribute('data-text-registered');

            if (!isAlreadyRegistered) {
              // Register with text render layer
              this.renderer!.registerTextForRendering(uniqueId, element);
              element.setAttribute('data-text-registered', 'true');
              totalRegistered++;
              console.log(`[TEXT DEBUG] ✓ Registered text element: ${uniqueId}`);
            } else {
              console.log(`[TEXT DEBUG] ⚠ Element already registered: ${uniqueId}`);
            }
          } else {
            console.log(`[TEXT DEBUG] ✗ Skipping element (not visible): ${uniqueId}`);
          }
        } else {
          console.warn(`[TEXT DEBUG] ✗ Element not HTMLElement:`, element);
        }
      });
    });

    console.log(`[TEXT DEBUG] Registration complete: ${totalRegistered}/${totalFound} elements registered`);
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
          console.log('[TEXT DEBUG] R key pressed - cycling debug modes');
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            const textRenderLayer = this.renderer.getTextRenderLayer();
            if (textRenderLayer) {
              console.log('[TEXT DEBUG] Text render layer available, cycling debug mode...');
              // Cycle through debug modes (state is tracked in renderer)
              this.renderer.setTextRenderDebugMode(true);
              // Update debug overlay immediately
              this.updateTextDebugOverlay();
            } else {
              console.log('[TEXT DEBUG] No text render layer available');
            }
          } else {
            console.log('[TEXT DEBUG] No renderer available');
          }
          break;
        case 'u':
        case 'U':
          // Force update text elements
          console.log('[TEXT DEBUG] U key pressed - force updating text elements');
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            this.renderer.forceUpdateTextElements();
            this.updateTextDebugOverlay();
          }
          break;
        case 'e':
        case 'E':
          // Force all text elements visible
          console.log('[TEXT DEBUG] E key pressed - forcing all text elements visible');
          event.preventDefault();
          event.stopPropagation();
          if (this.renderer) {
            this.renderer.forceAllTextElementsVisible();
            this.updateTextDebugOverlay();
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
    console.log('  U - Force update text element visibility');
    console.log('  E - Force all text elements visible (debug)');
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
   * Start debug overlay updates
   */
  private startDebugOverlayUpdates(): void {
    // Update debug overlay every second
    setInterval(() => {
      this.updateTextDebugOverlay();
    }, 1000);

    // Initial update
    this.updateTextDebugOverlay();
  }

  /**
   * Update text debug overlay with current status
   */
  private updateTextDebugOverlay(): void {
    if (!this.renderer) return;

    const statusEl = document.getElementById('text-status');
    const elementsEl = document.getElementById('text-elements');
    const debugModeEl = document.getElementById('text-debug-mode');
    const renderTimeEl = document.getElementById('text-render-time');
    const lastUpdateEl = document.getElementById('text-last-update');

    if (statusEl && elementsEl && debugModeEl && renderTimeEl && lastUpdateEl) {
      const textRenderLayer = this.renderer.getTextRenderLayer();
      const isEnabled = this.renderer.getTextRenderEnabled();

      if (textRenderLayer && isEnabled) {
        const metrics = this.renderer.getTextRenderMetrics();

        statusEl.textContent = `Status: ${isEnabled ? 'Enabled' : 'Disabled'}`;
        statusEl.style.color = isEnabled ? '#00ff00' : '#ff0000';

        if (metrics) {
          elementsEl.textContent = `Elements: ${metrics.elementCount} registered`;
          renderTimeEl.textContent = `Render Time: ${metrics.lastRenderTime.toFixed(2)}ms`;

          // Color code render time (red if 0, green if > 0)
          if (metrics.lastRenderTime > 0) {
            renderTimeEl.style.color = '#00ff00';
          } else {
            renderTimeEl.style.color = '#ff0000';
          }
        } else {
          elementsEl.textContent = 'Elements: No metrics';
          renderTimeEl.textContent = 'Render Time: No data';
        }

        debugModeEl.textContent = `Debug Mode: ${['Off', 'Text', 'Ocean', 'Analysis'][this.renderer.getTextDebugMode?.()] || 'Unknown'}`;
        lastUpdateEl.textContent = `Last Update: ${new Date().toLocaleTimeString()}`;
      } else {
        statusEl.textContent = 'Status: Not Available';
        statusEl.style.color = '#ff0000';
        elementsEl.textContent = 'Elements: N/A';
        debugModeEl.textContent = 'Debug Mode: N/A';
        renderTimeEl.textContent = 'Render Time: N/A';
        lastUpdateEl.textContent = 'Last Update: N/A';
      }
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
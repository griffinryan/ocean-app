/**
 * Panel Tracker for Liquid Glass Effect
 * Bridges CSS panel positions to WebGL coordinates for real-time distortion
 */

export interface PanelBounds {
  id: string;
  bounds: [number, number, number, number]; // [minX, minY, maxX, maxY] in normalized coordinates
  center: [number, number]; // Center point in normalized coordinates
  size: [number, number]; // Width, height in normalized coordinates
  distortionStrength: number; // Distortion intensity (0.0 - 1.0)
  state: number; // 0 = hidden, 0-1 = transitioning, 1 = visible
  element: HTMLElement; // Reference to the DOM element
}

export class PanelTracker {
  private panels: Map<string, PanelBounds> = new Map();
  private resizeObserver!: ResizeObserver;
  private mutationObserver!: MutationObserver;
  private canvas: HTMLCanvasElement;

  // Maximum supported panels
  private readonly MAX_PANELS = 8;

  // Update callbacks
  private updateCallbacks: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Set up observers for real-time tracking
    this.setupResizeObserver();
    this.setupMutationObserver();

    // Initial scan for glass panels
    this.scanForPanels();

    console.log('PanelTracker initialized');
    console.log('Canvas size:', this.canvas.width, 'x', this.canvas.height);
    this.logPanelData();
  }

  /**
   * Set up ResizeObserver to track panel position changes
   */
  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      let needsUpdate = false;

      for (const entry of entries) {
        const element = entry.target as HTMLElement;

        // Check if this is a tracked panel
        for (const [id, panel] of this.panels) {
          if (panel.element === element) {
            this.updatePanelBounds(id, element);
            needsUpdate = true;
            break;
          }
        }

        // Also update if canvas resizes
        if (element === this.canvas) {
          this.updateAllPanelBounds();
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        this.notifyUpdates();
      }
    });

    // Observe the canvas for resize events
    this.resizeObserver.observe(this.canvas);
  }

  /**
   * Set up MutationObserver to track DOM changes
   */
  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let needsUpdate = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const element = mutation.target as HTMLElement;

          // Check for class or style changes on tracked panels
          if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
            for (const [id, panel] of this.panels) {
              if (panel.element === element) {
                this.updatePanelState(id, element);
                this.updatePanelBounds(id, element);
                needsUpdate = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'childList') {
          // Rescan for new panels when DOM structure changes
          this.scanForPanels();
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        this.notifyUpdates();
      }
    });

    // Observe the entire document for changes
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  /**
   * Scan the DOM for glass panels
   */
  private scanForPanels(): void {
    const glassPanels = document.querySelectorAll('.glass-panel');

    // Remove panels that no longer exist
    for (const [id, panel] of this.panels) {
      if (!document.body.contains(panel.element)) {
        this.removePanel(id);
      }
    }

    // Add new panels
    glassPanels.forEach((element, index) => {
      if (index >= this.MAX_PANELS) return; // Respect panel limit

      const htmlElement = element as HTMLElement;
      const id = htmlElement.id || `panel-${index}`;

      if (!this.panels.has(id)) {
        this.addPanel(id, htmlElement);
      }
    });
  }

  /**
   * Add a panel to tracking
   */
  public addPanel(id: string, element: HTMLElement): void {
    if (this.panels.size >= this.MAX_PANELS) {
      console.warn(`Maximum panels (${this.MAX_PANELS}) reached. Cannot add panel: ${id}`);
      return;
    }

    const panel: PanelBounds = {
      id,
      bounds: [0, 0, 0, 0],
      center: [0, 0],
      size: [0, 0],
      distortionStrength: this.getDistortionStrength(element),
      state: this.getPanelState(element),
      element
    };

    this.panels.set(id, panel);
    this.updatePanelBounds(id, element);

    // Start observing this element
    this.resizeObserver.observe(element);

    console.log(`Added panel for tracking: ${id}`);
    this.notifyUpdates();
  }

  /**
   * Remove a panel from tracking
   */
  public removePanel(id: string): void {
    const panel = this.panels.get(id);
    if (panel) {
      this.resizeObserver.unobserve(panel.element);
      this.panels.delete(id);
      console.log(`Removed panel from tracking: ${id}`);
      this.notifyUpdates();
    }
  }

  /**
   * Update panel bounds in normalized coordinates
   */
  private updatePanelBounds(id: string, element: HTMLElement): void {
    const panel = this.panels.get(id);
    if (!panel) return;

    const rect = element.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();

    // Convert to UV coordinates [0, 1] - (0,0) is top-left, (1,1) is bottom-right
    const normalizedMinX = (rect.left - canvasRect.left) / canvasRect.width;
    const normalizedMaxX = (rect.right - canvasRect.left) / canvasRect.width;
    const normalizedMinY = (rect.top - canvasRect.top) / canvasRect.height;
    const normalizedMaxY = (rect.bottom - canvasRect.top) / canvasRect.height;

    panel.bounds = [normalizedMinX, normalizedMinY, normalizedMaxX, normalizedMaxY];
    panel.center = [
      (normalizedMinX + normalizedMaxX) * 0.5,
      (normalizedMinY + normalizedMaxY) * 0.5
    ];
    panel.size = [
      normalizedMaxX - normalizedMinX,
      normalizedMaxY - normalizedMinY
    ];
  }

  /**
   * Update all panel bounds
   */
  private updateAllPanelBounds(): void {
    for (const [id, panel] of this.panels) {
      this.updatePanelBounds(id, panel.element);
    }
  }

  /**
   * Update panel state based on CSS classes
   */
  private updatePanelState(id: string, element: HTMLElement): void {
    const panel = this.panels.get(id);
    if (!panel) return;

    panel.state = this.getPanelState(element);
    panel.distortionStrength = this.getDistortionStrength(element);
  }

  /**
   * Get panel visibility state from CSS classes
   */
  private getPanelState(element: HTMLElement): number {
    if (element.classList.contains('hidden')) {
      return 0.0; // Hidden
    } else if (element.classList.contains('fade-in') || element.classList.contains('fade-out')) {
      return 0.5; // Transitioning
    } else {
      return 1.0; // Visible
    }
  }

  /**
   * Get distortion strength based on panel type
   */
  private getDistortionStrength(element: HTMLElement): number {
    if (element.classList.contains('landing-panel')) {
      return 0.8; // Strong distortion for landing panel
    } else if (element.classList.contains('app-panel')) {
      return 0.6; // Moderate distortion for app panel
    } else {
      return 0.4; // Default distortion
    }
  }

  /**
   * Log current panel tracking data for debugging
   */
  public logPanelData(): void {
    console.log('=== Panel Tracking Debug ===');
    console.log('Total panels tracked:', this.panels.size);

    if (this.panels.size === 0) {
      console.log('No panels found! Looking for elements with class "glass-panel"');
      const glassPanels = document.querySelectorAll('.glass-panel');
      console.log('Found glass panel elements:', glassPanels.length);
      glassPanels.forEach((el, i) => {
        const htmlEl = el as HTMLElement;
        console.log(`  Panel ${i}:`, htmlEl.id || 'no-id', htmlEl.classList.toString());
      });
      return;
    }

    this.panels.forEach((panel, id) => {
      console.log(`Panel ${id}:`, {
        state: panel.state,
        bounds: panel.bounds,
        center: panel.center,
        size: panel.size,
        distortion: panel.distortionStrength,
        classes: panel.element.classList.toString()
      });
    });

    const data = this.getPanelData();
    console.log('Uniform data:', {
      count: data.count,
      bounds: data.bounds.slice(0, data.count * 4),
      centers: data.centers.slice(0, data.count * 2),
      states: data.states.slice(0, data.count)
    });
    console.log('=========================');
  }

  /**
   * Get panel data for WebGL uniforms
   */
  public getPanelData(): {
    count: number;
    bounds: number[];
    centers: number[];
    distortionStrengths: number[];
    states: number[];
  } {
    const count = Math.min(this.panels.size, this.MAX_PANELS);
    const bounds: number[] = new Array(this.MAX_PANELS * 4).fill(0);
    const centers: number[] = new Array(this.MAX_PANELS * 2).fill(0);
    const distortionStrengths: number[] = new Array(this.MAX_PANELS).fill(0);
    const states: number[] = new Array(this.MAX_PANELS).fill(0);

    let index = 0;
    for (const panel of this.panels.values()) {
      if (index >= this.MAX_PANELS) break;

      // Pack bounds [minX, minY, maxX, maxY]
      bounds[index * 4 + 0] = panel.bounds[0];
      bounds[index * 4 + 1] = panel.bounds[1];
      bounds[index * 4 + 2] = panel.bounds[2];
      bounds[index * 4 + 3] = panel.bounds[3];

      // Pack centers [x, y]
      centers[index * 2 + 0] = panel.center[0];
      centers[index * 2 + 1] = panel.center[1];

      // Pack properties
      distortionStrengths[index] = panel.distortionStrength;
      states[index] = panel.state;

      index++;
    }

    return {
      count,
      bounds,
      centers,
      distortionStrengths,
      states
    };
  }

  /**
   * Register a callback for panel updates
   */
  public onUpdate(callback: () => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Notify all update callbacks
   */
  private notifyUpdates(): void {
    console.log('Panel updates triggered - count:', this.panels.size);
    this.updateCallbacks.forEach(callback => callback());
  }

  /**
   * Force update all panels
   */
  public forceUpdate(): void {
    this.scanForPanels();
    this.updateAllPanelBounds();
    this.notifyUpdates();
  }

  /**
   * Get panel count
   */
  public getPanelCount(): number {
    return this.panels.size;
  }

  /**
   * Check if a specific panel is tracked
   */
  public hasPanel(id: string): boolean {
    return this.panels.has(id);
  }

  /**
   * Get panel bounds by ID
   */
  public getPanelBounds(id: string): PanelBounds | null {
    return this.panels.get(id) || null;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.panels.clear();
    this.updateCallbacks = [];
  }
}
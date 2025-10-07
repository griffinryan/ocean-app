/**
 * PanelLayoutTracker centralizes DOM → WebGL coordinate mapping for glass/text systems.
 * It measures target panels once per frame (when marked dirty) and exposes the results
 * as normalized positions/sizes ready for shader consumption.
 */

export interface PanelLayout {
  position: [number, number];
  size: [number, number];
}

export interface PanelLayoutSnapshot {
  version: number;
  count: number;
  positions: Float32Array;
  sizes: Float32Array;
  layouts: Map<string, PanelLayout>;
}

export class PanelLayoutTracker {
  private readonly panelIds: string[] = [
    'landing-panel',
    'app-bio-panel',
    'navbar',
    'portfolio-lakehouse-panel',
    'portfolio-encryption-panel',
    'portfolio-dotereditor-panel',
    'portfolio-dreamrequiem-panel',
    'portfolio-greenlightgo-panel',
    'resume-playember-panel',
    'resume-meta-panel',
    'resume-outlier-panel',
    'resume-uwtutor-panel',
    'resume-uwedu-panel'
  ];

  private dirty = true;
  private version = 0;
  private readonly layouts = new Map<string, PanelLayout>();
  private readonly positions = new Float32Array(this.panelIds.length * 2);
  private readonly sizes = new Float32Array(this.panelIds.length * 2);
  private count = 0;

  private cachedSnapshot: PanelLayoutSnapshot | null = null;

  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Returns the latest snapshot, updating measurements if dirty.
   * Callers should provide the canvas element so we can normalize coordinates correctly.
   */
  getSnapshot(canvas: HTMLCanvasElement): PanelLayoutSnapshot | null {
    if (!this.dirty && this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) {
      return this.cachedSnapshot; // Avoid invalid measurements
    }

    this.layouts.clear();
    this.count = 0;

    for (let i = 0; i < this.panelIds.length; i++) {
      const elementId = this.panelIds[i];
      const element = document.getElementById(elementId);
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }

      const layout = this.computeLayout(rect, canvasRect);
      this.layouts.set(elementId, layout);

      this.positions[this.count * 2] = layout.position[0];
      this.positions[this.count * 2 + 1] = layout.position[1];
      this.sizes[this.count * 2] = layout.size[0];
      this.sizes[this.count * 2 + 1] = layout.size[1];
      this.count += 1;
    }

    this.dirty = false;
    this.version += 1;

    this.cachedSnapshot = {
      version: this.version,
      count: this.count,
      positions: this.positions.subarray(0, this.count * 2),
      sizes: this.sizes.subarray(0, this.count * 2),
      layouts: new Map(this.layouts)
    };

    return this.cachedSnapshot;
  }

  private computeLayout(elementRect: DOMRect, canvasRect: DOMRect): PanelLayout {
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    const glX = centerX * 2.0 - 1.0;
    const glY = (1.0 - centerY) * 2.0 - 1.0;

    const width = (elementRect.width / canvasRect.width) * 2.0;
    const height = (elementRect.height / canvasRect.height) * 2.0;

    return {
      position: [glX, glY],
      size: [width, height]
    };
  }
}

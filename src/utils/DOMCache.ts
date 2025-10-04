/**
 * DOMCache: Performance optimization for panel position/size queries
 *
 * Caches getBoundingClientRect() results to avoid expensive DOM queries every frame.
 * Updates only on resize events or manual invalidation (e.g., during transitions).
 */

import { globalArrayPool } from './ArrayPool';

export interface PanelCacheEntry {
  position: [number, number]; // WebGL NDC coordinates [-1, 1]
  size: [number, number];     // WebGL NDC dimensions
  screenRect: DOMRect;        // Original screen rect for debugging
  visible: boolean;           // Visibility state
  lastUpdate: number;         // Timestamp of last update
}

export class DOMCache {
  private cache: Map<string, PanelCacheEntry> = new Map();
  private canvas: HTMLCanvasElement;
  private canvasRect: DOMRect | null = null;
  private isDirty: boolean = true;

  // Cached arrays for shader uniforms (eliminates per-frame allocations)
  private cachedPositionsArray: Float32Array | null = null;
  private cachedSizesArray: Float32Array | null = null;
  private cachedArrayMaxCount: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupResizeObserver();
  }

  /**
   * Setup resize observer to invalidate cache when canvas resizes
   */
  private setupResizeObserver(): void {
    const resizeObserver = new ResizeObserver(() => {
      this.invalidate();
    });

    resizeObserver.observe(this.canvas);
  }

  /**
   * Invalidate cache - forces recalculation on next access
   */
  public invalidate(): void {
    this.isDirty = true;
    this.canvasRect = null;
  }

  /**
   * Update canvas rect cache
   */
  private updateCanvasRect(): void {
    this.canvasRect = this.canvas.getBoundingClientRect();
  }

  /**
   * Convert HTML element rect to normalized WebGL coordinates
   */
  private htmlRectToNormalized(elementRect: DOMRect, canvasRect: DOMRect): { position: [number, number], size: [number, number] } {
    if (elementRect.width === 0 || elementRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      return { position: [0, 0], size: [0, 0] };
    }

    // Calculate center position in normalized coordinates (0 to 1)
    const centerX = ((elementRect.left + elementRect.width / 2) - canvasRect.left) / canvasRect.width;
    const centerY = ((elementRect.top + elementRect.height / 2) - canvasRect.top) / canvasRect.height;

    // Convert to WebGL coordinates (-1 to 1, with Y flipped)
    const glX = centerX * 2.0 - 1.0;
    const glY = (1.0 - centerY) * 2.0 - 1.0;

    // Calculate size in normalized coordinates
    const width = (elementRect.width / canvasRect.width) * 2.0;
    const height = (elementRect.height / canvasRect.height) * 2.0;

    return {
      position: [glX, glY],
      size: [width, height]
    };
  }

  /**
   * Update a single panel's cache entry
   */
  public updatePanel(panelId: string): void {
    if (!this.canvasRect) {
      this.updateCanvasRect();
    }

    if (!this.canvasRect || this.canvasRect.width === 0 || this.canvasRect.height === 0) {
      return;
    }

    // Construct element ID: navbar stays as-is, everything else gets -panel suffix
    const elementId = (panelId === 'navbar') ? 'navbar' : `${panelId}-panel`;
    const element = document.getElementById(elementId);

    if (!element) {
      // Remove from cache if element doesn't exist
      this.cache.delete(panelId);
      return;
    }

    // Check visibility
    const isHidden = element.classList.contains('hidden');
    const parent = element.parentElement?.parentElement;
    const parentHidden = parent?.classList.contains('hidden') ?? false;
    const visible = !isHidden && !parentHidden;

    if (!visible) {
      // Update visibility but don't recalculate position
      const existing = this.cache.get(panelId);
      if (existing) {
        existing.visible = false;
      }
      return;
    }

    // Get element rect
    const elementRect = element.getBoundingClientRect();

    if (elementRect.width === 0 || elementRect.height === 0) {
      // Element has no size, mark as invisible
      const existing = this.cache.get(panelId);
      if (existing) {
        existing.visible = false;
      }
      return;
    }

    // Convert to WebGL coordinates
    const normalized = this.htmlRectToNormalized(elementRect, this.canvasRect);

    // Update cache entry
    this.cache.set(panelId, {
      position: normalized.position,
      size: normalized.size,
      screenRect: elementRect,
      visible: true,
      lastUpdate: performance.now()
    });
  }

  /**
   * Update all panels in the provided list
   */
  public updatePanels(panelIds: string[]): void {
    if (!this.canvasRect || this.isDirty) {
      this.updateCanvasRect();
      this.isDirty = false;
    }

    for (const panelId of panelIds) {
      this.updatePanel(panelId);
    }
  }

  /**
   * Get cached panel data (returns null if not in cache or invisible)
   */
  public getPanel(panelId: string): PanelCacheEntry | null {
    const entry = this.cache.get(panelId);
    if (!entry || !entry.visible) {
      return null;
    }
    return entry;
  }

  /**
   * Get all visible panels with their data
   */
  public getVisiblePanels(): Map<string, PanelCacheEntry> {
    const visible = new Map<string, PanelCacheEntry>();
    for (const [id, entry] of this.cache) {
      if (entry.visible) {
        visible.set(id, entry);
      }
    }
    return visible;
  }

  /**
   * Get count of visible panels
   */
  public getVisiblePanelCount(): number {
    let count = 0;
    for (const entry of this.cache.values()) {
      if (entry.visible) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get panel positions as Float32Array for shader uniforms (OPTIMIZED - reuses arrays)
   */
  public getPanelPositionsArray(maxCount: number): Float32Array {
    // Reallocate arrays if maxCount changed
    if (this.cachedArrayMaxCount !== maxCount || !this.cachedPositionsArray) {
      // Release old arrays back to pool
      if (this.cachedPositionsArray) {
        globalArrayPool.releaseAll([
          this.cachedPositionsArray,
          this.cachedSizesArray!
        ]);
      }

      // Acquire new arrays from pool
      this.cachedPositionsArray = globalArrayPool.acquire(maxCount * 2);
      this.cachedSizesArray = globalArrayPool.acquire(maxCount * 2);
      this.cachedArrayMaxCount = maxCount;
    }

    // Reuse cached array (zero-allocation)
    const positions = this.cachedPositionsArray;
    let index = 0;

    for (const entry of this.cache.values()) {
      if (entry.visible && index < maxCount) {
        positions[index * 2] = entry.position[0];
        positions[index * 2 + 1] = entry.position[1];
        index++;
      }
    }

    return positions;
  }

  /**
   * Get panel sizes as Float32Array for shader uniforms (OPTIMIZED - reuses arrays)
   */
  public getPanelSizesArray(maxCount: number): Float32Array {
    // Arrays are allocated together in getPanelPositionsArray
    if (!this.cachedSizesArray) {
      throw new Error('DOMCache: getPanelPositionsArray must be called before getPanelSizesArray');
    }

    // Reuse cached array (zero-allocation)
    const sizes = this.cachedSizesArray;
    let index = 0;

    for (const entry of this.cache.values()) {
      if (entry.visible && index < maxCount) {
        sizes[index * 2] = entry.size[0];
        sizes[index * 2 + 1] = entry.size[1];
        index++;
      }
    }

    return sizes;
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.cache.clear();
    this.canvasRect = null;
    this.isDirty = true;

    // Release cached arrays back to pool
    if (this.cachedPositionsArray) {
      globalArrayPool.releaseAll([
        this.cachedPositionsArray,
        this.cachedSizesArray!
      ]);

      this.cachedPositionsArray = null;
      this.cachedSizesArray = null;
      this.cachedArrayMaxCount = 0;
    }
  }

  /**
   * Get cache statistics for debugging
   */
  public getStats(): { totalPanels: number; visiblePanels: number; lastUpdate: number } {
    let lastUpdate = 0;
    for (const entry of this.cache.values()) {
      lastUpdate = Math.max(lastUpdate, entry.lastUpdate);
    }

    return {
      totalPanels: this.cache.size,
      visiblePanels: this.getVisiblePanelCount(),
      lastUpdate
    };
  }
}

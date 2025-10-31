/**
 * Scroll Tracker for Glass Panel Position Updates
 * Ensures glass panels perfectly track CSS panels during scroll with RAF-based continuous updates
 */

import type { GlassRenderer } from '../renderer/GlassRenderer';
import type { TextRenderer } from '../renderer/TextRenderer';

export interface ScrollTrackerConfig {
  cooldownMs: number;           // Time after last scroll to stop tracking (default: 100ms)
  throttleMs: number;           // Minimum time between position updates (default: 0 = every frame)
  enableTextUpdates: boolean;   // Update text renderer positions during scroll (default: true)
}

const DEFAULT_CONFIG: ScrollTrackerConfig = {
  cooldownMs: 100,
  throttleMs: 0,
  enableTextUpdates: true
};

/**
 * Scroll Tracker
 * Manages continuous RAF-based position updates during scroll
 */
export class ScrollTracker {
  private config: ScrollTrackerConfig;
  private glassRenderer: GlassRenderer | null = null;
  private textRenderer: TextRenderer | null = null;

  // Scroll state
  private isScrolling: boolean = false;
  private scrollContainers: Set<HTMLElement> = new Set();

  // RAF tracking
  private rafId: number | null = null;
  private lastUpdateTime: number = 0;

  // Cooldown tracking
  private cooldownTimeouts: Map<HTMLElement, number> = new Map();

  // Event listeners (for cleanup)
  private scrollListeners: Map<HTMLElement, (e: Event) => void> = new Map();

  // Transition state coordination
  private isTransitioning: boolean = false;

  constructor(config?: Partial<ScrollTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setThrottle(throttleMs: number): void {
    const clamped = Math.max(0, Math.round(throttleMs));
    this.config.throttleMs = clamped;
  }

  /**
   * Set glass renderer reference
   */
  setGlassRenderer(renderer: GlassRenderer | null): void {
    this.glassRenderer = renderer;
  }

  /**
   * Set text renderer reference
   */
  setTextRenderer(renderer: TextRenderer | null): void {
    this.textRenderer = renderer;
  }

  /**
   * Track a scroll container element
   */
  trackContainer(container: HTMLElement): void {
    if (this.scrollContainers.has(container)) {
      return; // Already tracking
    }

    this.scrollContainers.add(container);

    // Create scroll event listener
    const scrollListener = (e: Event) => {
      this.onScroll(e.target as HTMLElement);
    };

    // Add listener with passive flag for performance
    container.addEventListener('scroll', scrollListener, { passive: true });

    // Store listener for cleanup
    this.scrollListeners.set(container, scrollListener);

    console.debug(`ScrollTracker: Now tracking scroll container ${container.id || 'unnamed'}`);
  }

  /**
   * Stop tracking a scroll container
   */
  untrackContainer(container: HTMLElement): void {
    if (!this.scrollContainers.has(container)) {
      return;
    }

    this.scrollContainers.delete(container);

    // Remove event listener
    const listener = this.scrollListeners.get(container);
    if (listener) {
      container.removeEventListener('scroll', listener);
      this.scrollListeners.delete(container);
    }

    // Clear any pending cooldown
    const timeout = this.cooldownTimeouts.get(container);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.cooldownTimeouts.delete(container);
    }

    console.debug(`ScrollTracker: Stopped tracking scroll container ${container.id || 'unnamed'}`);
  }

  /**
   * Handle scroll event
   */
  private onScroll(container: HTMLElement): void {
    // Don't update during CSS transitions (position freeze mode)
    if (this.isTransitioning) {
      console.debug('ScrollTracker: Ignoring scroll during transition');
      return;
    }

    // Start continuous tracking if not already active
    if (!this.isScrolling) {
      this.startScrollTracking();
    }

    // Reset cooldown timer for this container
    const existingTimeout = this.cooldownTimeouts.get(container);
    if (existingTimeout !== undefined) {
      clearTimeout(existingTimeout);
    }

    // Set new cooldown
    const timeoutId = window.setTimeout(() => {
      this.cooldownTimeouts.delete(container);
      this.checkStopTracking();
    }, this.config.cooldownMs);

    this.cooldownTimeouts.set(container, timeoutId);
  }

  /**
   * Start continuous scroll tracking (RAF loop)
   */
  private startScrollTracking(): void {
    if (this.isScrolling) {
      return; // Already tracking
    }

    this.isScrolling = true;
    this.lastUpdateTime = performance.now();

    console.debug('ScrollTracker: Started continuous tracking');

    // Start RAF loop
    this.updateLoop();
  }

  /**
   * Stop continuous scroll tracking
   */
  private stopScrollTracking(): void {
    if (!this.isScrolling) {
      return;
    }

    this.isScrolling = false;

    // Cancel RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    console.debug('ScrollTracker: Stopped continuous tracking');
  }

  /**
   * Check if we should stop tracking (no active cooldowns)
   */
  private checkStopTracking(): void {
    if (this.cooldownTimeouts.size === 0) {
      this.stopScrollTracking();
    }
  }

  /**
   * Continuous update loop (RAF)
   */
  private updateLoop = (): void => {
    if (!this.isScrolling) {
      return;
    }

    const currentTime = performance.now();
    const elapsed = currentTime - this.lastUpdateTime;

    // Check throttle
    if (elapsed >= this.config.throttleMs) {
      this.updatePositions();
      this.lastUpdateTime = currentTime;
    }

    // Schedule next frame
    this.rafId = requestAnimationFrame(this.updateLoop);
  };

  /**
   * Update glass and text renderer positions
   */
  private updatePositions(): void {
    // Update glass panel positions
    if (this.glassRenderer) {
      this.glassRenderer.markPositionsDirty();
    }

    // Update text renderer positions (if enabled)
    if (this.config.enableTextUpdates && this.textRenderer) {
      this.textRenderer.forceTextureUpdate();
      this.textRenderer.markSceneDirty();
    }
  }

  /**
   * Notify tracker that CSS transition started
   * Pauses scroll tracking to avoid conflicts with transition freeze mode
   */
  notifyTransitionStart(): void {
    this.isTransitioning = true;

    // Stop scroll tracking during transition
    if (this.isScrolling) {
      this.stopScrollTracking();
    }

    console.debug('ScrollTracker: Transition started, scroll tracking paused');
  }

  /**
   * Notify tracker that CSS transition ended
   * Resumes scroll tracking if needed
   */
  notifyTransitionEnd(): void {
    this.isTransitioning = false;
    console.debug('ScrollTracker: Transition ended, scroll tracking resumed');
  }

  /**
   * Force immediate position update (useful after layout changes)
   */
  forceUpdate(): void {
    this.updatePositions();
  }

  /**
   * Get tracking state
   */
  isTracking(): boolean {
    return this.isScrolling;
  }

  /**
   * Get number of tracked containers
   */
  getTrackedContainerCount(): number {
    return this.scrollContainers.size;
  }

  /**
   * Dispose scroll tracker and clean up resources
   */
  dispose(): void {
    // Stop tracking
    this.stopScrollTracking();

    // Untrack all containers
    const containers = Array.from(this.scrollContainers);
    containers.forEach(container => this.untrackContainer(container));

    // Clear all cooldowns
    this.cooldownTimeouts.forEach(timeout => clearTimeout(timeout));
    this.cooldownTimeouts.clear();

    console.log('ScrollTracker: Disposed');
  }
}

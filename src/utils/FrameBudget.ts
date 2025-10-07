/**
 * Frame Budget System for Locked 60 FPS Performance
 * Ensures frame time stays under 16.67ms with adaptive work scheduling
 */

export enum WorkPriority {
  CRITICAL = 0,    // Ocean rendering (never skip)
  HIGH = 1,        // Glass rendering (skip only if desperate)
  MEDIUM = 2,      // Text rendering (skip if tight)
  LOW = 3,         // Blur maps, effects (skip aggressively)
  OPTIONAL = 4     // Debug visualizations (skip first)
}

export interface FrameBudgetConfig {
  targetFps: number;              // Target framerate (default: 60)
  budgetMs: number;               // Frame time budget in ms (default: 16.67)
  safetyMarginMs: number;         // Safety margin for buffer (default: 2)
  temporalWindow: number;         // Frames to amortize work over (default: 3)
  adaptiveThreshold: number;      // Consecutive drops before degradation (default: 3)
}

const DEFAULT_CONFIG: FrameBudgetConfig = {
  targetFps: 60,
  budgetMs: 16.67,
  safetyMarginMs: 2.0,
  temporalWindow: 3,
  adaptiveThreshold: 3
};

/**
 * Work item for temporal amortization
 */
interface DeferredWork {
  priority: WorkPriority;
  work: () => void;
  estimatedCostMs: number;
  frameDeadline: number;  // Frame number by which this must complete
}

/**
 * Frame Budget Manager
 * Tracks frame time budget and decides what work to perform
 */
export class FrameBudgetManager {
  private config: FrameBudgetConfig;

  // Frame timing
  private frameStartTime: number = 0;
  private frameNumber: number = 0;
  private lastFrameTimes: number[] = [];

  // Adaptive degradation
  private consecutiveDrops: number = 0;
  private currentDegradationLevel: number = 0; // 0 = none, 1 = skip optional, 2 = skip low, etc.

  // Temporal amortization
  private deferredWorkQueue: DeferredWork[] = [];
  private workHistory: Map<string, number> = new Map(); // Work ID → avg cost

  // Budget statistics
  private budgetExceededCount: number = 0;
  private totalFrames: number = 0;

  constructor(config?: Partial<FrameBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Mark the beginning of a frame
   * Call this at the start of your render loop
   */
  beginFrame(): void {
    this.frameStartTime = performance.now();
    this.frameNumber++;
    this.totalFrames++;
  }

  /**
   * Mark the end of a frame and update metrics
   * Call this at the end of your render loop
   */
  endFrame(): void {
    const frameTime = performance.now() - this.frameStartTime;

    // Update frame time history
    this.lastFrameTimes.push(frameTime);
    if (this.lastFrameTimes.length > 60) {
      this.lastFrameTimes.shift();
    }

    // Check if budget was exceeded
    if (frameTime > this.config.budgetMs) {
      this.budgetExceededCount++;
      this.consecutiveDrops++;

      // Increase degradation if threshold exceeded
      if (this.consecutiveDrops >= this.config.adaptiveThreshold) {
        this.currentDegradationLevel = Math.min(4, this.currentDegradationLevel + 1);
        console.warn(`FrameBudget: Degradation level increased to ${this.currentDegradationLevel} (${frameTime.toFixed(2)}ms frame)`);
        this.consecutiveDrops = 0;
      }
    } else {
      // Frame was within budget
      this.consecutiveDrops = 0;

      // Gradually recover degradation level
      if (this.currentDegradationLevel > 0 && this.frameNumber % 180 === 0) { // Every 3 seconds at 60fps
        this.currentDegradationLevel = Math.max(0, this.currentDegradationLevel - 1);
        console.log(`FrameBudget: Degradation level decreased to ${this.currentDegradationLevel}`);
      }
    }
  }

  /**
   * Get remaining frame budget in milliseconds
   */
  getRemainingBudget(): number {
    const elapsed = performance.now() - this.frameStartTime;
    return this.config.budgetMs - elapsed;
  }

  /**
   * Check if we can afford to do work of a given cost
   */
  canAfford(costMs: number, priority: WorkPriority = WorkPriority.MEDIUM): boolean {
    const remaining = this.getRemainingBudget();

    // Critical work always proceeds
    if (priority === WorkPriority.CRITICAL) {
      return true;
    }

    // Check if we have enough budget including safety margin
    const requiredBudget = costMs + this.config.safetyMarginMs;

    // Apply degradation - skip lower priority work when degraded
    if (this.currentDegradationLevel > 0 && priority >= this.currentDegradationLevel) {
      return false;
    }

    return remaining >= requiredBudget;
  }

  /**
   * Should skip optional work (blur maps, effects, etc.)
   */
  shouldSkipOptionalWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 2 ||
           this.currentDegradationLevel >= WorkPriority.OPTIONAL;
  }

  /**
   * Should skip low priority work (some effects)
   */
  shouldSkipLowPriorityWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 3 ||
           this.currentDegradationLevel >= WorkPriority.LOW;
  }

  /**
   * Should skip medium priority work (text updates)
   */
  shouldSkipMediumPriorityWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 4 ||
           this.currentDegradationLevel >= WorkPriority.MEDIUM;
  }

  /**
   * Defer work to be completed over multiple frames (temporal amortization)
   * Returns true if work was deferred, false if it should be done immediately
   */
  deferWork(
    _workId: string,
    work: () => void,
    priority: WorkPriority,
    estimatedCostMs: number,
    maxFramesDelay: number = 3
  ): boolean {
    // Critical work never deferred
    if (priority === WorkPriority.CRITICAL) {
      return false;
    }

    // Check if we can afford it this frame
    if (this.canAfford(estimatedCostMs, priority)) {
      return false; // Do it now
    }

    // Defer to future frame
    const deadline = this.frameNumber + maxFramesDelay;
    this.deferredWorkQueue.push({
      priority,
      work,
      estimatedCostMs,
      frameDeadline: deadline
    });

    // Sort by priority (higher priority first), then by deadline
    this.deferredWorkQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.frameDeadline - b.frameDeadline;
    });

    return true; // Deferred
  }

  /**
   * Process deferred work queue
   * Call this each frame after critical work is done
   */
  processDeferredWork(): void {
    while (this.deferredWorkQueue.length > 0) {
      const item = this.deferredWorkQueue[0];

      // Check if past deadline - must execute even if tight
      const isPastDeadline = this.frameNumber >= item.frameDeadline;

      // Check if we can afford it
      if (!isPastDeadline && !this.canAfford(item.estimatedCostMs, item.priority)) {
        break; // Can't afford any more work this frame
      }

      // Execute work
      const workStart = performance.now();
      this.deferredWorkQueue.shift(); // Remove from queue
      item.work();
      const workCost = performance.now() - workStart;

      // Update cost estimate for future scheduling
      this.workHistory.set(`priority_${item.priority}`, workCost);
    }
  }

  /**
   * Get estimated cost for a priority level (based on history)
   */
  getEstimatedCost(priority: WorkPriority): number {
    const key = `priority_${priority}`;
    return this.workHistory.get(key) || 2.0; // Default 2ms estimate
  }

  /**
   * Get current degradation level (0 = none, 4 = maximum)
   */
  getDegradationLevel(): number {
    return this.currentDegradationLevel;
  }

  /**
   * Get average frame time over recent frames
   */
  getAverageFrameTime(): number {
    if (this.lastFrameTimes.length === 0) return 0;
    return this.lastFrameTimes.reduce((a, b) => a + b, 0) / this.lastFrameTimes.length;
  }

  /**
   * Get current frame time
   */
  getCurrentFrameTime(): number {
    return performance.now() - this.frameStartTime;
  }

  /**
   * Get frame budget utilization (0.0 - 1.0+)
   */
  getBudgetUtilization(): number {
    return this.getCurrentFrameTime() / this.config.budgetMs;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalFrames: number;
    budgetExceededCount: number;
    budgetExceededPercent: number;
    averageFrameTime: number;
    currentFrameTime: number;
    degradationLevel: number;
    deferredWorkQueueSize: number;
  } {
    return {
      totalFrames: this.totalFrames,
      budgetExceededCount: this.budgetExceededCount,
      budgetExceededPercent: (this.budgetExceededCount / Math.max(1, this.totalFrames)) * 100,
      averageFrameTime: this.getAverageFrameTime(),
      currentFrameTime: this.getCurrentFrameTime(),
      degradationLevel: this.currentDegradationLevel,
      deferredWorkQueueSize: this.deferredWorkQueue.length
    };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.budgetExceededCount = 0;
    this.totalFrames = 0;
    this.consecutiveDrops = 0;
    this.currentDegradationLevel = 0;
    this.lastFrameTimes = [];
    this.deferredWorkQueue = [];
    this.workHistory.clear();
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const stats = this.getStats();
    const fps = 1000 / stats.averageFrameTime;

    return `
=== Frame Budget Report ===
Total Frames: ${stats.totalFrames}
Budget Exceeded: ${stats.budgetExceededCount} (${stats.budgetExceededPercent.toFixed(2)}%)
Average FPS: ${fps.toFixed(1)} (${stats.averageFrameTime.toFixed(2)}ms/frame)
Current Frame: ${stats.currentFrameTime.toFixed(2)}ms
Degradation Level: ${stats.degradationLevel}/4
Deferred Work Queue: ${stats.deferredWorkQueueSize} items
Budget Target: ${this.config.budgetMs.toFixed(2)}ms (${this.config.targetFps} FPS)
=========================
    `.trim();
  }
}

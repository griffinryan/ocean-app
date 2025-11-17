/**
 * Frame Budget System for Locked 60 FPS Performance
 * Ensures frame time stays under ~16-18ms with adaptive work scheduling.
 * The degradation model now steps through optional → low → medium → high work,
 * avoiding the abrupt skips that caused stutters when quality presets were removed.
 */

export enum WorkPriority {
  CRITICAL = 0,    // Ocean rendering (never skip)
  HIGH = 1,        // Glass rendering (skip only if desperate)
  MEDIUM = 2,      // Text rendering (skip if tight)
  LOW = 3,         // Blur maps, effects (skip aggressively)
  OPTIONAL = 4     // Debug visualizations (skip first)
}

export interface FrameBudgetConfig {
  targetFps: number;
  budgetMs: number;
  safetyMarginMs: number;
  temporalWindow: number;
  adaptiveThreshold: number;
}

const DEFAULT_CONFIG: FrameBudgetConfig = {
  targetFps: 60,
  budgetMs: 17.5,
  safetyMarginMs: 1.5,
  temporalWindow: 3,
  adaptiveThreshold: 4
};

interface DeferredWork {
  priority: WorkPriority;
  work: () => void;
  estimatedCostMs: number;
  frameDeadline: number;
}

export class FrameBudgetManager {
  private static readonly PRIORITY_ORDER: WorkPriority[] = [
    WorkPriority.OPTIONAL,
    WorkPriority.LOW,
    WorkPriority.MEDIUM,
    WorkPriority.HIGH
  ];

  private config: FrameBudgetConfig;

  // Frame timing
  private frameStartTime: number = 0;
  private frameNumber: number = 0;
  private lastFrameTimes: number[] = [];

  // Adaptive degradation
  private consecutiveDrops: number = 0;
  private skipPriority: WorkPriority | null = null; // Lowest priority currently being skipped

  // Temporal amortization
  private deferredWorkQueue: DeferredWork[] = [];
  private workHistory: Map<string, number> = new Map();

  // Budget statistics
  private budgetExceededCount: number = 0;
  private totalFrames: number = 0;

  constructor(config?: Partial<FrameBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  beginFrame(): void {
    this.frameStartTime = performance.now();
    this.frameNumber++;
    this.totalFrames++;
  }

  endFrame(): void {
    const frameTime = performance.now() - this.frameStartTime;
    this.lastFrameTimes.push(frameTime);
    if (this.lastFrameTimes.length > 60) {
      this.lastFrameTimes.shift();
    }

    if (frameTime > this.config.budgetMs) {
      this.budgetExceededCount++;
      this.consecutiveDrops++;

      if (this.consecutiveDrops >= this.config.adaptiveThreshold) {
        this.increaseDegradation(frameTime);
        this.consecutiveDrops = 0;
      }
    } else {
      this.consecutiveDrops = 0;

      // Gradually recover once every ~3 seconds when stable
      if (this.skipPriority !== null && this.frameNumber % 180 === 0) {
        this.decreaseDegradation();
      }
    }
  }

  getRemainingBudget(): number {
    const elapsed = performance.now() - this.frameStartTime;
    return this.config.budgetMs - elapsed;
  }

  canAfford(costMs: number, priority: WorkPriority = WorkPriority.MEDIUM): boolean {
    if (priority === WorkPriority.CRITICAL) {
      return true;
    }

    if (this.shouldSkipPriority(priority)) {
      return false;
    }

    const requiredBudget = costMs + this.config.safetyMarginMs;
    return this.getRemainingBudget() >= requiredBudget;
  }

  shouldSkipOptionalWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 2 ||
      (this.skipPriority !== null && this.skipPriority <= WorkPriority.OPTIONAL);
  }

  shouldSkipLowPriorityWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 3 ||
      (this.skipPriority !== null && this.skipPriority <= WorkPriority.LOW);
  }

  shouldSkipMediumPriorityWork(): boolean {
    return this.getRemainingBudget() < this.config.safetyMarginMs * 4 ||
      (this.skipPriority !== null && this.skipPriority <= WorkPriority.MEDIUM);
  }

  shouldSkipPriority(priority: WorkPriority): boolean {
    if (priority === WorkPriority.CRITICAL) {
      return false;
    }

    if (this.skipPriority !== null && priority >= this.skipPriority) {
      return true;
    }

    return false;
  }

  deferWork(
    _workId: string,
    work: () => void,
    priority: WorkPriority,
    estimatedCostMs: number,
    maxFramesDelay: number = 3
  ): boolean {
    if (priority === WorkPriority.CRITICAL) {
      return false;
    }

    if (this.canAfford(estimatedCostMs, priority)) {
      return false;
    }

    const deadline = this.frameNumber + maxFramesDelay;
    this.deferredWorkQueue.push({
      priority,
      work,
      estimatedCostMs,
      frameDeadline: deadline
    });

    this.deferredWorkQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.frameDeadline - b.frameDeadline;
    });

    return true;
  }

  processDeferredWork(): void {
    while (this.deferredWorkQueue.length > 0) {
      const item = this.deferredWorkQueue[0];
      const isPastDeadline = this.frameNumber >= item.frameDeadline;

      const canRun = isPastDeadline || this.canAfford(item.estimatedCostMs, item.priority);
      if (!canRun) {
        break;
      }

      this.deferredWorkQueue.shift();
      item.work();
    }
  }

  recordWorkCost(workId: string, costMs: number): void {
    const previous = this.workHistory.get(workId);
    if (previous === undefined) {
      this.workHistory.set(workId, costMs);
    } else {
      this.workHistory.set(workId, (previous * 0.8) + (costMs * 0.2));
    }
  }

  getAverageWorkCost(workId: string): number | undefined {
    return this.workHistory.get(workId);
  }

  getBudgetStats(): { totalFrames: number; exceeded: number; skipPriority: WorkPriority | null } {
    return {
      totalFrames: this.totalFrames,
      exceeded: this.budgetExceededCount,
      skipPriority: this.skipPriority
    };
  }

  getStats(): {
    totalFrames: number;
    framesWithinBudget: number;
    budgetExceeded: number;
    currentSkipPriority: WorkPriority | null;
  } {
    const stats = this.getBudgetStats();
    const framesWithinBudget = Math.max(0, stats.totalFrames - stats.exceeded);
    return {
      totalFrames: stats.totalFrames,
      framesWithinBudget,
      budgetExceeded: stats.exceeded,
      currentSkipPriority: stats.skipPriority
    };
  }

  generateReport(): string {
    const stats = this.getStats();
    const skipName = this.getPriorityName(stats.currentSkipPriority);
    const withinPct = stats.totalFrames > 0
      ? ((stats.framesWithinBudget / stats.totalFrames) * 100).toFixed(1)
      : '100';

    return `
Frame Budget Report
-------------------
Total Frames:        ${stats.totalFrames}
Frames in Budget:    ${stats.framesWithinBudget} (${withinPct}%)
Budget Exceeded:     ${stats.budgetExceeded}
Skipping Priority ≥: ${skipName}
Budget Target (ms):  ${this.config.budgetMs.toFixed(2)}
`.trim();
  }

  reset(): void {
    this.frameStartTime = 0;
    this.frameNumber = 0;
    this.lastFrameTimes = [];
    this.consecutiveDrops = 0;
    this.skipPriority = null;
    this.deferredWorkQueue = [];
    this.workHistory.clear();
    this.budgetExceededCount = 0;
    this.totalFrames = 0;
  }

  private increaseDegradation(frameTime: number): void {
    const order = FrameBudgetManager.PRIORITY_ORDER;
    if (this.skipPriority === null) {
      this.skipPriority = order[0];
    } else {
      const index = order.indexOf(this.skipPriority);
      if (index < order.length - 1) {
        this.skipPriority = order[index + 1];
      }
    }

    console.warn(`FrameBudget: Skipping ${this.getPriorityName(this.skipPriority)} work (${frameTime.toFixed(2)}ms frame)`);
  }

  private decreaseDegradation(): void {
    if (this.skipPriority === null) {
      return;
    }

    const order = FrameBudgetManager.PRIORITY_ORDER;
    const index = order.indexOf(this.skipPriority);
    if (index <= 0) {
      this.skipPriority = null;
      console.log('FrameBudget: Restoring full workload');
    } else {
      this.skipPriority = order[index - 1];
      console.log(`FrameBudget: Restoring ${this.getPriorityName(this.skipPriority)} work`);
    }
  }

  private getPriorityName(priority: WorkPriority | null): string {
    switch (priority) {
      case WorkPriority.HIGH:
        return 'high-priority';
      case WorkPriority.MEDIUM:
        return 'medium-priority';
      case WorkPriority.LOW:
        return 'low-priority';
      case WorkPriority.OPTIONAL:
        return 'optional';
      default:
        return 'all';
    }
  }
}

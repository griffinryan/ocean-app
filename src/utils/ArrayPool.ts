/**
 * ArrayPool: Performance optimization for Float32Array allocation
 *
 * Maintains a pool of reusable Float32Array objects to eliminate per-frame allocations
 * and reduce garbage collection pressure.
 *
 * Usage:
 *   const pool = new ArrayPool();
 *   const array = pool.acquire(length);
 *   // ... use array ...
 *   pool.release(array);
 */

export class ArrayPool {
  private pools: Map<number, Float32Array[]> = new Map();
  private maxPoolSize: number = 10; // Maximum arrays per size to keep in pool

  // Statistics for debugging
  private stats = {
    acquires: 0,
    releases: 0,
    hits: 0,      // Reused from pool
    misses: 0,    // New allocation required
    totalPooled: 0
  };

  /**
   * Acquire a Float32Array of the specified length
   * Reuses from pool if available, otherwise creates new
   */
  public acquire(length: number): Float32Array {
    this.stats.acquires++;

    // Get pool for this size
    let pool = this.pools.get(length);

    if (pool && pool.length > 0) {
      // Reuse from pool
      this.stats.hits++;
      return pool.pop()!;
    }

    // Need to allocate new array
    this.stats.misses++;
    return new Float32Array(length);
  }

  /**
   * Release a Float32Array back to the pool for reuse
   * Array will be zeroed before being returned to pool
   */
  public release(array: Float32Array): void {
    this.stats.releases++;

    const length = array.length;
    let pool = this.pools.get(length);

    if (!pool) {
      // Create new pool for this size
      pool = [];
      this.pools.set(length, pool);
    }

    // Don't add to pool if we've reached max size for this length
    if (pool.length >= this.maxPoolSize) {
      return;
    }

    // Zero out array before returning to pool
    // This prevents stale data and ensures consistent behavior
    array.fill(0);

    pool.push(array);
    this.stats.totalPooled = this.getTotalPooledCount();
  }

  /**
   * Release multiple arrays at once
   */
  public releaseAll(arrays: Float32Array[]): void {
    for (const array of arrays) {
      this.release(array);
    }
  }

  /**
   * Clear all pools and reset statistics
   */
  public clear(): void {
    this.pools.clear();
    this.stats.totalPooled = 0;
  }

  /**
   * Get total number of pooled arrays across all sizes
   */
  private getTotalPooledCount(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.length;
    }
    return total;
  }

  /**
   * Get pool statistics for performance monitoring
   */
  public getStats(): {
    acquires: number;
    releases: number;
    hits: number;
    misses: number;
    hitRate: number;
    totalPooled: number;
    poolSizes: Map<number, number>;
  } {
    const hitRate = this.stats.acquires > 0
      ? this.stats.hits / this.stats.acquires
      : 0;

    const poolSizes = new Map<number, number>();
    for (const [length, pool] of this.pools) {
      poolSizes.set(length, pool.length);
    }

    return {
      ...this.stats,
      hitRate,
      poolSizes
    };
  }

  /**
   * Reset statistics (useful for benchmarking)
   */
  public resetStats(): void {
    this.stats.acquires = 0;
    this.stats.releases = 0;
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  /**
   * Set maximum pool size for each array length
   */
  public setMaxPoolSize(size: number): void {
    this.maxPoolSize = size;
  }
}

/**
 * Global singleton ArrayPool for convenience
 * Most use cases can use this shared instance
 */
export const globalArrayPool = new ArrayPool();

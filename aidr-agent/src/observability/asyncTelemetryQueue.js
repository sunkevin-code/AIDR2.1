const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function rank(item) {
  return SEVERITY_RANK[String(item?.severity || "info").toLowerCase()] ?? 0;
}

class AsyncTelemetryQueue {
  constructor(processor, options = {}) {
    if (typeof processor !== "function") throw new TypeError("processor must be a function");
    this.processor = processor;
    this.maxSize = Math.max(10, Number(options.maxSize || process.env.AIDR_TELEMETRY_QUEUE_MAX || 2000));
    this.batchSize = Math.max(1, Number(options.batchSize || process.env.AIDR_TELEMETRY_BATCH_SIZE || 50));
    this.flushIntervalMs = Math.max(1, Number(options.flushIntervalMs || process.env.AIDR_TELEMETRY_FLUSH_MS || 25));
    this.queue = [];
    this.timer = null;
    this.draining = false;
    this.accepting = true;
    this.stats = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      dropped: 0,
      droppedBySeverity: {},
      maxDepth: 0,
      lastError: null,
      lastProcessedAt: null
    };
  }

  enqueue(item) {
    if (!this.accepting) return false;
    if (this.queue.length >= this.maxSize) {
      const incomingRank = rank(item);
      let evictIndex = 0;
      for (let index = 1; index < this.queue.length; index += 1) {
        if (rank(this.queue[index]) < rank(this.queue[evictIndex])) evictIndex = index;
      }
      if (rank(this.queue[evictIndex]) <= incomingRank) {
        const evicted = this.queue.splice(evictIndex, 1)[0];
        this._countDropped(evicted);
      } else {
        this._countDropped(item);
        return false;
      }
    }
    this.queue.push(item);
    this.stats.enqueued += 1;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, this.queue.length);
    this._schedule();
    return true;
  }

  _countDropped(item) {
    const severity = String(item?.severity || "info").toLowerCase();
    this.stats.dropped += 1;
    this.stats.droppedBySeverity[severity] = (this.stats.droppedBySeverity[severity] || 0) + 1;
  }

  _schedule() {
    if (this.timer || this.draining || !this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._drain().catch(() => {});
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  async _drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.batchSize);
        for (const item of batch) {
          try {
            await this.processor(item);
            this.stats.processed += 1;
            this.stats.lastProcessedAt = new Date().toISOString();
          } catch (error) {
            this.stats.failed += 1;
            this.stats.lastError = String(error?.message || error);
          }
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length) this._schedule();
    }
  }

  async flush(timeoutMs = 5000) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs));
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while ((this.queue.length || this.draining) && Date.now() <= deadline) {
      await this._drain();
      if (this.queue.length || this.draining) await new Promise(resolve => setTimeout(resolve, 1));
    }
    return this.queue.length === 0 && !this.draining;
  }

  async stop(options = {}) {
    this.accepting = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (options.drain !== false) await this.flush(options.timeoutMs || 5000);
    else this.queue.length = 0;
  }

  getStatus() {
    return {
      status: this.stats.failed || this.stats.lastError ? "degraded" : "healthy",
      accepting: this.accepting,
      depth: this.queue.length,
      maxSize: this.maxSize,
      batchSize: this.batchSize,
      flushIntervalMs: this.flushIntervalMs,
      draining: this.draining,
      ...this.stats,
      utilization: this.maxSize ? Number((this.queue.length / this.maxSize).toFixed(4)) : 0
    };
  }
}

module.exports = { AsyncTelemetryQueue };

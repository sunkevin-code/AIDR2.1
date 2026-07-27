const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
    this.retryLimit = Math.max(0, Number(options.retryLimit ?? process.env.AIDR_TELEMETRY_RETRY_LIMIT ?? 3));
    this.retryBaseMs = Math.max(1, Number(options.retryBaseMs ?? process.env.AIDR_TELEMETRY_RETRY_BASE_MS ?? 25));
    this.walPath = options.walPath || process.env.AIDR_TELEMETRY_WAL_PATH || null;
    this.deadLetterPath = options.deadLetterPath || process.env.AIDR_TELEMETRY_DLQ_PATH || (this.walPath ? this.walPath + ".dead-letter.jsonl" : null);
    this.durable = new Map();
    this.attempts = new Map();
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
      lastProcessedAt: null,
      retried: 0,
      deadLettered: 0,
      recovered: 0,
      walErrors: 0
    };
    this._loadWal();
  }

  _key(item) {
    return String(item?.eventId || crypto.createHash("sha256").update(JSON.stringify(item || {})).digest("hex"));
  }

  _isDurable(item) {
    return Boolean(this.walPath) && rank(item) >= SEVERITY_RANK.high;
  }

  _loadWal() {
    if (!this.walPath || !fs.existsSync(this.walPath)) return;
    try {
      const records = JSON.parse(fs.readFileSync(this.walPath, "utf8"));
      if (!Array.isArray(records)) return;
      for (const record of records) {
        if (!record?.item) continue;
        const key = String(record.id || this._key(record.item));
        this.durable.set(key, record.item);
        this.attempts.set(key, Number(record.attempts || 0));
        if (this.queue.length < this.maxSize) {
          this.queue.push(record.item);
          this.stats.recovered += 1;
        }
      }
      this.stats.maxDepth = Math.max(this.stats.maxDepth, this.queue.length);
      if (this.queue.length) this._schedule();
    } catch (error) {
      this.stats.lastError = "telemetry_wal_read:" + error.message;
      this.stats.walErrors += 1;
    }
  }

  _writeWal() {
    if (!this.walPath) return;
    try {
      fs.mkdirSync(path.dirname(this.walPath), { recursive: true });
      const tmp = this.walPath + ".tmp";
      const records = Array.from(this.durable, ([id, item]) => ({ id, item, attempts: this.attempts.get(id) || 0 }));
      fs.writeFileSync(tmp, JSON.stringify(records), "utf8");
      fs.renameSync(tmp, this.walPath);
    } catch (error) {
      this.stats.lastError = "telemetry_wal_write:" + error.message;
      this.stats.walErrors += 1;
    }
  }

  _persist(item) {
    if (!this._isDurable(item)) return;
    const key = this._key(item);
    this.durable.set(key, item);
    this.attempts.set(key, this.attempts.get(key) || 0);
    this._writeWal();
  }

  _ack(item) {
    if (!this.walPath || !this._isDurable(item)) return;
    const key = this._key(item);
    this.durable.delete(key);
    this.attempts.delete(key);
    this._writeWal();
  }

  _deadLetter(item, error) {
    if (this.deadLetterPath) {
      try {
        fs.mkdirSync(path.dirname(this.deadLetterPath), { recursive: true });
        fs.appendFileSync(this.deadLetterPath, JSON.stringify({ item, error: String(error?.message || error), timestamp: new Date().toISOString() }) + "\n", "utf8");
      } catch (writeError) {
        this.stats.lastError = "telemetry_dlq_write:" + writeError.message;
      }
    }
    this.stats.deadLettered += 1;
    this._ack(item);
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
        this._ack(evicted);
      } else {
        this._countDropped(item);
        this._ack(item);
        return false;
      }
    }
    this._persist(item);
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
            this._ack(item);
            this.stats.processed += 1;
            this.stats.lastProcessedAt = new Date().toISOString();
          } catch (error) {
            this.stats.failed += 1;
            this.stats.lastError = String(error?.message || error);
            if (this._isDurable(item)) {
              const key = this._key(item);
              const attempts = (this.attempts.get(key) || 0) + 1;
              this.attempts.set(key, attempts);
              if (attempts <= this.retryLimit) {
                this.stats.retried += 1;
                this._writeWal();
                await new Promise(resolve => setTimeout(resolve, this.retryBaseMs * Math.min(attempts, 8)));
                this.queue.push(item);
              } else {
                this._deadLetter(item, error);
              }
            }
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
      status: this.stats.deadLettered || (this.queue.length > 0 && this.stats.lastError) ? "degraded" : "healthy",
      accepting: this.accepting,
      depth: this.queue.length,
      maxSize: this.maxSize,
      batchSize: this.batchSize,
      flushIntervalMs: this.flushIntervalMs,
      retryLimit: this.retryLimit,
      draining: this.draining,
      walPath: this.walPath,
      walDepth: this.durable.size,
      deadLetterPath: this.deadLetterPath,
      ...this.stats,
      utilization: this.maxSize ? Number((this.queue.length / this.maxSize).toFixed(4)) : 0
    };
  }
}

module.exports = { AsyncTelemetryQueue };

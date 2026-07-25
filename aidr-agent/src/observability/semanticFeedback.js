const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LEDGER_VERSION = "aidr-semantic-feedback-v1";

class SemanticFeedbackStore {
  constructor(logDir, options = {}) {
    this.path = path.join(logDir, "semantic-feedback.jsonl");
    this.maxRecords = Math.max(100, Number(options.maxRecords) || 5000);
    this.records = [];
    this.loadError = null;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.path)) return;
      const lines = fs.readFileSync(this.path, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-this.maxRecords)) {
        try {
          const record = JSON.parse(line);
          if (record && record.feedbackId && record.promptHash) this.records.push(record);
        } catch (_) {}
      }
    } catch (error) {
      this.loadError = error.message;
    }
  }

  record(input = {}) {
    const prompt = String(input.prompt || input.text || "").trim();
    const promptHash = /^[a-f0-9]{64}$/i.test(String(input.promptHash || ""))
      ? String(input.promptHash).toLowerCase()
      : (prompt ? crypto.createHash("sha256").update(prompt, "utf8").digest("hex") : "");
    if (!promptHash) throw new Error("prompt_or_prompt_hash_required");

    const prediction = input.prediction && typeof input.prediction === "object" ? input.prediction : {};
    const label = input.label && typeof input.label === "object" ? input.label : {};
    const record = {
      ledgerVersion: LEDGER_VERSION,
      feedbackId: String(input.feedbackId || crypto.randomUUID()),
      timestamp: new Date().toISOString(),
      promptHash,
      sessionId: limit(input.sessionId, 200),
      eventId: limit(input.eventId, 200),
      agentId: limit(input.agentId, 120),
      prediction: {
        source: limit(prediction.source || input.source || "unknown", 80),
        model: limit(prediction.model || input.model || "unknown", 120),
        verdict: limit(prediction.verdict, 40),
        riskLevel: limit(prediction.riskLevel || prediction.risk, 40),
        confidence: finiteNumber(prediction.confidence),
        categories: list(prediction.categories)
      },
      label: {
        correct: typeof label.correct === "boolean" ? label.correct : (typeof input.correct === "boolean" ? input.correct : null),
        verdict: limit(label.verdict || input.labelVerdict, 40),
        riskLevel: limit(label.riskLevel || input.labelRiskLevel, 40),
        categories: list(label.categories || input.labelCategories)
      },
      reviewer: limit(input.reviewer, 120),
      note: limit(input.note, 1000)
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records = this.records.slice(-this.maxRecords);
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.appendFileSync(this.path, JSON.stringify(record) + "\n", "utf8");
    return record;
  }

  getRecent(limit = 100) {
    const size = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.records.slice(-size).reverse();
  }

  getStats() {
    const stats = {
      ledgerVersion: LEDGER_VERSION,
      path: this.path,
      total: this.records.length,
      reviewed: 0,
      correct: 0,
      accuracy: null,
      bySource: {},
      byVerdict: {},
      byRiskLevel: {},
      lastFeedbackAt: this.records.length ? this.records[this.records.length - 1].timestamp : null,
      loadError: this.loadError
    };
    for (const record of this.records) {
      const source = record.prediction?.source || "unknown";
      const verdict = record.prediction?.verdict || "unknown";
      const riskLevel = record.prediction?.riskLevel || "unknown";
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      stats.byVerdict[verdict] = (stats.byVerdict[verdict] || 0) + 1;
      stats.byRiskLevel[riskLevel] = (stats.byRiskLevel[riskLevel] || 0) + 1;
      if (typeof record.label?.correct === "boolean") {
        stats.reviewed++;
        if (record.label.correct) stats.correct++;
      }
    }
    stats.accuracy = stats.reviewed ? Number((stats.correct / stats.reviewed).toFixed(4)) : null;
    return stats;
  }

  getStatus() {
    const stats = this.getStats();
    return { status: this.loadError ? "degraded" : "ready", ...stats };
  }
}

function limit(value, max) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).slice(0, max);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).slice(0, 80)).filter(Boolean))).slice(0, 20);
}

module.exports = { SemanticFeedbackStore, LEDGER_VERSION };

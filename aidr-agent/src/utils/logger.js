const fs = require("fs");
const path = require("path");

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_ROTATED_LOGS = 3;

class Logger {
  constructor(logDir, agentId) {
    this.agentId = agentId;
    this.logDir = logDir;
    this.logPath = path.join(logDir, "aidr-events.jsonl");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this._rotateIfNeeded();
  }

  _rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.logPath) || fs.statSync(this.logPath).size <= MAX_LOG_BYTES) return;
      for (let index = MAX_ROTATED_LOGS - 1; index >= 1; index -= 1) {
        const source = `${this.logPath}.${index}`;
        const target = `${this.logPath}.${index + 1}`;
        if (fs.existsSync(source)) {
          try { fs.renameSync(source, target); } catch (_) {}
        }
      }
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    } catch (_) {}
  }

  log(verdict, severity, category, summary, detail = {}, meta = {}) {
    const now = new Date().toISOString();
    const entry = {
      time: meta.timestamp || now,
      timestamp: meta.timestamp || now,
      eventId: meta.eventId || null,
      schemaVersion: Number(meta.schemaVersion || 1),
      agentId: meta.agentId || this.agentId,
      sessionId: meta.sessionId || null,
      matchedRule: meta.matchedRule || null,
      verdict, severity, category,
      summary, detail
    };
    const line = JSON.stringify(entry);
    try { fs.appendFileSync(this.logPath, line + "\n", "utf8"); } catch (_) {}

    const prefix = verdict === "block" ? "[BLOCK]" : verdict === "alert" ? "[ALERT]" : "[INFO]";
    console.log(`${prefix} [${category}] ${summary}`);
  }

  warn(msg) { console.warn(`[WARN] ${msg}`); }
  error(msg) { console.error(`[ERROR] ${msg}`); }
}

module.exports = { Logger };
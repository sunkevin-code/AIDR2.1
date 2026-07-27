const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const { sanitizePrompt } = require("../utils/promptSanitizer");

function monitoredUserHome(policy = {}) {
  if (process.env.AIDR_MONITORED_USER_PROFILE) return process.env.AIDR_MONITORED_USER_PROFILE;
  const workspace = String(policy.workspaceRoot || "");
  const match = workspace.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/i);
  return match?.[1] || os.homedir();
}

class HermesSessionSensor {
  constructor(policy, addEvent, eventBus) {
    this.policy = policy || {};
    this.addEvent = addEvent;
    this.eventBus = eventBus;
    this.active = false;
    this.polling = false;
    this.timer = null;
    this.lastId = 0;
    this.initialized = false;
    const userHome = monitoredUserHome(this.policy);
    this.dbPath = process.env.AIDR_HERMES_DB || path.join(userHome, "AppData", "Local", "Hermes", "state.db");
    this.stats = { sessions: 0, prompts: 0, errors: 0, lastPromptAt: null, source: this.dbPath };
  }

  async start() {
    this.SQL = await initSqlJs();
    this.active = true;
    this.addEvent("system", "info", "allow", "Hermes session sensor started", { source: this.dbPath });
    this.timer = setInterval(() => this.poll().catch(() => {}), 2500);
    setTimeout(() => this.poll().catch(() => {}), 500);
  }

  async stop() {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (!this.active || this.polling || !fs.existsSync(this.dbPath)) return;
    this.polling = true;
    let db;
    try {
      db = new this.SQL.Database(fs.readFileSync(this.dbPath));
      if (!this.initialized) {
        this.lastId = Number(db.exec("SELECT COALESCE(MAX(id), 0) FROM messages")[0]?.values?.[0]?.[0] || 0);
        this.initialized = true;
        return;
      }
      const statement = db.prepare(
        "SELECT m.id, m.session_id, m.content, m.timestamp, COALESCE(s.model,''), COALESCE(s.cwd,'') " +
        "FROM messages m LEFT JOIN sessions s ON s.id=m.session_id " +
        "WHERE m.id > ? AND lower(m.role)='user' AND COALESCE(m.active,1)<>0 ORDER BY m.id LIMIT 100"
      );
      statement.bind([this.lastId]);
      while (statement.step()) {
        const [id, sessionId, content, timestamp, model, cwd] = statement.get();
        this.lastId = Math.max(this.lastId, Number(id || 0));
        this._publish({ sessionId, prompt: content, timestamp, model, cwd });
      }
      statement.free();
    } catch (error) {
      this.stats.errors++;
      this.addEvent("hermes_session", "info", "alert", "Hermes session sensor read failed", { error: error.message });
    } finally {
      try { db?.close(); } catch (_) {}
      this.polling = false;
    }
  }

  _publish(row) {
    const prompt = sanitizePrompt(String(row.prompt || ""));
    if (!prompt) return;
    const timestamp = row.timestamp || new Date().toISOString();
    const sessionId = String(row.sessionId || "hermes-session");
    const submissionId = "hermes-" + crypto.createHash("sha256").update(sessionId + prompt).digest("hex").slice(0, 24);
    this.stats.prompts++;
    this.stats.sessions = Math.max(this.stats.sessions, 1);
    this.stats.lastPromptAt = timestamp;
    const payload = {
      agent: "hermes", agentLabel: "Hermes", conversationId: sessionId, sessionId, threadId: sessionId,
      submissionId, cwd: row.cwd || this.policy.workspaceRoot, model: row.model || "unknown",
      prompt, fullPrompt: prompt, timestamp, source: "hermes_state_db"
    };
    this.eventBus?.publish("agent:user_prompt", payload);
    this.addEvent("hermes_session", "info", "allow", "Hermes prompt: " + prompt.slice(0, 100), {
      agent: "hermes", agentLabel: "Hermes", conversationId: sessionId, submissionId,
      promptPreview: prompt.slice(0, 200), promptLength: prompt.length, source: payload.source
    });
  }

  getStats() { return { ...this.stats, active: this.active, polling: this.polling }; }
}

module.exports = { HermesSessionSensor };

const fs = require("fs");
const path = require("path");
const os = require("os");
const { sanitizePrompt } = require("../utils/promptSanitizer");

const ROLLOUT_STATE_VERSION = 2;

class CodexSessionSensor {
  constructor(policy, addEvent, eventBus) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.eventBus = eventBus;
    this.active = false;
    this.interval = null;
    this.lastProcessedId = 0;
    this.knownConversations = new Map();
    this.stats = { sessions: 0, prompts: 0, rolloutCatchUps: 0, rolloutLagBytes: 0 };
    this.polling = false;
    this.rolloutFiles = {};
    this.rolloutMessageKeys = new Map();
    this.rolloutContexts = new Map();
    this.logsDbFingerprint = null;
    this.transportDatabaseEnabled = policy.sensors?.codex?.transportDatabase === true || process.env.AIDR_CODEX_TRANSPORT_DB === "1";
    this.maxRolloutReadBytes = Math.max(512 * 1024, Number(policy.sensors?.codex?.maxReadBytes) || 4 * 1024 * 1024);
    this.transportPollIntervalMs = Math.max(5000, Number(policy.sensors?.codex?.transportPollIntervalMs) || 15000);
    this.lastTransportPollAt = 0;
  }

  async start() {
    this.active = true;
    this.codexDir = path.join(os.homedir(), ".codex");
    this.logsDbPath = path.join(this.codexDir, "logs_2.sqlite");
    this.sessionsDir = path.join(this.codexDir, "sessions");
    this._loadLastId();
    this.addEvent("system", "info", "allow", "Codex session sensor started");
    const pollIntervalMs = Math.max(2000, Number(this.policy.sensors?.codex?.pollIntervalMs) || 5000);
    this.interval = setInterval(() => this.poll(), pollIntervalMs);
  }

  _loadLastId() {
    try {
      const statePath = path.join(__dirname, "..", "..", "logs", "codex-sensor-state.json");
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        this.lastProcessedId = state.lastProcessedId || 0;
        this.rolloutFiles = state.rolloutStateVersion === ROLLOUT_STATE_VERSION
          ? (state.rolloutFiles || {})
          : {};
      }
    } catch (_) {}
  }

  _saveState() {
    try {
      const logDir = path.join(__dirname, "..", "..", "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, "codex-sensor-state.json"), JSON.stringify({
        lastProcessedId: this.lastProcessedId,
        rolloutStateVersion: ROLLOUT_STATE_VERSION,
        rolloutFiles: this.rolloutFiles
      }));
    } catch (_) {}
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (this.transportDatabaseEnabled && Date.now() - this.lastTransportPollAt >= this.transportPollIntervalMs) {
        this.lastTransportPollAt = Date.now();
        await this._pollTransportDatabase();
      }
      await this._pollRolloutFiles();
      this._saveState();
    } catch (_) {
      // Polling is best-effort. A partially-written Codex row/file is retried.
    } finally {
      this.polling = false;
    }
  }

  async _pollTransportDatabase() {
    try {
      const initSql = require("sql.js");
      const SQL = await initSql();
      if (!fs.existsSync(this.logsDbPath)) return;
      const dbStat = fs.statSync(this.logsDbPath);
      const dbFingerprint = `${dbStat.size}:${dbStat.mtimeMs}`;
      if (dbFingerprint === this.logsDbFingerprint) return;
      this.logsDbFingerprint = dbFingerprint;
      const buf = fs.readFileSync(this.logsDbPath);
      const db = new SQL.Database(buf);

      const stmt = db.prepare("SELECT id, ts, feedback_log_body FROM logs WHERE target = 'codex_client::transport' AND id > ? ORDER BY id ASC LIMIT 10");
      stmt.bind([this.lastProcessedId]);

      while (stmt.step()) {
        const row = stmt.getAsObject();
        const body = String(row.feedback_log_body || "");
        const convMatch = body.match(/conversation\.id=([a-f0-9-]+)/);
        const threadMatch = body.match(/thread_id=([a-f0-9-]+)/);
        const subMatch = body.match(/submission\.id="([a-f0-9-]+)"/);
        const convId = convMatch?.[1] || threadMatch?.[1] || "unknown";
        const submissionId = subMatch?.[1] || "unknown";

        const key = convId + ":" + submissionId;
        if (this.knownConversations.has(key)) continue;
        this.knownConversations.set(key, true);

        const userInput = this._extractUserMessage(body);
        if (userInput) {
          this.stats.prompts++;
          this.stats.lastPromptAt = new Date().toISOString();
          if (!this.knownConversations.has(convId)) {
            this.stats.sessions++;
            this.knownConversations.set(convId, true);
          }
          const cleaned = this._cleanPrompt(userInput);

          // A transport row can contain only an environment block. Do not
          // publish that as a user prompt or overwrite the session context.
          if (!cleaned) {
            if (row.id > this.lastProcessedId) this.lastProcessedId = row.id;
            continue;
          }

          if (this.eventBus) {
            this.eventBus.publish("codex:user_prompt", {
              agent: "openai-codex",
              conversationId: convId,
              threadId: threadMatch?.[1],
              submissionId,
              prompt: cleaned,
              fullPrompt: cleaned,
              timestamp: new Date(parseInt(row.ts) * 1000).toISOString()
            });
          }

          this.addEvent("codex_session", "info", "allow",
            "Codex prompt: " + cleaned.slice(0, 100),
            {
              sessionId: convId,
              conversationId: convId,
              threadId: threadMatch?.[1],
              submissionId,
              agentId: "openai-codex",
              promptPreview: cleaned.slice(0, 200),
              promptLength: cleaned.length
            }
          );
        }
        if (row.id > this.lastProcessedId) this.lastProcessedId = row.id;
      }
      stmt.free();
      db.close();
      this._saveState();
    } catch (_) { /* polling error ignored */ }
  }

  async _pollRolloutFiles() {
    if (!fs.existsSync(this.sessionsDir)) return;
    this.stats.rolloutLagBytes = 0;

    const files = this._listRolloutFiles(this.sessionsDir);
    const newest = files
      .map((file) => ({ file, stat: fs.statSync(file) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, 20)
      .map((item) => item.file);
    const tracked = Object.keys(this.rolloutFiles);
    const candidates = Array.from(new Set([...newest, ...tracked]));

    for (const file of candidates) {
      let stat;
      try { stat = fs.statSync(file); } catch (_) { continue; }
      if (!stat.isFile()) continue;

      let state = this.rolloutFiles[file];
      if (!state || Number(state.offset) > stat.size) {
        // On first install, replay only the tail of recently active sessions
        // so a live prompt is visible without importing the full history.
        const recent = Date.now() - stat.mtimeMs < 15 * 60 * 1000;
        state = { offset: recent ? Math.max(0, stat.size - this.maxRolloutReadBytes) : stat.size };
      }
      const backlogBytes = Math.max(0, stat.size - (Number(state.offset) || 0));
      this.stats.rolloutLagBytes = Math.max(this.stats.rolloutLagBytes || 0, backlogBytes);
      if (backlogBytes > this.maxRolloutReadBytes * 2) {
        state.offset = Math.max(0, stat.size - this.maxRolloutReadBytes);
        state.catchUpAt = new Date().toISOString();
        state.skippedBytes = backlogBytes - this.maxRolloutReadBytes;
        this.stats.rolloutCatchUps += 1;
      }

      if (state.size === stat.size && state.mtimeMs === stat.mtimeMs) continue;
      state.size = stat.size;
      state.mtimeMs = stat.mtimeMs;

      const startOffset = Number(state.offset) || 0;
      const bytesToRead = Math.min(Math.max(0, stat.size - startOffset), this.maxRolloutReadBytes);
      if (bytesToRead === 0) {
        state.offset = stat.size;
        this.rolloutFiles[file] = state;
        continue;
      }

      if (state.internal === undefined) state.internal = this._isInternalRollout(file);
      if (state.internal) {
        this.rolloutFiles[file] = { offset: stat.size, internal: true, size: stat.size, mtimeMs: stat.mtimeMs };
        continue;
      }

      const buffer = Buffer.allocUnsafe(bytesToRead);
      let bytesRead = 0;
      let fd;
      try {
        fd = fs.openSync(file, "r");
        bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, startOffset);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      const chunk = buffer.subarray(0, bytesRead).toString("utf8");
      let cursor = 0;
      let newline;
      while ((newline = chunk.indexOf("\n", cursor)) >= 0) {
        const line = chunk.slice(cursor, newline).replace(/\r$/, "");
        this._processRolloutLine(file, line);
        cursor = newline + 1;
      }
      state.offset = (Number(state.offset) || 0) + Buffer.byteLength(chunk.slice(0, cursor), "utf8");
      this.rolloutFiles[file] = state;
    }
  }

  _listRolloutFiles(root) {
    const result = [];
    const visit = (current) => {
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(fullPath);
      }
    };
    visit(root);
    return result;
  }

  _isInternalRollout(file) {
    try {
      const fd = fs.openSync(file, "r");
      const head = Buffer.allocUnsafe(64 * 1024);
      let bytesRead = 0;
      try { bytesRead = fs.readSync(fd, head, 0, head.length, 0); }
      finally { fs.closeSync(fd); }
      const firstLine = head.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
      const record = JSON.parse(firstLine);
      const payload = record.payload || {};
      return payload.thread_source === "subagent" || Boolean(payload.source && payload.source.subagent);
    } catch (_) {
      return false;
    }
  }

  _processRolloutLine(file, line) {
    if (!line.trim()) return;
    let record;
    try { record = JSON.parse(line); } catch (_) { return; }
    const payload = record.payload || {};
    if (record.type === "turn_context") {
      this.rolloutContexts.set(file, {
        cwd: payload.cwd || this.policy.workspaceRoot,
        turnId: payload.turn_id || null
      });
      return;
    }

    const prompt = this._extractRolloutPrompt(record);
    if (!prompt) return;
    const cleaned = this._cleanPrompt(prompt);
    if (!cleaned) return;

    const threadId = this._rolloutThreadId(file);
    const metadata = payload.internal_chat_message_metadata_passthrough || {};
    const submissionId = metadata.turn_id || null;
    const dedupeKey = `${threadId}:${cleaned}`;
    const lastSeen = this.rolloutMessageKeys.get(dedupeKey) || 0;
    if (Date.now() - lastSeen < 30 * 1000) return;
    this.rolloutMessageKeys.set(dedupeKey, Date.now());
    if (this.rolloutMessageKeys.size > 500) {
      const oldest = this.rolloutMessageKeys.keys().next().value;
      this.rolloutMessageKeys.delete(oldest);
    }

    const context = this.rolloutContexts.get(file) || {};
    const timestamp = record.timestamp || new Date().toISOString();
    this.stats.prompts++;
    this.stats.lastPromptAt = new Date().toISOString();
    if (!this.knownConversations.has(threadId)) {
      this.stats.sessions++;
      this.knownConversations.set(threadId, true);
    }
    if (this.eventBus) {
      this.eventBus.publish("codex:user_prompt", {
              agent: "openai-codex",
        conversationId: threadId,
        threadId,
        submissionId,
        cwd: context.cwd || this.policy.workspaceRoot,
        model: "codex-app-server",
        prompt: cleaned,
        fullPrompt: cleaned,
        timestamp,
        source: "codex_rollout"
      });
    }
    this.addEvent("codex_session", "info", "allow", "Codex prompt: " + cleaned.slice(0, 100), {
      sessionId: threadId,
      conversationId: threadId,
      threadId,
      submissionId,
      agentId: "openai-codex",
      cwd: context.cwd || this.policy.workspaceRoot,
      promptPreview: cleaned.slice(0, 200),
      promptLength: cleaned.length,
      source: "codex_rollout"
    });
  }

  _extractRolloutPrompt(record) {
    const payload = record.payload || {};
    if (record.type === "event_msg" && payload.type === "user_message") {
      return typeof payload.message === "string" ? payload.message : null;
    }
    // Codex v0.14x+ rollout 格式：用户消息是 response_item / message / role=user
    if (record.type === "response_item" && payload.type === "message" && String(payload.role || "").toLowerCase() === "user") {
      return this._extractContentText(payload.content) || null;
    }
    return null;
  }

  _extractContentText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => this._extractContentText(item)).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    if (typeof value.text === "string") return value.text;
    if (value.content) return this._extractContentText(value.content);
    return "";
  }

  _rolloutThreadId(file) {
    const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
    return match ? match[1] : path.basename(file, ".jsonl");
  }

  _extractUserMessage(body) {
    const textByUserMessage = this._extractRoleMessageTexts(body, "user");
    const usableUserText = textByUserMessage
      .map((text) => ({ raw: text, cleaned: this._cleanPrompt(text) }))
      .filter((item) => item.cleaned);

    // The request payload contains the conversation history. The last
    // non-empty user message is the prompt associated with this turn.
    if (usableUserText.length > 0) {
      return usableUserText[usableUserText.length - 1].raw;
    }

    // Compatibility fallback for older Codex payloads that embedded the
    // current request in the developer message.
    const developerTexts = this._extractRoleMessageTexts(body, "developer");
    for (let i = developerTexts.length - 1; i >= 0; i -= 1) {
      const marker = developerTexts[i].indexOf("## My request for Codex:");
      if (marker >= 0) {
        return developerTexts[i].slice(marker).replace(/## My request for Codex:\s*/i, "").trim();
      }
    }
    return null;
  }

  _extractRoleMessageTexts(body, role) {
    const text = String(body || "");
    const messagePattern = new RegExp(
      '\\{\\s*"type"\\s*:\\s*"message"\\s*,\\s*"role"\\s*:\\s*"' + role + '"',
      "g"
    );
    const starts = [];
    let match;
    while ((match = messagePattern.exec(text)) !== null) starts.push(match.index);

    // Some older payloads do not include the message type.
    if (starts.length === 0) {
      const rolePattern = new RegExp('"role"\\s*:\\s*"' + role + '"', "g");
      while ((match = rolePattern.exec(text)) !== null) starts.push(match.index);
    }

    const results = [];
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const end = starts[i + 1] || text.length;
      const segment = text.slice(start, end);
      const contentStart = segment.search(/"content"\s*:/);
      const searchStart = contentStart >= 0 ? contentStart : 0;
      const textPattern = /"text"\s*:\s*/g;
      textPattern.lastIndex = searchStart;
      const parts = [];
      let textMatch;
      while ((textMatch = textPattern.exec(segment)) !== null) {
        const value = this._readLooseString(segment, textMatch.index + textMatch[0].length);
        if (value !== null) parts.push(value);
      }
      if (parts.length > 0) results.push(parts.join("\n"));
    }
    return results;
  }

  _readLooseString(text, start) {
    let index = start;
    while (/\s/.test(text[index] || "")) index += 1;
    if (text[index] !== '"') return null;
    index += 1;
    let value = "";
    while (index < text.length) {
      const char = text[index];
      if (char === '"') return value;
      if (char !== "\\") {
        value += char;
        index += 1;
        continue;
      }

      const next = text[index + 1];
      const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (Object.prototype.hasOwnProperty.call(escapes, next)) {
        value += escapes[next];
        index += 2;
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
        value += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16));
        index += 6;
        continue;
      }

      // Codex logs can contain raw Windows paths such as C:\\Users. Keep
      // unknown escapes literal instead of losing the following character.
      value += "\\";
      index += 1;
    }
    return value;
  }

  _cleanPrompt(prompt) {
    return sanitizePrompt(prompt);
  }

  async stop() { this.active = false; if (this.interval) clearInterval(this.interval); this._saveState(); }
  getStats() { return { ...this.stats, transportDatabaseEnabled: this.transportDatabaseEnabled, rolloutReadBytes: this.maxRolloutReadBytes, pollIntervalMs: Math.max(2000, Number(this.policy.sensors?.codex?.pollIntervalMs) || 5000) }; }
}

module.exports = { CodexSessionSensor };

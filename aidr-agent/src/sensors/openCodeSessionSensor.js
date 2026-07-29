const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { sanitizePrompt } = require("../utils/promptSanitizer");

const STATE_VERSION = 6;
const POLL_INTERVAL_MS = 3000;
const STABLE_POLLS = 2;
const RECENT_FILE_WINDOW_MS = 30 * 60 * 1000;

class OpenCodeSessionSensor {
  constructor(policy, addEvent, eventBus, processSensor = null) {
    this.policy = policy || {};
    this.addEvent = addEvent;
    this.eventBus = eventBus;
    this.processSensor = processSensor;
    this.active = false;
    this.interval = null;
    this.polling = false;
    this.dataDir = null;
    this.dataDirs = [];
    this.statePath = null;
    this.entries = new Map();
    this.knownSessions = new Set();
    this.historyInitialized = false;
    this.stats = { sessions: 0, prompts: 0, files: 0, errors: 0, lastPromptAt: null };
  }

  async start() {
    this.active = true;
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    this.dataDirs = this._resolveDataDirs(appData);
    this.dataDir = this.dataDirs.join("; ");
    this.statePath = path.join(__dirname, "..", "..", "logs", "opencode-sensor-state.json");
    this._loadState();
    this.addEvent("system", "info", "allow", "OpenCode session sensor started", { dataDir: this.dataDir });
    this.interval = setInterval(() => this.poll().catch(() => {}), POLL_INTERVAL_MS);
    setTimeout(() => this.poll().catch(() => {}), 1000);
  }

  async stop() {
    this.active = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async poll() {
    if (!this.active || this.polling) return;
    this.polling = true;
    try {
      const workspaceFiles = this._listWorkspaceFiles();
      const globalFiles = this._listGlobalFiles();
      this.stats.files = workspaceFiles.length + globalFiles.length;
      for (const file of workspaceFiles) await this._pollWorkspaceFile(file);
      for (const file of globalFiles) await this._pollGlobalFile(file);
      this._saveState();
    } catch (error) {
      this.stats.errors++;
      this.addEvent("opencode_session", "info", "alert", "OpenCode session sensor read failed", { error: error.message });
    } finally {
      this.polling = false;
    }
  }

  _resolveDataDirs(appData) {
    const candidates = [];
    const add = value => {
      if (!value || candidates.includes(value)) return;
      if (fs.existsSync(value)) candidates.push(value);
    };
    add(process.env.AIDR_OPENCODE_DATA_DIR);
    const discovered = this.processSensor?.getAgentIdentities?.().find(agent => agent.id === "opencode");
    for (const processInfo of discovered?.processes || []) {
      const commandLine = String(processInfo.commandLine || "");
      const match = commandLine.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/i);
      if (match) add(match[1] || match[2]);
    }
    add(path.join(appData, "ai.opencode.desktop"));
    return candidates;
  }

  _listWorkspaceFiles() {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    this.dataDirs = this._resolveDataDirs(appData);
    this.dataDir = this.dataDirs.join("; ");
    const files = [];
    for (const dataDir of this.dataDirs) {
      try {
        for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
          if (entry.isFile() && /^opencode\.workspace\..+\.dat$/i.test(entry.name)) files.push(path.join(dataDir, entry.name));
        }
      } catch (_) {}
    }
    return files;
  }

  _listGlobalFiles() {
    return (this.dataDirs || [])
      .map(dataDir => path.join(dataDir, "opencode.global.dat"))
      .filter(file => fs.existsSync(file));
  }

  async _pollWorkspaceFile(file) {
    let stat;
    let record;
    try {
      stat = fs.statSync(file);
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      return;
    }
    const entries = this._extractPromptEntries(record);
    for (const entry of entries) this._observeEntry(file, stat, entry);
  }

  async _pollGlobalFile(file) {
    let stat;
    let record;
    try {
      stat = fs.statSync(file);
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      return;
    }
    let history;
    try { history = JSON.parse(record["prompt-history"] || "{}"); } catch (_) { return; }
    const items = Array.isArray(history?.entries) ? history.entries : [];
    if (!this.historyInitialized) {
      const latestPrompt = this._structuredPromptText(items[items.length - 1]?.prompt);
      const latestHash = latestPrompt ? this._hash(sanitizePrompt(latestPrompt)) : null;
      for (const item of items.slice(0, -1)) {
        const prompt = this._structuredPromptText(item?.prompt);
        const hash = prompt ? this._hash(sanitizePrompt(prompt)) : null;
        if (!hash || hash === latestHash) continue;
        this.entries.set(file + "::history:" + hash, { hash, emitted: true, emittedHash: hash, pendingCount: 0 });
      }
    }
    const start = this.historyInitialized ? 0 : Math.max(0, items.length - 1);
    for (const item of items.slice(start)) {
      const prompt = this._structuredPromptText(item?.prompt);
      if (!prompt) continue;
      const hash = this._hash(sanitizePrompt(prompt));
      this._observeEntry(file, stat, {
        sessionId: "opencode-history",
        model: "unknown",
        cwd: this.policy.workspaceRoot,
        prompt,
        source: "opencode_prompt_history",
        identityKey: "history:" + hash
      }, "history:" + hash);
    }
    this.historyInitialized = true;
  }

  _extractPromptEntries(record) {
    if (!record || typeof record !== "object") return [];
    const sessions = new Map();
    for (const [key, value] of Object.entries(record)) {
      const match = key.match(/^session:([^:]+):(.+)$/);
      if (!match) continue;
      const sessionId = match[1];
      const field = match[2];
      const session = sessions.get(sessionId) || { sessionId, prompt: "", model: "unknown", cwd: "" };
      if (field === "prompt") session.prompt = this._structuredPromptText(value);
      if (field === "model" && typeof value === "string") session.model = value;
      if ((field === "cwd" || field === "directory" || field === "workspace") && typeof value === "string") session.cwd = value;
      sessions.set(sessionId, session);
    }
    return Array.from(sessions.values()).filter(entry => entry.prompt.trim());
  }

  _structuredPromptText(value) {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") return this._structuredPromptText(parsed.prompt ?? parsed.content ?? parsed.text ?? "");
      } catch (_) {}
      return value;
    }
    if (Array.isArray(value)) return value.map(item => this._structuredPromptText(item)).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    if (typeof value.content === "string") return value.content;
    if (value.prompt !== undefined) return this._structuredPromptText(value.prompt);
    if (typeof value.text === "string") return value.text;
    return "";
  }

  _hash(value) {
    return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
  }

  _observeEntry(file, stat, entry, identityKey = null) {
    const prompt = sanitizePrompt(entry.prompt);
    if (!prompt) return;
    const hash = this._hash(prompt);
    const key = file + "::" + (identityKey || entry.sessionId);
    const previous = this.entries.get(key);
    if (previous?.emittedHash === hash || (previous?.hash === hash && previous?.emitted)) return;

    const next = previous && previous.pendingHash === hash
      ? { ...previous, pendingCount: previous.pendingCount + 1, hash }
      : { hash, pendingHash: hash, pendingCount: 1, emitted: false };
    const isRecent = Date.now() - stat.mtimeMs <= RECENT_FILE_WINDOW_MS;
    if (!previous && !isRecent) {
      this.entries.set(key, { hash, emitted: true, emittedHash: hash, pendingCount: 0 });
      return;
    }
    if (next.pendingCount < STABLE_POLLS) {
      this.entries.set(key, next);
      return;
    }

    this.entries.set(key, { hash, emitted: true, emittedHash: hash, pendingCount: next.pendingCount });
    this._publishPrompt({ ...entry, prompt }, hash);
  }

  _publishPrompt(entry, hash) {
    const timestamp = new Date().toISOString();
    const submissionId = "opencode-" + hash.slice(0, 24);
    this.stats.prompts++;
    this.stats.lastPromptAt = new Date().toISOString();
    this.stats.lastPromptAt = timestamp;
    if (!this.knownSessions.has(entry.sessionId)) {
      this.knownSessions.add(entry.sessionId);
      this.stats.sessions++;
    }
    const payload = {
      agent: "opencode",
      agentLabel: "OpenCode",
      conversationId: entry.sessionId,
      sessionId: entry.sessionId,
      threadId: entry.sessionId,
      submissionId,
      cwd: entry.cwd || this.policy.workspaceRoot,
      model: entry.model || "unknown",
      prompt: entry.prompt,
      fullPrompt: entry.prompt,
      timestamp,
      source: entry.source || "opencode_workspace_store"
    };
    if (this.eventBus) this.eventBus.publish("agent:user_prompt", payload);
    this.addEvent("opencode_session", "info", "allow", "OpenCode prompt: " + entry.prompt.slice(0, 100), {
      agent: "opencode",
      agentLabel: "OpenCode",
      conversationId: entry.sessionId,
      submissionId,
      promptPreview: entry.prompt.slice(0, 200),
      promptLength: entry.prompt.length,
      source: payload.source
    });
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return;
      const state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      if (state.version !== STATE_VERSION || !state.entries || typeof state.entries !== "object") return;
      this.entries = new Map(Object.entries(state.entries));
      this.historyInitialized = state.historyInitialized === true;
    } catch (_) {}
  }

  _saveState() {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const entries = Object.fromEntries(Array.from(this.entries.entries()).slice(-1000));
      fs.writeFileSync(this.statePath, JSON.stringify({ version: STATE_VERSION, historyInitialized: this.historyInitialized, entries }));
    } catch (_) {}
  }

  getStats() {
    return { ...this.stats, active: this.active, polling: this.polling, dataDir: this.dataDir };
  }
}

module.exports = { OpenCodeSessionSensor };

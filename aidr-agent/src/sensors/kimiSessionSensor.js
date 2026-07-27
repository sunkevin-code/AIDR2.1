const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { sanitizePrompt } = require("../utils/promptSanitizer");

function monitoredUserHome(policy = {}) {
  if (process.env.AIDR_MONITORED_USER_PROFILE) return process.env.AIDR_MONITORED_USER_PROFILE;
  const workspace = String(policy.workspaceRoot || "");
  const match = workspace.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/i);
  return match?.[1] || os.homedir();
}

class KimiSessionSensor {
  constructor(policy, addEvent, eventBus) {
    this.policy = policy || {};
    this.addEvent = addEvent;
    this.eventBus = eventBus;
    this.active = false;
    this.polling = false;
    this.timer = null;
    this.files = new Map();
    this.root = process.env.AIDR_KIMI_SESSION_ROOT || path.join(
      monitoredUserHome(this.policy), "AppData", "Roaming",
      "kimi-desktop", "daimon-share", "daimon", "runtime", "kimi-code", "home", "sessions"
    );
    this.stats = { sessions: 0, prompts: 0, files: 0, errors: 0, lastPromptAt: null, source: this.root };
  }

  async start() {
    this.active = true;
    this.addEvent("system", "info", "allow", "Kimi session sensor started", { source: this.root });
    this.timer = setInterval(() => this.poll().catch(() => {}), 2000);
    setTimeout(() => this.poll().catch(() => {}), 500);
  }

  async stop() {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (!this.active || this.polling) return;
    this.polling = true;
    try {
      const files = this._findWireFiles(this.root);
      this.stats.files = files.length;
      for (const file of files) this._pollFile(file);
    } catch (error) {
      this.stats.errors++;
      this.addEvent("kimi_session", "info", "alert", "Kimi session sensor read failed", { error: error.message });
    } finally {
      this.polling = false;
    }
  }

  _findWireFiles(root) {
    if (!fs.existsSync(root)) return [];
    const result = [];
    const queue = [{ dir: root, depth: 0 }];
    while (queue.length && result.length < 200) {
      const { dir, depth } = queue.shift();
      if (depth > 8) continue;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) queue.push({ dir: full, depth: depth + 1 });
        else if (entry.isFile() && entry.name.toLowerCase() === "wire.jsonl") result.push(full);
      }
    }
    return result;
  }

  _pollFile(file) {
    const stat = fs.statSync(file);
    const previous = this.files.get(file);
    if (!previous) {
      this.files.set(file, { offset: stat.size, remainder: "" });
      return;
    }
    if (stat.size < previous.offset) previous.offset = 0;
    if (stat.size === previous.offset) return;
    const length = stat.size - previous.offset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, buffer, 0, length, previous.offset); } finally { fs.closeSync(fd); }
    previous.offset = stat.size;
    const lines = (previous.remainder + buffer.toString("utf8")).split(/\r?\n/);
    previous.remainder = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch (_) { continue; }
      if (record.type !== "turn.prompt") continue;
      const prompt = this._extractText(record.input);
      if (prompt) this._publish(file, record, prompt);
    }
  }

  _extractText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(item => this._extractText(item)).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return this._extractText(value.text ?? value.content ?? value.prompt ?? value.message ?? "");
  }

  _publish(file, record, rawPrompt) {
    const prompt = sanitizePrompt(rawPrompt);
    if (!prompt) return;
    const conversation = file.split(/[\\/]/).find(part => /^conv-/i.test(part)) || path.basename(path.dirname(file));
    const timestamp = record.time || record.timestamp || new Date().toISOString();
    const submissionId = "kimi-" + crypto.createHash("sha256").update(conversation + prompt).digest("hex").slice(0, 24);
    this.stats.prompts++;
    this.stats.sessions = new Set([...this.files.keys()].map(item => item.split(/[\\/]/).find(part => /^conv-/i.test(part)) || item)).size;
    this.stats.lastPromptAt = timestamp;
    const payload = {
      agent: "kimi", agentLabel: "Kimi", conversationId: conversation, sessionId: conversation, threadId: conversation,
      submissionId, cwd: this.policy.workspaceRoot, model: record.model || "kimi",
      prompt, fullPrompt: prompt, timestamp, source: "kimi_wire_jsonl"
    };
    this.eventBus?.publish("agent:user_prompt", payload);
    this.addEvent("kimi_session", "info", "allow", "Kimi prompt: " + prompt.slice(0, 100), {
      agent: "kimi", agentLabel: "Kimi", conversationId: conversation, submissionId,
      promptPreview: prompt.slice(0, 200), promptLength: prompt.length, source: payload.source
    });
  }

  getStats() { return { ...this.stats, active: this.active, polling: this.polling }; }
}

module.exports = { KimiSessionSensor };

const WebSocket = require("ws");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

class TransportClient {
  constructor(policy, addEvent, queuePath = null) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.queuePath = queuePath || process.env.AIDR_TRANSPORT_QUEUE_PATH || null;
    this.maxBuffer = 1000;
    this.offlineBuffer = this._loadQueue();
    this.inFlight = new Map();
    this.httpHealthy = false;
    this.httpRetryTimer = null;
    this.httpInFlight = 0;
    this.httpConcurrency = 8;
    this.queuePersistTimer = null;
    this.heartbeatInterval = null;
    this.stats = { sent: 0, httpSent: 0, httpFailed: 0, httpRetries: 0, buffered: 0, replayed: 0, acked: 0, deduplicated: 0, dropped: 0, skippedNoServer: 0, reconnects: 0, lastError: null, lastHttpError: null, lastConnectedAt: null, lastHttpAt: null, lastDisconnectedAt: null, lastSentAt: null, lastQueuePersistedAt: null, queueError: null };
  }

  async connect() {
    if (this.ws) this._cleanup();

    const serverUrl = this.policy.serverUrl;
    if (!serverUrl) {
      this.addEvent("system", "info", "allow", "未配置服务器地址，跳过连接");
      return;
    }

    if (this.policy.transportMode !== "websocket") {
      this._postHttp({ type: "register", agentId: this.policy.agentId, agentType: this.policy.agentType, version: this.policy.version, hostname: require("os").hostname(), platform: process.platform, arch: process.arch, sensors: Object.keys(this.policy.sensors || {}).filter(k => this.policy.sensors[k].enabled) })
        .then(() => { this.httpHealthy = true; this.stats.lastHttpAt = new Date().toISOString(); this._retryHttpQueue(); })
        .catch(error => { this.stats.lastHttpError = String(error.message || error); this.stats.lastError = this.stats.lastHttpError; this._scheduleHttpRetry(); });
      return true;
    }

    try {
      const wsUrl = serverUrl.replace(/^http/, "ws") + "/ws/agent";
      this.ws = new WebSocket(wsUrl, {
        headers: this._buildHeaders(),
        perMessageDeflate: false
      });

      return new Promise((resolve) => {
        this.ws.on("open", () => {
          this.connected = true;
          this.stats.lastConnectedAt = new Date().toISOString();
          this.stats.lastError = null;
          this.addEvent("system", "info", "allow", `已连接到服务器: ${serverUrl}`);
          this._register();
          this._startHeartbeat();
          this._flushBuffer();
          resolve(true);
        });

        this.ws.on("message", (data) => this._handleMessage(data));
        this.ws.on("close", () => this._onDisconnect());
        this.ws.on("error", (err) => {
          this.stats.lastError = String(err.message || err);
          this.addEvent("system", "medium", "alert", `WebSocket 错误: ${err.message}`);
          resolve(false);
        });

        setTimeout(() => {
          if (!this.connected) resolve(false);
        }, 10000);
      });
    } catch (e) {
      this.addEvent("system", "medium", "alert", `连接失败: ${e.message}`);
      return false;
    }
  }


  _shouldUseHttp(message) {
    if (!this.policy.serverUrl || this.policy.transportMode === "websocket") return false;
    return ["event", "batch_events", "session_start"].includes(message?.type);
  }

  _agentMetadata() {
    return { agentType: this.policy.agentType, version: this.policy.version, hostname: require("os").hostname(), platform: process.platform, arch: process.arch, sensors: Object.keys(this.policy.sensors || {}).filter(k => this.policy.sensors[k].enabled) };
  }

  _postHttp(message) {
    return new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(this.policy.serverUrl);
        target.pathname = (target.pathname || "").replace(/\/$/, "") + "/api/v1/ingest";
      } catch (error) { reject(error); return; }
      const payload = Buffer.from(JSON.stringify({ agentId: this.policy.agentId, agent: this._agentMetadata(), message }), "utf8");
      const transport = target.protocol === "https:" ? https : http;
      const headers = { ...this._buildHeaders(), "Content-Type": "application/json", "Content-Length": payload.length };
      const req = transport.request({ hostname: target.hostname, port: target.port || (target.protocol === "https:" ? 443 : 80), path: target.pathname + target.search, method: "POST", headers, timeout: 5000 }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error("HTTP ingest " + res.statusCode + ": " + data.slice(0, 180))); return; }
          try { resolve(JSON.parse(data || "{}")); } catch (_) { resolve({ ok: true }); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("HTTP ingest timeout")));
      req.on("error", reject);
      req.end(payload);
    });
  }

  _sendHttpItem(item) {
    if (!item || item.httpPending || this.httpInFlight >= this.httpConcurrency) return false;
    item.httpPending = true;
    item.attempts = Number(item.attempts || 0) + 1;
    this.httpInFlight++;
    let succeeded = false;
    this._persistQueueSoon();
    this._postHttp(item.message).then(() => {
      succeeded = true;
      this.httpHealthy = true;
      this.stats.httpSent++;
      this.stats.lastHttpAt = new Date().toISOString();
      this.stats.lastError = this.connected ? this.stats.lastError : null;
      this._acknowledge([item.id]);
    }).catch(error => {
      this.httpHealthy = false;
      this.stats.httpFailed++;
      this.stats.httpRetries++;
      this.stats.lastHttpError = String(error.message || error);
      this.stats.lastError = this.stats.lastHttpError;
      this._persistQueueSoon();
      this._scheduleHttpRetry();
    }).finally(() => {
      item.httpPending = false;
      this.httpInFlight = Math.max(0, this.httpInFlight - 1);
      if (succeeded) this._retryHttpQueue();
    });
    return true;
  }

  _retryHttpQueue() {
    if (!this.policy.serverUrl) return;
    while (this.httpInFlight < this.httpConcurrency && this.offlineBuffer.length > 0 && this._shouldUseHttp(this.offlineBuffer[0].message)) {
      const item = this.offlineBuffer.shift();
      this.inFlight.set(item.id, item);
      this.stats.replayed++;
      this._sendHttpItem(item);
    }
    for (const item of this.inFlight.values()) {
      if (this.httpInFlight >= this.httpConcurrency) break;
      if (this._shouldUseHttp(item.message)) this._sendHttpItem(item);
    }
    this._persistQueueSoon();
  }

  _scheduleHttpRetry() {
    if (this.httpRetryTimer || !this.policy.serverUrl) return;
    this.httpRetryTimer = setTimeout(() => { this.httpRetryTimer = null; this._retryHttpQueue(); }, 5000);
    this.httpRetryTimer.unref?.();
  }
  _buildHeaders() {
    const headers = {};
    if (this.policy.serverAuthToken) {
      headers["Authorization"] = `Bearer ${this.policy.serverAuthToken}`;
    }
    return headers;
  }

  _register() {
    this._send({
      type: "register",
      agentId: this.policy.agentId,
      agentType: this.policy.agentType,
      version: this.policy.version,
      hostname: require("os").hostname(),
      platform: process.platform,
      arch: process.arch,
      sensors: Object.keys(this.policy.sensors || {}).filter(k => this.policy.sensors[k].enabled)
    });
  }

  _startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        this._send({
          type: "heartbeat",
          agentId: this.policy.agentId,
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          stats: this.stats
        });
      }
    }, 10000);
  }

  _onDisconnect() {
    this.connected = false;
    this.stats.lastDisconnectedAt = new Date().toISOString();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.addEvent("system", "medium", "alert", "与服务器断开连接");

    if (this.policy.serverUrl) {
      this.stats.reconnects++;
      this._scheduleHttpRetry();
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  _handleMessage(data) {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case "policy_update": {
          if (msg.policy) {
            this.addEvent("system", "info", "allow", "收到策略更新");
            if (this.onPolicyUpdate) this.onPolicyUpdate(msg.policy);
          }
          break;
        }
        case "command": {
          this.addEvent("system", "info", "allow", `收到服务端指令: ${msg.command}`);
          if (this.onCommand) this.onCommand(msg);
          break;
        }
        case "ack": {
          const ids = msg.eventIds || (msg.eventId ? [msg.eventId] : (msg.messageId ? [msg.messageId] : []));
          this._acknowledge(ids);
          break;
        }
        default: {
          this.addEvent("system", "info", "allow", `收到消息: ${msg.type || "unknown"}`);
        }
      }
    } catch (_) {}
  }

  _acknowledge(ids = []) {
    let changed = false;
    for (const id of ids.map(String)) {
      if (this.inFlight.delete(id)) {
        this.stats.acked++;
        changed = true;
      }
    }
    if (changed) this._persistQueueSoon();
  }

  _send(msg, options = {}) {
    if (!this.policy.serverUrl) {
      this.stats.skippedNoServer++;
      return false;
    }
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        this.stats.sent++;
        this.stats.lastSentAt = new Date().toISOString();
        return true;
      } catch (error) {
        this.stats.lastError = String(error.message || error);
        if (options.queue !== false) this._buffer(msg);
        return false;
      }
    }
    if (options.queue !== false) this._buffer(msg);
    return false;
  }

  _messageId(msg) {
    if (msg?.type === "event" && msg.event?.eventId) return String(msg.event.eventId);
    if (msg?.type === "session_start" && msg.sessionId) return `session:${msg.sessionId}:${msg.timestamp || ""}`;
    return crypto.createHash("sha256").update(JSON.stringify(msg || {})).digest("hex");
  }

  _loadQueue() {
    try {
      if (!this.queuePath || !require("fs").existsSync(this.queuePath)) return [];
      const raw = JSON.parse(require("fs").readFileSync(this.queuePath, "utf8"));
      const items = Array.isArray(raw) ? raw : [...(raw.items || []), ...(raw.inFlight || [])];
      return (items || []).filter(item => item?.message).map(item => ({ id: item.id || this._messageId(item.message), message: item.message, createdAt: item.createdAt || new Date().toISOString(), attempts: Number(item.attempts || 0) })).slice(-this.maxBuffer);
    } catch (error) {
      this.stats && (this.stats.queueError = String(error.message || error));
      return [];
    }
  }

  _persistQueueSoon() {
    if (!this.queuePath || this.queuePersistTimer) return;
    this.queuePersistTimer = setTimeout(() => { this.queuePersistTimer = null; this._persistQueue(); }, 250);
    this.queuePersistTimer.unref?.();
  }

  _persistQueue() {
    if (!this.queuePath) return;
    try {
      const fs = require("fs");
      const path = require("path");
      fs.mkdirSync(path.dirname(this.queuePath), { recursive: true });
      const temp = `${this.queuePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(temp, JSON.stringify({ version: 2, items: this.offlineBuffer, inFlight: [...this.inFlight.values()] }, null, 2), "utf8");
      fs.renameSync(temp, this.queuePath);
      this.stats.lastQueuePersistedAt = new Date().toISOString();
      this.stats.queueError = null;
    } catch (error) {
      this.stats.queueError = String(error.message || error);
    }
  }

  _buffer(msg) {
    const id = this._messageId(msg);
    if (this.offlineBuffer.some(item => item.id === id) || this.inFlight.has(id)) {
      this.stats.deduplicated++;
      return;
    }
    this.offlineBuffer.push({ id, message: msg, createdAt: new Date().toISOString(), attempts: 0 });
    this.stats.buffered++;
    if (this.offlineBuffer.length > this.maxBuffer) {
      this.offlineBuffer.shift();
      this.stats.dropped++;
    }
    this._persistQueue();
  }

  _flushBuffer() {
    this._retryHttpQueue();
    while (this.offlineBuffer.length > 0) {
      const item = this.offlineBuffer[0];
      if (this._shouldUseHttp(item.message)) break;
      if (!this.connected || !this._send(item.message, { queue: false })) break;
      this.offlineBuffer.shift();
      item.attempts++;
      this.inFlight.set(item.id, item);
      this.stats.replayed++;
      this._persistQueueSoon();
    }
  }

  _cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.connected = false;
  }

  _deliverReliable(message) {
    if (!this.policy.serverUrl) { this._send(message); return; }
    const id = this._messageId(message);
    if (this.offlineBuffer.some(item => item.id === id) || this.inFlight.has(id)) { this.stats.deduplicated++; return; }
    const item = { id, message, createdAt: new Date().toISOString(), attempts: 0, httpPending: false };
    this.inFlight.set(id, item);
    this._persistQueue();
    if (this._shouldUseHttp(message)) { this._sendHttpItem(item); return; }
    if (this.connected && !this._send(message, { queue: false })) { this.inFlight.delete(id); this._buffer(message); }
    else if (!this.connected) this._buffer(message);
  }

  _deliverEvent(message) { this._deliverReliable(message); }

  sendEvent(event) {
    const detail = this._sanitizeDetail(event.detail || {});
    this._deliverEvent({
      type: "event",
      agentId: this.policy.agentId,
      event: {
        timestamp: event.time || new Date().toISOString(),
        category: event.category,
        severity: event.severity,
        verdict: event.verdict,
        summary: event.summary,
        detail,
        mitreTactic: event.mitreTactic || null,
        mitreTechnique: event.mitreTechnique || null,
        eventId: event.eventId || null,
        schemaVersion: event.schemaVersion || 1,
        sessionId: event.sessionId || null,
        agentId: event.agentId || this.policy.agentId || null
      }
    });
  }

  sendBatchEvents(events) { for (const event of events || []) this.sendEvent(event); }

  sendSessionStart(data) {
    const prompt = String(data.prompt || "");
    this._deliverReliable({
      type: "session_start", agentId: this.policy.agentId, sessionId: data.sessionId,
      threadId: data.threadId, submissionId: data.submissionId,
      prompt: this.policy.privacy?.uploadRawPrompts === true ? prompt : prompt.slice(0, 180),
      promptHash: this._hash(prompt), promptLength: prompt.length, timestamp: data.timestamp
    });
  }

  _sanitizeDetail(detail) {
    if (this.policy.privacy?.uploadRawPrompts === true) return detail;
    const sensitiveKeys = /^(prompt|fullPrompt|tool_response|response|content|apiKey|token|password|secret)$/i;
    const walk = (value, key = "", depth = 0) => {
      if (depth > 5) return "[TRUNCATED]";
      if (sensitiveKeys.test(key)) {
        const text = typeof value === "string" ? value : JSON.stringify(value || "");
        return { redacted: true, preview: String(text).slice(0, 180), length: String(text).length, sha256: this._hash(text) };
      }
      if (Array.isArray(value)) return value.slice(0, 50).map(item => walk(item, key, depth + 1));
      if (value && typeof value === "object") {
        const out = {};
        for (const [childKey, childValue] of Object.entries(value)) out[childKey] = walk(childValue, childKey, depth + 1);
        return out;
      }
      if (typeof value === "string" && value.length > 1000) return value.slice(0, 1000) + "...[truncated]";
      return value;
    };
    return walk(detail);
  }

  _hash(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
  }

  async stop() {
    this._cleanup();
    if (this.httpRetryTimer) clearTimeout(this.httpRetryTimer);
    this.httpRetryTimer = null;
  }

  getStats() { return { ...this.stats, connected: this.connected || this.httpHealthy, websocketConnected: this.connected, httpHealthy: this.httpHealthy, transportMode: this.httpHealthy ? "http-ingest" : (this.connected ? "websocket-control" : "offline"), serverConfigured: Boolean(this.policy.serverUrl), queueDepth: this.offlineBuffer.length + this.inFlight.size, inFlight: this.inFlight.size, maxBuffer: this.maxBuffer, walPath: this.queuePath }; }
}

module.exports = { TransportClient };


const http = require("http");
const https = require("https");
const { EventEmitter } = require("events");

class CodexProxy extends EventEmitter {
  constructor(options = {}) {
    super();
    this.listenPort = options.listenPort || 15721;
    this.upstreamHost = options.upstreamHost || "127.0.0.1";
    this.upstreamPort = options.upstreamPort || 15722;
    this.server = null;
    this.stats = { requests: 0, sessions: 0, errors: 0 };
    this.active = false;
    this.sessions = [];
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server.once("error", (err) => {
        this.active = false;
        this.stats.errors++;
        reject(err);
      });
      this.server.listen(this.listenPort, "127.0.0.1", () => {
        this.active = true;
        this.emit("started", this.listenPort);
        resolve();
      });
    });
  }

  _handleRequest(clientReq, clientRes) {
    this.stats.requests++;

    let bodyChunks = [];
    clientReq.on("data", chunk => bodyChunks.push(chunk));
    clientReq.on("end", () => {
      const body = Buffer.concat(bodyChunks).toString("utf8");
      const bodySize = Buffer.concat(bodyChunks).length;

      // Extract prompt from request body
      this._extractPrompt(clientReq.url, body);

      // Forward to upstream
      const options = {
        hostname: this.upstreamHost,
        port: this.upstreamPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: this.upstreamHost + ":" + this.upstreamPort },
        timeout: 120000
      };

      const proxyReq = http.request(options, (proxyRes) => {
        // Stream response back
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);

        // Capture response for stream completion detection
        let responseBody = [];
        proxyRes.on("data", chunk => {
          clientRes.write(chunk);
          responseBody.push(chunk);
        });
        proxyRes.on("end", () => {
          clientRes.end();
          const respText = Buffer.concat(responseBody).toString("utf8");
          this._extractResponse(respText);
        });
      });

      proxyReq.on("error", (err) => {
        this.stats.errors++;
        clientRes.writeHead(502, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({ error: "proxy_error", message: err.message }));
      });

      proxyReq.setTimeout(120000, () => {
        proxyReq.destroy();
        clientRes.writeHead(504);
        clientRes.end();
      });

      if (bodySize > 0) proxyReq.write(Buffer.concat(bodyChunks));
      proxyReq.end();
    });

    clientReq.on("error", () => {});
  }

  _extractPrompt(url, body) {
    if (!body) return;

    try {
      const data = JSON.parse(body);

      // OpenAI chat completions format
      if (url.includes("/chat/completions") && data.messages) {
        const userMsgs = data.messages.filter(m => m.role === "user").map(m => m.content).join("\n");
        if (userMsgs) {
          this._saveSession("chat", userMsgs, data);
        }
      }

      // Codex /v1/responses format
      if (url.includes("/responses") && data.input) {
        const userInput = data.input
          .filter(i => i.role === "user" || (typeof i === "object" && i.role === "user"))
          .map(i => typeof i.content === "string" ? i.content : JSON.stringify(i.content))
          .join("\n");

        if (userInput) {
          // Extract the actual task from the developer message
          const developerInput = data.input
            .filter(i => i.role === "developer")
            .map(i => {
              if (typeof i.content === "string") return i.content;
              if (Array.isArray(i.content)) return i.content.map(c => c.text || "").join("\n");
              return "";
            }).join("\n");

          const task = this._extractTask(userInput, developerInput);
          this._saveSession("responses", task, data);
        }
      }

      // General prompt extraction from any JSON body
      if (data.prompt || data.question || data.query) {
        const prompt = data.prompt || data.question || data.query;
        this._saveSession("general", prompt, data);
      }
    } catch (_) {}
  }

  _extractTask(userInput, developerInput) {
    // Try to extract "My request for Codex:" from developer message first
    if (developerInput) {
      const marker = developerInput.indexOf("## My request for Codex:");
      if (marker >= 0) {
        let task = developerInput.slice(marker).replace(/## My request for Codex:\s*\n?/, "").trim();
        task = task.split("\n")[0].trim();
        if (task) return task;
      }
    }
    // Fallback to user message, cleaned
    return userInput
      .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
      .replace(/## My request for Codex:\s*\n?/g, "")
      .trim()
      .slice(0, 200);
  }

  _saveSession(type, prompt, requestData) {
    const sessionId = requestData.metadata?.session_id ||
      requestData.conversation_id ||
      "sess_" + Date.now().toString(36);

    // Skip duplicates within 5 seconds
    const recent = this.sessions.find(s => s.prompt === prompt && Date.now() - s.time < 5000);
    if (recent) {
      recent.count = (recent.count || 1) + 1;
      return;
    }

    this.stats.sessions++;

    const session = {
      id: sessionId,
      type,
      prompt,
      model: requestData.model || "unknown",
      time: Date.now(),
      timestamp: new Date().toISOString(),
      requestSize: JSON.stringify(requestData).length
    };

    this.sessions.push(session);
    if (this.sessions.length > 200) this.sessions.shift();

    this.emit("session", session);
  }

  _extractResponse(responseText) {
    try {
      const data = JSON.parse(responseText);
      // Could extract model response, token usage, etc.
      if (data.usage) {
        this.emit("usage", data.usage);
      }
    } catch (_) {}
  }

  async stop() {
    this.active = false;
    if (this.server) {
      return new Promise(resolve => this.server.close(resolve));
    }
  }

  getStats() { return { ...this.stats, sessionCount: this.sessions.length }; }
  getSessions() { return this.sessions.slice(-50); }
}

module.exports = { CodexProxy };

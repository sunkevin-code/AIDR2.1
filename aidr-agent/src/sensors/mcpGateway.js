const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

class MCPGateway {
  constructor(policy, addEvent, ruleEngine) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ruleEngine = ruleEngine;
    this.active = false;
    this.server = null;
    const gatewayPolicy = policy.sensors?.mcp_gateway || {};
    this.upstreamUrl = String(gatewayPolicy.upstream || gatewayPolicy.upstreamUrl || process.env.AIDR_MCP_UPSTREAM_URL || "").trim();
    this.upstreamHeaders = gatewayPolicy.headers && typeof gatewayPolicy.headers === "object" ? { ...gatewayPolicy.headers } : {};
    this.timeoutMs = Math.max(1000, Math.min(120000, Number(gatewayPolicy.timeoutMs || process.env.AIDR_MCP_TIMEOUT_MS || 30000)));
    this.maxBodyBytes = Math.max(1024, Math.min(10 * 1024 * 1024, Number(gatewayPolicy.maxBodyBytes || 1024 * 1024)));
    this.stats = { requests: 0, intercepted: 0, blocked: 0, approvals: 0, forwarded: 0, upstreamErrors: 0, upstreamConfigured: Boolean(this.upstreamUrl) };
  }

  async start() {
    if (!this.policy.sensors?.mcp_gateway?.enabled || this.active || this.server) return;
    const proxyPort = this.policy.sensors.mcp_gateway.proxy || 9797;

    this.server = http.createServer((req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");

      const chunks = [];
      let bodyBytes = 0;
      let tooLarge = false;
      req.on("data", chunk => {
        bodyBytes += chunk.length;
        if (bodyBytes <= this.maxBodyBytes) chunks.push(chunk);
        else tooLarge = true;
      });
      req.on("end", () => {
        this.stats.requests++;
        if (tooLarge) {
          res.writeHead(413, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "mcp_request_too_large", maxBodyBytes: this.maxBodyBytes }));
        }
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed = this._parseMCPRequest(req, body);
        this._handleMCPCall(parsed, res).catch(error => {
          this.stats.upstreamErrors++;
          if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mcp_gateway_error", message: error.message }));
        });
      });
      req.on("error", () => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "proxy error" }));
      });
    });

    this.server.on("error", error => {
      this.active = false;
      this.server = null;
      this.addEvent("system", "medium", "alert", `MCP gateway unavailable: ${error.message}`, {
        code: error.code,
        port: proxyPort
      });
    });

    this.server.listen(proxyPort, "127.0.0.1", () => {
      this.active = true;
      this.addEvent("system", "info", "allow", `MCP 网关代理已启动: 127.0.0.1:${proxyPort}`);
    });
  }

  _parseMCPRequest(req, body) {
    let toolName = "unknown";
    let toolArgs = {};
    try {
      const json = JSON.parse(body);
      if (json.method === "tools/call") {
        toolName = json.params?.name || "unknown";
        toolArgs = json.params?.arguments || {};
      } else if (json.method === "tools/list") {
        toolName = "tools/list";
      } else {
        toolName = json.method || "unknown";
      }
    } catch (_) {}

    return { toolName, toolArgs, method: req.method, url: req.url, rawBody: body, headers: req.headers };
  }

  async _handleMCPCall(parsed, res) {
    const { toolName, toolArgs } = parsed;

    const dangerousTools = [
      "execute_command", "run_shell", "bash", "terminal",
      "write_file", "create_file", "delete_file",
      "web_fetch", "http_request", "curl"
    ];

    const isDangerous = dangerousTools.some(t =>
      toolName.toLowerCase().includes(t.toLowerCase())
    );

    const event = {
      category: "mcp_tool",
      summary: `MCP 工具调用: ${toolName}`,
      detail: { toolName, toolArgs: JSON.stringify(toolArgs), dangerous: isDangerous }
    };

    const ruleResult = this.ruleEngine ? this.ruleEngine.evaluate(event) : { verdict: isDangerous ? "alert" : "allow" };
    const allowedTools = this.policy.sessionPolicy?.allowedMcpTools || [];
    const explicitlyAllowed = allowedTools.includes(toolName);
    if (allowedTools.length && !explicitlyAllowed && ruleResult.verdict !== "block") {
      ruleResult.verdict = "block";
      ruleResult.matchedRule = "mcp.tool_allowlist";
    } else if (isDangerous && this.policy.mode === "enforce" && !explicitlyAllowed && ruleResult.verdict !== "block") {
      ruleResult.verdict = "block";
      ruleResult.matchedRule = "mcp.default_deny_write";
    }

    if (ruleResult.verdict === "block") {
      this.stats.blocked++;
      this.addEvent("mcp_tool", "high", "block",
        `MCP 工具调用已拦截: ${toolName}`,
        { toolName, toolArgs: JSON.stringify(toolArgs), effectProof: { source: "mcp-gateway-preflight", enforcementPoint: "MCPGateway", prevented: true, executed: false, attempted: false } },
        { mitreTactic: "Execution", mitreTechnique: "T1059" }
      );
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Blocked by AIDR MCP Gateway", rule: ruleResult.matchedRule, effectProof: { source: "mcp-gateway-preflight", prevented: true, executed: false } }));
    }

    if (isDangerous || ruleResult.verdict === "alert") {
      this.stats.intercepted++;
      this.addEvent("mcp_tool", "medium", ruleResult.verdict,
        `MCP 高危工具调用: ${toolName}`,
        { toolName, toolArgs: JSON.stringify(toolArgs) });
    }

    const needsApproval = ruleResult.verdict === "alert" && this.policy.mode === "enforce";
    if (needsApproval) {
      this.stats.approvals++;
      this.addEvent("mcp_tool", "medium", "alert",
        `MCP 调用需要审批: ${toolName}`,
        { toolName, approvalRequired: true, effectProof: { source: "mcp-gateway-preflight", enforcementPoint: "MCPGateway", prevented: true, executed: false, attempted: false } });
      res.writeHead(202, { "Content-Type": "application/json", "X-AIDR-Decision": "approval_required" });
      return res.end(JSON.stringify({ status: "approval_required", tool: toolName, verdict: "alert", rule: ruleResult.matchedRule || null }));
    }

    if (!this.upstreamUrl) {
      this.stats.upstreamErrors++;
      this.addEvent("mcp_tool", "high", "alert", `MCP 上游未配置: ${toolName}`, {
        toolName,
        effectProof: { source: "mcp-gateway", enforcementPoint: "MCPGateway", prevented: false, executed: false, attempted: false }
      });
      res.writeHead(503, { "Content-Type": "application/json", "X-AIDR-Decision": "upstream_not_configured" });
      return res.end(JSON.stringify({ error: "mcp_upstream_not_configured", message: "Configure sensors.mcp_gateway.upstream before enabling forwarding" }));
    }

    const upstream = await this._forward(parsed);
    this.stats.forwarded++;
    const requestHash = crypto.createHash("sha256").update(String(parsed.rawBody || "")).digest("hex");
    const responseHash = crypto.createHash("sha256").update(String(upstream.body || "")).digest("hex");
    const effectProof = { source: "mcp-upstream", enforcementPoint: "MCPGateway", prevented: false, executed: true, attempted: true, upstreamStatus: upstream.statusCode, requestHash, responseHash, observedAt: new Date().toISOString() };
    this.addEvent("mcp_tool", upstream.statusCode >= 400 ? "medium" : "info", upstream.statusCode >= 400 ? "alert" : "allow", `MCP 上游响应: ${toolName}`, { toolName, statusCode: upstream.statusCode, effectProof });
    res.writeHead(upstream.statusCode, { "Content-Type": upstream.headers["content-type"] || "application/json", "X-AIDR-Decision": "allow", "X-AIDR-Effect-Proof": "runtime" });
    return res.end(upstream.body);
  }

  _forward(parsed) {
    const target = new URL(this.upstreamUrl);
    if (!/^https?:$/.test(target.protocol)) throw new Error("mcp_upstream_scheme_not_supported");
    const transport = target.protocol === "https:" ? https : http;
    const body = parsed.rawBody || JSON.stringify({ jsonrpc: "2.0", method: parsed.method, params: parsed.toolArgs });
    const headers = { "content-type": parsed.headers?.["content-type"] || "application/json", "content-length": Buffer.byteLength(body), ...this.upstreamHeaders };
    return new Promise((resolve, reject) => {
      const request = transport.request({ hostname: target.hostname, port: target.port || undefined, path: `${target.pathname || "/"}${target.search || ""}`, method: "POST", headers, timeout: this.timeoutMs }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode || 502, headers: response.headers || {}, body: Buffer.concat(chunks) }));
      });
      request.on("timeout", () => request.destroy(new Error("mcp_upstream_timeout")));
      request.on("error", reject);
      request.end(body);
    });
  }

  async stop() {
    this.active = false;
    const server = this.server;
    this.server = null;
    if (server) {
      return new Promise(resolve => server.close(resolve));
    }
  }

  getStats() { return { ...this.stats, upstreamUrl: this.upstreamUrl ? this.upstreamUrl.replace(/\/\/[^/]+@/, "//[redacted]@") : null, timeoutMs: this.timeoutMs }; }
}

module.exports = { MCPGateway };

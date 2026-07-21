const net = require("net");
const http = require("http");

class MCPGateway {
  constructor(policy, addEvent, ruleEngine) {
    this.policy = policy;
    this.addEvent = addEvent;
    this.ruleEngine = ruleEngine;
    this.active = false;
    this.server = null;
    this.stats = { requests: 0, intercepted: 0, blocked: 0 };
  }

  async start() {
    if (!this.policy.sensors?.mcp_gateway?.enabled || this.active || this.server) return;
    const proxyPort = this.policy.sensors.mcp_gateway.proxy || 9797;

    this.server = http.createServer((req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");

      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        this.stats.requests++;
        const parsed = this._parseMCPRequest(req, body);
        this._handleMCPCall(parsed, res);
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

    return { toolName, toolArgs, method: req.method, url: req.url };
  }

  _handleMCPCall(parsed, res) {
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
    const explicitlyAllowed = (this.policy.sessionPolicy?.allowedMcpTools || []).includes(toolName);
    if (isDangerous && this.policy.mode === "enforce" && !explicitlyAllowed && ruleResult.verdict !== "block") {
      ruleResult.verdict = "block";
      ruleResult.matchedRule = "mcp.default_deny_write";
    }

    if (ruleResult.verdict === "block") {
      this.stats.blocked++;
      this.addEvent("mcp_tool", "high", "block",
        `MCP 工具调用已拦截: ${toolName}`,
        { toolName, toolArgs: JSON.stringify(toolArgs) },
        { mitreTactic: "Execution", mitreTechnique: "T1059" }
      );
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Blocked by AIDR MCP Gateway", rule: ruleResult.matchedRule }));
    }

    if (isDangerous || ruleResult.verdict === "alert") {
      this.stats.intercepted++;
      this.addEvent("mcp_tool", "medium", ruleResult.verdict,
        `MCP 高危工具调用: ${toolName}`,
        { toolName, toolArgs: JSON.stringify(toolArgs) });
    }

    const needsApproval = ruleResult.verdict === "alert" && this.policy.mode === "enforce";
    if (needsApproval) {
      this.addEvent("mcp_tool", "medium", "alert",
        `MCP 调用需要审批: ${toolName}`,
        { toolName });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "proxied", tool: toolName, verdict: ruleResult.verdict }));
  }

  async stop() {
    this.active = false;
    const server = this.server;
    this.server = null;
    if (server) {
      return new Promise(resolve => server.close(resolve));
    }
  }

  getStats() { return this.stats; }
}

module.exports = { MCPGateway };

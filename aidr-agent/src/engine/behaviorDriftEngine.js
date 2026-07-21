const path = require("path");

const CAPABILITIES = ["fileRead", "fileWrite", "shell", "network", "mcpRead", "mcpWrite"];

class BehaviorDriftEngine {
  constructor(options = {}) {
    this.alertThreshold = Number(options.alertThreshold || 20);
    this.blockThreshold = Number(options.blockThreshold || 70);
    this.maxFindings = Number(options.maxFindings || 50);
    this.stats = { checked: 0, detected: 0, alerted: 0, blocked: 0, maxScore: 0 };
  }

  createBaseline(intent, input = {}) {
    const policy = intent?.policy || {};
    const capabilities = { ...(intent?.capabilities || {}) };
    for (const key of CAPABILITIES) capabilities[key] = Boolean(capabilities[key]);
    return {
      version: "aidr-behavior-baseline-v1",
      createdAt: new Date().toISOString(),
      workspaceRoot: path.resolve(policy.workspaceRoot || input.cwd || process.cwd()),
      intentSummary: intent?.summary || "",
      intentRiskLevel: intent?.riskLevel || "low",
      capabilities,
      allowedDomains: Array.from(new Set(policy.allowedDomains || [])).map(value => String(value).toLowerCase()),
      allowedMcpTools: Array.from(new Set(policy.allowedMcpTools || [])).map(String),
      expectedChain: this._expectedChain(capabilities),
      observed: { tools: [], categories: [], domains: [], paths: [], mcpTools: [], transitions: [] },
      actionCount: 0
    };
  }

  observePrompt(session, intent, input = {}) {
    if (!session.behaviorBaseline) {
      session.behaviorBaseline = this.createBaseline(intent, input);
      session.behaviorDrift = this._emptyState();
      return this._result(0, []);
    }

    const baseline = session.behaviorBaseline;
    const findings = [];
    const previous = baseline.capabilities || {};
    const current = intent?.capabilities || {};
    for (const key of ["fileWrite", "shell", "network", "mcpWrite"]) {
      if (!previous[key] && current[key]) {
        findings.push(this._finding("prompt_intent_expansion", 15,
          `Prompt expanded capability: ${key}`, { capability: key }));
      }
    }
    for (const domain of intent?.policy?.allowedDomains || []) {
      if (!baseline.allowedDomains.includes(String(domain).toLowerCase())) {
        findings.push(this._finding("prompt_new_domain", 15,
          `Prompt introduced a new domain: ${domain}`, { domain }));
      }
    }
    for (const tool of intent?.policy?.allowedMcpTools || []) {
      if (!baseline.allowedMcpTools.includes(String(tool))) {
        findings.push(this._finding("prompt_new_mcp", 15,
          `Prompt introduced a new MCP tool: ${tool}`, { tool }));
      }
    }
    return this._apply(session, findings, "User prompt compared with session behavior baseline");
  }

  observeTool(session, input = {}, effective = {}) {
    if (!session.behaviorBaseline) return this._result(0, []);
    const baseline = session.behaviorBaseline;
    const action = this._classify(input);
    const findings = [];
    const capabilities = baseline.capabilities || {};

    if (action.shell && !capabilities.shell) {
      findings.push(this._finding("capability_escalation", 45, "Shell execution was outside the behavior baseline", { capability: "shell" }));
    }
    if (action.fileWrite && !capabilities.fileWrite) {
      findings.push(this._finding("capability_escalation", 45, "File write was outside the behavior baseline", { capability: "fileWrite" }));
    }
    if (action.network && !capabilities.network) {
      findings.push(this._finding("capability_escalation", 45, "Network access was outside the behavior baseline", { capability: "network" }));
    }
    if (action.mcpWrite && !capabilities.mcpWrite) {
      findings.push(this._finding("capability_escalation", 45, "Write-capable MCP use was outside the behavior baseline", { capability: "mcpWrite" }));
    }
    if (action.mcp && !this._contains(baseline.allowedMcpTools, action.toolName)) {
      findings.push(this._finding("new_mcp_tool", action.mcpWrite ? 35 : 20,
        `MCP tool was not declared by the session baseline: ${action.toolName}`, { tool: action.toolName }));
    }
    for (const domain of action.domains) {
      if (!this._contains(baseline.allowedDomains, domain)) {
        findings.push(this._finding("new_domain", 30, `Domain was not declared by the session baseline: ${domain}`, { domain }));
      }
    }
    for (const target of action.paths) {
      const resolved = path.resolve(input.cwd || baseline.workspaceRoot, target);
      if (!this._within(resolved, baseline.workspaceRoot)) {
        findings.push(this._finding("path_outside_baseline", 35,
          `Path was outside the session workspace: ${target}`, { path: target }));
      }
    }

    const observedTools = baseline.observed.tools || [];
    const observedCategories = baseline.observed.categories || [];
    if (action.toolName && !observedTools.includes(action.toolName)) {
      findings.push(this._finding("new_tool", 10, `New tool observed in the behavior chain: ${action.toolName}`, { tool: action.toolName }));
    }
    if (action.category && observedCategories.length && !observedCategories.includes(action.category)) {
      findings.push(this._finding("sequence_deviation", 15,
        `New behavior category observed: ${action.category}`, { category: action.category }));
    }
    if (action.sensitive) {
      findings.push(this._finding("sensitive_target", 40, "Sensitive data target observed in the behavior chain", {}));
    }
    if (action.destructive) {
      findings.push(this._finding("destructive_action", 55, "Destructive action observed in the behavior chain", {}));
    }

    const previousCategory = baseline.observed.categories?.slice(-1)[0];
    if (previousCategory && previousCategory !== action.category && action.network && !capabilities.network && previousCategory === "file") {
      findings.push(this._finding("sequence_deviation", 20,
        "Network activity followed file activity without an explicit network baseline", { previousCategory, category: action.category }));
    }

    baseline.actionCount = Number(baseline.actionCount || 0) + 1;
    this._remember(baseline.observed.tools, action.toolName, 100);
    this._remember(baseline.observed.categories, action.category, 100);
    for (const domain of action.domains) this._remember(baseline.observed.domains, domain, 100);
    for (const target of action.paths) this._remember(baseline.observed.paths, target, 100);
    if (action.mcp) this._remember(baseline.observed.mcpTools, action.toolName, 100);
    if (previousCategory && previousCategory !== action.category) {
      this._remember(baseline.observed.transitions, `${previousCategory}->${action.category}`, 100);
    }
    return this._apply(session, findings, `Behavior checked: ${action.toolName || "unknown"}`);
  }

  getStats() {
    return { ...this.stats };
  }

  _classify(input) {
    const toolName = String(input.tool_name || "unknown");
    const serialized = this._serialize(input.tool_input);
    const lower = `${toolName} ${serialized}`.toLowerCase();
    const domains = [];
    for (const match of lower.matchAll(/https?:\/\/([^\s/"'<>]+)/gi)) domains.push(match[1]);
    const paths = [];
    const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
    for (const key of ["path", "file", "file_path", "target", "directory", "cwd"]) {
      if (typeof toolInput[key] === "string" && this._looksLikePath(toolInput[key])) paths.push(toolInput[key]);
    }
    const shell = toolName === "Bash" || /shell|command|powershell|terminal/i.test(toolName);
    const fileWrite = /apply_patch|^(edit|write|save|delete)$/i.test(toolName) || /\b(?:write|edit|modify|update|delete|rename|move|mkdir|remove-item|set-content)\b/i.test(lower);
    const network = domains.length > 0 || /network|http|fetch|request|upload|download|curl|web|browser/i.test(lower);
    const mcp = toolName.toLowerCase().startsWith("mcp__");
    const mcpWrite = mcp && !/(read|get|list|search|find|view|status|inspect|query)/i.test(toolName);
    const sensitive = /\.ssh|\.aws|\.azure|credentials?|id_rsa|private.?key|\.env|password|secret|token/i.test(lower);
    const destructive = /format\s+[a-z]:|diskpart|vssadmin\s+delete|bcdedit|remove-item[^\r\n]*(?:-recurse|-force)|rmdir\s+\/s|del\s+\/f\s+\/s|sc(?:\.exe)?\s+delete/i.test(lower);
    let category = "read";
    if (destructive) category = "destructive";
    else if (network) category = "network";
    else if (fileWrite) category = "file";
    else if (shell) category = "shell";
    else if (mcp) category = "mcp";
    return { toolName, category, shell, fileWrite, network, mcp, mcpWrite, sensitive, destructive, domains, paths };
  }

  _expectedChain(capabilities) {
    const chain = ["prompt", "read"];
    if (capabilities.fileWrite) chain.push("file");
    if (capabilities.shell) chain.push("shell");
    if (capabilities.network) chain.push("network");
    if (capabilities.mcpRead || capabilities.mcpWrite) chain.push("mcp");
    return chain;
  }

  _apply(session, findings, summary) {
    const unique = [];
    const seen = new Set();
    for (const finding of findings) {
      const key = `${finding.type}:${finding.detail?.tool || finding.detail?.domain || finding.detail?.path || finding.detail?.capability || finding.message}`;
      if (!seen.has(key)) { seen.add(key); unique.push(finding); }
    }
    const score = Math.min(100, unique.reduce((total, item) => total + item.weight, 0));
    const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= this.alertThreshold ? "medium" : score > 0 ? "low" : "none";
    const mode = session.effectivePolicy?.mode || "monitor";
    const result = {
      score, level, findings: unique.slice(0, this.maxFindings), summary,
      shouldAlert: score >= this.alertThreshold,
      shouldBlock: score >= this.blockThreshold && mode === "enforce",
      checkedAt: new Date().toISOString()
    };
    const current = session.behaviorDrift || this._emptyState();
    current.score = score;
    current.level = level;
    current.maxScore = Math.max(Number(current.maxScore || 0), score);
    current.cumulativeScore = Math.min(100, Number(current.cumulativeScore || 0) + score);
    current.lastSummary = summary;
    current.lastCheckedAt = result.checkedAt;
    if (unique.length) {
      current.detected += 1;
      current.findings = [...unique, ...(current.findings || [])].slice(0, this.maxFindings);
    }
    session.behaviorDrift = current;
    this.stats.checked++;
    if (score > 0) this.stats.detected++;
    if (result.shouldAlert) this.stats.alerted++;
    if (result.shouldBlock) this.stats.blocked++;
    this.stats.maxScore = Math.max(this.stats.maxScore, score);
    return result;
  }

  _result(score, findings) {
    const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= this.alertThreshold ? "medium" : score > 0 ? "low" : "none";
    return {
      score, level, findings: findings || [], summary: "No behavior baseline deviation",
      shouldAlert: score >= this.alertThreshold, shouldBlock: false, checkedAt: new Date().toISOString()
    };
  }

  _emptyState() {
    return { score: 0, level: "none", maxScore: 0, cumulativeScore: 0, detected: 0, findings: [], lastSummary: "", lastCheckedAt: null };
  }

  _finding(type, weight, message, detail) {
    return { type, weight, message, detail: detail || {} };
  }

  _remember(list, value, limit) {
    if (!value || list.includes(value)) return;
    list.push(value);
    if (list.length > limit) list.shift();
  }

  _contains(list, value) {
    const needle = String(value || "").toLowerCase();
    return (list || []).some(item => String(item).toLowerCase() === needle);
  }

  _looksLikePath(value) {
    return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || /^\//.test(value) || value.includes("\\") || value.includes("/");
  }

  _within(candidate, root) {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  _serialize(value) {
    try { return JSON.stringify(value === undefined ? null : value); } catch (_) { return ""; }
  }
}

module.exports = { BehaviorDriftEngine };

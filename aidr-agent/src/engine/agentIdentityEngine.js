const fs = require("fs");
const path = require("path");

// Local catalog and multi-signal matcher. The endpoint never needs API keys to identify an agent.
const AGENT_CATALOG = [
  { id: "openai-codex", label: "OpenAI Codex", vendor: "OpenAI", category: "coding-agent", processNames: ["codex.exe", "codex"], commandTokens: ["codex", "codex-app-server"], configPaths: ["%USERPROFILE%\\.codex", "%APPDATA%\\Codex"] },
  { id: "opencode", label: "OpenCode", vendor: "OpenCode", category: "ai-desktop", processNames: ["opencode.exe", "opencode"], commandTokens: ["opencode", "@opencode-aidesktop", "ai.opencode.desktop"], configPaths: ["%USERPROFILE%\\.config\\opencode", "%APPDATA%\\opencode", "%LOCALAPPDATA%\\opencode"] }, { id: "hermes", label: "Hermes (AI 助手)", vendor: "Hermes", category: "ai-agent", processNames: ["hermes.exe", "hermes"], commandTokens: ["hermes", "hermes-ai", "hermes-agent"], configPaths: ["%USERPROFILE%\\.hermes", "%APPDATA%\\Hermes", "%LOCALAPPDATA%\\Hermes"] },
  { id: "claude-code", label: "Claude Code", vendor: "Anthropic", category: "coding-agent", processNames: ["claude.exe", "claude"], commandTokens: ["claude", "claude-code"], configPaths: ["%USERPROFILE%\\.claude"] },
  { id: "cursor", label: "Cursor", vendor: "Anysphere", category: "ai-ide", processNames: ["cursor.exe", "cursor"], commandTokens: ["cursor"], configPaths: ["%APPDATA%\\Cursor", "%USERPROFILE%\\.cursor"] },
  { id: "windsurf", label: "Windsurf", vendor: "Codeium", category: "ai-ide", processNames: ["windsurf.exe", "windsurf"], commandTokens: ["windsurf", "windsurf.exe"], configPaths: ["%APPDATA%\\Windsurf", "%USERPROFILE%\\.windsurf"] },
  { id: "cline", label: "Cline", vendor: "Cline", category: "vscode-agent", processNames: ["code.exe", "code-insiders.exe"], commandTokens: ["cline", "saoudrizwan.claude-dev"], extensionMarkers: ["saoudrizwan.claude-dev"], configPaths: ["%USERPROFILE%\\.vscode\\extensions\\saoudrizwan.claude-dev*"] },
  { id: "roo-code", label: "Roo Code", vendor: "Roo Code", category: "vscode-agent", processNames: ["code.exe", "code-insiders.exe"], commandTokens: ["roo-cline", "rooveterinaryinc.roo-cline"], extensionMarkers: ["rooveterinaryinc.roo-cline"], configPaths: ["%USERPROFILE%\\.vscode\\extensions\\rooveterinaryinc.roo-cline*"] },
  { id: "github-copilot", label: "GitHub Copilot", vendor: "GitHub", category: "vscode-agent", processNames: ["code.exe", "code-insiders.exe"], commandTokens: ["github.copilot", "copilot"], extensionMarkers: ["github.copilot"], configPaths: ["%USERPROFILE%\\.vscode\\extensions\\github.copilot*"] },
  { id: "continue", label: "Continue", vendor: "Continue", category: "vscode-agent", processNames: ["code.exe", "code-insiders.exe"], commandTokens: ["continue.continue", "continue"], extensionMarkers: ["continue.continue"], configPaths: ["%USERPROFILE%\\.vscode\\extensions\\continue.continue*", "%USERPROFILE%\\.continue"] },
  { id: "aider", label: "Aider", vendor: "Aider", category: "terminal-agent", processNames: ["aider.exe", "aider"], commandTokens: ["aider", "aider-chat"], configPaths: ["%USERPROFILE%\\.aider.conf.yml"] },
  { id: "gemini-cli", label: "Gemini CLI", vendor: "Google", category: "terminal-agent", processNames: ["gemini.exe", "gemini"], commandTokens: ["gemini", "@google/gemini-cli"], configPaths: ["%USERPROFILE%\\.gemini"] },
  { id: "amazon-q", label: "Amazon Q Developer", vendor: "AWS", category: "terminal-agent", processNames: ["amazon-q.exe", "amazonq.exe", "q.exe", "q"], commandTokens: ["amazon-q", "amazonq", "q chat", "aws.amazonq"], extensionMarkers: ["amazonwebservices.amazon-q-vscode"], configPaths: ["%USERPROFILE%\\.aws\\amazonq", "%USERPROFILE%\\.vscode\\extensions\\amazonwebservices.amazon-q-vscode*"] },
  { id: "qwen-code", label: "Qwen Code", vendor: "Alibaba", category: "terminal-agent", processNames: ["qwen.exe", "qwen-code.exe", "qwen-code"], commandTokens: ["qwen", "qwen-code"], configPaths: ["%USERPROFILE%\\.qwen"] },
  { id: "kiro", label: "Kiro", vendor: "AWS", category: "ai-ide", processNames: ["kiro.exe", "kiro"], commandTokens: ["kiro"], configPaths: ["%APPDATA%\\Kiro"] },
  { id: "open-interpreter", label: "Open Interpreter", vendor: "Open Interpreter", category: "terminal-agent", processNames: ["open-interpreter.exe", "interpreter.exe", "open-interpreter"], commandTokens: ["open-interpreter", "interpreter"], configPaths: ["%USERPROFILE%\\.open-interpreter"] }
];

AGENT_CATALOG.push({
  id: "kimi",
  label: "Kimi",
  vendor: "Moonshot AI",
  category: "ai-desktop",
  processNames: ["kimi.exe", "kimi", "kimi-webbridge.exe", "kimi-webbridge"],
  commandTokens: ["kimi-desktop", "kimi-code", "kimi-webbridge", "com.moonshot.kimichat"],
  configPaths: ["%APPDATA%\\kimi-desktop", "%USERPROFILE%\\.kimi", "%USERPROFILE%\\.kimi-webbridge"]
});

const GENERIC_HOSTS = new Set(["code.exe", "code-insiders.exe", "q.exe", "q"]);

function expandPath(value) {
  return String(value || "")
    .replace(/%([^%]+)%/g, (_, key) => process.env[key] || "%" + key + "%")
    .replace(/^~(?=[\\/])/, process.env.USERPROFILE || process.env.HOME || "~");
}

function pathExists(value) {
  const expanded = expandPath(value);
  if (!expanded.includes("*")) return fs.existsSync(expanded);
  const marker = expanded.indexOf("*");
  const prefix = expanded.slice(0, marker);
  const parent = path.dirname(prefix);
  const fragment = path.basename(prefix).toLowerCase();
  try {
    return fs.readdirSync(parent).some(name => name.toLowerCase().startsWith(fragment));
  } catch (_) {
    return false;
  }
}

function normalizeProcess(processInfo) {
  const name = String(processInfo?.Name || processInfo?.name || processInfo?.process_name || "").trim().toLowerCase();
  const commandLine = String(processInfo?.CommandLine || processInfo?.commandLine || processInfo?.command_line || "").trim();
  const pid = Number(processInfo?.ProcessId || processInfo?.pid || 0) || 0;
  const basename = name.replace(/^.*[\\/]/, "");
  return { name: basename, commandLine, commandLower: commandLine.toLowerCase(), pid };
}

function redactCommandLine(value) {
  return String(value || "")
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s"']+/ig, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s"']+/ig, "$1[REDACTED]");
}

function normalizeProfile(profile = {}) {
  return {
    id: String(profile.id || "").trim(),
    label: String(profile.label || profile.id || "Unknown Agent"),
    vendor: String(profile.vendor || "Unknown"),
    category: String(profile.category || "ai-agent"),
    processNames: Array.isArray(profile.processNames) ? profile.processNames.map(String) : [],
    commandTokens: Array.isArray(profile.commandTokens) ? profile.commandTokens.map(String) : [],
    extensionMarkers: Array.isArray(profile.extensionMarkers) ? profile.extensionMarkers.map(String) : [],
    configPaths: Array.isArray(profile.configPaths) ? profile.configPaths.map(String) : []
  };
}

class AgentIdentityEngine {
  constructor(policy = {}, catalog = AGENT_CATALOG) {
    this.policy = policy;
    const profiles = new Map(catalog.map(profile => [String(profile.id), normalizeProfile(profile)]));
    for (const profile of (Array.isArray(policy.agentCatalog) ? policy.agentCatalog : [])) {
      const normalized = normalizeProfile(profile);
      if (normalized.id) profiles.set(normalized.id, normalized);
    }
    this.catalog = [...profiles.values()];
    this.states = new Map();
  }

  restore(snapshot = []) {
    const known = new Set(this.catalog.map(profile => profile.id));
    for (const item of Array.isArray(snapshot) ? snapshot : []) {
      if (!item?.id || !known.has(String(item.id))) continue;
      this.states.set(String(item.id), {
        ...item,
        id: String(item.id),
        status: item.status === "active" ? "offline" : (item.status || "offline"),
        processes: Array.isArray(item.processes) ? item.processes : [],
        pids: Array.isArray(item.pids) ? item.pids : [],
        signals: Array.isArray(item.signals) ? item.signals : [],
        stale: true,
        wasActive: false
      });
    }
  }

  matchProcess(processInfo) {
    const proc = normalizeProcess(processInfo);
    if (!proc.name && !proc.commandLine) return null;
    let best = null;
    for (const profile of this.catalog) {
      const processMatched = profile.processNames.some(name => name.toLowerCase() === proc.name);
      const commandSignals = (profile.commandTokens || []).filter(token => proc.commandLower.includes(token.toLowerCase()));
      const extensionSignals = (profile.extensionMarkers || []).filter(marker => proc.commandLower.includes(marker.toLowerCase()));
      // A generic host such as Code.exe or q.exe is only evidence when its agent marker is visible.
      const genericHost = GENERIC_HOSTS.has(proc.name);
      const nameEvidence = processMatched && !(genericHost && commandSignals.length === 0 && extensionSignals.length === 0);
      const score = (nameEvidence ? 65 : 0) + (commandSignals.length ? 35 : 0) + (extensionSignals.length ? 40 : 0);
      if (score < 40) continue;
      const signals = [];
      if (nameEvidence) signals.push("process_name:" + proc.name);
      if (commandSignals.length) signals.push("command_line:" + commandSignals.slice(0, 3).join(","));
      if (extensionSignals.length) signals.push("extension_marker:" + extensionSignals.slice(0, 3).join(","));
      const candidate = { profile, score: Math.min(100, score), signals, process: { pid: proc.pid, name: proc.name, commandLine: redactCommandLine(proc.commandLine) } };
      if (!best || candidate.score > best.score) best = candidate;
    }
    return best;
  }

  update(processes = []) {
    const now = new Date().toISOString();
    const matches = new Map();
    for (const rawProcess of Array.isArray(processes) ? processes : []) {
      const match = this.matchProcess(rawProcess);
      if (!match) continue;
      const bucket = matches.get(match.profile.id) || { profile: match.profile, items: [] };
      bucket.items.push(match);
      matches.set(match.profile.id, bucket);
    }

    const changes = [];
    for (const profile of this.catalog) {
      const previous = this.states.get(profile.id) || { id: profile.id, firstSeenAt: null, lastSeenAt: null, wasActive: false };
      const bucket = matches.get(profile.id);
      const configPaths = (profile.configPaths || []).filter(pathValue => pathExists(pathValue));
      const items = bucket ? bucket.items : [];
      const active = items.length > 0;
      const best = items.slice().sort((a, b) => b.score - a.score)[0];
      const next = {
        id: profile.id,
        label: profile.label,
        vendor: profile.vendor,
        category: profile.category,
        status: active ? "active" : (configPaths.length ? "configured" : (previous.lastSeenAt ? "offline" : "not_detected")),
        confidence: best ? best.score : (previous.confidence || 0),
        signals: best ? best.signals : (previous.signals || []),
        pids: items.map(item => item.process.pid).filter(Boolean),
        processes: items.map(item => item.process),
        configPaths,
        firstSeenAt: previous.firstSeenAt || (active ? now : null),
        lastSeenAt: active ? now : previous.lastSeenAt,
        lastScanAt: now,
        stale: false
      };
      if (active && !previous.wasActive) changes.push(next);
      this.states.set(profile.id, { ...next, wasActive: active });
    }
    return { agents: this.getSnapshot(), changes, timestamp: now };
  }

  getSnapshot() {
    return Array.from(this.states.values())
      .filter(agent => agent.status !== "not_detected")
      .map(agent => ({ ...agent, processes: (agent.processes || []).map(processInfo => ({ ...processInfo, commandLine: redactCommandLine(processInfo.commandLine) })) }));
  }

  getCatalog() {
    return this.catalog.map(profile => ({ ...profile }));
  }

  getStatus() {
    const agents = this.getSnapshot();
    return {
      agents,
      catalog: this.getCatalog(),
      activeCount: agents.filter(agent => agent.status === "active").length,
      configuredCount: agents.filter(agent => agent.status === "configured").length,
      detectedCount: agents.filter(agent => agent.status === "active" || agent.status === "offline").length,
      staleCount: agents.filter(agent => agent.stale === true).length,
      lastScanAt: agents.map(agent => agent.lastScanAt).filter(Boolean).sort().pop() || null,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { AGENT_CATALOG, AgentIdentityEngine, normalizeProcess, redactCommandLine };

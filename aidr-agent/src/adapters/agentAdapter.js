const TOOL_ALIASES = {
  bash: "Bash",
  shell: "Bash",
  command: "Bash",
  edit: "Edit",
  write: "Write",
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch"
};

class AgentAdapter {
  constructor(manifest = {}) {
    this.manifest = {
      sdkVersion: manifest.sdkVersion || "aidr-adapter-sdk-v1",
      id: manifest.id || "generic",
      label: manifest.label || manifest.id || "Generic Agent",
      vendor: manifest.vendor || "community",
      category: manifest.category || "ai_agent",
      protocol: manifest.protocol || "aidr-hook-v1",
      realtime: manifest.realtime !== false,
      capabilities: manifest.capabilities || ["prompt", "tool", "response", "session"]
    };
  }

  get id() { return this.manifest.id; }

  getManifest() { return { ...this.manifest, capabilities: [...this.manifest.capabilities] }; }

  registerAgent(payload = {}) { return this.normalize({ ...payload, event: "agent.register", hook_event_name: "AgentRegister" }); }
  onSessionStart(payload = {}) { return this.normalize({ ...payload, event: "session.created", hook_event_name: "SessionStart" }); }
  onPrompt(payload = {}) { return this.normalize({ ...payload, event: "prompt.submit", hook_event_name: "UserPromptSubmit" }); }
  onToolCall(payload = {}) { return this.normalize({ ...payload, event: "tool.execute.before", hook_event_name: "PreToolUse" }); }
  onFileAccess(payload = {}) {
    const toolInput = payload.tool_input || payload.toolInput || { path: payload.path, operation: payload.operation || payload.access };
    return this.normalize({ ...payload, event: "file.access", hook_event_name: "PreToolUse", tool_name: payload.tool_name || "filesystem", tool_input: toolInput });
  }
  onProcessCreate(payload = {}) {
    const toolInput = payload.tool_input || payload.toolInput || { pid: payload.pid, commandLine: payload.commandLine || payload.command_line };
    return this.normalize({ ...payload, event: "process.create", hook_event_name: "PreToolUse", tool_name: payload.tool_name || "process", tool_input: toolInput });
  }
  onNetworkRequest(payload = {}) {
    const toolInput = payload.tool_input || payload.toolInput || { url: payload.url, host: payload.host, port: payload.port, method: payload.method };
    return this.normalize({ ...payload, event: "network.request", hook_event_name: "PreToolUse", tool_name: payload.tool_name || "network", tool_input: toolInput });
  }
  onResponse(payload = {}) { return this.normalize({ ...payload, event: "tool.execute.after", hook_event_name: "PostToolUse" }); }
  onSessionEnd(payload = {}) { return this.normalize({ ...payload, event: "session.deleted", hook_event_name: "Stop" }); }

  dispatch(payload = {}) {
    const event = String(payload.hook_event_name || payload.event || payload.type || "").toLowerCase();
    if (event.includes("session") && (event.includes("created") || event.includes("start"))) return this.onSessionStart(payload);
    if (event.includes("session") && (event.includes("deleted") || event.includes("idle") || event.includes("stop"))) return this.onSessionEnd(payload);
    if (event.includes("tool") && (event.includes("after") || event.includes("response"))) return this.onResponse(payload);
    if (event.includes("tool") || event.includes("permission")) return this.onToolCall(payload);
    if (event.includes("file")) return this.onFileAccess(payload);
    if (event.includes("process")) return this.onProcessCreate(payload);
    if (event.includes("network")) return this.onNetworkRequest(payload);
    if (event.includes("register") || event.includes("discover")) return this.registerAgent(payload);
    return this.onPrompt(payload);
  }

  matches(payload = {}) {
    return String(payload.agent || payload.agent_id || payload.agent_type || "").toLowerCase() === this.id.toLowerCase();
  }

  normalize(payload = {}) {
    const hookEventName = normalizeHookName(payload.hook_event_name || payload.event || payload.type);
    const sessionId = payload.session_id || payload.sessionId || payload.conversation_id || payload.conversationId || payload.sessionID || null;
    const toolName = payload.tool_name || payload.toolName || payload.tool || null;
    return {
      ...payload,
      agent: payload.agent || payload.agent_id || payload.agent_type || this.id,
      agent_type: payload.agent_type || this.id,
      hook_event_name: hookEventName,
      session_id: sessionId,
      turn_id: payload.turn_id || payload.turnId || payload.call_id || payload.callID || null,
      tool_name: toolName ? normalizeToolName(toolName) : undefined,
      tool_input: payload.tool_input || payload.toolInput || payload.args || {},
      tool_response: payload.tool_response || payload.toolResponse || payload.result || payload.output,
      prompt: extractText(payload.prompt || payload.fullPrompt || payload.text || payload.content || payload.message),
      cwd: payload.cwd || payload.directory || payload.worktree || "",
      source: payload.source || `adapter:${this.id}`,
      adapter: this.id,
      received_at: payload.received_at || new Date().toISOString()
    };
  }
}

class GenericAgentAdapter extends AgentAdapter {
  constructor() {
    super({
      id: "generic",
      label: "Generic Agent Hook",
      vendor: "AIDR",
      category: "universal",
      protocol: "aidr-hook-v1",
      capabilities: ["prompt", "tool", "response", "session", "permission"]
    });
  }

  normalize(payload = {}) {
    const normalized = super.normalize(payload);
    if (payload.agent && payload.agent !== "generic") {
      normalized.adapter = "generic";
      normalized.agent = String(payload.agent);
      normalized.agent_type = String(payload.agent_type || payload.agent);
    }
    return normalized;
  }
}

class OpenCodeAdapter extends AgentAdapter {
  constructor() {
    super({
      id: "opencode",
      label: "OpenCode",
      vendor: "SST / OpenCode",
      category: "coding_agent",
      protocol: "opencode-plugin-v1",
      realtime: true,
      capabilities: ["prompt", "tool", "response", "session", "permission", "event"]
    });
  }

  normalize(payload = {}) {
    const event = String(payload.hook_event_name || payload.event || payload.type || "");
    const mapped = {
      ...payload,
      agent: "opencode",
      agent_type: "opencode",
      session_id: payload.session_id || payload.sessionId || payload.sessionID || payload.properties?.sessionID || payload.properties?.session_id || null,
      turn_id: payload.turn_id || payload.call_id || payload.callID || payload.properties?.callID || null,
      cwd: payload.cwd || payload.directory || payload.properties?.directory || "",
      model: payload.model || payload.properties?.model || "unknown",
      tool_name: payload.tool_name || payload.toolName || payload.tool || payload.properties?.tool || null,
      tool_input: payload.tool_input || payload.toolInput || payload.args || payload.properties?.args || {},
      tool_response: payload.tool_response || payload.toolResponse || payload.result || payload.output || payload.properties?.output,
      prompt: payload.prompt || payload.fullPrompt || payload.text || payload.content || payload.properties?.text || payload.properties?.content,
      source: payload.source || `opencode:${event || "hook"}`
    };
    if (event === "tool.execute.before") mapped.hook_event_name = "PreToolUse";
    else if (event === "tool.execute.after") mapped.hook_event_name = "PostToolUse";
    else if (event === "session.created" || event === "session.status") mapped.hook_event_name = "SessionStart";
    else if (event === "session.idle" || event === "session.deleted") mapped.hook_event_name = "Stop";
    else if (event === "tui.prompt.append" || event === "message.updated" || event === "message.part.updated") mapped.hook_event_name = "UserPromptSubmit";
    return super.normalize(mapped);
  }
}

class AgentAdapterRegistry {
  constructor() { this.adapters = new Map(); }

  register(adapter) {
    if (!(adapter instanceof AgentAdapter)) throw new TypeError("adapter_instance_required");
    if (!adapter.id || typeof adapter.normalize !== "function" || typeof adapter.matches !== "function") throw new TypeError("invalid_adapter_contract");
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }

  get(id) { return this.adapters.get(String(id || "").toLowerCase()) || null; }

  list() { return [...this.adapters.values()]; }

  resolve(payload = {}) {
    const requested = String(payload.adapter || payload.agent || payload.agent_type || "").toLowerCase();
    if (this.adapters.has(requested)) return this.adapters.get(requested);
    return this.adapters.get("generic") || [...this.adapters.values()][0] || null;
  }

  normalize(payload = {}) {
    const adapter = this.resolve(payload);
    return adapter ? adapter.normalize(payload) : payload;
  }

  dispatch(payload = {}) {
    const adapter = this.resolve(payload);
    return adapter ? { adapter: adapter.id, manifest: adapter.getManifest(), payload: adapter.dispatch(payload) } : { adapter: null, manifest: null, payload };
  }

  validate(payload = {}) {
    const adapter = this.resolve(payload);
    if (!adapter) return { valid: false, adapter: null, errors: ["adapter_not_found"], normalized: null };
    const normalized = adapter.normalize(payload);
    const errors = [];
    if (!normalized.agent) errors.push("agent_required");
    if (!normalized.hook_event_name) errors.push("hook_event_required");
    if (!normalized.session_id && normalized.hook_event_name !== "SessionStart") errors.push("session_id_required");
    return { valid: errors.length === 0, adapter: adapter.id, protocol: adapter.getManifest().protocol, errors, normalized };
  }

  getManifests() { return this.list().map(adapter => adapter.getManifest()); }
}

function createDefaultAdapterRegistry() {
  const registry = new AgentAdapterRegistry();
  registry.register(new GenericAgentAdapter());
  registry.register(new OpenCodeAdapter());
  return registry;
}

function normalizeHookName(value) {
  const raw = String(value || "");
  return {
    "tool.execute.before": "PreToolUse",
    "tool.execute.after": "PostToolUse",
    "session.created": "SessionStart",
    "session.idle": "Stop",
    "session.deleted": "Stop",
    "tui.prompt.append": "UserPromptSubmit",
    "message.updated": "UserPromptSubmit",
    "message.part.updated": "UserPromptSubmit"
  }[raw] || raw || "UserPromptSubmit";
}

function normalizeToolName(value) {
  const raw = String(value || "");
  return TOOL_ALIASES[raw.toLowerCase()] || raw;
}

function extractText(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return extractText(parsed.prompt || parsed.content || parsed.text || "");
    } catch (_) {}
    return value;
  }
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return extractText(value.text || value.content || value.prompt || value.message || "");
  return "";
}

module.exports = {
  AgentAdapter,
  GenericAgentAdapter,
  OpenCodeAdapter,
  AgentAdapterRegistry,
  createDefaultAdapterRegistry,
  normalizeHookName
};

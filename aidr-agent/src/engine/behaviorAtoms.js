const { normalizeAtomDefinition, normalizeOccurrence } = require("./behaviorAtomSchema");
const catalogCache = new WeakMap();
const organizationBoundaryCache = new WeakMap();
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

// The catalog mirrors the ABCG v1 ontology used by the design document and demos.
const DOMAINS = [
  { id: "INTENT", label: "意图", atoms: ["RECEIVE", "INTERPRET", "GENERAL_TASK", "READ_TASK", "WRITE_TASK", "EXECUTE_TASK", "NETWORK_TASK", "PUBLISH_TASK", "CREDENTIAL_TASK", "ADMIN_TASK", "INFER", "CLARIFY", "CONFIRM", "MODIFY", "DELEGATE", "TERMINATE"] },
  { id: "PLAN", label: "计划", atoms: ["CREATE", "DECOMPOSE", "SELECT", "MODIFY", "RETRY", "FALLBACK", "VALIDATE", "COMPLETE"] },
  { id: "AGENT", label: "Agent", atoms: ["CREATE", "CONFIGURE", "START", "STOP", "DELEGATE", "COMMUNICATE", "SHARE_CONTEXT", "AGGREGATE"] },
  { id: "MODEL", label: "模型", atoms: ["INVOKE", "SWITCH", "SEND_CONTEXT", "RECEIVE_OUTPUT", "VALIDATE_OUTPUT", "CACHE"] },
  { id: "TOOL", label: "工具 / MCP", atoms: ["DISCOVER", "CONNECT", "MCP_CONNECT", "API_REQUEST", "WEB_FETCH", "REGISTER", "CONFIGURE", "INVOKE", "RECEIVE_RESULT", "CHAIN", "DISCONNECT"] },
  { id: "AUTH", label: "身份 / 凭据", atoms: ["IDENTITY_AUTHENTICATE", "IDENTITY_IMPERSONATE", "CREDENTIAL_DISCOVER", "CREDENTIAL_ACQUIRE", "CREDENTIAL_USE", "CREDENTIAL_TRANSFER", "CREDENTIAL_REVOKE", "PERMISSION_CHECK", "PERMISSION_REQUEST", "PERMISSION_MODIFY"] },
  { id: "DATA", label: "数据", atoms: ["RESOURCE_DISCOVER", "RESOURCE_CREATE", "DATA_READ", "FILE_READ", "CONFIG_READ", "ENVIRONMENT_READ", "AGENT_CONFIG_READ", "SYSTEM_CONFIG_READ", "APP_CONFIG_READ", "SOURCE_CODE_READ", "DOCUMENT_READ", "DATABASE_READ", "CREDENTIAL_READ", "DATA_WRITE", "DATA_MODIFY", "DATA_TRANSFORM", "DATA_TRANSFER", "DATA_PUBLISH", "RESOURCE_DELETE", "RESOURCE_PERMISSION_CHANGE"] },
  { id: "MEMORY", label: "记忆", atoms: ["MEMORY_READ", "MEMORY_WRITE", "MEMORY_MODIFY", "MEMORY_SHARE", "MEMORY_DELETE", "MEMORY_RESTORE"] },
  { id: "EXEC", label: "执行 / 系统", atoms: ["CODE_GENERATE", "CODE_EXECUTE", "PROGRAM_EXECUTE", "SHELL_COMMAND", "TEST_EXECUTE", "BUILD_EXECUTE", "PACKAGE_OPERATION", "DOWNLOAD_EXECUTE", "PROCESS_CREATE", "PROGRAM_PROCESS_CREATE", "SHELL_PROCESS_CREATE", "BROWSER_PROCESS_CREATE", "TOOL_PROCESS_CREATE", "PROCESS_CONTROL", "SERVICE_START", "SYSTEM_EVENT", "SYSTEM_CONFIGURE", "SYSTEM_PRIVILEGE_CHANGE", "SYSTEM_RESOURCE_CONSUME", "SYSTEM_CALL", "NETWORK_CONNECT", "TLS_CONNECT", "HTTP_CONNECT", "REMOTE_ACCESS_CONNECT", "DATABASE_CONNECT", "MESSAGE_SERVICE_CONNECT", "NETWORK_LISTEN", "NETWORK_SEND", "NETWORK_RECEIVE", "DNS_QUERY"] }
];

const LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 5 };

// Leaf atoms preserve the existing domain/radius model while replacing broad
// parents with auditable operations.
const REFINED_ATOMS = {
  TOOL: ["HTTP_API_CONNECT", "DATABASE_CONNECT", "BROWSER_CONNECT", "CLOUD_SERVICE_CONNECT"],
  DATA: ["CLIPBOARD_READ"],
  EXEC: ["SCRIPT_EXECUTE", "REGISTRY_MODIFY", "SERVICE_CONTROL"]
};
for (const domain of DOMAINS) {
  for (const name of REFINED_ATOMS[domain.id] || []) {
    if (!domain.atoms.includes(name)) domain.atoms.push(name);
  }
}

const HIGH_RISK = new Set([
  "INTENT.MODIFY", "INTENT.DELEGATE", "PLAN.FALLBACK", "AGENT.CONFIGURE", "AGENT.SHARE_CONTEXT",
  "MODEL.SWITCH", "MODEL.SEND_CONTEXT", "TOOL.MCP_CONNECT", "TOOL.API_REQUEST", "TOOL.WEB_FETCH", "TOOL.REGISTER", "TOOL.CONFIGURE", "TOOL.CHAIN",
  "AUTH.IDENTITY_IMPERSONATE", "AUTH.CREDENTIAL_DISCOVER", "AUTH.CREDENTIAL_ACQUIRE", "AUTH.CREDENTIAL_TRANSFER", "AUTH.CREDENTIAL_REVOKE", "AUTH.PERMISSION_REQUEST", "AUTH.PERMISSION_MODIFY",
  "DATA.CREDENTIAL_READ", "DATA.DATA_TRANSFER", "DATA.DATA_PUBLISH", "DATA.RESOURCE_DELETE", "DATA.RESOURCE_PERMISSION_CHANGE",
  "MEMORY.MEMORY_SHARE", "MEMORY.MEMORY_DELETE", "EXEC.PROCESS_CONTROL", "EXEC.SYSTEM_CONFIGURE", "EXEC.SYSTEM_PRIVILEGE_CHANGE"
]);
[
  "TOOL.HTTP_API_CONNECT", "TOOL.DATABASE_CONNECT", "TOOL.BROWSER_CONNECT", "TOOL.CLOUD_SERVICE_CONNECT",
  "DATA.CLIPBOARD_READ", "EXEC.REGISTRY_MODIFY", "EXEC.SERVICE_CONTROL"
].forEach(id => HIGH_RISK.add(id));

const BASE_LEVELS = {
  "INTENT.RECEIVE": 0, "INTENT.INTERPRET": 0, "INTENT.GENERAL_TASK": 0, "INTENT.READ_TASK": 1, "INTENT.WRITE_TASK": 2, "INTENT.EXECUTE_TASK": 3, "INTENT.NETWORK_TASK": 3, "INTENT.PUBLISH_TASK": 4, "INTENT.CREDENTIAL_TASK": 4, "INTENT.ADMIN_TASK": 5, "INTENT.INFER": 1, "INTENT.CLARIFY": 0, "INTENT.CONFIRM": 0, "INTENT.MODIFY": 2, "INTENT.DELEGATE": 3, "INTENT.TERMINATE": 0,
  "PLAN.CREATE": 0, "PLAN.DECOMPOSE": 0, "PLAN.SELECT": 0, "PLAN.MODIFY": 1, "PLAN.RETRY": 1, "PLAN.FALLBACK": 2, "PLAN.VALIDATE": 0, "PLAN.COMPLETE": 0,
  "AGENT.CREATE": 3, "AGENT.CONFIGURE": 4, "AGENT.START": 3, "AGENT.STOP": 3, "AGENT.DELEGATE": 3, "AGENT.COMMUNICATE": 2, "AGENT.SHARE_CONTEXT": 3, "AGENT.AGGREGATE": 1,
  "MODEL.INVOKE": 3, "MODEL.SWITCH": 3, "MODEL.SEND_CONTEXT": 3, "MODEL.RECEIVE_OUTPUT": 0, "MODEL.VALIDATE_OUTPUT": 0, "MODEL.CACHE": 2,
  "TOOL.DISCOVER": 1, "TOOL.CONNECT": 3, "TOOL.MCP_CONNECT": 3, "TOOL.API_REQUEST": 3, "TOOL.WEB_FETCH": 3, "TOOL.REGISTER": 4, "TOOL.CONFIGURE": 4, "TOOL.INVOKE": 3, "TOOL.RECEIVE_RESULT": 1, "TOOL.CHAIN": 3, "TOOL.DISCONNECT": 3,
  "AUTH.IDENTITY_AUTHENTICATE": 1, "AUTH.IDENTITY_IMPERSONATE": 4, "AUTH.CREDENTIAL_DISCOVER": 2, "AUTH.CREDENTIAL_ACQUIRE": 4, "AUTH.CREDENTIAL_USE": 3, "AUTH.CREDENTIAL_TRANSFER": 5, "AUTH.CREDENTIAL_REVOKE": 4, "AUTH.PERMISSION_CHECK": 1, "AUTH.PERMISSION_REQUEST": 4, "AUTH.PERMISSION_MODIFY": 5,
  "DATA.RESOURCE_DISCOVER": 1, "DATA.RESOURCE_CREATE": 2, "DATA.DATA_READ": 1, "DATA.FILE_READ": 1, "DATA.CONFIG_READ": 2, "DATA.ENVIRONMENT_READ": 3, "DATA.AGENT_CONFIG_READ": 2, "DATA.SYSTEM_CONFIG_READ": 3, "DATA.APP_CONFIG_READ": 2, "DATA.SOURCE_CODE_READ": 1, "DATA.DOCUMENT_READ": 1, "DATA.DATABASE_READ": 2, "DATA.CREDENTIAL_READ": 3, "DATA.DATA_WRITE": 2, "DATA.DATA_MODIFY": 2, "DATA.DATA_TRANSFORM": 2, "DATA.DATA_TRANSFER": 3, "DATA.DATA_PUBLISH": 5, "DATA.RESOURCE_DELETE": 5, "DATA.RESOURCE_PERMISSION_CHANGE": 5,
  "MEMORY.MEMORY_READ": 1, "MEMORY.MEMORY_WRITE": 2, "MEMORY.MEMORY_MODIFY": 2, "MEMORY.MEMORY_SHARE": 3, "MEMORY.MEMORY_DELETE": 4, "MEMORY.MEMORY_RESTORE": 2,
  "EXEC.CODE_GENERATE": 2, "EXEC.CODE_EXECUTE": 3, "EXEC.PROGRAM_EXECUTE": 3, "EXEC.SHELL_COMMAND": 3, "EXEC.TEST_EXECUTE": 2, "EXEC.BUILD_EXECUTE": 2, "EXEC.PACKAGE_OPERATION": 3, "EXEC.DOWNLOAD_EXECUTE": 4, "EXEC.PROCESS_CREATE": 3, "EXEC.PROGRAM_PROCESS_CREATE": 3, "EXEC.SHELL_PROCESS_CREATE": 3, "EXEC.BROWSER_PROCESS_CREATE": 3, "EXEC.TOOL_PROCESS_CREATE": 3, "EXEC.PROCESS_CONTROL": 4, "EXEC.SERVICE_START": 2, "EXEC.SYSTEM_EVENT": 1, "EXEC.SYSTEM_CONFIGURE": 4, "EXEC.SYSTEM_PRIVILEGE_CHANGE": 5, "EXEC.SYSTEM_RESOURCE_CONSUME": 2, "EXEC.SYSTEM_CALL": 3,
  "EXEC.NETWORK_CONNECT": 3, "EXEC.TLS_CONNECT": 3, "EXEC.HTTP_CONNECT": 2, "EXEC.REMOTE_ACCESS_CONNECT": 4, "EXEC.DATABASE_CONNECT": 3, "EXEC.MESSAGE_SERVICE_CONNECT": 3, "EXEC.NETWORK_LISTEN": 4, "EXEC.NETWORK_SEND": 3, "EXEC.NETWORK_RECEIVE": 1, "EXEC.DNS_QUERY": 1
};
Object.assign(BASE_LEVELS, {
  "TOOL.HTTP_API_CONNECT": 3,
  "TOOL.DATABASE_CONNECT": 3,
  "TOOL.BROWSER_CONNECT": 3,
  "TOOL.CLOUD_SERVICE_CONNECT": 4,
  "DATA.CLIPBOARD_READ": 3,
  "EXEC.SCRIPT_EXECUTE": 3,
  "EXEC.REGISTRY_MODIFY": 4,
  "EXEC.SERVICE_CONTROL": 4
});

const RISK_SEMANTICS = {
  "EXEC.PROGRAM_PROCESS_CREATE": { action: "create_process", risk: "Executes a new native process", dimensions: ["execution", "process"] },
  "EXEC.SHELL_PROCESS_CREATE": { action: "create_shell_process", risk: "Creates a command interpreter process", dimensions: ["execution", "shell"] },
  "EXEC.SCRIPT_EXECUTE": { action: "execute_script", risk: "Executes script content through an interpreter", dimensions: ["execution", "script"] },
  "EXEC.REGISTRY_MODIFY": { action: "modify_registry", risk: "Changes persistent operating-system configuration", dimensions: ["persistence", "system"] },
  "EXEC.SERVICE_CONTROL": { action: "control_service", risk: "Starts, stops or reconfigures an operating-system service", dimensions: ["persistence", "privilege"] },
  "TOOL.MCP_CONNECT": { action: "connect_mcp", risk: "Opens an MCP capability channel", dimensions: ["tool", "extension"] },
  "TOOL.HTTP_API_CONNECT": { action: "connect_http_api", risk: "Connects to an HTTP API", dimensions: ["network", "api"] },
  "TOOL.DATABASE_CONNECT": { action: "connect_database", risk: "Connects to a database service", dimensions: ["network", "data"] },
  "TOOL.BROWSER_CONNECT": { action: "connect_browser", risk: "Delegates activity to a browser surface", dimensions: ["network", "browser"] },
  "TOOL.CLOUD_SERVICE_CONNECT": { action: "connect_cloud_service", risk: "Connects to a cloud control or data plane", dimensions: ["network", "cloud"] },
  "DATA.SOURCE_CODE_READ": { action: "read_source_code", risk: "Reads source code from the workspace", dimensions: ["data", "source"] },
  "DATA.CREDENTIAL_READ": { action: "read_credentials", risk: "Reads secrets or authentication material", dimensions: ["data", "credential"] },
  "DATA.APP_CONFIG_READ": { action: "read_configuration", risk: "Reads application configuration", dimensions: ["data", "configuration"] },
  "DATA.DOCUMENT_READ": { action: "read_document", risk: "Reads a document or project note", dimensions: ["data", "document"] },
  "DATA.DATABASE_READ": { action: "read_database", risk: "Reads records from a database", dimensions: ["data", "database"] },
  "DATA.CLIPBOARD_READ": { action: "read_clipboard", risk: "Reads user clipboard content", dimensions: ["data", "clipboard", "privacy"] }
};

const DESCRIPTIONS = {
  "PLAN.BYPASS": "尝试绕过既定策略、审批或工具边界",
  "DATA.TRANSFER_EXTERNAL": "向组织边界之外传输数据",
  "AUTH.CREDENTIAL_READ": "读取凭据、密钥或高敏感配置",
  "DATA.SENSITIVE_READ": "读取敏感数据或受保护文件",
  "TOOL.INVOKE_WRITE": "调用具有写入副作用的工具或 MCP",
  "TOOL.REMOTE_EXEC": "调用远程执行或高副作用工具",
  "EXEC.PROCESS_SPAWN": "创建或启动新的系统进程",
  "EXEC.NETWORK": "建立外部网络连接",
  "MODEL.SEND_CONTEXT": "向模型发送 Prompt、文件或工具结果",
  "MEMORY.POISON": "将不可信内容写入或污染长期记忆"
};

// Historical labels remain visible as mapping candidates while runtime data
// uses the formal 72-atom catalog from the ABCG design.
const ATOM_ALIASES = {
  "PLAN.BYPASS": "PLAN.MODIFY",
  "AGENT.SPAWN": "AGENT.CREATE",
  "INTENT.ANALYZE": "INTENT.INTERPRET",
  "TOOL.INVOKE_READ": "TOOL.INVOKE",
  "TOOL.INVOKE_WRITE": "TOOL.INVOKE",
  "TOOL.INSTALL": "TOOL.REGISTER",
  "TOOL.DELETE": "TOOL.DISCONNECT",
  "TOOL.REMOTE_EXEC": "TOOL.INVOKE",
  "TOOL.ADMIN": "TOOL.CONFIGURE",
  "MODEL.EXPORT": "MODEL.SEND_CONTEXT",
  "MODEL.EXFIL": "MODEL.SEND_CONTEXT",
  "AUTH.IDENTIFY": "AUTH.IDENTITY_AUTHENTICATE",
  "AUTH.AUTHENTICATE": "AUTH.IDENTITY_AUTHENTICATE",
  "AUTH.TOKEN_USE": "AUTH.CREDENTIAL_USE",
  "AUTH.ASSUME_ROLE": "AUTH.IDENTITY_IMPERSONATE",
  "AUTH.CREDENTIAL_READ": "AUTH.CREDENTIAL_DISCOVER",
  "AUTH.CREDENTIAL_WRITE": "AUTH.CREDENTIAL_ACQUIRE",
  "AUTH.PRIV_ESC": "AUTH.PERMISSION_MODIFY",
  "DATA.DISCOVER": "DATA.RESOURCE_DISCOVER",
  "DATA.READ": "DATA.DATA_READ",
  "DATA.QUERY": "DATA.DATA_READ",
  "DATA.WRITE": "DATA.DATA_WRITE",
  "DATA.DELETE": "DATA.RESOURCE_DELETE",
  "DATA.TRANSFORM": "DATA.DATA_TRANSFORM",
  "DATA.SENSITIVE_READ": "DATA.DATA_READ",
  "DATA.TRANSFER_EXTERNAL": "DATA.DATA_TRANSFER",
  "DATA.TRANSFER": "DATA.DATA_TRANSFER",
  "MEMORY.READ": "MEMORY.MEMORY_READ",
  "MEMORY.WRITE": "MEMORY.MEMORY_WRITE",
  "MEMORY.SHARE": "MEMORY.MEMORY_SHARE",
  "MEMORY.DELETE": "MEMORY.MEMORY_DELETE",
  "MEMORY.LONG_TERM": "MEMORY.MEMORY_WRITE",
  "MEMORY.CROSS_SESSION": "MEMORY.MEMORY_SHARE",
  "MEMORY.POISON": "MEMORY.MEMORY_MODIFY",
  "MEMORY.EXPORT": "MEMORY.MEMORY_SHARE",
  "EXEC.INSPECT": "EXEC.SYSTEM_CALL",
  "EXEC.COMMAND": "EXEC.CODE_EXECUTE",
  "EXEC.PROCESS_SPAWN": "EXEC.PROCESS_CREATE",
  "EXEC.FILE_SYSTEM": "DATA.DATA_READ",
  "EXEC.NETWORK": "EXEC.SYSTEM_CALL",
  "EXEC.SYSTEM_MODIFY": "EXEC.SYSTEM_CONFIGURE",
  "EXEC.KERNEL": "EXEC.SYSTEM_CALL",
  "EXEC.DESTRUCTIVE": "EXEC.SYSTEM_PRIVILEGE_CHANGE"
};
const BROAD_PARENT_ATOMS = new Set(["EXEC.SYSTEM_CALL", "TOOL.CONNECT", "DATA.DATA_READ", "DATA.CONFIG_READ", "EXEC.CODE_EXECUTE", "EXEC.PROCESS_CREATE", "INTENT.INTERPRET"]);

function canonicalAtomId(id) {
  const normalized = String(id || "UNMAPPED.UNKNOWN").toUpperCase();
  return ATOM_ALIASES[normalized] || normalized;
}

function atomId(domain, atom) { return String(domain).toUpperCase() + "." + String(atom).toUpperCase(); }

function buildCatalog(policy = {}) {
  const behaviorAtoms = policy.behaviorAtoms || EMPTY_OBJECT;
  const custom = behaviorAtoms.custom || EMPTY_OBJECT;
  const disabledList = behaviorAtoms.disabled || EMPTY_ARRAY;
  const cached = catalogCache.get(policy);
  if (cached && cached.behaviorAtoms === behaviorAtoms && cached.custom === custom && cached.disabledList === disabledList) return cached.catalog;
  const disabled = new Set(disabledList);
  const result = [];
  for (const domain of DOMAINS) {
    for (const name of domain.atoms) {
      const id = atomId(domain.id, name);
      const override = custom[id] && typeof custom[id] === "object" ? custom[id] : EMPTY_OBJECT;
      result.push(normalizeAtomDefinition({
        id, domain: domain.id, domainLabel: domain.label, name, baseLevel: BASE_LEVELS[id] ?? 2,
        description: DESCRIPTIONS[id] || `${domain.label}：${name}`,
        system: true, highRisk: HIGH_RISK.has(id),
        ...override,
        enabled: !disabled.has(id) && override.enabled !== false
      }));
    }
  }
  for (const [id, value] of Object.entries(custom)) {
    if (result.some(item => item.id === id)) continue;
    const [domain, name] = String(id).toUpperCase().split(".");
    result.push(normalizeAtomDefinition({ id: String(id).toUpperCase(), domain, domainLabel: domain, name, baseLevel: 2, description: "自定义行为原子", system: false, enabled: true, highRisk: false, ...(value || {}) }));
  }
  catalogCache.set(policy, { behaviorAtoms, custom, disabledList, catalog: result });
  return result;
}

function valueText(event = {}) {
  return JSON.stringify({
    category: event.category, eventType: event.eventType, summary: event.summary, subject: event.subject,
    object: event.object, detail: event.detail, matchedRule: event.matchedRule
  }).toLowerCase();
}

function networkAtomId(event = {}, text = "") {
  const detail = event.detail || {};
  const port = Number(detail.remotePort || detail.remote_port || detail.destinationPort || detail.destination_port || 0);
  if (/listen|bound endpoint|server socket/i.test(text)) return "EXEC.NETWORK_LISTEN";
  if (port === 53 || /\bdns\b|resolve|domain lookup/i.test(text)) return "EXEC.DNS_QUERY";
  if (/upload|send|post|put|exfil|outbound data/i.test(text)) return "EXEC.NETWORK_SEND";
  if (/download|receive|response bytes|inbound data/i.test(text)) return "EXEC.NETWORK_RECEIVE";
  if (/mcp/i.test(text)) return "TOOL.MCP_CONNECT";
  if (/webfetch|browser\.fetch|fetch url|http request|api request/i.test(text)) return /webfetch|browser\.fetch|fetch url/i.test(text) ? "TOOL.WEB_FETCH" : "TOOL.API_REQUEST";
  if ([5228, 5229, 5230].includes(port)) return "EXEC.MESSAGE_SERVICE_CONNECT";
  if ([22, 23, 3389, 5900, 5985, 5986].includes(port)) return "EXEC.REMOTE_ACCESS_CONNECT";
  if ([1433, 1521, 3306, 5432, 6379, 9042, 27017].includes(port)) return "EXEC.DATABASE_CONNECT";
  if (port === 443 || /tls|ssl/i.test(text)) return "EXEC.TLS_CONNECT";
  if ([80, 8080, 8000, 8888].includes(port) || /\bhttp\b/i.test(text)) return "EXEC.HTTP_CONNECT";
  return "EXEC.NETWORK_CONNECT";
}

function toolConnectionAtomId(event = {}, text = "") {
  const detail = event.detail || {};
  const port = Number(detail.remotePort || detail.remote_port || detail.port || 0);
  if (/\bmcp\b|model context protocol/i.test(text)) return "TOOL.MCP_CONNECT";
  if (/browser|playwright|chrom(?:e|ium)|edge|firefox|webview/i.test(text)) return "TOOL.BROWSER_CONNECT";
  if (/postgres|mysql|mariadb|sqlite|mongodb|redis|sql server|database|jdbc|odbc/i.test(text) ||
      [1433, 1521, 3306, 5432, 6379, 9042, 27017].includes(port)) return "TOOL.DATABASE_CONNECT";
  if (/\baws\b|amazon web services|azure|gcp|google cloud|s3|blob storage|cloudflare|kubernetes api/i.test(text)) return "TOOL.CLOUD_SERVICE_CONNECT";
  if (/https?:\/\/|\bapi\b|rest|graphql|webhook/i.test(text)) return "TOOL.HTTP_API_CONNECT";
  return "TOOL.CONNECT";
}

function dataReadAtomId(event = {}, text = "") {
  const detail = event.detail || {};
  const resource = String(detail.path || detail.file_path || detail.target || event.object || event.resource || "");
  const lower = (text + " " + resource).toLowerCase();
  if (/clipboard|pasteboard|get-clipboard|xclip|xsel|wl-paste/i.test(lower)) return "DATA.CLIPBOARD_READ";
  if (/credential|secret|password|api.?key|access.?token|refresh.?token|bearer|id_rsa|private.?key|\.pem\b|\.pfx\b|\.ssh[\\/]/i.test(lower)) return "DATA.CREDENTIAL_READ";
  if (/\.env\b|environment variable|process\.env/i.test(lower)) return "DATA.ENVIRONMENT_READ";
  if (/\.codex[\\/]|opencode|cursor|hermes|agent.?config/i.test(lower)) return "DATA.AGENT_CONFIG_READ";
  if (/registry|hkey_|windows[\\/]system32|system.?config|group policy/i.test(lower)) return "DATA.SYSTEM_CONFIG_READ";
  if (/config|settings|\.ini\b|\.ya?ml\b|\.toml\b/i.test(lower)) return "DATA.APP_CONFIG_READ";
  if (/database|sql|query|sqlite|postgres|mysql|mongodb|redis/i.test(lower)) return "DATA.DATABASE_READ";
  if (/\.(?:js|jsx|ts|tsx|py|java|go|rs|cs|cpp|c|h|rb|php|swift|kt)\b|source.?code/i.test(lower)) return "DATA.SOURCE_CODE_READ";
  if (/readme|document|\.md\b|\.txt\b|\.pdf\b|\.docx?\b/i.test(lower)) return "DATA.DOCUMENT_READ";
  return "DATA.FILE_READ";
}

function executionAtomId(event = {}, text = "") {
  if (/\breg(?:\.exe)?\s+(?:add|delete|copy|import)|set-itemproperty|new-itemproperty|hkey_|hkcu\\|hklm\\/i.test(text)) return "EXEC.REGISTRY_MODIFY";
  if (/\bsc(?:\.exe)?\s+(?:start|stop|create|delete|config)|start-service|stop-service|restart-service|set-service|systemctl|service\s+\S+\s+(?:start|stop|restart|enable|disable)/i.test(text)) return "EXEC.SERVICE_CONTROL";
  if (/curl|wget|invoke-webrequest|download.+(?:run|execute)|bitsadmin/i.test(text)) return "EXEC.DOWNLOAD_EXECUTE";
  if (/npm\s+(?:install|add)|pnpm\s+(?:install|add)|yarn\s+(?:install|add)|pip\s+install|cargo\s+install|winget\s+install|choco\s+install/i.test(text)) return "EXEC.PACKAGE_OPERATION";
  if (/npm\s+test|pnpm\s+test|yarn\s+test|pytest|jest|vitest|mocha|dotnet\s+test|go\s+test|cargo\s+test/i.test(text)) return "EXEC.TEST_EXECUTE";
  if (/npm\s+run\s+build|pnpm\s+build|yarn\s+build|compile|webpack|vite\s+build|dotnet\s+build|cargo\s+build|go\s+build/i.test(text)) return "EXEC.BUILD_EXECUTE";
  if (/powershell|pwsh|cmd\.exe|bash|zsh|sh\s+-c|shell/i.test(text)) return "EXEC.SHELL_COMMAND";
  if (/\.(?:ps1|py|js|mjs|cjs|sh|bash|zsh|rb|pl)\b|python(?:3)?\s+\S+|node\s+\S+/i.test(text)) return "EXEC.SCRIPT_EXECUTE";
  return "EXEC.PROGRAM_EXECUTE";
}

function processCreateAtomId(event = {}, text = "") {
  if (/powershell|pwsh|cmd\.exe|bash|zsh|wsl|sh\.exe/i.test(text)) return "EXEC.SHELL_PROCESS_CREATE";
  if (/chrome|msedge|firefox|browser/i.test(text)) return "EXEC.BROWSER_PROCESS_CREATE";
  if (/npm|node|python|git|docker|kubectl|compiler|webpack|vite|mcp|tool/i.test(text)) return "EXEC.TOOL_PROCESS_CREATE";
  return "EXEC.PROGRAM_PROCESS_CREATE";
}

function intentTaskAtomId(text = "") {
  if (/credential|secret|password|api.?key|token|ssh.?key|private.?key/i.test(text)) return "INTENT.CREDENTIAL_TASK";
  if (/administrator|admin|privilege|permission|registry|service|driver|firewall|system config/i.test(text)) return "INTENT.ADMIN_TASK";
  if (/publish|deploy|release|push|upload|send externally/i.test(text)) return "INTENT.PUBLISH_TASK";
  if (/network|browse|web|url|http|download|api|internet/i.test(text)) return "INTENT.NETWORK_TASK";
  if (/execute|run|test|build|compile|command|shell|install/i.test(text)) return "INTENT.EXECUTE_TASK";
  if (/write|modify|edit|create|implement|delete|remove|fix/i.test(text)) return "INTENT.WRITE_TASK";
  if (/read|inspect|review|summarize|explain|search|find|list/i.test(text)) return "INTENT.READ_TASK";
  return "INTENT.GENERAL_TASK";
}

function mapEventToAtom(event = {}) {
  const text = valueText(event);
  const category = String(event.category || event.eventType || "").toLowerCase();
  const detail = event.detail || {};
  const toolName = String(detail.toolName || detail.tool || detail.tool_name || event.object || "").toLowerCase();
  const promptInjection = /ignore\s+(all|previous|prior)|bypass|override|jailbreak|prompt.?injection|untrusted instruction|do not follow/i.test(text);
  const memoryPoison = /poison|污染|不可信.*记忆|untrusted.*memory|long.?term memory/i.test(text);
  const external = Boolean(detail.destination?.external || detail.external || /external|upload|exfil|transfer|unknown-model|curl|wget|https?:\/\//i.test(text));
  let id = "INTENT.INTERPRET";
  let rule = "default.intent_analyze";
  if (promptInjection) { id = "PLAN.MODIFY"; rule = "threat.prompt_injection"; }
  else if (memoryPoison) { id = "MEMORY.MEMORY_MODIFY"; rule = "threat.memory_poisoning"; }
  else if (/external|upload|exfil|transfer|send.?to|outbound/i.test(text) && external) { id = "DATA.DATA_TRANSFER"; rule = "data.external_destination"; }
  else if (category.includes("file") && /credential|secret|\.env|ssh.?key|id_rsa|private.?key|password|api.?key|access.?token|refresh.?token|bearer|token\s*[:=]/i.test(text)) {
    id = "DATA.CREDENTIAL_READ";
    rule = "runtime.sensitive_file_read";
  }
  else if (/credential|secret|\.env|ssh.?key|id_rsa|private.?key|password|api.?key|access.?token|refresh.?token|bearer|token\s*[:=]/i.test(text)) {
    id = /write|transfer|send|upload/i.test(text) ? "AUTH.CREDENTIAL_TRANSFER" : "AUTH.CREDENTIAL_DISCOVER";
    rule = "sensitive.credential_pattern";
  }
  else if (/long.?term|cross.?session|memory|记忆/i.test(text)) { id = /write|store|save|persist/i.test(text) ? "MEMORY.MEMORY_WRITE" : "MEMORY.MEMORY_READ"; rule = "memory.operation"; }
  else if (/reg(?:\.exe)?\s+(?:add|delete|copy|import)|set-itemproperty|new-itemproperty|hkey_|hkcu\\|hklm\\/i.test(text)) { id = "EXEC.REGISTRY_MODIFY"; rule = "runtime.registry_modify"; }
  else if (/sc(?:\.exe)?\s+(?:start|stop|create|delete|config)|start-service|stop-service|restart-service|set-service|systemctl|service\s+\S+\s+(?:start|stop|restart|enable|disable)/i.test(text)) { id = "EXEC.SERVICE_CONTROL"; rule = "runtime.service_control"; }
  else if (/execute.+\.(?:ps1|py|js|mjs|cjs|sh|bash|zsh|rb|pl)\b|python(?:3)?\s+\S+|node\s+\S+/i.test(text)) { id = "EXEC.SCRIPT_EXECUTE"; rule = "runtime.script_execute"; }
  else if (category === "system") { id = /started|listener|listening|proxy started|sensor started/i.test(text) ? "EXEC.SERVICE_START" : "EXEC.SYSTEM_EVENT"; rule = "runtime.system_event"; }
  else if (/model|llm|inference|completion|embedding|prompt|context/i.test(text) && (category.includes("model") || category.includes("prompt") || category.includes("response"))) {
    id = /send|context|prompt/i.test(text) ? "MODEL.SEND_CONTEXT" : /output|response/i.test(text) ? "MODEL.RECEIVE_OUTPUT" : "MODEL.INVOKE";
    rule = "model.runtime_operation";
  }
  else if (category === "process" && detail.eventType === "process" && detail.agentId && detail.name) { id = "AGENT.CREATE"; rule = "agent.runtime_observation"; }
  else if ((category.includes("agent") && !category.includes("tool")) || /delegate|spawn|sub.?agent|agent.?message/i.test(text)) { id = /delegate/i.test(text) ? "AGENT.DELEGATE" : /message|communicat/i.test(text) ? "AGENT.COMMUNICATE" : "AGENT.CREATE"; rule = "agent.coordination"; }
  else if ((category.includes("tool") || category.includes("mcp")) && /connect|connection|api|browser|database|cloud|mcp/i.test(text)) { id = toolConnectionAtomId(event, text); rule = "agent.tool_connection"; }
  else if (category.includes("network") || /network|url|http|https|socket|request/i.test(text)) { id = networkAtomId(event, text); rule = "runtime.network_operation"; }
  else if (category.includes("process") || /spawn|process|powershell|shell|command|curl|wget|npm run/i.test(text)) { id = category.includes("process") || /spawn|process.?create/i.test(text) ? processCreateAtomId(event, text) : executionAtomId(event, text); rule = "runtime.process_observation"; }
  else if (category.includes("tool") || category.includes("mcp") || /tool|mcp|invoke|browser\.fetch|filesystem\./i.test(text)) {
    id = /delete|remove/i.test(text) ? "TOOL.DISCONNECT" : /install|add package/i.test(text) ? "TOOL.REGISTER" : /write|modify|edit|create/i.test(text) ? "TOOL.INVOKE" : "TOOL.INVOKE";
    rule = "agent.tool_operation";
  }
  else if (category.includes("file") || /file|readme|workspace|path|document/i.test(text)) { id = /delete|remove/i.test(text) ? "DATA.RESOURCE_DELETE" : /write|modify|edit/i.test(text) ? "DATA.DATA_WRITE" : dataReadAtomId(event, text); rule = "runtime.file_operation"; }
  else if (category.includes("session") || category.includes("prompt") || category.includes("intent")) { id = intentTaskAtomId(text); rule = "intent.task_classification"; }
  const confidence = promptInjection ? 0.99 : id === "INTENT.INTERPRET" ? 0.58 : (HIGH_RISK.has(id) ? 0.96 : 0.88);
  const derived = new Set([id]);
  const lower = text + " " + toolName;
  if (/file|path|readme|workspace|\.env|credential|secret|ssh.?key|private.?key/i.test(lower)) derived.add(/write|modify|edit|create/i.test(lower) ? "DATA.DATA_WRITE" : dataReadAtomId(event, lower));
  if (/tool|mcp|invoke|filesystem\.|browser\.|webfetch/i.test(lower)) derived.add(/write|modify|edit|create/i.test(lower) ? "TOOL.INVOKE" : "TOOL.RECEIVE_RESULT");
  if (category.includes("network") || /socket|connection|connect(?:ed|ion)?|remote.?address|remote.?port|outbound/i.test(lower)) {
    derived.add(networkAtomId(event, lower));
  }
  if (category.includes("process") || /shell|command|powershell|npm run|curl|wget|spawn|execute/i.test(lower)) {
    derived.add(category.includes("process") || /spawn|process.?create/i.test(lower) ? processCreateAtomId(event, lower) : executionAtomId(event, lower));
  }
  if (/https?:\/\/|external|upload|exfil|transfer|send.?to|outbound/i.test(lower)) derived.add(networkAtomId(event, lower));
  if (/credential|secret|\.env|ssh.?key|id_rsa|private.?key|password|api.?key|token/i.test(lower)) derived.add(/upload|exfil|transfer|send/i.test(lower) ? "AUTH.CREDENTIAL_TRANSFER" : "AUTH.CREDENTIAL_DISCOVER");
  if (derived.size > 1 && external && /upload|exfil|transfer|send.?to|outbound|curl|wget/i.test(lower)) derived.add("DATA.DATA_TRANSFER");
  const atomSet = Array.from(derived).map(atomIdValue => ({
    atomId: canonicalAtomId(atomIdValue),
    role: atomIdValue === id ? "primary" : "derived",
    score: atomIdValue === id ? confidence : Math.max(0.5, confidence - 0.08),
    rule: atomIdValue === id ? rule : "derived.structure"
  }));
  const candidates = [
    { atomId: id, score: confidence, rule },
    ...(promptInjection ? [{ atomId: "PLAN.BYPASS", canonicalAtomId: "PLAN.MODIFY", score: 0.99, rule: "threat.prompt_injection" }, { atomId: "INTENT.MODIFY", score: 0.42, rule: "intent.boundary_change" }] : [])
  ];
  return {
    atomId: id,
    confidence,
    mappingRule: rule,
    mappingVersion: "rules-v3-structured",
    candidates,
    atoms: atomSet,
    unknown: id === "INTENT.INTERPRET" && confidence < 0.65,
    calibrationVersion: "rules-calibration-pending-v1",
    explanation: {
      rawEvent: { category, eventType: event.eventType || null, summary: event.summary || "", source: event.source || null },
      matchedRule: rule,
      primaryAtom: id,
      evidence: [category, toolName, event.summary, detail.path, detail.url, detail.remotePort].filter(value => value !== undefined && value !== null && String(value).trim()),
      riskSemantics: RISK_SEMANTICS[id] || { action: id.toLowerCase().replace(".", "_"), risk: HIGH_RISK.has(id) ? "High-impact capability use" : "Observed agent capability use", dimensions: [id.split(".")[0].toLowerCase()] }
    }
  };
}

function mapEventToAtoms(event = {}) {
  const mapping = mapEventToAtom(event);
  return mapping.atoms?.length ? mapping.atoms : [{ atomId: mapping.atomId, role: "primary", score: mapping.confidence, rule: mapping.mappingRule }];
}

function getOrganizationBoundary(policy = {}) {
  const configured = policy.organizationBoundary || EMPTY_OBJECT;
  const session = policy.sessionPolicy || EMPTY_OBJECT;
  const cached = organizationBoundaryCache.get(policy);
  if (cached && cached.configured === configured && cached.session === session) return cached.boundary;
  const maxLevel = Math.max(0, Math.min(5, Number.isFinite(Number(configured.maxLevel)) ? Number(configured.maxLevel) : 3));
  const configuredLevels = configured.levels || configured.domainLevels || {};
  const levels = Object.fromEntries(DOMAINS.map(domain => [
    domain.id,
    Math.max(0, Math.min(5, Number.isFinite(Number(configuredLevels[domain.id])) ? Number(configuredLevels[domain.id]) : maxLevel))
  ]));
  const boundary = {
    version: configured.version || "org-boundary-v1",
    policyVersion: policy.version || null,
    policyRevision: policy.policyMeta?.revision ?? null,
    maxLevel,
    levels,
    allowedAtoms: Array.from(new Set(configured.allowedAtoms || [])).map(canonicalAtomId),
    conditionalAtoms: Array.from(new Set(configured.conditionalAtoms || [])).map(canonicalAtomId),
    deniedAtoms: Array.from(new Set(configured.deniedAtoms || [])).map(canonicalAtomId),
    allowedDomains: configured.allowedDomains || session.allowedDomains || ["localhost", "127.0.0.1"],
    deniedPaths: configured.deniedPaths || session.deniedPaths || [],
    source: configured.source || "policy.organizationBoundary",
    policyBasis: ["organizationBoundary.allowedAtoms", "organizationBoundary.deniedAtoms", "organizationBoundary.levels", "sessionPolicy.allowedDomains", "sessionPolicy.deniedPaths"]
  };
  organizationBoundaryCache.set(policy, { configured, session, boundary });
  return boundary;
}

function classifyOrganizationAtom(atom = {}, organization = {}) {
  const id = canonicalAtomId(atom.id);
  const domain = String(atom.domain || id.split(".")[0]).toUpperCase();
  const requiredLevel = Math.max(0, Math.min(5, Number(atom.baseLevel || 0)));
  const allowedLevel = Math.max(0, Math.min(5, Number(organization.levels?.[domain] ?? organization.maxLevel ?? 3)));
  const allowedByAtom = (organization.allowedAtoms || []).some(item => canonicalAtomId(item) === id);
  const conditionalByAtom = (organization.conditionalAtoms || []).some(item => canonicalAtomId(item) === id);
  const deniedByAtom = (organization.deniedAtoms || []).some(item => canonicalAtomId(item) === id);
  const disabled = atom.enabled === false;
  let reason = "within";
  if (disabled) reason = "atom_disabled";
  else if (deniedByAtom) reason = "atom_denied_by_policy";
  else if (conditionalByAtom) reason = "atom_requires_approval";
  else if (!allowedByAtom && requiredLevel > allowedLevel) reason = "level_exceeds_organization";
  return {
    scope: reason === "within" ? "within" : reason === "atom_requires_approval" ? "conditional" : "organization",
    reason,
    atomId: id,
    domain,
    enabled: !disabled,
    policyAllowed: reason === "within",
    explicitlyAllowed: allowedByAtom,
    conditionallyAllowed: conditionalByAtom,
    requiredLevel,
    allowedLevel,
    version: organization.version || "org-boundary-v1",
    policyVersion: organization.policyVersion || null,
    policyRevision: organization.policyRevision ?? null,
    source: organization.source || "policy.organizationBoundary"
  };
}

function deriveTaskLevels(effective = {}, maxLevel = 3) {
  const configured = effective.levels || effective.domainLevels;
  if (configured && typeof configured === "object") {
    return Object.fromEntries(DOMAINS.map(domain => [
      domain.id,
      Math.max(0, Math.min(5, Number.isFinite(Number(configured[domain.id])) ? Number(configured[domain.id]) : maxLevel))
    ]));
  }
  const capabilities = effective.capabilities || {};
  const hasCapability = Object.keys(capabilities).length > 0;
  if (!hasCapability) return Object.fromEntries(DOMAINS.map(domain => [domain.id, maxLevel]));
  const enabled = name => capabilities[name] === true;
  return {
    INTENT: 1,
    PLAN: 1,
    AGENT: 0,
    MODEL: enabled("network") ? 3 : 1,
    TOOL: enabled("mcpWrite") ? 3 : enabled("mcpRead") || enabled("network") ? 3 : 0,
    AUTH: 0,
    DATA: enabled("fileWrite") ? 2 : enabled("fileRead") ? 1 : 0,
    MEMORY: 0,
    EXEC: enabled("shell") ? 3 : enabled("network") ? 3 : 0
  };
}

function sessionBoundary(session = {}) {
  const effective = session.effectivePolicy || session.taskBoundary || {};
  const capabilities = effective.capabilities || {};
  const maxLevel = Number.isFinite(Number(effective.maxLevel)) ? Number(effective.maxLevel) : 3;
  return {
    maxLevel,
    levels: deriveTaskLevels(effective, maxLevel),
    capabilities,
    allowedDomains: effective.allowedDomains || [],
    deniedPaths: effective.deniedPaths || [],
    source: "session.taskBoundary"
  };
}

function constrainTaskBoundary(task = {}, organization = {}) {
  const orgMax = Math.max(0, Math.min(5, Number(organization.maxLevel ?? 3)));
  const taskMax = Math.max(0, Math.min(5, Number(task.maxLevel ?? orgMax)));
  const orgLevels = organization.levels || organization.domainLevels || {};
  const taskLevels = task.levels || task.domainLevels || {};
  const levels = Object.fromEntries(DOMAINS.map(domain => {
    const orgLevel = Number.isFinite(Number(orgLevels[domain.id])) ? Number(orgLevels[domain.id]) : orgMax;
    const taskLevel = Number.isFinite(Number(taskLevels[domain.id])) ? Number(taskLevels[domain.id]) : taskMax;
    return [domain.id, Math.max(0, Math.min(5, orgLevel, taskLevel))];
  }));
  return { ...task, maxLevel: Math.min(orgMax, taskMax), levels, source: task.source || "session.taskBoundary" };
}

function classifyBoundary(atom, event = {}, policy = {}, session = {}) {
  const org = getOrganizationBoundary(policy);
  const task = constrainTaskBoundary(sessionBoundary(session), org);
  const detail = event.detail || {};
  const toolInput = detail.toolInput && typeof detail.toolInput === "object" ? detail.toolInput : {};
  const resource = String(detail.path || detail.file_path || toolInput.path || toolInput.file_path || detail.target || event.object || event.resource || "");
  const destination = String(detail.destination || detail.url || detail.host || toolInput.url || toolInput.host || toolInput.domain || "");
  const externalTarget = Boolean(detail.external || /https?:\/\//i.test(destination) || /external|unknown-model|attacker/i.test(destination));
  const disabledAtom = atom.enabled === false;
  const allowedByAtom = org.allowedAtoms.some(item => canonicalAtomId(item) === atom.id);
  const conditionalByAtom = org.conditionalAtoms.some(item => canonicalAtomId(item) === atom.id);
  const deniedByAtom = org.deniedAtoms.some(item => canonicalAtomId(item) === atom.id);
  const deniedPath = org.deniedPaths.some(pattern => String(resource).toLowerCase().includes(String(pattern).replace(/\*/g, "").toLowerCase()));
  const threatAdjustment = String(event.mappingRule || "").startsWith("threat.") ? 2 : 0;
  const requiredLevel = Math.min(5, Number(atom.baseLevel || 0) + threatAdjustment + (atom.highRisk ? 0 : 0));
  const taskDeniedPath = (task.deniedPaths || []).some(pattern => String(resource).toLowerCase().includes(String(pattern).replace(/\*/g, "").toLowerCase()));
  const matchesDomain = (pattern, value) => pattern === "*" || value.includes(String(pattern));
  const taskDomainDenied = externalTarget && task.allowedDomains?.length > 0 && !task.allowedDomains.some(domain => matchesDomain(domain, destination));
  const orgAllowedLevel = org.levels?.[atom.domain] ?? org.maxLevel;
  const taskAllowedLevel = task.levels?.[atom.domain] ?? task.maxLevel;
  const orgLevelExceeded = !allowedByAtom && requiredLevel > orgAllowedLevel;
  const taskLevelExceeded = requiredLevel > taskAllowedLevel;
  const orgExceeded = disabledAtom || deniedByAtom || deniedPath || orgLevelExceeded || (externalTarget && !org.allowedDomains.some(domain => matchesDomain(domain, destination)));
  const taskExceeded = !orgExceeded && (taskLevelExceeded || taskDeniedPath || taskDomainDenied);
  const scope = orgExceeded ? "organization" : taskExceeded ? "task" : conditionalByAtom ? "conditional" : "within";
  return {
    scope,
    requiredLevel,
    allowedLevel: Math.min(orgAllowedLevel, taskAllowedLevel),
    organizationBoundaryVersion: org.version,
    organizationReason: disabledAtom ? "atom_disabled" : deniedByAtom ? "atom_denied_by_policy" : deniedPath ? "path_denied_by_policy" : orgLevelExceeded ? "level_exceeds_organization" : (externalTarget && !org.allowedDomains.some(domain => matchesDomain(domain, destination))) ? "domain_outside_organization" : "within",
    taskBoundarySource: task.source,
    color: orgExceeded ? "red" : taskExceeded || conditionalByAtom ? "amber" : "teal",
    externalTarget,
    layers: {
      organization: { maxLevel: orgAllowedLevel, denied: orgExceeded, conditional: conditionalByAtom, reason: disabledAtom ? "atom_disabled" : deniedByAtom ? "atom_denied_by_policy" : conditionalByAtom ? "atom_requires_approval" : deniedPath ? "path_denied_by_policy" : orgLevelExceeded ? "level_exceeds_organization" : (externalTarget && !org.allowedDomains.some(domain => matchesDomain(domain, destination))) ? "domain_outside_organization" : "within", version: org.version },
      task: { maxLevel: taskAllowedLevel, denied: taskExceeded, source: task.source },
      runtime: { externalTarget, resource }
    }
  };
}

function enrichEvent(event, policy = {}, session = {}) {
  const upstreamAtomId = event.atomId ? canonicalAtomId(event.atomId) : null;
  const structuralMapping = mapEventToAtom(event);
  const upstreamAtoms = Array.isArray(event.behaviorAtoms) ? event.behaviorAtoms : [];
  const needsStructuralBackfill = Boolean(upstreamAtomId) && (upstreamAtoms.length <= 1 || BROAD_PARENT_ATOMS.has(upstreamAtomId));
  const refinedAtomId = needsStructuralBackfill && BROAD_PARENT_ATOMS.has(upstreamAtomId) && structuralMapping.atomId !== upstreamAtomId
    ? structuralMapping.atomId
    : upstreamAtomId;
  const backfilledAtoms = needsStructuralBackfill
    ? [
        { atomId: refinedAtomId, role: "primary", score: Number(event.atomConfidence ?? structuralMapping.confidence ?? 1), rule: refinedAtomId === upstreamAtomId ? (event.mappingRule || "upstream_mapping") : "refined.legacy_parent" },
        ...(structuralMapping.atoms || [])
          .filter(item => canonicalAtomId(item.atomId) !== refinedAtomId)
          .map(item => ({ ...item, role: item.role === "primary" ? "derived" : item.role, rule: item.rule || "derived.structure_backfill" }))
      ]
    : upstreamAtoms;
  const mapping = upstreamAtomId ? {
    atomId: refinedAtomId,
    originalAtomId: String(event.atomId).toUpperCase(),
    confidence: Number(event.atomConfidence ?? 1),
    mappingRule: event.mappingRule || "upstream_mapping",
    mappingVersion: needsStructuralBackfill ? "upstream+rules-v3-structured" : (event.mappingVersion || "upstream"),
    candidates: event.mappingCandidates || [],
    atoms: backfilledAtoms.length ? backfilledAtoms : [{ atomId: upstreamAtomId, role: "primary", score: Number(event.atomConfidence ?? 1), rule: event.mappingRule || "upstream_mapping" }],
    unknown: Boolean(event.mappingUnknown),
    calibrationVersion: event.calibrationVersion || "upstream"
  } : structuralMapping;
  const catalog = buildCatalog(policy);
  const atom = catalog.find(item => item.id === mapping.atomId) || normalizeAtomDefinition({ id: mapping.atomId || "UNMAPPED.UNKNOWN", domain: String(mapping.atomId || "UNMAPPED.UNKNOWN").split(".")[0], baseLevel: 2, highRisk: true, description: "未归属行为原子", system: false });
  const boundary = classifyBoundary(atom, { ...event, mappingRule: mapping.mappingRule }, policy, session);
  const mappingCandidates = [
    ...(mapping.originalAtomId && mapping.originalAtomId !== mapping.atomId ? [{ atomId: mapping.originalAtomId, canonicalAtomId: mapping.atomId, score: mapping.confidence, rule: "compatibility.alias" }] : []),
    ...(mapping.candidates || [])
  ];
  const normalizedAtoms = (mapping.atoms || [{ atomId: mapping.atomId, role: "primary", score: mapping.confidence, rule: mapping.mappingRule }]).map(item => ({ ...item, atomId: canonicalAtomId(item.atomId) }));
  const mappingExplanation = mapping.explanation || {
    rawEvent: { category: event.category || null, eventType: event.eventType || null, summary: event.summary || "", source: event.source || null },
    matchedRule: mapping.mappingRule,
    primaryAtom: mapping.atomId,
    evidence: Array.isArray(event.evidence) ? event.evidence : [],
    riskSemantics: RISK_SEMANTICS[mapping.atomId] || { action: String(mapping.atomId).toLowerCase().replace(".", "_"), risk: atom.highRisk ? "High-impact capability use" : "Observed agent capability use", dimensions: [String(atom.domain).toLowerCase()] }
  };
  const occurrence = normalizeOccurrence({ ...event, atomId: mapping.atomId, behaviorAtoms: normalizedAtoms, atomConfidence: mapping.confidence, mappingRule: mapping.mappingRule, mappingUnknown: mapping.unknown }, atom, { ...mapping, candidates: mappingCandidates, atoms: normalizedAtoms }, boundary);
  return {
    ...event,
    atomId: mapping.atomId,
    atomDomain: atom.domain,
    atomConfidence: mapping.confidence,
    atomBaseLevel: atom.baseLevel,
    mappingRule: mapping.mappingRule,
    boundaryScope: boundary.scope,
    requiredLevel: boundary.requiredLevel,
    allowedLevel: boundary.allowedLevel,
    organizationBoundaryVersion: boundary.organizationBoundaryVersion,
    enforcementColor: boundary.color,
    behaviorAtom: { id: mapping.atomId, domain: atom.domain, confidence: mapping.confidence, baseLevel: atom.baseLevel, description: atom.description },
    behaviorAtoms: normalizedAtoms,
    mappingUnknown: Boolean(mapping.unknown),
    calibrationVersion: mapping.calibrationVersion || "rules-calibration-pending-v1",
    boundary,
    occurrenceId: occurrence.occurrenceId,
    taskId: occurrence.taskId,
    mappingVersion: mapping.mappingVersion,
    mappingCandidates,
    mappingExplanation,
    riskSemantics: mappingExplanation.riskSemantics,
    occurrence
  };
}

function aggregateEvents(events = [], policy = {}, sessionResolver = null) {
  const atomStats = new Map();
  const agents = new Map();
  const occurrences = [];
  const quality = {
    totalEvents: 0,
    mappedEvents: 0,
    unknownEvents: 0,
    multiAtomEvents: 0,
    lowConfidenceEvents: 0,
    attributedEvents: 0,
    sessionLinkedEvents: 0,
    totalAtomOccurrences: 0,
    primaryAtomOccurrences: 0,
    derivedAtomOccurrences: 0,
    inferredAtomOccurrences: 0
  };
  const catalog = buildCatalog(policy);
  for (const [sequence, raw] of events.slice().sort((a, b) => String(a.timestamp || a.time || "").localeCompare(String(b.timestamp || b.time || ""))).entries()) {
    const session = sessionResolver ? (sessionResolver(raw) || {}) : (raw.session || {});
    const event = raw && raw.occurrence && raw.behaviorAtom && raw.boundary
      ? raw
      : enrichEvent(raw, policy, session);
    const atom = event.atomId || "UNCLASSIFIED.UNKNOWN";
    const agent = String(event.agentId || event.agent || "unknown");
    const mappedAtoms = Array.from(new Map(
      (event.behaviorAtoms?.length ? event.behaviorAtoms : [{ atomId: atom, role: "primary", score: event.atomConfidence ?? 1, rule: event.mappingRule }])
        .map(item => {
          const atomIdValue = canonicalAtomId(item.atomId || atom);
          return [atomIdValue, { ...item, atomId: atomIdValue, role: item.role || (atomIdValue === atom ? "primary" : "derived") }];
        })
    ).values());
    quality.totalEvents++;
    quality.totalAtomOccurrences += mappedAtoms.length;
    quality.mappedEvents += mappedAtoms.length ? 1 : 0;
    quality.unknownEvents += event.mappingUnknown ? 1 : 0;
    quality.multiAtomEvents += mappedAtoms.length > 1 ? 1 : 0;
    quality.lowConfidenceEvents += Number(event.atomConfidence ?? 0) < 0.65 ? 1 : 0;
    quality.attributedEvents += agent !== "unknown" ? 1 : 0;
    quality.sessionLinkedEvents += event.sessionId ? 1 : 0;
    mappedAtoms.forEach(mapped => {
      const role = ["primary", "derived", "inferred"].includes(mapped.role) ? mapped.role : "derived";
      quality[role + "AtomOccurrences"]++;
      const definition = catalog.find(item => item.id === mapped.atomId) || normalizeAtomDefinition({
        id: mapped.atomId, domain: mapped.atomId.split(".")[0], baseLevel: event.requiredLevel || 2,
        highRisk: true, description: "未归属行为原子", system: false
      });
      const atomBoundary = mapped.atomId === atom
        ? { scope: event.boundaryScope, requiredLevel: event.requiredLevel, allowedLevel: event.allowedLevel }
        : classifyBoundary(definition, { ...event, mappingRule: mapped.rule || event.mappingRule }, policy, session);
      const stat = atomStats.get(mapped.atomId) || {
        atomId: mapped.atomId, domain: definition.domain || mapped.atomId.split(".")[0],
        hits: 0, events: 0, allow: 0, alert: 0, block: 0,
        primary: 0, derived: 0, inferred: 0, confidenceTotal: 0,
        agents: new Set(), sessions: new Set(), outOfOrganization: 0, outOfTask: 0,
        firstSeen: null, lastSeen: null
      };
      stat.hits++;
      stat.events++;
      stat[role]++;
      stat.confidenceTotal += Number(mapped.score ?? event.atomConfidence ?? 0);
      stat[event.verdict] = (stat[event.verdict] || 0) + 1;
      stat.agents.add(agent);
      if (event.sessionId) stat.sessions.add(String(event.sessionId));
      if (atomBoundary.scope === "organization") stat.outOfOrganization++;
      if (atomBoundary.scope === "task") stat.outOfTask++;
      stat.firstSeen = !stat.firstSeen || stat.firstSeen > event.timestamp ? event.timestamp : stat.firstSeen;
      stat.lastSeen = stat.lastSeen && stat.lastSeen > event.timestamp ? stat.lastSeen : event.timestamp;
      atomStats.set(mapped.atomId, stat);
    });
    const occurrence = { ...event.occurrence, sequence: sequence + 1 };
    occurrences.push(occurrence);
    const agentStat = agents.get(agent) || { agentId: agent, atoms: new Map(), total: 0, outOfOrganization: 0, outOfTask: 0, block: 0, alert: 0, allow: 0, path: [], sessions: new Set() };
    agentStat.total++; agentStat[event.verdict] = (agentStat[event.verdict] || 0) + 1;
    if (event.boundaryScope === "organization") agentStat.outOfOrganization++; if (event.boundaryScope === "task") agentStat.outOfTask++;
    if (event.sessionId) agentStat.sessions.add(String(event.sessionId));
    agentStat.path.push({ occurrenceId: occurrence.occurrenceId, eventId: occurrence.eventId, atomId: atom, atoms: event.behaviorAtoms || [{ atomId: atom, role: "primary" }], timestamp: event.timestamp, sequence: sequence + 1, boundaryScope: event.boundaryScope, verdict: event.verdict, source: event.source, parentEventId: event.parentEventId, confidence: event.atomConfidence, mappingUnknown: Boolean(event.mappingUnknown), evidenceHash: occurrence.evidenceHash, effect: occurrence.effect, boundary: occurrence.boundary });
    mappedAtoms.forEach(mapped => agentStat.atoms.set(mapped.atomId, (agentStat.atoms.get(mapped.atomId) || 0) + 1));
    agents.set(agent, agentStat);
  }
  const mappedEventDenominator = Math.max(1, quality.totalEvents);
  return {
    occurrences,
    atoms: Array.from(atomStats.values()).map(item => ({
      ...item,
      averageConfidence: item.hits ? Number((item.confidenceTotal / item.hits).toFixed(3)) : 0,
      agents: Array.from(item.agents),
      sessions: Array.from(item.sessions)
    })).sort((a, b) => b.hits - a.hits),
    agents: Array.from(agents.values()).map(item => ({ ...item, atoms: Object.fromEntries(item.atoms), sessions: Array.from(item.sessions), path: item.path.sort((a, b) => Number(a.sequence) - Number(b.sequence)) })).sort((a, b) => b.total - a.total),
    mappingQuality: {
      ...quality,
      mappingCoverage: Number((quality.mappedEvents / mappedEventDenominator).toFixed(4)),
      unknownRate: Number((quality.unknownEvents / mappedEventDenominator).toFixed(4)),
      multiAtomRate: Number((quality.multiAtomEvents / mappedEventDenominator).toFixed(4)),
      lowConfidenceRate: Number((quality.lowConfidenceEvents / mappedEventDenominator).toFixed(4)),
      attributionRate: Number((quality.attributedEvents / mappedEventDenominator).toFixed(4)),
      sessionLinkRate: Number((quality.sessionLinkedEvents / mappedEventDenominator).toFixed(4)),
      averageAtomsPerEvent: Number((quality.totalAtomOccurrences / mappedEventDenominator).toFixed(3))
    }
  };
}

module.exports = { DOMAINS, buildCatalog, mapEventToAtom, mapEventToAtoms, enrichEvent, aggregateEvents, getOrganizationBoundary, classifyOrganizationAtom, deriveTaskLevels, sessionBoundary, constrainTaskBoundary, classifyBoundary };

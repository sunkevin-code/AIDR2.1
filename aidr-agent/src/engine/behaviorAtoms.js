const { normalizeAtomDefinition, normalizeOccurrence } = require("./behaviorAtomSchema");
const catalogCache = new WeakMap();
const organizationBoundaryCache = new WeakMap();
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

// The catalog mirrors the ABCG v1 ontology used by the design document and demos.
const DOMAINS = [
  { id: "INTENT", label: "意图", atoms: ["RECEIVE", "INTERPRET", "INFER", "CLARIFY", "CONFIRM", "MODIFY", "DELEGATE", "TERMINATE"] },
  { id: "PLAN", label: "计划", atoms: ["CREATE", "DECOMPOSE", "SELECT", "MODIFY", "RETRY", "FALLBACK", "VALIDATE", "COMPLETE"] },
  { id: "AGENT", label: "Agent", atoms: ["CREATE", "CONFIGURE", "START", "STOP", "DELEGATE", "COMMUNICATE", "SHARE_CONTEXT", "AGGREGATE"] },
  { id: "MODEL", label: "模型", atoms: ["INVOKE", "SWITCH", "SEND_CONTEXT", "RECEIVE_OUTPUT", "VALIDATE_OUTPUT", "CACHE"] },
  { id: "TOOL", label: "工具 / MCP", atoms: ["DISCOVER", "CONNECT", "REGISTER", "CONFIGURE", "INVOKE", "RECEIVE_RESULT", "CHAIN", "DISCONNECT"] },
  { id: "AUTH", label: "身份 / 凭据", atoms: ["IDENTITY_AUTHENTICATE", "IDENTITY_IMPERSONATE", "CREDENTIAL_DISCOVER", "CREDENTIAL_ACQUIRE", "CREDENTIAL_USE", "CREDENTIAL_TRANSFER", "CREDENTIAL_REVOKE", "PERMISSION_CHECK", "PERMISSION_REQUEST", "PERMISSION_MODIFY"] },
  { id: "DATA", label: "数据", atoms: ["RESOURCE_DISCOVER", "RESOURCE_CREATE", "DATA_READ", "DATA_WRITE", "DATA_MODIFY", "DATA_TRANSFORM", "DATA_TRANSFER", "DATA_PUBLISH", "RESOURCE_DELETE", "RESOURCE_PERMISSION_CHANGE"] },
  { id: "MEMORY", label: "记忆", atoms: ["MEMORY_READ", "MEMORY_WRITE", "MEMORY_MODIFY", "MEMORY_SHARE", "MEMORY_DELETE", "MEMORY_RESTORE"] },
  { id: "EXEC", label: "执行 / 系统", atoms: ["CODE_GENERATE", "CODE_EXECUTE", "PROCESS_CREATE", "PROCESS_CONTROL", "SYSTEM_CONFIGURE", "SYSTEM_PRIVILEGE_CHANGE", "SYSTEM_RESOURCE_CONSUME", "SYSTEM_CALL"] }
];

const LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 5 };
const HIGH_RISK = new Set([
  "INTENT.MODIFY", "INTENT.DELEGATE", "PLAN.FALLBACK", "AGENT.CONFIGURE", "AGENT.SHARE_CONTEXT",
  "MODEL.SWITCH", "MODEL.SEND_CONTEXT", "TOOL.REGISTER", "TOOL.CONFIGURE", "TOOL.CHAIN",
  "AUTH.IDENTITY_IMPERSONATE", "AUTH.CREDENTIAL_DISCOVER", "AUTH.CREDENTIAL_ACQUIRE", "AUTH.CREDENTIAL_TRANSFER", "AUTH.CREDENTIAL_REVOKE", "AUTH.PERMISSION_REQUEST", "AUTH.PERMISSION_MODIFY",
  "DATA.DATA_TRANSFER", "DATA.DATA_PUBLISH", "DATA.RESOURCE_DELETE", "DATA.RESOURCE_PERMISSION_CHANGE",
  "MEMORY.MEMORY_SHARE", "MEMORY.MEMORY_DELETE", "EXEC.PROCESS_CONTROL", "EXEC.SYSTEM_CONFIGURE", "EXEC.SYSTEM_PRIVILEGE_CHANGE"
]);

const BASE_LEVELS = {
  "INTENT.RECEIVE": 0, "INTENT.INTERPRET": 0, "INTENT.INFER": 1, "INTENT.CLARIFY": 0, "INTENT.CONFIRM": 0, "INTENT.MODIFY": 2, "INTENT.DELEGATE": 3, "INTENT.TERMINATE": 0,
  "PLAN.CREATE": 0, "PLAN.DECOMPOSE": 0, "PLAN.SELECT": 0, "PLAN.MODIFY": 1, "PLAN.RETRY": 1, "PLAN.FALLBACK": 2, "PLAN.VALIDATE": 0, "PLAN.COMPLETE": 0,
  "AGENT.CREATE": 3, "AGENT.CONFIGURE": 4, "AGENT.START": 3, "AGENT.STOP": 3, "AGENT.DELEGATE": 3, "AGENT.COMMUNICATE": 2, "AGENT.SHARE_CONTEXT": 3, "AGENT.AGGREGATE": 1,
  "MODEL.INVOKE": 3, "MODEL.SWITCH": 3, "MODEL.SEND_CONTEXT": 3, "MODEL.RECEIVE_OUTPUT": 0, "MODEL.VALIDATE_OUTPUT": 0, "MODEL.CACHE": 2,
  "TOOL.DISCOVER": 1, "TOOL.CONNECT": 3, "TOOL.REGISTER": 4, "TOOL.CONFIGURE": 4, "TOOL.INVOKE": 3, "TOOL.RECEIVE_RESULT": 1, "TOOL.CHAIN": 3, "TOOL.DISCONNECT": 3,
  "AUTH.IDENTITY_AUTHENTICATE": 1, "AUTH.IDENTITY_IMPERSONATE": 4, "AUTH.CREDENTIAL_DISCOVER": 2, "AUTH.CREDENTIAL_ACQUIRE": 4, "AUTH.CREDENTIAL_USE": 3, "AUTH.CREDENTIAL_TRANSFER": 5, "AUTH.CREDENTIAL_REVOKE": 4, "AUTH.PERMISSION_CHECK": 1, "AUTH.PERMISSION_REQUEST": 4, "AUTH.PERMISSION_MODIFY": 5,
  "DATA.RESOURCE_DISCOVER": 1, "DATA.RESOURCE_CREATE": 2, "DATA.DATA_READ": 1, "DATA.DATA_WRITE": 2, "DATA.DATA_MODIFY": 2, "DATA.DATA_TRANSFORM": 2, "DATA.DATA_TRANSFER": 3, "DATA.DATA_PUBLISH": 5, "DATA.RESOURCE_DELETE": 5, "DATA.RESOURCE_PERMISSION_CHANGE": 5,
  "MEMORY.MEMORY_READ": 1, "MEMORY.MEMORY_WRITE": 2, "MEMORY.MEMORY_MODIFY": 2, "MEMORY.MEMORY_SHARE": 3, "MEMORY.MEMORY_DELETE": 4, "MEMORY.MEMORY_RESTORE": 2,
  "EXEC.CODE_GENERATE": 2, "EXEC.CODE_EXECUTE": 3, "EXEC.PROCESS_CREATE": 3, "EXEC.PROCESS_CONTROL": 4, "EXEC.SYSTEM_CONFIGURE": 4, "EXEC.SYSTEM_PRIVILEGE_CHANGE": 5, "EXEC.SYSTEM_RESOURCE_CONSUME": 2, "EXEC.SYSTEM_CALL": 3
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
      result.push(normalizeAtomDefinition({
        id, domain: domain.id, domainLabel: domain.label, name, baseLevel: BASE_LEVELS[id] ?? 2,
        description: DESCRIPTIONS[id] || `${domain.label}：${name}`,
        system: true, enabled: !disabled.has(id), highRisk: HIGH_RISK.has(id),
        ...(custom[id] && typeof custom[id] === "object" ? custom[id] : {})
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
  else if (/credential|secret|\.env|ssh.?key|id_rsa|private.?key|password|api.?key|access.?token|refresh.?token|bearer|token\s*[:=]/i.test(text)) {
    id = /write|transfer|send|upload/i.test(text) ? "AUTH.CREDENTIAL_TRANSFER" : "AUTH.CREDENTIAL_DISCOVER";
    rule = "sensitive.credential_pattern";
  }
  else if (/long.?term|cross.?session|memory|记忆/i.test(text)) { id = /write|store|save|persist/i.test(text) ? "MEMORY.MEMORY_WRITE" : "MEMORY.MEMORY_READ"; rule = "memory.operation"; }
  else if (/model|llm|inference|completion|embedding|prompt|context/i.test(text) && (category.includes("model") || category.includes("prompt") || category.includes("response"))) {
    id = /send|context|prompt/i.test(text) ? "MODEL.SEND_CONTEXT" : /output|response/i.test(text) ? "MODEL.RECEIVE_OUTPUT" : "MODEL.INVOKE";
    rule = "model.runtime_operation";
  }
  else if (category === "process" && detail.eventType === "process" && detail.agentId && detail.name) { id = "AGENT.CREATE"; rule = "agent.runtime_observation"; }
  else if (category.includes("agent") || /delegate|spawn|sub.?agent|agent.?message/i.test(text)) { id = /delegate/i.test(text) ? "AGENT.DELEGATE" : /message|communicat/i.test(text) ? "AGENT.COMMUNICATE" : "AGENT.CREATE"; rule = "agent.coordination"; }
  else if (category.includes("network") || /network|url|http|https|socket|request/i.test(text)) { id = "EXEC.SYSTEM_CALL"; rule = "runtime.network_observation"; }
  else if (category.includes("process") || /spawn|process|powershell|shell|command|curl|wget|npm run/i.test(text)) { id = /spawn|process/i.test(text) ? "EXEC.PROCESS_CREATE" : "EXEC.CODE_EXECUTE"; rule = "runtime.process_observation"; }
  else if (category.includes("tool") || category.includes("mcp") || /tool|mcp|invoke|browser\.fetch|filesystem\./i.test(text)) {
    id = /delete|remove/i.test(text) ? "TOOL.DISCONNECT" : /install|add package/i.test(text) ? "TOOL.REGISTER" : /write|modify|edit|create/i.test(text) ? "TOOL.INVOKE" : "TOOL.INVOKE";
    rule = "agent.tool_operation";
  }
  else if (category.includes("file") || /file|readme|workspace|path|document/i.test(text)) { id = /delete|remove/i.test(text) ? "DATA.RESOURCE_DELETE" : /write|modify|edit/i.test(text) ? "DATA.DATA_WRITE" : "DATA.DATA_READ"; rule = "runtime.file_operation"; }
  else if (category.includes("session") || category.includes("prompt") || category.includes("intent")) { id = /modify|write|create|implement/i.test(text) ? "INTENT.MODIFY" : "INTENT.INTERPRET"; rule = "intent.prompt_operation"; }
  const confidence = promptInjection ? 0.99 : id === "INTENT.INTERPRET" ? 0.58 : (HIGH_RISK.has(id) ? 0.96 : 0.88);
  const candidates = [
    { atomId: id, score: confidence, rule },
    ...(promptInjection ? [{ atomId: "PLAN.BYPASS", canonicalAtomId: "PLAN.MODIFY", score: 0.99, rule: "threat.prompt_injection" }, { atomId: "INTENT.MODIFY", score: 0.42, rule: "intent.boundary_change" }] : [])
  ];
  return { atomId: id, confidence, mappingRule: rule, mappingVersion: "rules-v2", candidates };
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
    maxLevel,
    levels,
    deniedAtoms: Array.from(new Set([...(configured.deniedAtoms || []), "AUTH.CREDENTIAL_DISCOVER", "DATA.DATA_TRANSFER", "TOOL.CONFIGURE"])).map(canonicalAtomId),
    allowedDomains: configured.allowedDomains || session.allowedDomains || ["localhost", "127.0.0.1"],
    deniedPaths: configured.deniedPaths || session.deniedPaths || [],
    source: configured.source || "policy.organizationBoundary"
  };
  organizationBoundaryCache.set(policy, { configured, session, boundary });
  return boundary;
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
    TOOL: enabled("mcpWrite") ? 3 : enabled("mcpRead") ? 1 : 0,
    AUTH: 0,
    DATA: enabled("fileWrite") ? 2 : enabled("fileRead") ? 1 : 0,
    MEMORY: 0,
    EXEC: enabled("shell") ? 3 : 0
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
  const resource = String(detail.path || detail.target || event.object || event.resource || "");
  const destination = String(detail.destination || detail.url || detail.host || "");
  const externalTarget = Boolean(detail.external || /https?:\/\//i.test(destination) || /external|unknown-model|attacker/i.test(destination));
  const deniedByAtom = org.deniedAtoms.some(item => canonicalAtomId(item) === atom.id);
  const deniedPath = org.deniedPaths.some(pattern => String(resource).toLowerCase().includes(String(pattern).replace(/\*/g, "").toLowerCase()));
  const threatAdjustment = String(event.mappingRule || "").startsWith("threat.") ? 2 : 0;
  const requiredLevel = Math.min(5, Number(atom.baseLevel || 0) + (externalTarget ? 1 : 0) + threatAdjustment + (atom.highRisk ? 0 : 0));
  const taskDeniedPath = (task.deniedPaths || []).some(pattern => String(resource).toLowerCase().includes(String(pattern).replace(/\*/g, "").toLowerCase()));
  const taskDomainDenied = externalTarget && task.allowedDomains?.length > 0 && !task.allowedDomains.some(domain => destination.includes(domain));
  const orgAllowedLevel = org.levels?.[atom.domain] ?? org.maxLevel;
  const taskAllowedLevel = task.levels?.[atom.domain] ?? task.maxLevel;
  const orgLevelExceeded = requiredLevel > orgAllowedLevel;
  const taskLevelExceeded = requiredLevel > taskAllowedLevel;
  const orgExceeded = deniedByAtom || deniedPath || orgLevelExceeded || (externalTarget && !org.allowedDomains.some(domain => destination.includes(domain)));
  const taskExceeded = !orgExceeded && (taskLevelExceeded || taskDeniedPath || taskDomainDenied);
  const scope = orgExceeded ? "organization" : taskExceeded ? "task" : "within";
  return {
    scope,
    requiredLevel,
    allowedLevel: Math.min(orgAllowedLevel, taskAllowedLevel),
    organizationBoundaryVersion: org.version,
    taskBoundarySource: task.source,
    color: orgExceeded ? "red" : taskExceeded ? "amber" : "teal",
    externalTarget,
    layers: {
      organization: { maxLevel: orgAllowedLevel, denied: orgExceeded, version: org.version },
      task: { maxLevel: taskAllowedLevel, denied: taskExceeded, source: task.source },
      runtime: { externalTarget, resource }
    }
  };
}

function enrichEvent(event, policy = {}, session = {}) {
  const mapping = event.atomId ? {
    atomId: canonicalAtomId(event.atomId),
    originalAtomId: String(event.atomId).toUpperCase(),
    confidence: Number(event.atomConfidence ?? 1),
    mappingRule: event.mappingRule || "upstream_mapping",
    mappingVersion: event.mappingVersion || "upstream",
    candidates: event.mappingCandidates || []
  } : mapEventToAtom(event);
  const catalog = buildCatalog(policy);
  const atom = catalog.find(item => item.id === mapping.atomId) || normalizeAtomDefinition({ id: mapping.atomId || "UNMAPPED.UNKNOWN", domain: String(mapping.atomId || "UNMAPPED.UNKNOWN").split(".")[0], baseLevel: 2, highRisk: true, description: "未归属行为原子", system: false });
  const boundary = classifyBoundary(atom, { ...event, mappingRule: mapping.mappingRule }, policy, session);
  const mappingCandidates = [
    ...(mapping.originalAtomId && mapping.originalAtomId !== mapping.atomId ? [{ atomId: mapping.originalAtomId, canonicalAtomId: mapping.atomId, score: mapping.confidence, rule: "compatibility.alias" }] : []),
    ...(mapping.candidates || [])
  ];
  const occurrence = normalizeOccurrence({ ...event, atomId: mapping.atomId, atomConfidence: mapping.confidence, mappingRule: mapping.mappingRule }, atom, { ...mapping, candidates: mappingCandidates }, boundary);
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
    boundary,
    occurrenceId: occurrence.occurrenceId,
    taskId: occurrence.taskId,
    mappingVersion: mapping.mappingVersion,
    mappingCandidates,
    occurrence
  };
}

function aggregateEvents(events = [], policy = {}, sessionResolver = null) {
  const atomStats = new Map();
  const agents = new Map();
  const occurrences = [];
  for (const [sequence, raw] of events.slice().sort((a, b) => String(a.timestamp || a.time || "").localeCompare(String(b.timestamp || b.time || ""))).entries()) {
    const event = raw && raw.occurrence && raw.behaviorAtom && raw.boundary
      ? raw
      : enrichEvent(raw, policy, sessionResolver ? (sessionResolver(raw) || {}) : (raw.session || {}));
    const atom = event.atomId || "UNCLASSIFIED.UNKNOWN";
    const agent = String(event.agentId || event.agent || "unknown");
    const stat = atomStats.get(atom) || { atomId: atom, domain: event.atomDomain || atom.split(".")[0], hits: 0, allow: 0, alert: 0, block: 0, agents: new Set(), sessions: new Set(), outOfOrganization: 0, outOfTask: 0, firstSeen: null, lastSeen: null };
    stat.hits++; stat[event.verdict] = (stat[event.verdict] || 0) + 1; stat.agents.add(agent); if (event.sessionId) stat.sessions.add(String(event.sessionId));
    if (event.boundaryScope === "organization") stat.outOfOrganization++; if (event.boundaryScope === "task") stat.outOfTask++;
    stat.firstSeen = !stat.firstSeen || stat.firstSeen > event.timestamp ? event.timestamp : stat.firstSeen;
    stat.lastSeen = stat.lastSeen && stat.lastSeen > event.timestamp ? stat.lastSeen : event.timestamp;
    atomStats.set(atom, stat);
    const occurrence = { ...event.occurrence, sequence: sequence + 1 };
    occurrences.push(occurrence);
    const agentStat = agents.get(agent) || { agentId: agent, atoms: new Map(), total: 0, outOfOrganization: 0, outOfTask: 0, block: 0, alert: 0, allow: 0, path: [], sessions: new Set() };
    agentStat.total++; agentStat[event.verdict] = (agentStat[event.verdict] || 0) + 1;
    if (event.boundaryScope === "organization") agentStat.outOfOrganization++; if (event.boundaryScope === "task") agentStat.outOfTask++;
    if (event.sessionId) agentStat.sessions.add(String(event.sessionId));
    agentStat.path.push({ occurrenceId: occurrence.occurrenceId, eventId: occurrence.eventId, atomId: atom, timestamp: event.timestamp, sequence: sequence + 1, boundaryScope: event.boundaryScope, verdict: event.verdict, source: event.source, parentEventId: event.parentEventId, confidence: event.atomConfidence, evidenceHash: occurrence.evidenceHash, effect: occurrence.effect, boundary: occurrence.boundary });
    agentStat.atoms.set(atom, (agentStat.atoms.get(atom) || 0) + 1); agents.set(agent, agentStat);
  }
  return {
    occurrences,
    atoms: Array.from(atomStats.values()).map(item => ({ ...item, agents: Array.from(item.agents), sessions: Array.from(item.sessions) })).sort((a, b) => b.hits - a.hits),
    agents: Array.from(agents.values()).map(item => ({ ...item, atoms: Object.fromEntries(item.atoms), sessions: Array.from(item.sessions), path: item.path.sort((a, b) => Number(a.sequence) - Number(b.sequence)) })).sort((a, b) => b.total - a.total)
  };
}

module.exports = { DOMAINS, buildCatalog, mapEventToAtom, enrichEvent, aggregateEvents, getOrganizationBoundary, deriveTaskLevels, sessionBoundary, constrainTaskBoundary, classifyBoundary };

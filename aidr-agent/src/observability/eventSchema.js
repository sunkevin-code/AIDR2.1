const crypto = require("crypto");

const EVENT_SCHEMA_VERSION = 2;
const IDENTITY_CONTRACT_VERSION = "aidr-event-identity-v1";
const EVENT_TYPES = new Set([
  "session", "prompt", "intent", "tool", "tool_response", "file", "process",
  "network", "mcp", "policy_decision", "behavior_drift", "approval", "enforcement",
  "system", "agent_identity"
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value == null || value === "" ? [] : [value];
}

function normalizeEvent(input = {}, context = {}) {
  const source = asObject(input);
  const detail = asObject(source.detail);
  const timestamp = source.timestamp || source.time || source.receivedAt || new Date().toISOString();
  const category = String(source.category || source.eventType || source.event_type || "system");
  const eventType = String(source.eventType || source.event_type || inferEventType(category));
  const sessionId = source.sessionId || source.session_id || detail.sessionId || detail.session_id || context.sessionId || null;
  const agentId = source.agentId || source.agent_id || detail.agentId || detail.agent_id || detail.agent || context.agentId || null;
  const traceId = source.traceId || source.trace_id || detail.traceId || detail.trace_id || context.traceId || null;
  const decisionId = source.decisionId || source.decision_id || detail.decisionId || detail.decision_id || context.decisionId || null;
  const parentEventId = source.parentEventId || source.parent_event_id || detail.parentEventId || detail.parent_event_id || context.parentEventId || null;
  const endpointId = source.endpointId || source.endpoint_id || detail.endpointId || detail.endpoint_id || context.endpointId || null;
  const taskId = source.taskId || source.task_id || detail.taskId || detail.task_id || context.taskId || null;
  const processId = source.processId || source.process_id || source.pid || detail.processId || detail.process_id || detail.pid || context.processId || null;
  const parentProcessId = source.parentProcessId || source.parent_process_id || source.ppid || detail.parentProcessId || detail.parent_process_id || detail.ppid || context.parentProcessId || null;
  const toolCallId = source.toolCallId || source.tool_call_id || detail.toolCallId || detail.tool_call_id || detail.callId || context.toolCallId || null;
  const resourceId = source.resourceId || source.resource_id || detail.resourceId || detail.resource_id || detail.path || detail.url || detail.target || context.resourceId || null;
  const subject = source.subject || detail.subject || detail.resource || source.summary || category;
  const object = source.object || detail.object || detail.target || detail.toolName || detail.tool || null;
  const evidence = asArray(source.evidence || detail.evidence).map(value => typeof value === "string" ? { type: "text", value } : value);
  const policyVersion = source.policyVersion || source.policy_version || detail.policyVersion || detail.policy_version || null;
  const atomId = source.atomId || source.atom_id || detail.atomId || detail.atom_id || null;
  const atomDomain = source.atomDomain || source.atom_domain || detail.atomDomain || detail.atom_domain || null;
  const atomConfidence = source.atomConfidence ?? source.atom_confidence ?? detail.atomConfidence ?? detail.atom_confidence ?? null;
  const boundaryScope = source.boundaryScope || source.boundary_scope || detail.boundaryScope || detail.boundary_scope || null;
  const requiredLevel = source.requiredLevel ?? source.required_level ?? detail.requiredLevel ?? detail.required_level ?? null;
  const allowedLevel = source.allowedLevel ?? source.allowed_level ?? detail.allowedLevel ?? detail.allowed_level ?? null;
  const normalizedDetail = {
    ...detail,
    eventType,
    source: source.source || detail.source || context.source || "agent",
    traceId,
    decisionId,
    parentEventId,
    endpointId,
    taskId,
    processId,
    parentProcessId,
    toolCallId,
    resourceId,
    subject,
    object,
    evidence,
    policyVersion,
    atomId,
    atomDomain,
    atomConfidence,
    boundaryScope,
    requiredLevel,
    allowedLevel
  };

  return {
    ...source,
    eventId: source.eventId || source.event_id || crypto.randomUUID(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    time: timestamp,
    timestamp,
    eventType,
    category,
    source: normalizedDetail.source,
    severity: String(source.severity || "info"),
    verdict: String(source.verdict || source.decision || "allow"),
    summary: String(source.summary || `${eventType} event`),
    detail: normalizedDetail,
    traceId,
    decisionId,
    parentEventId,
    endpointId,
    taskId,
    processId,
    parentProcessId,
    toolCallId,
    resourceId,
    identityContract: {
      version: IDENTITY_CONTRACT_VERSION,
      endpointId,
      agentId,
      sessionId,
      taskId,
      processId,
      parentProcessId,
      toolCallId,
      resourceId,
      completeness: Number(([
        endpointId, agentId, sessionId, taskId, processId
      ].filter(Boolean).length / 5).toFixed(2))
    },
    subject: String(subject),
    object: object == null ? null : String(object),
    evidence,
    policyVersion,
    atomId,
    atomDomain,
    atomConfidence,
    atomBaseLevel: source.atomBaseLevel ?? source.atom_base_level ?? detail.atomBaseLevel ?? detail.atom_base_level ?? null,
    mappingRule: source.mappingRule || source.mapping_rule || detail.mappingRule || detail.mapping_rule || null,
    boundaryScope,
    requiredLevel,
    allowedLevel,
    organizationBoundaryVersion: source.organizationBoundaryVersion || source.organization_boundary_version || detail.organizationBoundaryVersion || detail.organization_boundary_version || null,
    enforcementColor: source.enforcementColor || source.enforcement_color || detail.enforcementColor || detail.enforcement_color || null,
    sessionId,
    agentId,
    matchedRule: source.matchedRule || source.matched_rule || detail.matchedRule || detail.matched_rule || null,
    mitreTactic: source.mitreTactic || source.mitre_tactic || null,
    mitreTechnique: source.mitreTechnique || source.mitre_technique || null
  };
}

function inferEventType(category) {
  if (EVENT_TYPES.has(category)) return category;
  if (category.includes("tool")) return "tool";
  if (category.includes("file")) return "file";
  if (category.includes("network")) return "network";
  if (category.includes("process")) return "process";
  if (category.includes("policy")) return "policy_decision";
  return "system";
}

function validateEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object") return { valid: false, errors: ["event_object_required"] };
  for (const field of ["eventId", "timestamp", "eventType", "category", "summary", "verdict"]) {
    if (!event[field]) errors.push(`${field}_required`);
  }
  if (Number(event.schemaVersion) < 1) errors.push("schema_version_invalid");
  if (event.eventType && !/^[a-z][a-z0-9_.-]{1,63}$/i.test(String(event.eventType))) errors.push("event_type_invalid");
  if (event.evidence && !Array.isArray(event.evidence)) errors.push("evidence_array_required");
  return { valid: errors.length === 0, errors };
}

module.exports = { EVENT_SCHEMA_VERSION, IDENTITY_CONTRACT_VERSION, EVENT_TYPES, normalizeEvent, validateEvent };

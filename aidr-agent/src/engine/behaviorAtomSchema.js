"use strict";

const crypto = require("crypto");

const BEHAVIOR_ATOM_SCHEMA_VERSION = "aidr-behavior-atom-v1";
const ORBIT_SCHEMA_VERSION = "aidr-orbit-v1";

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value == null || value === "" ? [] : [value];
}

function text(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function evidenceHash(event = {}) {
  if (event.evidenceHash || event.detail?.evidenceHash) return String(event.evidenceHash || event.detail.evidenceHash);
  const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const canonical = {
    eventId: event.eventId || null,
    timestamp: event.timestamp || event.time || null,
    category: event.category || event.eventType || null,
    source: event.source || detail.source || null,
    summary: event.summary || null,
    subject: event.subject || detail.subject || null,
    object: event.object || detail.object || null,
    resource: event.resource || detail.resource || detail.target || null,
    verdict: event.verdict || event.decision || null,
    rule: event.matchedRule || detail.matchedRule || detail.rule || null,
    evidence: event.evidence || detail.evidence || []
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function normalizeAtomDefinition(atom = {}) {
  const id = text(atom.id).trim().toUpperCase();
  const parts = id.split(".");
  return {
    schemaVersion: atom.schemaVersion || BEHAVIOR_ATOM_SCHEMA_VERSION,
    id,
    version: text(atom.version, "1.0"),
    domain: text(atom.domain, parts[0] || "UNKNOWN").toUpperCase(),
    action: text(atom.action, parts[1] || "UNKNOWN").toUpperCase(),
    name: text(atom.name, parts[1] || "UNKNOWN").toUpperCase(),
    domainLabel: text(atom.domainLabel, parts[0] || "UNKNOWN"),
    description: text(atom.description, "未提供行为原子说明"),
    baseLevel: Math.max(0, Math.min(5, Number(atom.baseLevel ?? 2))),
    sideEffect: text(atom.sideEffect || atom.side_effect, "none"),
    resourceTypes: asArray(atom.resourceTypes || atom.resource_types),
    preconditions: asArray(atom.preconditions),
    defaultControl: text(atom.defaultControl || atom.default_control, "require_policy_gate"),
    system: atom.system !== false,
    enabled: atom.enabled !== false,
    highRisk: Boolean(atom.highRisk)
  };
}

function normalizeBoundary(boundary = {}) {
  return {
    scope: text(boundary.scope, "within"),
    requiredLevel: Math.max(0, Math.min(5, Number(boundary.requiredLevel ?? 0))),
    allowedLevel: Math.max(0, Math.min(5, Number(boundary.allowedLevel ?? 0))),
    color: text(boundary.color, "teal"),
    organizationBoundaryVersion: text(boundary.organizationBoundaryVersion, "org-boundary-v1"),
    taskBoundarySource: text(boundary.taskBoundarySource, "session.taskBoundary"),
    externalTarget: Boolean(boundary.externalTarget),
    layers: boundary.layers || {}
  };
}

function normalizeOccurrence(event = {}, atom = {}, mapping = {}, boundary = {}) {
  const definition = normalizeAtomDefinition(atom);
  const normalizedBoundary = normalizeBoundary(boundary);
  const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const occurrenceId = text(event.occurrenceId || event.eventId, `occurrence-${Date.now()}`);
  const verdict = text(event.verdict || event.decision, "allow");
  const suppliedEffect = event.effect && typeof event.effect === "object" ? event.effect : (detail.effect && typeof detail.effect === "object" ? detail.effect : {});
  const effectProof = event.effectProof || detail.effectProof || detail.enforcementResult || detail.enforcement_result || null;
  return {
    schemaVersion: BEHAVIOR_ATOM_SCHEMA_VERSION,
    occurrenceId,
    eventId: text(event.eventId, occurrenceId),
    sessionId: event.sessionId || null,
    taskId: event.taskId || detail.taskId || detail.task_id || null,
    agentId: event.agentId || event.agent || detail.agentId || detail.agent || "unknown",
    traceId: event.traceId || detail.traceId || detail.trace_id || null,
    parentEventId: event.parentEventId || detail.parentEventId || detail.parent_event_id || null,
    sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : null,
    timestamp: event.timestamp || event.time || new Date().toISOString(),
    source: event.source || detail.source || "unknown",
    eventType: event.eventType || event.category || "system",
    subject: event.subject || detail.subject || null,
    resource: event.resource || detail.resource || detail.target || event.object || null,
    context: event.context || detail.context || {},
    atom: {
      id: definition.id,
      domain: definition.domain,
      action: definition.action,
      confidence: Number(mapping.confidence ?? event.atomConfidence ?? 0),
      mappingRule: mapping.mappingRule || event.mappingRule || null,
      mappingVersion: mapping.mappingVersion || "rules-v1",
      candidates: mapping.candidates || []
    },
    boundary: normalizedBoundary,
    decision: {
      verdict,
      rule: event.matchedRule || detail.matchedRule || detail.rule || null,
      reason: event.reason || detail.reason || event.summary || null
    },
    effect: {
      attempted: suppliedEffect.attempted ?? true,
      executed: suppliedEffect.executed ?? null,
      prevented: suppliedEffect.prevented ?? (verdict === "block" ? true : null),
      proof: effectProof,
      source: suppliedEffect.source || (effectProof ? "runtime" : "inferred")
    },
    evidenceHash: evidenceHash(event),
    evidenceIntegrity: { algorithm: "sha256", status: "derived", version: "aidr-evidence-v1" },
    evidence: asArray(event.evidence || detail.evidence),
    rawEvent: {
      category: event.category || null,
      summary: event.summary || null,
      detail
    }
  };
}

function buildOrbitGraph({
  sessionId = null,
  agentId = null,
  organizationBoundary = {},
  taskBoundary = {},
  predictedPath = [],
  actualPath = [],
  requestPath = [],
  decisionTrace = null,
  events = []
} = {}) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const addNode = (node) => {
    if (!node || !node.id || nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push({
      id: node.id,
      type: node.type || "behavior_atom",
      label: text(node.label, node.id),
      status: node.status || node.verdict || "unknown",
      verdict: node.verdict || node.status || "unknown",
      timestamp: node.timestamp || null,
      atomId: node.atomId || null,
      boundaryScope: node.boundaryScope || "within",
      source: node.source || null,
      data: node.data || {}
    });
  };
  const addEdge = (source, target, type, label) => {
    if (!source || !target || source === target) return;
    const id = [source, target, type || "sequence", label || ""].join("|");
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id: `edge:${edges.length + 1}`, source, target, type: type || "sequence", label: label || "" });
  };
  const addPath = (path, pathType) => {
    let previous = null;
    path.forEach((item, index) => {
      const atomId = item.atomId || "UNMAPPED.UNKNOWN";
      const id = `${pathType}:${item.occurrenceId || item.eventId || index}:${atomId}`;
      addNode({
        id,
        type: pathType === "predicted" ? "predicted_atom" : "behavior_atom",
        label: atomId,
        atomId,
        status: item.verdict || item.state || pathType,
        verdict: item.verdict || item.state || pathType,
        timestamp: item.timestamp,
        boundaryScope: item.boundaryScope,
        source: item.source,
        data: {
          pathType,
          sequence: index + 1,
          confidence: item.confidence ?? null,
          eventId: item.eventId || null,
          occurrenceId: item.occurrenceId || null,
          parentEventId: item.parentEventId || null,
          resource: item.resource || item.object || null,
          mappingRule: item.mappingRule || null
          ,evidenceHash: item.evidenceHash || null
          ,effect: item.effect || null
          ,boundary: item.boundary || null
        }
      });
      if (previous) addEdge(previous, id, pathType === "predicted" ? "predicted_sequence" : "sequence", pathType);
      if (item.parentEventId) {
        const parent = nodes.find(node => node.data?.eventId === item.parentEventId || node.data?.occurrenceId === item.parentEventId);
        if (parent) addEdge(parent.id, id, "causes", "parent");
      }
      previous = id;
    });
  };

  addNode({ id: `session:${sessionId || agentId || "unknown"}`, type: sessionId ? "session" : "agent", label: sessionId ? `Session · ${agentId || "unknown"}` : `Agent · ${agentId || "unknown"}`, data: { sessionId, agentId } });
  addPath(predictedPath, "predicted");
  addPath(actualPath, "actual");
  addPath(requestPath, "request");
  events.forEach((event) => {
    const occurrenceId = event.occurrenceId || event.eventId;
    const eventNodeId = `event:${occurrenceId}`;
    addNode({
      id: eventNodeId,
      type: "runtime_event",
      label: event.summary || event.atomId || event.eventType || "Runtime event",
      atomId: event.atomId,
      status: event.verdict,
      verdict: event.verdict,
      timestamp: event.timestamp,
      boundaryScope: event.boundaryScope,
      source: event.source,
      data: {
        eventId: event.eventId,
        occurrenceId: event.occurrenceId || null,
        sessionId: event.sessionId,
        agentId: event.agentId,
        evidenceHash: event.evidenceHash || evidenceHash(event),
        mappingConfidence: event.atomConfidence ?? event.atom?.confidence ?? null,
        mappingRule: event.mappingRule || event.atom?.mappingRule || null,
        boundary: event.boundary || null,
        effect: event.effect || null
      }
    });
    const atomNode = nodes.find(item => item.data?.eventId === event.eventId || item.data?.occurrenceId === occurrenceId);
    if (atomNode) {
      addEdge(eventNodeId, atomNode.id, "maps_to", "maps to");
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      const resource = event.resource || event.object || detail.resource || detail.target || detail.path || detail.url || detail.host;
      if (resource) {
        const resourceNodeId = `resource:${occurrenceId}`;
        addNode({ id: resourceNodeId, type: "resource", label: String(resource), status: "observed", source: event.source, data: { eventId: event.eventId, resource: String(resource) } });
        addEdge(atomNode.id, resourceNodeId, "uses", "uses");
      }
    }
  });

  const traceSteps = Array.isArray(decisionTrace)
    ? decisionTrace
    : (decisionTrace?.steps || decisionTrace?.decisionPath || decisionTrace?.trace || decisionTrace?.decisionContract?.trace || []);
  let previousTraceNode = sessionId || agentId ? `session:${sessionId || agentId}` : null;
  traceSteps.forEach((step, index) => {
    const traceId = `decision:${step.id || step.stepId || index + 1}`;
    addNode({
      id: traceId,
      type: "decision_trace",
      label: step.name || step.stage || step.rule || `Decision ${index + 1}`,
      status: step.verdict || step.action || "observed",
      verdict: step.verdict || step.action || "observed",
      source: step.source || step.provider || "decision_trace",
      data: {
        traceStep: index + 1,
        reason: step.reason || step.detail || step.rule || null,
        eventId: step.eventId || step.evidenceEventId || null,
        contract: step.contract || null
      }
    });
    if (previousTraceNode) addEdge(previousTraceNode, traceId, "decision_trace", "evaluates");
    const evidenceEventId = step.eventId || step.evidenceEventId;
    if (evidenceEventId) {
      const target = nodes.find(node => node.data?.eventId === evidenceEventId || node.data?.occurrenceId === evidenceEventId);
      if (target) addEdge(traceId, target.id, "evidence", "supports");
    }
    previousTraceNode = traceId;
  });

  return {
    schemaVersion: ORBIT_SCHEMA_VERSION,
    sessionId,
    agentId,
    boundaries: { organization: organizationBoundary, task: taskBoundary },
    layers: { permission: true, predicted: predictedPath.length > 0, actual: actualPath.length > 0, request: requestPath.length > 0 },
    nodes,
    edges,
    predictedPath,
    actualPath,
    requestPath,
    decisionTrace,
    events,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      predictedCount: predictedPath.length,
      actualCount: actualPath.length,
      requestCount: requestPath.length,
      decisionCount: traceSteps.length,
      blockedCount: actualPath.filter(item => item.verdict === "block").length,
      outOfOrganization: actualPath.filter(item => item.boundaryScope === "organization").length
    },
    provenance: {
      schemaVersion: "aidr-provenance-v1",
      model: "entity-activity-agent",
      hashAlgorithm: "sha256",
      evidenceHashes: Array.from(new Set(nodes.map(node => node.data?.evidenceHash).filter(Boolean))),
      verifiedEvidenceCount: nodes.filter(node => Boolean(node.data?.evidenceHash)).length,
      traceEdgeCount: edges.filter(edge => ["causes", "maps_to", "uses", "evidence", "decision_trace"].includes(edge.type)).length
    }
  };
}

module.exports = { BEHAVIOR_ATOM_SCHEMA_VERSION, ORBIT_SCHEMA_VERSION, normalizeAtomDefinition, normalizeBoundary, normalizeOccurrence, buildOrbitGraph, evidenceHash };

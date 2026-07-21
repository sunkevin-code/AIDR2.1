const crypto = require("crypto");

const MAX_GRAPH_NODES = 800;

function stableId(prefix, value) {
  const digest = crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
  return prefix + ":" + digest;
}

function text(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value);
}

function addNode(graph, node) {
  if (!node?.id || graph.nodeMap.has(node.id)) return graph.nodeMap.get(node.id);
  if (graph.nodes.length >= MAX_GRAPH_NODES) return null;
  const normalized = {
    id: node.id,
    type: node.type || "event",
    label: text(node.label, node.id),
    status: node.status || node.verdict || "unknown",
    verdict: node.verdict || node.status || "unknown",
    timestamp: node.timestamp || null,
    source: node.source || null,
    data: node.data || {}
  };
  graph.nodes.push(normalized);
  graph.nodeMap.set(normalized.id, normalized);
  return normalized;
}

function addEdge(graph, source, target, type, label) {
  if (!source || !target || source === target) return;
  const key = [source, target, type || "causal", label || ""].join("|");
  if (graph.edgeMap.has(key)) return;
  graph.edgeMap.add(key);
  graph.edges.push({ id: "edge:" + graph.edges.length, source, target, type: type || "causal", label: label || "" });
}

function resourceCandidates(action) {
  const detail = action.detail || {};
  const input = detail.toolInput || detail.tool_input || {};
  const candidates = [];
  const add = (kind, value, label) => {
    if (value === undefined || value === null || value === "") return;
    candidates.push({ kind, value: text(value).slice(0, 500), label: label || text(value).slice(0, 140) });
  };
  add("file", input.file_path || input.path || input.file, "File");
  add("url", input.url || input.uri || input.href, "URL");
  add("command", input.command || input.cmd, "Command");
  add("domain", input.domain, "Domain");
  add("mcp", input.tool || (detail.toolName && detail.toolName.startsWith("mcp__") ? detail.toolName : null), "MCP");
  if (detail.path) add("file", detail.path, "File");
  if (detail.remoteAddress) add("network", detail.remoteAddress + ":" + text(detail.remotePort, ""), "Network");
  return candidates.slice(0, 12);
}

function buildBehaviorTraceGraph(session) {
  if (!session) return null;
  const graph = { sessionId: session.id, nodes: [], edges: [], nodeMap: new Map(), edgeMap: new Set() };
  const rootId = "session:" + session.id;
  addNode(graph, {
    id: rootId,
    type: "session",
    label: "Session · " + text(session.agent, "unknown"),
    status: session.status,
    timestamp: session.createdAt,
    data: { agent: session.agent, model: session.model, cwd: session.cwd, status: session.status },
    source: { sessionId: session.id, agent: session.agent }
  });

  let previous = rootId;
  const promptByTurn = new Map((session.promptHistory || []).map(item => [text(item.turnId), item]));
  const actions = Array.isArray(session.actions) ? session.actions : [];

  for (const [index, action] of actions.entries()) {
    const detail = action.detail || {};
    const trace = detail.decisionTrace || session.decisionTrace || {};
    const actionSource = { sessionId: session.id, actionId: action.id, event: action.event, index };
    let parent = previous;

    if (action.event === "UserPromptSubmit" || action.subject === "intent" || detail.prompt) {
      const prompt = promptByTurn.get(text(detail.turnId)) || session.promptHistory?.[Math.min(index, (session.promptHistory || []).length - 1)] || {};
      const promptId = stableId("prompt", session.id + ":" + text(prompt.id || prompt.turnId || index) + ":" + text(prompt.prompt || session.prompt));
      addNode(graph, {
        id: promptId,
        type: "prompt",
        label: "Prompt · " + text(prompt.prompt || session.promptPreview || session.prompt, "unavailable").slice(0, 120),
        verdict: action.verdict,
        timestamp: prompt.timestamp || action.timestamp,
        source: { ...actionSource, promptId: prompt.id || null },
        data: { turnId: prompt.turnId || null, prompt: text(prompt.prompt || session.prompt, "unavailable").slice(0, 400) }
      });
      addEdge(graph, parent, promptId, "causal", "submitted");
      parent = promptId;

      const intentId = stableId("intent", action.id || index);
      addNode(graph, {
        id: intentId,
        type: "intent",
        label: "Intent · " + text(detail.riskLevel || session.intent?.riskLevel, "unknown"),
        verdict: action.verdict,
        timestamp: action.timestamp,
        source: actionSource,
        data: { summary: action.summary, riskLevel: detail.riskLevel || session.intent?.riskLevel, riskScore: detail.riskScore || session.intent?.riskScore, capabilities: detail.capabilities || session.intent?.capabilities || {}, semanticAnalysis: detail.semanticAnalysis || null, behaviorDrift: detail.behaviorDrift || null }
      });
      addEdge(graph, parent, intentId, "analysis", "analyzed");
      parent = intentId;
    }

    const resolution = trace.sessionPolicy?.resolution || session.effectivePolicy?.resolution || null;
    if (resolution || trace.sessionPolicy) {
      const resolutionKey = JSON.stringify(resolution || trace.sessionPolicy);
      const policyId = stableId("policy", session.id + ":" + resolutionKey);
      addNode(graph, {
        id: policyId,
        type: "policy",
        label: "Policy · " + text(resolution?.precedence?.[0] || trace.sessionPolicy?.source, "least privilege"),
        verdict: action.verdict,
        timestamp: action.timestamp,
        source: actionSource,
        data: { resolution, capabilities: trace.sessionPolicy?.capabilities || {}, requireApproval: trace.sessionPolicy?.requireApproval || {} }
      });
      addEdge(graph, parent, policyId, "policy", "resolved");
      parent = policyId;
    }

    const actionId = "action:" + text(action.id || index);
    addNode(graph, {
      id: actionId,
      type: action.event === "PostToolUse" ? "tool_response" : action.event === "PreToolUse" || action.event === "PermissionRequest" ? "tool" : "action",
      label: text(action.subject || action.summary, "Agent action").slice(0, 140),
      verdict: action.verdict,
      timestamp: action.timestamp,
      source: actionSource,
      data: { event: action.event, subject: action.subject, summary: action.summary, detail }
    });
    addEdge(graph, parent, actionId, "causal", action.event || "action");

    let resourceParent = actionId;
    for (const resource of resourceCandidates(action)) {
      const resourceId = stableId("resource", session.id + ":" + resource.kind + ":" + resource.value);
      addNode(graph, {
        id: resourceId,
        type: resource.kind,
        label: resource.label + " · " + resource.value.slice(0, 110),
        verdict: action.verdict,
        timestamp: action.timestamp,
        source: actionSource,
        data: { kind: resource.kind, value: resource.value, tool: action.subject }
      });
      addEdge(graph, resourceParent, resourceId, "uses", resource.kind);
      resourceParent = resourceId;
    }

    const decisionId = stableId("decision", session.id + ":" + text(action.id || index) + ":" + action.verdict + ":" + text(detail.rule || trace.final?.rule));
    addNode(graph, {
      id: decisionId,
      type: "decision",
      label: "Decision · " + text(action.verdict, "allow"),
      status: action.verdict,
      verdict: action.verdict,
      timestamp: action.timestamp,
      source: actionSource,
      data: { rule: detail.rule || trace.final?.rule || null, reason: trace.final?.reason || action.summary, trace: trace, approvalId: detail.approvalId || null }
    });
    addEdge(graph, resourceParent, decisionId, "decision", text(detail.rule || trace.final?.rule, "final"));
    previous = decisionId;
  }

  const nodes = graph.nodes.map(node => node);
  const edges = graph.edges.map(edge => edge);
  return {
    sessionId: session.id,
    agent: session.agent,
    generatedAt: new Date().toISOString(),
    roots: [rootId],
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      resourceCount: nodes.filter(node => ["file", "url", "domain", "command", "network", "mcp"].includes(node.type)).length,
      blockedCount: nodes.filter(node => node.verdict === "block").length,
      approvalCount: nodes.filter(node => node.data?.approvalId).length
    },
    legend: [
      { type: "session", label: "Session" },
      { type: "prompt", label: "Prompt" },
      { type: "intent", label: "Intent" },
      { type: "policy", label: "Policy" },
      { type: "tool", label: "Tool" },
      { type: "file", label: "File" },
      { type: "url", label: "URL" },
      { type: "decision", label: "Decision" }
    ]
  };
}

module.exports = { buildBehaviorTraceGraph };

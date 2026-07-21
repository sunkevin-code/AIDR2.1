const crypto = require("crypto");

const MAX_ITEMS = 80;

function id(prefix, value) {
  return prefix + ":" + crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function text(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value);
}

function verdict(actions, fallback = "allow") {
  const values = actions.map(action => text(action.verdict).toLowerCase());
  if (values.includes("block")) return "block";
  if (values.includes("alert")) return "alert";
  return values.find(Boolean) || fallback;
}

function counts(actions) {
  return actions.reduce((result, action) => {
    const key = text(action.verdict, "allow").toLowerCase();
    if (result[key] === undefined) result[key] = 0;
    result[key]++;
    return result;
  }, { allow: 0, alert: 0, block: 0 });
}

function actionTool(action) {
  const detail = action.detail || {};
  return text(detail.toolName || detail.tool_name || action.subject || "").trim();
}

function actionResources(action) {
  const detail = action.detail || {};
  const input = detail.toolInput || detail.tool_input || {};
  const values = [];
  const add = (kind, value) => {
    if (value === undefined || value === null || value === "") return;
    values.push({ kind, value: text(value).slice(0, 500) });
  };
  add("file", input.file_path || input.path || input.file || detail.path);
  add("url", input.url || input.uri || input.href);
  add("command", input.command || input.cmd);
  add("domain", input.domain);
  if (input.tool || (detail.toolName && detail.toolName.startsWith("mcp__"))) add("mcp", input.tool || detail.toolName);
  if (detail.remoteAddress) add("network", detail.remoteAddress + ":" + text(detail.remotePort, ""));
  return values;
}

function addNode(graph, node) {
  graph.nodes.push({
    id: node.id,
    type: node.type,
    label: text(node.label, node.id),
    status: node.status || node.verdict || "unknown",
    verdict: node.verdict || node.status || "unknown",
    timestamp: node.timestamp || null,
    source: node.source || null,
    data: node.data || {}
  });
  return node.id;
}

function addEdge(graph, source, target, type, label) {
  if (!source || !target || source === target) return;
  graph.edges.push({ id: "edge:" + graph.edges.length, source, target, type: type || "causal", label: label || "" });
}

function buildSessionContextGraph(session) {
  if (!session) return null;
  const actions = Array.isArray(session.actions) ? session.actions : [];
  const actionIds = actions.map(action => action.id).filter(Boolean);
  const graph = { sessionId: session.id, agent: session.agent, view: "session_context", nodes: [], edges: [] };
  const root = addNode(graph, {
    id: id("context-session", session.id),
    type: "session",
    label: "Agent session - " + text(session.agent, "unknown"),
    status: session.status,
    verdict: verdict(actions, session.status === "active" ? "allow" : "unknown"),
    timestamp: session.createdAt,
    source: { sessionId: session.id, agent: session.agent, actionIds },
    data: { agent: session.agent, model: session.model, cwd: session.cwd, status: session.status, actionCount: actions.length }
  });

  let previous = root;
  const prompts = (session.promptHistory || []).map(item => ({
    id: item.id || item.turnId || null,
    prompt: text(item.prompt || "").slice(0, 1200),
    timestamp: item.timestamp || null
  })).filter(item => item.prompt);
  if (!prompts.length && session.prompt) prompts.push({ prompt: text(session.prompt).slice(0, 1200), timestamp: session.createdAt });
  if (prompts.length) {
    const promptId = addNode(graph, {
      id: id("context-prompt", session.id),
      type: "prompt",
      label: "Prompt - " + prompts.length,
      verdict: verdict(actions.filter(action => action.event === "UserPromptSubmit" || action.subject === "intent")),
      timestamp: prompts.at(-1).timestamp,
      source: { sessionId: session.id, actionIds: actions.filter(action => action.event === "UserPromptSubmit" || action.subject === "intent").map(action => action.id).filter(Boolean) },
      data: { count: prompts.length, latest: prompts.at(-1).prompt, prompts }
    });
    addEdge(graph, previous, promptId, "causal", "context");
    previous = promptId;
  }

  const intentActions = actions.filter(action => action.event === "UserPromptSubmit" || action.subject === "intent");
  const intent = session.intent || {};
  const intentId = addNode(graph, {
    id: id("context-intent", session.id),
    type: "intent",
    label: "Intent - " + text(intent.riskLevel, "unknown") + " / " + text(intent.riskScore, 0),
    verdict: verdict(intentActions),
    timestamp: intent.generatedAt || intentActions.at(-1)?.timestamp,
    source: { sessionId: session.id, actionIds: intentActions.map(action => action.id).filter(Boolean) },
    data: {
      summary: intent.summary || "Session intent context",
      riskLevel: intent.riskLevel || null,
      riskScore: intent.riskScore || 0,
      risks: intent.risks || [],
      capabilities: intent.capabilities || {},
      semanticAnalysis: session.semanticAnalysis || intent.semanticAnalysis || null,
      behaviorDrift: session.behaviorDrift || null
    }
  });
  addEdge(graph, previous, intentId, "analysis", "intent");
  previous = intentId;

  const policy = session.effectivePolicy || intent.policy || {};
  const policyId = addNode(graph, {
    id: id("context-policy", session.id),
    type: "policy",
    label: "Policy - " + text(policy.mode, "monitor"),
    verdict: verdict(actions),
    timestamp: policy.generatedAt || null,
    source: { sessionId: session.id, actionIds },
    data: {
      mode: policy.mode || "monitor",
      allowedReadPaths: policy.allowedReadPaths || [],
      allowedWritePaths: policy.allowedWritePaths || [],
      allowedDomains: policy.allowedDomains || [],
      allowedMcpTools: policy.allowedMcpTools || [],
      deniedPaths: policy.deniedPaths || [],
      requireApproval: policy.requireApproval || {},
      resolution: policy.resolution || null
    }
  });
  addEdge(graph, previous, policyId, "policy", "least privilege");
  previous = policyId;

  const toolActions = actions.filter(action => actionTool(action) || ["PreToolUse", "PostToolUse", "PermissionRequest"].includes(action.event));
  if (toolActions.length) {
    const tools = new Map();
    for (const action of toolActions) {
      const name = actionTool(action) || action.event || "tool";
      const item = tools.get(name) || { name, count: 0, verdicts: counts([]), actionIds: [], samples: [] };
      item.count++;
      item.verdicts[text(action.verdict, "allow").toLowerCase()] = (item.verdicts[text(action.verdict, "allow").toLowerCase()] || 0) + 1;
      if (action.id) item.actionIds.push(action.id);
      if (item.samples.length < 5) item.samples.push({ id: action.id, event: action.event, verdict: action.verdict, summary: action.summary, timestamp: action.timestamp });
      tools.set(name, item);
    }
    const toolId = addNode(graph, {
      id: id("context-tools", session.id),
      type: "tool_group",
      label: "Tools - " + tools.size + " / " + toolActions.length,
      verdict: verdict(toolActions),
      timestamp: toolActions.at(-1)?.timestamp,
      source: { sessionId: session.id, actionIds: toolActions.map(action => action.id).filter(Boolean) },
      data: { count: toolActions.length, tools: [...tools.values()] }
    });
    addEdge(graph, previous, toolId, "uses", "tool calls");
    previous = toolId;
  }

  const resources = new Map();
  for (const action of actions) {
    for (const resource of actionResources(action)) {
      const key = resource.kind + ":" + resource.value;
      const item = resources.get(key) || { kind: resource.kind, value: resource.value, actionIds: [], verdicts: { allow: 0, alert: 0, block: 0 } };
      if (action.id) item.actionIds.push(action.id);
      const actionVerdict = text(action.verdict, "allow").toLowerCase();
      item.verdicts[actionVerdict] = (item.verdicts[actionVerdict] || 0) + 1;
      resources.set(key, item);
    }
  }
  if (resources.size) {
    const resourceItems = [...resources.values()].slice(0, MAX_ITEMS);
    const resourceId = addNode(graph, {
      id: id("context-resources", session.id),
      type: "resource_group",
      label: "Resources - " + resourceItems.length,
      verdict: verdict(resourceItems.flatMap(item => Object.entries(item.verdicts).flatMap(([value, count]) => Array(count).fill({ verdict: value })))),
      timestamp: actions.at(-1)?.timestamp,
      source: { sessionId: session.id, actionIds: [...new Set(resourceItems.flatMap(item => item.actionIds))] },
      data: { count: resourceItems.length, resources: resourceItems }
    });
    addEdge(graph, previous, resourceId, "uses", "resources");
    previous = resourceId;
  }

  const decisionCounts = counts(actions);
  const decisionId = addNode(graph, {
    id: id("context-decision", session.id),
    type: "decision",
    label: "Decision - " + verdict(actions, "allow"),
    verdict: verdict(actions, "allow"),
    timestamp: actions.at(-1)?.timestamp || session.updatedAt,
    source: { sessionId: session.id, actionIds },
    data: { counts: decisionCounts, actionCount: actions.length, lastActions: actions.slice(-8).map(action => ({ id: action.id, event: action.event, subject: action.subject, verdict: action.verdict, summary: action.summary, detail: action.detail })) }
  });
  addEdge(graph, previous, decisionId, "decision", "final");

  const nodes = graph.nodes;
  return {
    ...graph,
    generatedAt: new Date().toISOString(),
    roots: [root],
    summary: {
      nodeCount: nodes.length,
      edgeCount: graph.edges.length,
      resourceCount: resources.size,
      blockedCount: nodes.filter(node => node.verdict === "block").length,
      approvalCount: actions.filter(action => action.detail?.approvalId).length,
      actionCount: actions.length,
      compacted: true
    },
    legend: [
      { type: "session", label: "Session" },
      { type: "prompt", label: "Prompt context" },
      { type: "intent", label: "Intent" },
      { type: "policy", label: "Least privilege policy" },
      { type: "tool_group", label: "Tool group" },
      { type: "resource_group", label: "Resource group" },
      { type: "decision", label: "Final decision" }
    ]
  };
}

module.exports = { buildSessionContextGraph };

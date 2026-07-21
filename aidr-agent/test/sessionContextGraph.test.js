const assert = require("assert");
const { buildSessionContextGraph } = require("../src/engine/sessionContextGraph");

const graph = buildSessionContextGraph({
  id: "context-session",
  agent: "opencode",
  model: "test",
  cwd: "C:\\workspace",
  status: "active",
  createdAt: new Date().toISOString(),
  prompt: "Review the repository and summarize the changes",
  intent: { summary: "Repository review", riskLevel: "low", riskScore: 12, capabilities: { fileRead: true } },
  effectivePolicy: { mode: "enforce", allowedReadPaths: ["C:\\workspace\\**"], allowedWritePaths: [] },
  actions: [
    { id: "prompt", event: "UserPromptSubmit", subject: "intent", verdict: "allow", summary: "intent", detail: { riskLevel: "low" } },
    { id: "tool", event: "PreToolUse", subject: "Bash", verdict: "block", summary: "blocked command", detail: { toolName: "Bash", toolInput: { command: "curl https://example.com" } } }
  ]
});

assert.equal(graph.view, "session_context");
assert.ok(graph.summary.compacted);
assert.ok(graph.nodes.length <= 7);
assert.ok(graph.nodes.some(node => node.type === "tool_group"));
assert.ok(graph.nodes.some(node => node.type === "resource_group"));
assert.ok(graph.nodes.some(node => node.type === "decision" && node.verdict === "block"));
assert.equal(graph.edges.length, graph.nodes.length - 1);
console.log("session context graph tests passed");

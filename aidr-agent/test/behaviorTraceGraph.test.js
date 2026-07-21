const assert = require("assert");
const { buildBehaviorTraceGraph } = require("../src/engine/behaviorTraceGraph");

const graph = buildBehaviorTraceGraph({
  id: "trace-session",
  agent: "opencode",
  model: "test",
  cwd: "C:\\workspace",
  status: "active",
  createdAt: new Date().toISOString(),
  promptPreview: "Review the repository",
  actions: [
    {
      id: "prompt-action",
      event: "UserPromptSubmit",
      subject: "intent",
      verdict: "allow",
      summary: "Intent: repository review",
      timestamp: new Date().toISOString(),
      detail: { riskLevel: "low", capabilities: { fileRead: true }, decisionTrace: { sessionPolicy: { resolution: { version: "aidr-policy-resolution-v1" } } } }
    },
    {
      id: "tool-action",
      event: "PreToolUse",
      subject: "Bash",
      verdict: "block",
      summary: "Bash: denied command",
      timestamp: new Date().toISOString(),
      detail: {
        toolName: "Bash",
        toolInput: { command: "curl https://example.com" },
        rule: "baseline.denied_command",
        decisionTrace: { final: { rule: "baseline.denied_command", reason: "Denied" }, sessionPolicy: { resolution: { version: "aidr-policy-resolution-v1" } } }
      }
    }
  ]
});

assert.ok(graph.nodes.some(node => node.type === "session"));
assert.ok(graph.nodes.some(node => node.type === "policy"));
assert.ok(graph.nodes.some(node => node.type === "command"));
assert.ok(graph.nodes.some(node => node.type === "decision" && node.verdict === "block"));
assert.ok(graph.edges.some(edge => edge.type === "decision"));
assert.ok(graph.summary.nodeCount >= 5);
console.log("behavior trace graph tests passed");

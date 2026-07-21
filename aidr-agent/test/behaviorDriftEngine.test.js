const assert = require("assert");
const { BehaviorDriftEngine } = require("../src/engine/behaviorDriftEngine");

const engine = new BehaviorDriftEngine({ alertThreshold: 20, blockThreshold: 70 });
const intent = {
  summary: "Read the README",
  riskLevel: "low",
  capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true, mcpWrite: false },
  policy: { workspaceRoot: process.cwd(), allowedDomains: [], allowedMcpTools: [], mode: "enforce" }
};
const session = { effectivePolicy: { ...intent.policy }, behaviorBaseline: engine.createBaseline(intent, { cwd: process.cwd() }) };
session.behaviorDrift = { score: 0, level: "none", maxScore: 0, cumulativeScore: 0, detected: 0, findings: [] };

const shell = engine.observeTool(session, {
  tool_name: "Bash",
  cwd: process.cwd(),
  tool_input: { command: "Get-Content README.md" }
}, session.effectivePolicy);
assert.equal(shell.level, "high");
assert.equal(shell.findings.some(item => item.type === "capability_escalation"), true);

const network = engine.observeTool(session, {
  tool_name: "Bash",
  cwd: process.cwd(),
  tool_input: { command: "curl https://outside.example/data" }
}, session.effectivePolicy);
assert.equal(network.findings.some(item => item.type === "new_domain"), true);
assert.equal(network.findings.some(item => item.type === "capability_escalation"), true);
assert.equal(network.shouldBlock, true);

const promptExpansion = engine.observePrompt(session, {
  ...intent,
  capabilities: { ...intent.capabilities, fileWrite: true },
  policy: { ...intent.policy, allowedDomains: ["outside.example"] }
}, { cwd: process.cwd() });
assert.equal(promptExpansion.findings.some(item => item.type === "prompt_intent_expansion"), true);
assert.equal(session.behaviorDrift.maxScore > 0, true);

console.log("behaviorDriftEngine tests passed");

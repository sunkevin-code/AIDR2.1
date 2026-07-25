const assert = require("assert");
const { DECISION_CONTRACT_VERSION, createDecisionContract, validateDecisionContract } = require("../src/engine/decisionContract");

const contract = createDecisionContract({
  session: { id: "session-1", agent: "codex" },
  input: { prompt: "Read README.md", cwd: "C:\\workspace", source: "hook" },
  hookName: "UserPromptSubmit",
  localIntent: { riskLevel: "low", capabilities: { fileRead: true } },
  localDecision: null,
  semantic: { source: "local_model", model: "aidr-local-nb-v1", riskLevel: "low", confidence: 0.91, categories: [] },
  intent: { summary: "workspace read", riskLevel: "low", riskScore: 10, capabilities: { fileRead: true }, policy: { mode: "enforce", allowedReadPaths: ["C:\\workspace\\**"] } },
  decision: { verdict: "allow", rule: "policy.default_allow", reason: "Policy allowed" },
  traceId: "trace-1"
});

assert.equal(contract.schemaVersion, DECISION_CONTRACT_VERSION);
assert.equal(contract.contractVersion, DECISION_CONTRACT_VERSION);
assert.equal(contract.traceId, "trace-1");
assert.equal(contract.request.promptSha256.length, 64);
assert.equal(validateDecisionContract(contract).valid, true);
console.log("decisionContract.test.js passed");

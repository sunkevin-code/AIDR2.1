const assert = require("assert");
const { SessionPolicyEngine } = require("../src/engine/sessionPolicyEngine");

const semantic = {
  isAvailable: () => true,
  analyzePrompt: async () => ({
    source: "local_model",
    provider: "AIDR Local",
    model: "aidr-local-nb-v1",
    riskLevel: "low",
    confidence: 0.91,
    categories: ["workspace_read"],
    capabilities: { fileRead: true },
    requireApproval: {}
  }),
  analyzeIntent: async () => ({ source: "local_model", riskLevel: "low", confidence: 0.91, categories: [] })
};
const engine = new SessionPolicyEngine({ mode: "enforce", workspaceRoot: process.cwd(), sessionPolicy: {} }, () => {}, null, semantic);

(async () => {
  const result = await engine.analyzePromptDecision("Read the README", { agent: "generic", cwd: process.cwd() });
  assert.equal(result.semanticAnalysis.source, "local_model");
  assert.equal(result.decisionTrace.contractVersion, "aidr-decision-contract-v1");
  assert.equal(result.decisionTrace.decisionContract.outcome.verdict, "allow");
  assert.equal(result.intent.intentEvidence.source, "hybrid");
  assert.equal(result.intent.intentEvidence.risk.semanticConfidence, 0.91);
  assert.ok(result.generatedPolicy.capabilities.fileRead);
  console.log("decisionPipeline.test.js passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

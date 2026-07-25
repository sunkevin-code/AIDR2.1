const assert = require("assert");
const { buildIntentEvidence } = require("../src/engine/intentEvidence");

const evidence = buildIntentEvidence({
  prompt: "Read README and do not use the network.",
  input: { cwd: "C:\\workspace" },
  localIntent: {
    summary: "读取工作区文档",
    riskLevel: "low",
    riskScore: 12,
    risks: [],
    capabilities: { fileRead: true, network: false },
    policy: { workspaceRoot: "C:\\workspace", allowedReadPaths: ["C:\\workspace\\**"], mode: "enforce" },
    threatFindings: []
  }
});

assert.equal(evidence.schemaVersion, "aidr-intent-evidence-v1");
assert.equal(evidence.source, "local_rules");
assert.match(evidence.promptSha256, /^[a-f0-9]{64}$/);
assert.match(evidence.intentFingerprint, /^[a-f0-9]{64}$/);
assert.equal(evidence.requestedCapabilities.fileRead, true);
assert.equal(evidence.requestedCapabilities.network, false);
assert(evidence.analysisChain.includes("least_privilege"));

console.log("intentEvidence tests passed");

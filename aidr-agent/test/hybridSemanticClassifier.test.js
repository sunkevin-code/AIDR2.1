const assert = require("assert");
const { HybridSemanticClassifier } = require("../src/engine/hybridSemanticClassifier");

const local = { isAvailable: () => true, analyzePrompt: async () => { throw new Error("local_down"); } };
const remote = { isAvailable: () => true, analyzePrompt: async () => { throw new Error("remote_down"); } };
const classifier = new HybridSemanticClassifier(local, remote, { mode: "local_first" });

(async () => {
  const result = await classifier.analyzePrompt("Read the workspace");
  assert.equal(result.source, "rules_only");
  assert.equal(classifier.getStats().errors, 2);
  console.log("hybridSemanticClassifier.test.js passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

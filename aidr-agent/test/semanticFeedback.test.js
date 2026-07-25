const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SemanticFeedbackStore } = require("../src/observability/semanticFeedback");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-feedback-"));
const store = new SemanticFeedbackStore(dir);
const record = store.record({
  prompt: "Read README.md and summarize it",
  sessionId: "session-1",
  agentId: "openai-codex",
  prediction: { source: "local_model", model: "aidr-local-nb-v1", verdict: "allow", riskLevel: "low", confidence: 0.88, categories: ["workspace_read"] },
  label: { correct: true, verdict: "allow", riskLevel: "low" },
  reviewer: "test",
  note: "read-only task"
});

assert.strictEqual(record.promptHash.length, 64);
assert.strictEqual(Object.prototype.hasOwnProperty.call(record, "prompt"), false);
assert.strictEqual(store.getStats().accuracy, 1);
assert.strictEqual(store.getStats().bySource.local_model, 1);
assert.strictEqual(store.getRecent(1)[0].feedbackId, record.feedbackId);
assert.ok(fs.readFileSync(path.join(dir, "semantic-feedback.jsonl"), "utf8").includes(record.promptHash));

assert.throws(() => store.record({ prediction: { verdict: "allow" } }), /prompt_or_prompt_hash_required/);
console.log("semanticFeedback tests passed");

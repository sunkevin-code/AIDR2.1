const assert = require("assert");
const { buildOrbitGraph, normalizeOccurrence } = require("../src/engine/behaviorAtomSchema");

const occurrence = normalizeOccurrence({
  eventId: "evt-1",
  sessionId: "session-1",
  agentId: "codex",
  timestamp: "2026-07-24T10:00:00Z",
  source: "mcp",
  eventType: "tool",
  summary: "read README",
  verdict: "block",
  detail: { path: "README.md", effectProof: { prevented: true, source: "user-mode-policy" } }
}, {
  id: "DATA.DATA_READ", domain: "DATA", action: "DATA_READ", baseLevel: 1, description: "读取数据"
}, { confidence: 0.93, mappingRule: "runtime.file_operation" }, {
  scope: "within", requiredLevel: 1, allowedLevel: 3, color: "teal"
});

assert.strictEqual(occurrence.schemaVersion, "aidr-behavior-atom-v1");
assert.strictEqual(occurrence.atom.id, "DATA.DATA_READ");
assert.strictEqual(occurrence.eventId, "evt-1");
assert.strictEqual(occurrence.effect.prevented, true);
assert.strictEqual(occurrence.effect.proof.prevented, true);
assert.match(occurrence.evidenceHash, /^[a-f0-9]{64}$/);
assert.strictEqual(occurrence.evidenceIntegrity.algorithm, "sha256");

const graph = buildOrbitGraph({
  sessionId: "session-1",
  agentId: "codex",
  predictedPath: [{ atomId: "DATA.DATA_READ", state: "predicted" }],
  actualPath: [{ occurrenceId: "evt-1", eventId: "evt-1", atomId: "DATA.DATA_READ", verdict: "allow", boundaryScope: "within" }, { occurrenceId: "evt-2", eventId: "evt-2", atomId: "DATA.DATA_TRANSFER", verdict: "block", boundaryScope: "organization" }],
  requestPath: [{ occurrenceId: "evt-2", eventId: "evt-2", atomId: "DATA.DATA_TRANSFER", verdict: "block", boundaryScope: "organization" }],
  events: [{ eventId: "evt-1", occurrenceId: "evt-1", atomId: "DATA.DATA_READ", eventType: "file", summary: "read README", detail: { path: "README.md" } }]
});

assert.strictEqual(graph.schemaVersion, "aidr-orbit-v1");
assert.strictEqual(graph.summary.actualCount, 2);
assert.strictEqual(graph.summary.requestCount, 1);
assert.strictEqual(graph.summary.blockedCount, 1);
assert(graph.edges.length >= 1);
assert(graph.nodes.some(node => node.id.startsWith("request:")));
assert(graph.edges.some(edge => edge.type === "maps_to"));
assert(graph.edges.some(edge => edge.type === "uses"));
assert(graph.provenance.schemaVersion === "aidr-provenance-v1");
assert(graph.provenance.evidenceHashes.length >= 1);

const traced = buildOrbitGraph({
  sessionId: "session-2",
  decisionTrace: { decisionPath: [
    { stage: "local_rules", outcome: "allow", reason: "matched" },
    { stage: "final_enforcement", outcome: "block", reason: "boundary" }
  ] }
});
assert.strictEqual(traced.summary.decisionCount, 2);
assert.strictEqual(traced.nodes.filter(node => node.type === "decision_trace").length, 2);

console.log("behaviorAtomSchema tests passed");

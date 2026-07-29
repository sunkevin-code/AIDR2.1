const assert = require("assert");
const { normalizeEvent, IDENTITY_CONTRACT_VERSION } = require("../src/observability/eventSchema");
const { buildDataQuality, compactBehaviorPath } = require("../src/utils/apiServer");
const { buildCatalog, mapEventToAtoms } = require("../src/engine/behaviorAtoms");
const { compilePolicyRules } = require("../src/engine/policyRules");

const event = normalizeEvent({
  category: "process",
  summary: "Agent process: codex.exe",
  detail: {
    endpointId: "endpoint-1",
    agentId: "openai-codex",
    sessionId: "session-1",
    taskId: "task-1",
    pid: 4242,
    name: "codex.exe",
    eventType: "process"
  }
});

assert.strictEqual(event.identityContract.version, IDENTITY_CONTRACT_VERSION);
assert.strictEqual(event.identityContract.endpointId, "endpoint-1");
assert.strictEqual(event.identityContract.agentId, "openai-codex");
assert.strictEqual(event.identityContract.sessionId, "session-1");
assert.strictEqual(event.identityContract.taskId, "task-1");
assert.strictEqual(event.identityContract.processId, 4242);
assert.strictEqual(event.identityContract.completeness, 1);

const mapped = mapEventToAtoms(event).map(item => item.atomId);
assert(mapped.includes("AGENT.START"));
assert(mapped.includes("EXEC.PROCESS_CREATE"));
assert(mapped.includes("EXEC.TOOL_PROCESS_CREATE"));
assert(mapped.includes("EXEC.PROGRAM_EXECUTE"));

const quality = buildDataQuality([event], {
  process: {
    active: true,
    getStats: () => ({ lastEventAt: new Date().toISOString(), errors: 0 })
  }
});
assert.strictEqual(quality.identity.agentLinkRate, 1);
assert.strictEqual(quality.identity.sessionLinkRate, 1);
assert.strictEqual(quality.identity.processLinkRate, 1);
assert.strictEqual(quality.identity.taskLinkRate, 1);
assert.strictEqual(quality.sensors.process.status, "ready");

const compacted = compactBehaviorPath([
  { eventId: "1", taskId: "task-old", atomId: "DATA.FILE_READ", verdict: "allow", boundaryScope: "within" },
  { eventId: "2", taskId: "task-new", atomId: "DATA.FILE_READ", verdict: "allow", boundaryScope: "within" },
  { eventId: "3", taskId: "task-new", atomId: "DATA.FILE_READ", verdict: "allow", boundaryScope: "within" },
  { eventId: "4", taskId: "task-new", atomId: "EXEC.SHELL_COMMAND", verdict: "block", boundaryScope: "task" }
], 20);
assert.strictEqual(compacted.length, 2);
assert.strictEqual(compacted[0].repeatCount, 2);
assert.strictEqual(compacted[1].atomId, "EXEC.SHELL_COMMAND");

const catalog = buildCatalog({});
const compiled = compilePolicyRules({
  policyRules: [{
    id: "allow-read",
    name: "Allow read",
    enabled: true,
    priority: 1,
    authorization: { allow: ["DATA.FILE_READ"], conditional: [], deny: [] }
  }]
}, undefined, catalog.map(atom => atom.id));
assert(compiled.organizationBoundary.compiledRevision);
assert.strictEqual(compiled.organizationBoundary.compilerContract.schemaVersion, "aidr-policy-compiler-v1");
assert.strictEqual(compiled.organizationBoundary.compilerContract.invariants.mutuallyExclusive, true);
assert.strictEqual(compiled.organizationBoundary.compilerContract.invariants.catalogCovered, true);

console.log("data contract tests passed");

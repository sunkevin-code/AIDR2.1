const assert = require("assert");
const { EVENT_SCHEMA_VERSION, normalizeEvent, validateEvent } = require("../src/observability/eventSchema");

const event = normalizeEvent({
  category: "policy_decision",
  severity: "high",
  verdict: "block",
  summary: "Blocked tool",
  session_id: "session-1",
  agent_id: "opencode",
  trace_id: "trace-1",
  detail: { toolName: "filesystem.write", evidence: [{ type: "rule", value: "secret" }] }
});

assert.equal(event.schemaVersion, EVENT_SCHEMA_VERSION);
assert.equal(event.eventType, "policy_decision");
assert.equal(event.sessionId, "session-1");
assert.equal(event.agentId, "opencode");
assert.equal(event.traceId, "trace-1");
assert.equal(event.object, "filesystem.write");
assert.equal(validateEvent(event).valid, true);
assert.equal(validateEvent({}).valid, false);
console.log("eventSchema.test.js passed");

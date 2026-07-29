const assert = require("assert");
const { linkBehaviorEventToSession } = require("../src/utils/apiServer");

const sessions = [
  {
    id: "session-codex",
    agent: "openai-codex",
    threadId: "thread-1",
    cwd: "C:\\workspace\\aidr",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:10:00.000Z"
  },
  {
    id: "session-opencode",
    agent: "opencode",
    cwd: "C:\\workspace\\other",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:10:00.000Z"
  }
];

const explicit = linkBehaviorEventToSession({
  timestamp: "2026-07-29T11:00:00.000Z",
  agentId: "openai-codex",
  detail: { threadId: "thread-1" }
}, sessions);
assert.strictEqual(explicit.sessionId, "session-codex");
assert.strictEqual(explicit.detail.sessionAttribution.source, "session.explicit_identifier");

const temporal = linkBehaviorEventToSession({
  timestamp: "2026-07-29T10:08:00.000Z",
  agentId: "codex",
  detail: { cwd: "C:\\workspace\\aidr" }
}, sessions);
assert.strictEqual(temporal.sessionId, "session-codex");
assert.strictEqual(temporal.detail.sessionAttribution.source, "session.agent_time_workspace");

const stale = linkBehaviorEventToSession({
  timestamp: "2026-07-29T12:00:00.000Z",
  agentId: "openai-codex",
  detail: { cwd: "C:\\workspace\\aidr" }
}, sessions);
assert.strictEqual(stale.sessionId, undefined);

const existing = linkBehaviorEventToSession({ sessionId: "already-linked" }, sessions);
assert.strictEqual(existing.sessionId, "already-linked");

console.log("behavior session attribution tests passed");

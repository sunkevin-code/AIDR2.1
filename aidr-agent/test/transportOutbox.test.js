const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { TransportClient } = require("../src/transport/client");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-outbox-"));
const queuePath = path.join(root, "transport-outbox.json");
const policy = { serverUrl: "http://127.0.0.1:9", agentId: "test-agent", agentType: "generic", privacy: { uploadRawPrompts: false } };
const event = { eventId: "event-1", schemaVersion: 1, time: new Date().toISOString(), category: "policy_decision", severity: "high", verdict: "block", summary: "test block", detail: { sessionId: "session-1" }, sessionId: "session-1", agentId: "test-agent" };

const first = new TransportClient(policy, () => {}, queuePath);
first.sendEvent(event);
assert.equal(first.getStats().queueDepth, 1);
assert.equal(fs.existsSync(queuePath), true);

const second = new TransportClient(policy, () => {}, queuePath);
assert.equal(second.getStats().queueDepth, 1);
second.sendEvent(event);
assert.equal(second.getStats().queueDepth, 1);
assert.equal(second.getStats().deduplicated, 1);

const standalone = new TransportClient({ serverUrl: "", agentId: "standalone" }, () => {}, path.join(root, "standalone.json"));
standalone.sendEvent(event);
assert.equal(standalone.getStats().queueDepth, 0);
assert.equal(standalone.getStats().skippedNoServer, 1);

fs.rmSync(root, { recursive: true, force: true });
console.log("transport outbox tests passed");

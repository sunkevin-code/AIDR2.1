const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AuditLedger } = require("../src/observability/auditLedger");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-audit-ledger-"));
const event = { eventId: "evt-1", schemaVersion: 2, timestamp: "2026-07-24T00:00:00.000Z", category: "intent", eventType: "intent", severity: "high", verdict: "block", summary: "blocked prompt", detail: { category: "prompt_injection" } };
const ledger = new AuditLedger(temp);
assert.equal(ledger.verify().status, "empty");
assert.equal(ledger.append(event).ok, true);
assert.equal(ledger.append({ ...event, eventId: "evt-2", verdict: "allow" }).ok, true);
assert.equal(ledger.verify().valid, true);
assert.equal(ledger.getStatus().records, 2);
assert.equal(ledger.export(1).length, 1);

const file = path.join(temp, "aidr-audit-ledger.jsonl");
const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
const tampered = JSON.parse(lines[0]);
tampered.verdict = "allow";
lines[0] = JSON.stringify(tampered);
fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
const reopened = new AuditLedger(temp);
assert.equal(reopened.verify().valid, false);
assert.equal(reopened.getStatus().status, "record_hash_mismatch");

console.log("auditLedger tests passed");

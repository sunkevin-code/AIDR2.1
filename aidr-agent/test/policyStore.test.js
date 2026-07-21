const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PolicyStore } = require("../src/utils/policyStore");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-policy-store-"));
const baselinePath = path.join(directory, "baseline.json");
const policyPath = path.join(directory, "policy.json");
fs.writeFileSync(baselinePath, JSON.stringify({ version: "2.2.4", mode: "enforce", sessionPolicy: { ttlMinutes: 120 } }));

const store = new PolicyStore(policyPath, baselinePath, { dataDir: directory });
const first = store.save({ version: "2.2.4", mode: "monitor", sessionPolicy: { ttlMinutes: 30 } });
assert.equal(store.verify(first).valid, true);
assert.equal(first.policyMeta.revision, 1);

const second = store.save({ ...first, mode: "enforce", signature: undefined });
assert.equal(second.policyMeta.revision, 2);
assert.equal(store.getHistory().length, 2);

const tampered = JSON.parse(fs.readFileSync(policyPath, "utf8"));
tampered.mode = "monitor";
fs.writeFileSync(policyPath, JSON.stringify(tampered));
assert.equal(store.verifyActive().valid, false);

const restored = store.rollback(1);
assert.equal(restored.mode, "monitor");
assert.equal(restored.policyMeta.revision, 3);
assert.equal(store.verifyActive().valid, true);

fs.rmSync(directory, { recursive: true, force: true });
console.log("policy store tests passed");

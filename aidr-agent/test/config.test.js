const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPolicy } = require("../src/utils/config");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-config-test-"));
const baselinePath = path.join(directory, "baseline.json");
const storedPath = path.join(directory, "stored.json");

fs.writeFileSync(baselinePath, JSON.stringify({
  version: "2.2.4",
  mode: "enforce",
  sessionPolicy: { ttlMinutes: 120, defaultDenyUnrequestedTools: true },
  privacy: { uploadRawPrompts: false }
}));
fs.writeFileSync(storedPath, JSON.stringify({
  version: "1.0.0",
  mode: "monitor",
  sessionPolicy: { ttlMinutes: 30 }
}));

const policy = loadPolicy(storedPath, baselinePath);
assert.equal(policy.version, "2.2.4");
assert.equal(policy.mode, "monitor");
assert.equal(policy.sessionPolicy.ttlMinutes, 30);
assert.equal(policy.sessionPolicy.defaultDenyUnrequestedTools, true);
assert.equal(policy.privacy.uploadRawPrompts, false);

fs.rmSync(directory, { recursive: true, force: true });
console.log("config tests passed");

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readJsonWithBackup, writeJsonAtomic } = require("../src/utils/atomicJson");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-atomic-json-"));
const file = path.join(root, "state.json");

writeJsonAtomic(file, { version: 1, value: "first" });
assert.deepEqual(readJsonWithBackup(file).value, { version: 1, value: "first" });
writeJsonAtomic(file, { version: 2, value: "second" });
assert.deepEqual(readJsonWithBackup(file).value, { version: 2, value: "second" });
assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), { version: 1, value: "first" });

fs.writeFileSync(file, "{broken", "utf8");
const recovered = readJsonWithBackup(file);
assert.equal(recovered.source, "backup");
assert.equal(recovered.recovered, true);
assert.deepEqual(recovered.value, { version: 1, value: "first" });

fs.rmSync(root, { recursive: true, force: true });
console.log("atomicJson tests passed");

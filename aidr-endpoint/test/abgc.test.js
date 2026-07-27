const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "ui", "abgc.js"), "utf8"), context);

const model = context.window.AIDR_ABCG.createViewModel({
  mode: "actual",
  boundary: {
    organization: { levels: { DATA: 2 }, maxLevel: 3, version: "org-v1" },
    task: { levels: { DATA: 1 }, maxLevel: 2, version: "task-v1" }
  },
  catalog: [{ id: "data.transfer", domain: "data", baseLevel: 4, enabled: false }],
  items: [{ atom_id: "data.transfer", requiredLevel: 4, boundary_scope: "organization", decision: "BLOCK" }]
});

assert.strictEqual(model.mode, "actual");
assert.strictEqual(model.boundary.organization.levels.DATA, 2);
assert.strictEqual(model.boundary.task.levels.DATA, 1);
assert.strictEqual(model.catalog[0].id, "DATA.TRANSFER");
assert.strictEqual(model.catalog[0].enabled, false);
assert.strictEqual(model.items[0].atomId, "DATA.TRANSFER");
assert.strictEqual(model.items[0].boundaryScope, "organization");
assert.strictEqual(model.items[0].verdict, "block");
assert.strictEqual(model.items[0].requiredLevel, 4);

const boundaryAtoms = context.window.AIDR_ABCG.selectBoundaryAtoms([
  { id: "DATA.READ", domain: "DATA", baseLevel: 1, enabled: true },
  { id: "DATA.WRITE", domain: "DATA", baseLevel: 2, enabled: true },
  { id: "DATA.TRANSFER", domain: "DATA", baseLevel: 3, enabled: true },
  { id: "DATA.DISABLED", domain: "DATA", baseLevel: 2, enabled: false },
  { id: "EXEC.CALL", domain: "EXEC", baseLevel: 2, enabled: true }
], {
  organization: { levels: { DATA: 2, EXEC: 2 }, maxLevel: 2, deniedAtoms: ["EXEC.CALL"] },
  task: { levels: { DATA: 1, EXEC: 2 }, maxLevel: 2 }
}, "organization", ["DATA", "EXEC"]);
assert.deepStrictEqual(Array.from(boundaryAtoms[0].atoms, atom => atom.id), ["DATA.WRITE"]);
assert.strictEqual(boundaryAtoms[0].effectiveLevel, 2);
assert.strictEqual(boundaryAtoms[1].atoms.length, 0);

const explicitBoundaryAtoms = context.window.AIDR_ABCG.selectBoundaryAtoms([
  { id: "DATA.READ", domain: "DATA", baseLevel: 1, enabled: true },
  { id: "DATA.TRANSFER", domain: "DATA", baseLevel: 4, enabled: true }
], {
  organization: { levels: { DATA: 1 }, maxLevel: 1, allowedAtoms: ["DATA.TRANSFER"] }
}, "organization", ["DATA"]);
assert.deepStrictEqual(Array.from(explicitBoundaryAtoms[0].atoms, atom => atom.id), ["DATA.TRANSFER"]);

const taskBoundaryAtoms = context.window.AIDR_ABCG.selectBoundaryAtoms([
  { id: "DATA.READ", domain: "DATA", baseLevel: 1, enabled: true },
  { id: "DATA.WRITE", domain: "DATA", baseLevel: 2, enabled: true }
], {
  organization: { levels: { DATA: 3 }, maxLevel: 3 },
  task: { levels: { DATA: 1 }, maxLevel: 1 }
}, "task", ["DATA"]);
assert.deepStrictEqual(Array.from(taskBoundaryAtoms[0].atoms, atom => atom.id), ["DATA.READ"]);

const explicitlyAllowedTaskAtoms = context.window.AIDR_ABCG.selectBoundaryAtoms([
  { id: "EXEC.READ", domain: "EXEC", baseLevel: 1, enabled: true },
  { id: "EXEC.SYSTEM_CALL", domain: "EXEC", baseLevel: 3, enabled: true }
], {
  organization: {
    levels: { EXEC: 3 },
    maxLevel: 3,
    allowedAtoms: ["EXEC.SYSTEM_CALL"]
  },
  task: { levels: { EXEC: 1 }, maxLevel: 1 }
}, "task", ["EXEC"]);
assert.deepStrictEqual(
  Array.from(explicitlyAllowedTaskAtoms[0].atoms, atom => atom.id),
  ["EXEC.READ"],
  "Organization-level explicit allows must not bypass the current task boundary"
);
assert.strictEqual(explicitlyAllowedTaskAtoms[0].configuredLevel, 1);

console.log("ABCG shared view-model tests passed");

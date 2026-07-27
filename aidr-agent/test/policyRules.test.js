"use strict";
const assert = require("assert");
const { compilePolicyRules, upsertAtomAuthorizationRule } = require("../src/engine/policyRules");
let policy = {
  organizationBoundary: { allowedAtoms: ["DATA.FILE_READ"], deniedAtoms: ["AUTH.CREDENTIAL_READ"] },
  policyRules: [
    { id: "read", authorization: { allow: ["DATA.SOURCE_CODE_READ"], conditional: ["EXEC.HTTP_CONNECT"], deny: ["EXEC.SERVICE_CONTROL"] }, priority: 20 },
    { id: "secret", action: "block", atomIds: ["DATA.CREDENTIAL_READ"], priority: 10 }
  ]
};
let compiled = compilePolicyRules(policy);
assert(compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(compiled.organizationBoundary.deniedAtoms.includes("DATA.CREDENTIAL_READ"));
assert(compiled.organizationBoundary.conditionalAtoms.includes("EXEC.HTTP_CONNECT"));
assert.strictEqual(compiled.effectivePolicy.authorization.conditionalAtoms.length, 1);
assert.strictEqual(compiled.policyRules.find(rule => rule.id === "read").action, "mixed");
assert.strictEqual(compiled.policyRules[0].id, "secret");
policy = { ...policy, ...compiled };
compiled = upsertAtomAuthorizationRule(policy, "DATA.SOURCE_CODE_READ", false);
assert(!compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(compiled.organizationBoundary.deniedAtoms.includes("DATA.SOURCE_CODE_READ"));
policy = { ...policy, ...compiled };
compiled = upsertAtomAuthorizationRule(policy, "DATA.SOURCE_CODE_READ", true);
assert(compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(!compiled.organizationBoundary.deniedAtoms.includes("DATA.SOURCE_CODE_READ"));

compiled = compilePolicyRules({
  organizationBoundary: {
    allowedAtoms: ["DATA.FILE_READ"],
    deniedAtoms: ["AUTH.CREDENTIAL_READ"],
    compiledAtoms: []
  },
  policyRules: []
}, [], ["DATA.FILE_READ", "AUTH.CREDENTIAL_READ", "EXEC.SERVICE_CONTROL"]);
assert(compiled.policyRules.some(rule => rule.id === "baseline-boundary-import"));
assert(compiled.policyRules.some(rule => rule.id === "baseline-default-deny"));
assert(compiled.organizationBoundary.allowedAtoms.includes("DATA.FILE_READ"));
assert(compiled.organizationBoundary.deniedAtoms.includes("EXEC.SERVICE_CONTROL"));
assert.strictEqual(
  compiled.organizationBoundary.allowedAtoms.length
    + compiled.organizationBoundary.conditionalAtoms.length
    + compiled.organizationBoundary.deniedAtoms.length,
  3
);
console.log("policyRules tests passed");

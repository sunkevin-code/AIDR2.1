"use strict";
const assert = require("assert");
const { compilePolicyRules, upsertAtomAuthorizationRule } = require("../src/engine/policyRules");
let policy = {
  organizationBoundary: { allowedAtoms: ["DATA.FILE_READ"], deniedAtoms: ["AUTH.CREDENTIAL_READ"] },
  policyRules: [
    { id: "read", action: "allow", atomIds: ["DATA.SOURCE_CODE_READ"], priority: 20 },
    { id: "secret", action: "block", atomIds: ["DATA.CREDENTIAL_READ"], priority: 10 }
  ]
};
let compiled = compilePolicyRules(policy);
assert(compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(compiled.organizationBoundary.deniedAtoms.includes("DATA.CREDENTIAL_READ"));
assert.strictEqual(compiled.policyRules[0].id, "secret");
policy = { ...policy, ...compiled };
compiled = upsertAtomAuthorizationRule(policy, "DATA.SOURCE_CODE_READ", false);
assert(!compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(compiled.organizationBoundary.deniedAtoms.includes("DATA.SOURCE_CODE_READ"));
policy = { ...policy, ...compiled };
compiled = upsertAtomAuthorizationRule(policy, "DATA.SOURCE_CODE_READ", true);
assert(compiled.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
assert(!compiled.organizationBoundary.deniedAtoms.includes("DATA.SOURCE_CODE_READ"));
console.log("policyRules tests passed");

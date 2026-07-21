const assert = require("assert");
const { SessionPolicyEngine } = require("../src/engine/sessionPolicyEngine");

const engine = new SessionPolicyEngine({
  mode: "enforce",
  sessionPolicy: {
    deniedPaths: ["**\\.env"],
    allowedWritePaths: ["C:\\workspace\\.env"]
  },
  agentPolicies: {
    opencode: {
      mode: "disabled",
      capabilities: { fileRead: false, fileWrite: false, network: false },
      allowedReadPaths: ["C:\\workspace"],
      allowedWritePaths: ["C:\\workspace"],
      allowedDomains: ["example.com"]
    }
  }
}, () => {}, null);

const result = engine.validatePolicy();
assert.equal(result.valid, false);
assert.ok(result.errors.some(item => item.code === "grant_denied_overlap"));
assert.ok(result.errors.some(item => item.code === "read_path_without_file_read"));
assert.ok(result.errors.some(item => item.code === "domain_without_network"));
assert.ok(result.warnings.some(item => item.code === "disabled_agent_has_capabilities") === false);
console.log("policy validation tests passed");

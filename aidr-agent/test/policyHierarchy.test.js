const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SessionPolicyEngine } = require("../src/engine/sessionPolicyEngine");

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-policy-") );
const policy = {
  mode: "enforce",
  workspaceRoot,
  sessionPolicy: { ttlMinutes: 60, allowedDomains: ["localhost", "127.0.0.1", "example.com"] },
  workspacePolicies: {
    [workspaceRoot]: { allowedDomains: ["example.com"], capabilities: { network: false }, allowedWritePaths: [path.join(workspaceRoot, "safe")] }
  },
  agentPolicies: {
    opencode: { capabilities: { network: true, fileRead: true, fileWrite: true, shell: true, mcpRead: true, mcpWrite: false }, allowedDomains: ["example.com", "evil.example"] }
  }
};

const engine = new SessionPolicyEngine(policy, () => {}, path.join(workspaceRoot, "session-policies.json"));
const intent = engine.analyzePrompt("Fetch https://example.com and summarize it.", { agent: "opencode", cwd: workspaceRoot });
assert.equal(intent.capabilities.network, false);
assert.deepEqual(intent.policy.allowedDomains, ["example.com"]);
assert.equal(intent.policy.workspacePolicy.matched, true);
assert.deepEqual(intent.policy.resolution.layers.map(layer => layer.name), ["global", "workspace", "agent"]);
assert.equal(intent.policy.resolution.denyOverridesAllow, true);

const prompt = engine.handleHook({ hook_event_name: "UserPromptSubmit", session_id: "hierarchy-session", agent: "opencode", cwd: workspaceRoot, prompt: "Fetch https://example.com and summarize it." });
assert.equal(prompt.session.effectivePolicy.resolution.version, "aidr-policy-resolution-v1");
assert.equal(prompt.session.decisionTrace.schemaVersion, "aidr-decision-trace-v1");
assert.ok(prompt.session.decisionTrace.traceId);
assert.equal(prompt.session.decisionTrace.sources.localRules, true);
const decision = engine.handleHook({ hook_event_name: "PreToolUse", session_id: "hierarchy-session", agent: "opencode", cwd: workspaceRoot, tool_name: "WebFetch", tool_input: { url: "https://example.com" } });
assert.equal(decision.decision.verdict, "block");
assert.equal(decision.session.decisionTrace.sessionPolicy.resolution.layers.length, 3);
assert.equal(decision.session.decisionTrace.schemaVersion, "aidr-decision-trace-v1");

fs.rmSync(workspaceRoot, { recursive: true, force: true });
console.log("policy hierarchy tests passed");

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SessionPolicyEngine } = require("../src/engine/sessionPolicyEngine");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-approval-"));
const statePath = path.join(root, "session-policies.json");
const policy = {
  mode: "enforce",
  workspaceRoot: process.cwd(),
  sessionPolicy: { ttlMinutes: 120, allowedDomains: ["*"] },
  agentPolicies: { default: { requireApproval: { externalNetwork: true, sensitiveData: true, destructiveAction: true } } }
};

const first = new SessionPolicyEngine(policy, () => {}, statePath);
first.handleHook({ hook_event_name: "UserPromptSubmit", session_id: "approval-session", agent: "opencode", cwd: process.cwd(), prompt: "Browse https://example.com and summarize the page." });
const decision = first.handleHook({ hook_event_name: "PreToolUse", session_id: "approval-session", agent: "opencode", cwd: process.cwd(), tool_name: "WebFetch", tool_input: { url: "https://example.com" } });
assert.equal(decision.decision.requiresApproval, true);
assert.equal(first.getApprovals("pending").length, 1);
assert.ok(fs.existsSync(path.join(root, "approvals.json")));

const second = new SessionPolicyEngine(policy, () => {}, statePath);
const restored = second.getApprovals("pending");
assert.equal(restored.length, 1);
assert.equal(restored[0].id, first.getApprovals("pending")[0].id);
const resolved = second.resolveApproval(restored[0].id, "approved", 5);
assert.equal(resolved.status, "approved");

const third = new SessionPolicyEngine(policy, () => {}, statePath);
assert.equal(third.getApprovals("pending").length, 0);
assert.equal(third.getApprovals("approved").length, 1);
fs.rmSync(root, { recursive: true, force: true });
console.log("approval persistence tests passed");

const assert = require("assert");
const { createDefaultAdapterRegistry } = require("../src/adapters/agentAdapter");

const registry = createDefaultAdapterRegistry();
const before = registry.normalize({ agent: "opencode", event: "tool.execute.before", sessionID: "s1", callID: "c1", tool: "bash", args: { command: "echo ok" } });
assert.strictEqual(before.hook_event_name, "PreToolUse");
assert.strictEqual(before.tool_name, "Bash");
assert.strictEqual(before.session_id, "s1");
assert.ok(registry.getManifests().some(item => item.id === "generic"));
assert.strictEqual(registry.get("opencode").id, "opencode");
assert.strictEqual(registry.validate({ agent: "opencode", event: "tool.execute.before", sessionID: "s1", tool: "bash" }).valid, true);
assert.strictEqual(registry.getManifests().find(item => item.id === "opencode").sdkVersion, "aidr-adapter-sdk-v1");
assert.strictEqual(registry.get("opencode").onPrompt({ sessionID: "s1", prompt: "Read README" }).hook_event_name, "UserPromptSubmit");
assert.strictEqual(registry.get("opencode").onToolCall({ sessionID: "s1", tool: "read" }).hook_event_name, "PreToolUse");
assert.strictEqual(registry.dispatch({ agent: "opencode", event: "tool.execute.before", sessionID: "s1", tool: "bash" }).payload.hook_event_name, "PreToolUse");
console.log("agentAdapter tests passed");

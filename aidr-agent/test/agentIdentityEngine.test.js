const assert = require("assert");
const { AgentIdentityEngine, redactCommandLine } = require("../src/engine/agentIdentityEngine");

const engine = new AgentIdentityEngine();

const codex = engine.matchProcess({ Name: "codex.exe", ProcessId: 101, CommandLine: "codex app-server --api-key=secret-value" });
assert.equal(codex.profile.id, "openai-codex");
assert.equal(codex.score, 100);
assert.equal(codex.signals.some(signal => signal.startsWith("process_name:")), true);
assert.equal(redactCommandLine("--api-key=secret-value").includes("secret-value"), false);

const opencode = engine.matchProcess({ Name: "OpenCode.exe", ProcessId: 105, CommandLine: "C:\\Users\\OseasyVM\\AppData\\Local\\Programs\\@opencode-aidesktop\\OpenCode.exe --user-data-dir=%APPDATA%\\ai.opencode.desktop" });
assert.equal(opencode.profile.id, "opencode");
assert.equal(opencode.score, 100);
const claude = engine.matchProcess({ Name: "claude.exe", ProcessId: 102, CommandLine: "claude --model sonnet" });
assert.equal(claude.profile.id, "claude-code");

const cline = engine.matchProcess({ Name: "Code.exe", ProcessId: 103, CommandLine: "Code.exe --extensionDevelopmentPath=saoudrizwan.claude-dev" });
assert.equal(cline.profile.id, "cline");
assert.equal(cline.signals.some(signal => signal.includes("extension_marker:")), true);

// A generic VS Code process must not be classified as Cline, Roo Code, Copilot or Continue.
assert.equal(engine.matchProcess({ Name: "Code.exe", ProcessId: 104, CommandLine: "Code.exe --folder-uri C:\\workspace" }), null);

const discovery = engine.update([
  { Name: "codex.exe", ProcessId: 101, CommandLine: "codex app-server --token=hidden" },
  { Name: "Code.exe", ProcessId: 103, CommandLine: "Code.exe --extensionDevelopmentPath=saoudrizwan.claude-dev" }
]);
assert.equal(discovery.changes.length, 2);
assert.equal(discovery.agents.some(agent => agent.id === "openai-codex" && agent.status === "active"), true);
assert.equal(discovery.agents.some(agent => agent.id === "cline" && agent.status === "active"), true);
assert.equal(discovery.agents.find(agent => agent.id === "openai-codex").processes[0].commandLine.includes("hidden"), false);
assert.equal(engine.getCatalog().length >= 10, true);

const stopped = engine.update([]);
assert.notEqual(stopped.agents.find(agent => agent.id === "openai-codex").status, "active");
assert.notEqual(stopped.agents.find(agent => agent.id === "cline").status, "active");

console.log("agentIdentityEngine tests passed");
const assert = require("assert");
const { AgentIdentityEngine } = require("../src/engine/agentIdentityEngine");

const custom = new AgentIdentityEngine({ agentCatalog: [
  { id: "custom-agent", label: "Custom Agent", vendor: "Test", processNames: ["custom-agent.exe"], commandTokens: ["custom-agent"] }
] });
const match = custom.matchProcess({ Name: "custom-agent.exe", ProcessId: 201, CommandLine: "custom-agent --safe" });
assert.equal(match.profile.id, "custom-agent");

const first = custom.update([{ Name: "hermes.exe", ProcessId: 202, CommandLine: "hermes --session test" }]);
assert.equal(first.agents.find(agent => agent.id === "hermes").status, "active");
const snapshot = custom.getSnapshot();

const restored = new AgentIdentityEngine();
restored.restore(snapshot);
const restoredHermes = restored.getSnapshot().find(agent => agent.id === "hermes");
assert.equal(restoredHermes.status, "offline");
assert.equal(restoredHermes.stale, true);

const refreshed = restored.update([{ Name: "hermes.exe", ProcessId: 202, CommandLine: "hermes --session test" }]);
assert.equal(refreshed.agents.find(agent => agent.id === "hermes").status, "active");
assert.equal(refreshed.agents.find(agent => agent.id === "hermes").stale, false);

console.log("agent discovery persistence tests passed");

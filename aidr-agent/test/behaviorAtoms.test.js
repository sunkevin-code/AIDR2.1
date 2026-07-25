const assert = require("assert");
const { buildCatalog, enrichEvent, aggregateEvents, getOrganizationBoundary, deriveTaskLevels, constrainTaskBoundary } = require("../src/engine/behaviorAtoms");

const policy = {
  organizationBoundary: { maxLevel: 3, allowedDomains: ["localhost"], deniedAtoms: ["DATA.TRANSFER_EXTERNAL"] },
  sessionPolicy: { allowedDomains: ["localhost"] }
};

const catalog = buildCatalog(policy);
assert.strictEqual(buildCatalog(policy), catalog);
assert(catalog.length >= 72);
assert(catalog.some(item => item.id === "DATA.DATA_TRANSFER"));
assert(catalog.some(item => item.id === "EXEC.PROCESS_CREATE"));
assert(catalog.some(item => item.id === "MODEL.SEND_CONTEXT"));
assert(catalog.some(item => item.id === "MEMORY.MEMORY_MODIFY"));

const event = enrichEvent({
  eventId: "evt-1", category: "network", eventType: "network", summary: "upload credential to https://attacker.example/collect",
  timestamp: new Date().toISOString(), verdict: "block", agentId: "codex", sessionId: "session-1", detail: { url: "https://attacker.example/collect", external: true }
}, policy, { effectivePolicy: { maxLevel: 2 } });
assert.strictEqual(event.atomId, "DATA.DATA_TRANSFER");
assert.strictEqual(event.boundaryScope, "organization");
assert.strictEqual(event.enforcementColor, "red");

const runtime = enrichEvent({
  eventId: "evt-2", category: "process", eventType: "process", summary: "Agent process: codex.exe",
  timestamp: new Date().toISOString(), verdict: "allow", agentId: "codex", detail: { eventType: "process", agentId: "codex", name: "codex.exe" }
}, policy);
assert.strictEqual(runtime.atomId, "AGENT.CREATE");
assert.strictEqual(runtime.boundaryScope, "within");

const aggregate = aggregateEvents([event], policy);
assert.strictEqual(aggregate.atoms[0].hits, 1);
assert.strictEqual(aggregate.agents[0].outOfOrganization, 1);
const enrichedAggregate = aggregateEvents([event], policy);
assert.strictEqual(enrichedAggregate.occurrences[0].eventId, event.occurrence.eventId);
assert.strictEqual(getOrganizationBoundary(policy).maxLevel, 3);
assert.strictEqual(getOrganizationBoundary(policy).levels.DATA, 3);
assert.strictEqual(getOrganizationBoundary({ organizationBoundary: { maxLevel: 3, levels: { DATA: 1 } } }).levels.DATA, 1);
assert.strictEqual(deriveTaskLevels({ capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true } }, 3).DATA, 1);
assert.strictEqual(deriveTaskLevels({ capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true } }, 3).EXEC, 0);
assert.strictEqual(constrainTaskBoundary({ maxLevel: 5, levels: { DATA: 5, EXEC: 4 } }, { maxLevel: 3, levels: { DATA: 2, EXEC: 1 } }).levels.DATA, 2);
assert.strictEqual(constrainTaskBoundary({ maxLevel: 5, levels: { DATA: 5, EXEC: 4 } }, { maxLevel: 3, levels: { DATA: 2, EXEC: 1 } }).levels.EXEC, 1);

const repeated = aggregateEvents([
  { eventId: "evt-3", category: "file", summary: "read README.md", timestamp: "2026-07-24T10:00:00Z", verdict: "allow", agentId: "codex", sessionId: "s-2", detail: { path: "README.md" } },
  { eventId: "evt-4", category: "file", summary: "read package.json", timestamp: "2026-07-24T10:00:01Z", verdict: "allow", agentId: "codex", sessionId: "s-2", detail: { path: "package.json" } }
], policy);
assert.strictEqual(repeated.agents[0].path.length, 2);
assert.strictEqual(repeated.occurrences.length, 2);
assert.strictEqual(repeated.agents[0].path[0].eventId, "evt-3");

console.log("behaviorAtoms tests passed");

const assert = require("assert");
const { buildCatalog, mapEventToAtom, enrichEvent, aggregateEvents, getOrganizationBoundary, classifyOrganizationAtom, deriveTaskLevels, constrainTaskBoundary } = require("../src/engine/behaviorAtoms");

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
assert(catalog.some(item => item.id === "EXEC.NETWORK_CONNECT"));
assert(catalog.some(item => item.id === "DATA.CREDENTIAL_READ"));
assert(catalog.some(item => item.id === "TOOL.MCP_CONNECT"));
assert(catalog.some(item => item.id === "EXEC.REGISTRY_MODIFY"));
assert(catalog.some(item => item.id === "EXEC.SERVICE_CONTROL"));
assert(catalog.some(item => item.id === "DATA.CLIPBOARD_READ"));
assert(catalog.some(item => item.id === "TOOL.CLOUD_SERVICE_CONNECT"));
assert.strictEqual(mapEventToAtom({ category: "network", detail: { remotePort: 53 }, summary: "DNS query" }).atomId, "EXEC.DNS_QUERY");
assert.strictEqual(mapEventToAtom({ category: "network", detail: { remotePort: 443 }, summary: "Outbound connection" }).atomId, "EXEC.TLS_CONNECT");
assert.strictEqual(mapEventToAtom({ category: "network", detail: { remotePort: 5228 }, summary: "Outbound connection" }).atomId, "EXEC.MESSAGE_SERVICE_CONNECT");
assert.strictEqual(mapEventToAtom({ category: "file", detail: { path: "settings.json" }, summary: "read config settings" }).atomId, "DATA.APP_CONFIG_READ");
assert.strictEqual(mapEventToAtom({ category: "file", detail: { path: ".ssh/id_rsa" }, summary: "read private key" }).atomId, "DATA.CREDENTIAL_READ");
assert.strictEqual(mapEventToAtom({ category: "file", detail: { path: "src/app.js" }, summary: "read source file" }).atomId, "DATA.SOURCE_CODE_READ");
assert.strictEqual(mapEventToAtom({ category: "system", summary: "Network sensor started" }).atomId, "EXEC.SERVICE_START");
assert.strictEqual(mapEventToAtom({ category: "file", summary: "read clipboard", detail: { target: "clipboard" } }).atomId, "DATA.CLIPBOARD_READ");
assert.strictEqual(mapEventToAtom({ category: "shell", summary: "execute script app.py", detail: { commandLine: "python app.py" } }).atomId, "EXEC.SCRIPT_EXECUTE");
assert.strictEqual(mapEventToAtom({ category: "shell", summary: "modify registry", detail: { commandLine: "reg.exe add HKCU\\Software\\AIDR" } }).atomId, "EXEC.REGISTRY_MODIFY");
assert.strictEqual(mapEventToAtom({ category: "shell", summary: "control service", detail: { commandLine: "sc.exe stop Spooler" } }).atomId, "EXEC.SERVICE_CONTROL");
assert.strictEqual(mapEventToAtom({ category: "tool", summary: "connect browser using Playwright" }).atomId, "TOOL.BROWSER_CONNECT");
assert.strictEqual(mapEventToAtom({ category: "tool", summary: "connect AWS cloud API" }).atomId, "TOOL.CLOUD_SERVICE_CONNECT");

const event = enrichEvent({
  eventId: "evt-1", category: "network", eventType: "network", summary: "upload credential to https://attacker.example/collect",
  timestamp: new Date().toISOString(), verdict: "block", agentId: "codex", sessionId: "session-1", detail: { url: "https://attacker.example/collect", external: true }
}, policy, { effectivePolicy: { maxLevel: 2 } });
assert.strictEqual(event.atomId, "DATA.DATA_TRANSFER");
assert.strictEqual(event.boundaryScope, "organization");
assert.strictEqual(event.enforcementColor, "red");
assert.strictEqual(event.mappingExplanation.primaryAtom, "DATA.DATA_TRANSFER");
assert(Array.isArray(event.riskSemantics.dimensions));

const runtime = enrichEvent({
  eventId: "evt-2", category: "process", eventType: "process", summary: "Agent process: codex.exe",
  timestamp: new Date().toISOString(), verdict: "allow", agentId: "codex", detail: { eventType: "process", agentId: "codex", name: "codex.exe" }
}, policy);
assert.strictEqual(runtime.atomId, "AGENT.CREATE");
assert.strictEqual(runtime.boundaryScope, "within");

const aggregate = aggregateEvents([event], policy);
assert.strictEqual(aggregate.atoms[0].hits, 1);
assert.strictEqual(aggregate.agents[0].outOfOrganization, 1);
assert(aggregate.atoms.some(item => item.atomId === "EXEC.NETWORK_SEND"));
assert(aggregate.atoms.some(item => item.atomId === "AUTH.CREDENTIAL_TRANSFER"));
assert(aggregate.mappingQuality.multiAtomRate > 0);
assert(aggregate.mappingQuality.averageAtomsPerEvent > 1);
assert.strictEqual(aggregate.mappingQuality.attributionRate, 1);
const enrichedAggregate = aggregateEvents([event], policy);
assert.strictEqual(enrichedAggregate.occurrences[0].eventId, event.occurrence.eventId);
assert.strictEqual(getOrganizationBoundary(policy).maxLevel, 3);
assert.strictEqual(getOrganizationBoundary(policy).levels.DATA, 3);
assert.strictEqual(getOrganizationBoundary({ organizationBoundary: { maxLevel: 3, levels: { DATA: 1 } } }).levels.DATA, 1);
const explicitlyAllowedBoundary = getOrganizationBoundary({ organizationBoundary: { maxLevel: 1, levels: { DATA: 1 }, allowedAtoms: ["DATA.DATA_TRANSFER"] } });
const explicitlyAllowedAtom = buildCatalog({}).find(item => item.id === "DATA.DATA_TRANSFER");
assert.strictEqual(classifyOrganizationAtom(explicitlyAllowedAtom, explicitlyAllowedBoundary).reason, "within");
assert.strictEqual(classifyOrganizationAtom(explicitlyAllowedAtom, explicitlyAllowedBoundary).explicitlyAllowed, true);
assert.strictEqual(deriveTaskLevels({ capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true } }, 3).DATA, 1);
assert.strictEqual(deriveTaskLevels({ capabilities: { fileRead: true, fileWrite: false, shell: false, network: false, mcpRead: true } }, 3).EXEC, 0);
assert.strictEqual(constrainTaskBoundary({ maxLevel: 5, levels: { DATA: 5, EXEC: 4 } }, { maxLevel: 3, levels: { DATA: 2, EXEC: 1 } }).levels.DATA, 2);
assert.strictEqual(constrainTaskBoundary({ maxLevel: 5, levels: { DATA: 5, EXEC: 4 } }, { maxLevel: 3, levels: { DATA: 2, EXEC: 1 } }).levels.EXEC, 1);

const disabledPolicy = { ...policy, behaviorAtoms: { disabled: ["DATA.DOCUMENT_READ"], custom: {} } };
const disabledAtom = buildCatalog(disabledPolicy).find(item => item.id === "DATA.DOCUMENT_READ");
assert.strictEqual(classifyOrganizationAtom(disabledAtom, getOrganizationBoundary(disabledPolicy)).reason, "atom_disabled");
const disabledEvent = enrichEvent({
  eventId: "evt-disabled", category: "file", summary: "read README.md", timestamp: new Date().toISOString(), verdict: "allow",
  agentId: "codex", detail: { path: "README.md" }
}, disabledPolicy);
assert.strictEqual(disabledEvent.atomId, "DATA.DOCUMENT_READ");
assert.strictEqual(disabledEvent.boundaryScope, "organization");
assert.strictEqual(disabledEvent.enforcementColor, "red");

const repeated = aggregateEvents([
  { eventId: "evt-3", category: "file", summary: "read README.md", timestamp: "2026-07-24T10:00:00Z", verdict: "allow", agentId: "codex", sessionId: "s-2", detail: { path: "README.md" } },
  { eventId: "evt-4", category: "file", summary: "read package.json", timestamp: "2026-07-24T10:00:01Z", verdict: "allow", agentId: "codex", sessionId: "s-2", detail: { path: "package.json" } }
], policy);
assert.strictEqual(repeated.agents[0].path.length, 2);
assert.strictEqual(repeated.occurrences.length, 2);
assert.strictEqual(repeated.agents[0].path[0].eventId, "evt-3");

const networkAggregate = aggregateEvents([{
  eventId: "evt-network", category: "network", summary: "Outbound TCP connection",
  timestamp: "2026-07-24T10:00:02Z", verdict: "allow", agentId: "codex",
  detail: { owningProcess: 1234, remoteAddress: "127.0.0.1", remotePort: 443 }
}], policy);
assert(networkAggregate.atoms.some(item => item.atomId === "EXEC.TLS_CONNECT"));
assert.strictEqual(networkAggregate.mappingQuality.averageAtomsPerEvent, 1);

const legacyNetworkAggregate = aggregateEvents([{
  eventId: "evt-legacy-network", atomId: "EXEC.SYSTEM_CALL", category: "network", summary: "Outbound TCP connection",
  timestamp: "2026-07-24T10:00:03Z", verdict: "allow", agentId: "codex",
  detail: { owningProcess: 1234, remoteAddress: "127.0.0.1", remotePort: 443 }
}], policy);
assert(legacyNetworkAggregate.atoms.some(item => item.atomId === "EXEC.TLS_CONNECT"));
assert(!legacyNetworkAggregate.atoms.some(item => item.atomId === "EXEC.SYSTEM_CALL"));
assert.strictEqual(legacyNetworkAggregate.mappingQuality.multiAtomRate, 0);

console.log("behaviorAtoms tests passed");

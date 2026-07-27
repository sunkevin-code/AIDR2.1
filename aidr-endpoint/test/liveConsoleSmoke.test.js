const assert = require("assert");

const base = process.env.AIDR_UI_URL || "http://127.0.0.1:8791";

async function json(pathname) {
  const response = await fetch(base + pathname, { cache: "no-store" });
  assert.strictEqual(response.status, 200, `${pathname} returned ${response.status}`);
  return response.json();
}

async function waitForAgentReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "not_checked";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/sessions?compact=1&limit=1", { cache: "no-store" });
      lastStatus = String(response.status);
      if (response.status === 200) return;
    } catch (error) {
      lastStatus = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`Agent data API did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

async function main() {
  await waitForAgentReady();
  const [status, sessions, agents, events, policy, atoms] = await Promise.all([
    json("/api/status"),
    json("/api/sessions?compact=1&limit=40"),
    json("/api/agents"),
    json("/api/events?limit=100"),
    json("/api/policy"),
    json("/api/behavior-atoms?windowHours=24&pathLimit=160&occurrenceLimit=200")
  ]);

  assert.strictEqual(status.endpoint.components.userModeAgent.status, "running");
  assert.strictEqual(status.endpoint.components.agentApi.status, "ready");
  assert(status.endpoint.build && status.endpoint.build.gitCommit, "endpoint build identity missing");
  assert(status.endpoint.build.uiRevision, "endpoint UI revision missing");
  assert(Array.isArray(sessions.sessions), "sessions contract missing");
  assert(Array.isArray(agents.agents), "agents contract missing");
  assert(Array.isArray(events.events), "events contract missing");
  assert(policy && typeof policy === "object", "policy contract missing");
  assert(Array.isArray(atoms.catalog) && atoms.catalog.length > 0, "behavior atom catalog is empty");

  const response = await fetch(base + "/", { cache: "no-store" });
  const html = await response.text();
  for (const marker of [
    'id="page-sessions"',
    'id="page-agents"',
    'id="page-policy"',
    'id="page-behavior"',
    'id="page-semantic"',
    'id="page-system"',
    'id="aidr-abgc-runtime"',
    'id="aidr-runtime-adapter"',
    'id="abgPolicySvg"',
    'id="abgCapabilityGrid"',
    'id="abgBehaviorSvg"',
    'id="abgSessionSvg"',
    'name="aidr-build-commit"',
    'name="aidr-ui-revision"'
  ]) assert(html.includes(marker), `served UI missing ${marker}`);

  assert.strictEqual((html.match(/id="aidr-runtime-adapter"/g) || []).length, 1);
  assert.strictEqual((html.match(/id="aidr-abgc-runtime"/g) || []).length, 1);
  console.log(JSON.stringify({
    ok: true,
    version: status.endpoint.version,
    build: status.endpoint.build,
    sessions: sessions.sessions.length,
    agents: agents.agents.length,
    events: events.events.length,
    behaviorAtoms: atoms.catalog.length
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

"use strict";

const baseUrl = String(process.argv[2] || process.env.AIDR_SERVER_URL || "http://127.0.0.1:8888").replace(/\/$/, "");

const checks = [
  ["console", "/console", "html"],
  ["endpoints", "/console/api/endpoints", "endpoints"],
  ["agents", "/console/api/agents", "agents"],
  ["sessions", "/console/api/sessions", "sessions"],
  ["events", "/console/api/events", "events"],
  ["policy", "/console/api/policy", null],
  ["behaviorAtoms", "/console/api/behavior-atoms", "catalog"]
];

async function run() {
  const results = [];
  for (const [name, requestPath, property] of checks) {
    try {
      const response = await fetch(baseUrl + requestPath, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (property === "html") {
        const html = await response.text();
        if (!/aidr-data-mode" content="central"/.test(html)) throw new Error("central_console_marker_missing");
        results.push({ name, status: "ready" });
        continue;
      }
      const payload = await response.json();
      if (property && !Array.isArray(payload[property])) throw new Error(`contract_${property}_missing`);
      const count = property && Array.isArray(payload[property]) ? payload[property].length : null;
      results.push({ name, status: count === 0 && ["endpoints", "agents"].includes(name) ? "degraded" : "ready", count });
    } catch (error) {
      results.push({ name, status: "failed", error: String(error.message || error) });
    }
  }
  const failed = results.filter(result => result.status === "failed");
  const degraded = results.filter(result => result.status === "degraded");
  const status = failed.length ? "failed" : (degraded.length ? "degraded" : "ready");
  process.stdout.write(JSON.stringify({ status, baseUrl, checks: results }, null, 2) + "\n");
  if (failed.length) process.exitCode = 1;
}

run().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});

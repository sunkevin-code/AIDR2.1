"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const port = 19000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-server-test-"));
const enrollmentToken = "integration-enrollment-token";
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: path.join(__dirname, ".."),
  env: {
    ...process.env,
    PORT: String(port),
    AIDR_SERVER_DATA_DIR: dataDir,
    AIDR_ENROLLMENT_TOKEN: enrollmentToken
  },
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/console`);
      if (response.ok) return response.text();
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server_start_timeout");
}

async function run() {
  const html = await waitForServer();
  assert.match(html, /aidr-data-mode" content="central"/);
  assert.match(html, /\/console\/runtime-adapter\.js/);

  let response = await fetch(`${baseUrl}/api/v1/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enrollmentToken: "wrong", hostname: "bad-endpoint" })
  });
  assert.strictEqual(response.status, 401);

  response = await fetch(`${baseUrl}/api/v1/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollmentToken,
      hostname: "linux-integration",
      platform: "linux",
      arch: "x64",
      version: "2.4.0-test"
    })
  });
  assert.strictEqual(response.status, 200);
  const enrollment = await response.json();
  assert.ok(enrollment.endpointId);
  assert.ok(enrollment.endpointToken);

  response = await fetch(`${baseUrl}/api/v1/ingest`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${enrollment.endpointToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agentId: enrollment.endpointId,
      agent: { hostname: "linux-integration", platform: "linux", version: "2.4.0-test" },
      message: {
        type: "session_start",
        sessionId: "session-integration",
        prompt: "Read README.md and summarize it.",
        timestamp: new Date().toISOString()
      }
    })
  });
  assert.strictEqual(response.status, 200);

  response = await fetch(`${baseUrl}/console/api/endpoints`);
  const endpoints = await response.json();
  assert.ok(endpoints.endpoints.some(endpoint => endpoint.id === enrollment.endpointId));

  response = await fetch(`${baseUrl}/console/api/sessions?endpoint_id=${encodeURIComponent(enrollment.endpointId)}`);
  const sessions = await response.json();
  assert.ok(sessions.sessions.some(session => session.id === "session-integration"));

  response = await fetch(`${baseUrl}/console/api/sessions/session-integration`);
  const detail = await response.json();
  assert.strictEqual(detail.prompt, "Read README.md and summarize it.");

  response = await fetch(`${baseUrl}/console/api/sessions/session-integration/orbit`);
  const orbit = await response.json();
  assert.strictEqual(orbit.sessionId, "session-integration");
  assert.ok(orbit.organizationBoundary);

  response = await fetch(`${baseUrl}/console/api/policy`);
  const initialPolicy = await response.json();
  assert.ok(Array.isArray(initialPolicy.policyRules));

  response = await fetch(`${baseUrl}/console/api/policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      policyRules: [
        { id: "integration-mixed", name: "Integration mixed", enabled: true, priority: 1, authorization: { allow: ["DATA.SOURCE_CODE_READ"], conditional: ["EXEC.HTTP_CONNECT"], deny: ["AUTH.CREDENTIAL_READ"] }, agentScope: ["*"] },
        { id: "integration-block", name: "Integration block", enabled: true, priority: 2, action: "block", agentScope: ["*"], atomIds: ["AUTH.CREDENTIAL_READ"] }
      ]
    })
  });
  assert.strictEqual(response.status, 200);
  const policyUpdate = await response.json();
  assert.ok(policyUpdate.policy.organizationBoundary.allowedAtoms.includes("DATA.SOURCE_CODE_READ"));
  assert.ok(policyUpdate.policy.organizationBoundary.conditionalAtoms.includes("EXEC.HTTP_CONNECT"));
  assert.ok(policyUpdate.policy.organizationBoundary.deniedAtoms.includes("AUTH.CREDENTIAL_READ"));
  assert.strictEqual(policyUpdate.policy.effectivePolicy.ruleContributions[0].conditional, 1);

  response = await fetch(`${baseUrl}/console/api/behavior-atoms`);
  const atoms = await response.json();
  assert.ok(atoms.catalog.some(atom => atom.id === "DATA.SOURCE_CODE_READ" && atom.enabled));
  assert.ok(atoms.catalog.some(atom => atom.id === "EXEC.HTTP_CONNECT" && atom.authorizationState === "conditional"));

  process.stdout.write("control-plane integration: PASS\n");
}

run().finally(() => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

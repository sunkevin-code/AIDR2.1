"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const serverUrl = String(process.argv[2] || "").replace(/\/$/, "");
  const enrollmentToken = String(process.argv[3] || "");
  const policyPath = process.argv[4];
  if (!serverUrl || !enrollmentToken || !policyPath) throw new Error("server_url_enrollment_token_and_policy_path_required");
  const response = await fetch(serverUrl + "/api/v1/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollmentToken,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      version: "2.4.0-linux",
      agentType: "aidr-endpoint"
    })
  });
  if (!response.ok) throw new Error("enrollment_failed_" + response.status + ": " + (await response.text()).slice(0, 200));
  const enrollment = await response.json();
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  policy.agentId = enrollment.endpointId;
  policy.serverUrl = serverUrl;
  policy.serverAuthToken = enrollment.endpointToken;
  policy.transportMode = "http";
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2), { mode: 0o600 });
  fs.chmodSync(policyPath, 0o600);
  process.stdout.write(JSON.stringify({ ok: true, endpointId: enrollment.endpointId, serverUrl }) + "\n");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

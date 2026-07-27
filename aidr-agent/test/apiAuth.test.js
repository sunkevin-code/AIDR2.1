const assert = require("assert");
const http = require("http");
const { startApiServer } = require("../src/utils/apiServer");

function request(port, method, pathname, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.request({ hostname: "127.0.0.1", port, method, path: pathname, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const previous = process.env.AIDR_API_TOKENS;
  delete process.env.AIDR_LOCAL_TOKEN;
  process.env.AIDR_API_TOKENS = JSON.stringify({ "admin-token": { role: "admin" }, "read-token": { role: "viewer" } });
  const server = startApiServer({
    policy: { agentId: "test-agent", version: "test", mode: "monitor" },
    events: [], sessions: [], db: null, addEvent: () => {}, sensors: {}, transport: {}, apiPort: 0,
    handleEvent: () => {}, ruleEngine: {}, llmClassifier: {}, localSemanticClassifier: {}, semanticClassifier: {},
    enforcer: {}, policyStore: {}, getPolicyVerification: () => ({}), sessionPolicyEngine: {}, adapterRegistry: {},
    auditLedger: {}, semanticFeedback: {}, getRuntimeHealth: () => ({ status: "healthy" }), onPolicyUpdate: () => {}, onPolicyRollback: () => {}
  });
  await new Promise(resolve => server.once("listening", resolve));
  const port = server.address().port;
  assert.equal((await request(port, "GET", "/api/ui/contract", "read-token")).status, 200);
  assert.equal((await request(port, "GET", "/api/ui/contract")).status, 401);
  assert.equal((await request(port, "PUT", "/api/policy", "read-token")).status, 403);
  assert.equal((await request(port, "GET", "/api/ui/contract", "admin-token")).status, 200);
  await new Promise(resolve => server.close(resolve));
  if (previous === undefined) delete process.env.AIDR_API_TOKENS;
  else process.env.AIDR_API_TOKENS = previous;
  console.log("apiAuth.test.js passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

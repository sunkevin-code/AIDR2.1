const assert = require("assert");
const http = require("http");
const { MCPGateway } = require("../src/sensors/mcpGateway");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "content-type": "application/json" } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

(async () => {
  let upstreamCalls = 0;
  const upstream = http.createServer((req, res) => {
    upstreamCalls += 1;
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id || 1, result: { content: [{ type: "text", text: "upstream-ok" }] } }));
    });
  });
  const upstreamPort = await listen(upstream);
  const probe = http.createServer();
  const proxyPort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));

  const events = [];
  const gateway = new MCPGateway({
    mode: "enforce",
    sessionPolicy: { allowedMcpTools: ["read_file"] },
    sensors: { mcp_gateway: { enabled: true, proxy: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}/mcp`, timeoutMs: 2000 } }
  }, (...args) => events.push(args), { evaluate: () => ({ verdict: "allow" }) });
  await gateway.start();
  await new Promise(resolve => setTimeout(resolve, 20));

  const allowed = await post(proxyPort, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_file", arguments: { path: "README.md" } } });
  assert.equal(allowed.status, 200);
  assert.match(allowed.body, /upstream-ok/);
  assert.equal(upstreamCalls, 1);

  const blocked = await post(proxyPort, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write_file", arguments: { path: ".env" } } });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body, /effectProof/);
  assert.equal(upstreamCalls, 1);
  assert.equal(gateway.getStats().forwarded, 1);

  await gateway.stop();
  await new Promise(resolve => upstream.close(resolve));
  console.log("mcpGateway.test.js passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.AIDR_DEMO_PORT || 8765);
const host = "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/demo/index.html" : url.pathname);
  const target = path.resolve(root, `.${pathname}`);

  if (!target.startsWith(root)) {
    send(res, 403, "forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      send(res, 404, "not found");
      return;
    }
    send(res, 200, data, types[path.extname(target)] || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  console.log(`AIDR demo: http://${host}:${port}/demo/index.html`);
  console.log(`AIDR architecture: http://${host}:${port}/architecture/aidr-architecture.html`);
});

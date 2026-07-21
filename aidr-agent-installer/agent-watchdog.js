const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const installDir = process.env.AIDR_AGENT_SERVICE_HOME || path.dirname(process.execPath);
const agentDir = process.env.AIDR_AGENT_DIR || path.join(installDir, "aidr-agent");
const logDir = path.join(installDir, "logs");
const healthPort = Number(process.env.AIDR_AGENT_HEALTH_PORT || 8790);

let child = null;
let childStartedAt = null;
let restarts = 0;
let lastExit = null;
let stopping = false;
let restartTimer = null;

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function log(message) {
  ensureDir(logDir);
  const line = `[${new Date().toISOString()}] ${message}${os.EOL}`;
  fs.appendFileSync(path.join(logDir, "service.log"), line, "utf8");
  console.log(line.trim());
}

function findNode() {
  const candidates = [
    process.env.AIDR_NODE,
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const output = childProcess.execFileSync("where.exe", ["node.exe"], {
      encoding: "utf8",
      windowsHide: true
    });
    const first = output.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch (_) {}

  return null;
}

function startAgent() {
  if (stopping || child) return;

  const nodeExe = findNode();
  if (!nodeExe) {
    log("Node.js not found. Install Node.js or set AIDR_NODE.");
    scheduleRestart(10000);
    return;
  }

  const entry = path.join(agentDir, "src", "agent.js");
  if (!fs.existsSync(entry)) {
    log(`Agent entry not found: ${entry}`);
    scheduleRestart(10000);
    return;
  }

  ensureDir(logDir);
  const stdout = fs.openSync(path.join(logDir, "agent.stdout.log"), "a");
  const stderr = fs.openSync(path.join(logDir, "agent.stderr.log"), "a");

  childStartedAt = new Date();
  child = childProcess.spawn(nodeExe, [entry], {
    cwd: agentDir,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
    env: {
      ...process.env,
      AIDR_AGENT_SERVICE_HOME: installDir
    }
  });

  log(`Started AIDR Agent pid=${child.pid}`);

  child.on("exit", (code, signal) => {
    lastExit = { code, signal, time: new Date().toISOString() };
    log(`AIDR Agent exited code=${code} signal=${signal}`);
    child = null;
    if (!stopping) scheduleRestart(backoffMs());
  });

  child.on("error", (error) => {
    log(`AIDR Agent start error: ${error.message}`);
    child = null;
    if (!stopping) scheduleRestart(backoffMs());
  });
}

function backoffMs() {
  restarts += 1;
  return Math.min(30000, 2000 + restarts * 1000);
}

function scheduleRestart(delay) {
  if (restartTimer) clearTimeout(restartTimer);
  log(`Restart scheduled in ${delay}ms`);
  restartTimer = setTimeout(startAgent, delay);
}

function stopAgent() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (!child) return;
  try {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child) {
        try { child.kill("SIGKILL"); } catch (_) {}
      }
    }, 3000);
  } catch (_) {}
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== "/health" && req.url !== "/status") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const body = {
      service: "AIDR Agent Service",
      ok: true,
      installDir,
      agentDir,
      childPid: child ? child.pid : null,
      childStartedAt,
      restarts,
      lastExit,
      uptime: process.uptime()
    };
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  });

  server.on("error", (error) => {
    log(`Health server failed: ${error.message}`);
    process.exit(1);
  });

  server.listen(healthPort, "127.0.0.1", () => {
    log(`Health server listening: http://127.0.0.1:${healthPort}/health`);
  });
}

process.on("SIGINT", () => { stopAgent(); process.exit(0); });
process.on("SIGTERM", () => { stopAgent(); process.exit(0); });
process.on("uncaughtException", (error) => log(`uncaughtException: ${error.stack || error.message}`));
process.on("unhandledRejection", (error) => log(`unhandledRejection: ${error && (error.stack || error.message) || error}`));

log("AIDR Agent Service starting");
startHealthServer();
startAgent();

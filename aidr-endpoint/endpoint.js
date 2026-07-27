const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const moduleApi = require("module");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PRODUCT = "AIDR Endpoint";
const VERSION = "2.4.0-20260726.1030";
const TASK_NAME = "AIDR Endpoint";
const SERVICE_NAME = "AIDR Endpoint";
const RUN_VALUE = "AIDR Endpoint";
const INSTALL_DIR = process.env.AIDR_ENDPOINT_HOME || path.join(os.homedir(), "AppData", "Local", "AIDREndpoint");
const AGENT_DIR = path.join(INSTALL_DIR, "aidr-agent");
const AGENT_MANIFEST_FILE = path.join(INSTALL_DIR, "agent-manifest.json");
const LOG_DIR = path.join(INSTALL_DIR, "logs");
const ENDPOINT_BINARY = `AIDR.Endpoint-${VERSION}.exe`;
const ENDPOINT_EXE = path.join(INSTALL_DIR, ENDPOINT_BINARY);
const SERVICE_HOST_BINARY = "AIDR.ServiceHost.exe";
const SERVICE_HOST_EXE = path.join(INSTALL_DIR, SERVICE_HOST_BINARY);
const RUNNER_CMD = path.join(INSTALL_DIR, "run-endpoint.cmd");
const TOKEN_FILE = path.join(INSTALL_DIR, ".local-token");
const CODEX_HOOKS_FILE = path.join(process.env.AIDR_CODEX_HOME || os.homedir(), ".codex", "hooks.json");
const OPENCODE_PLUGIN_FILE = path.join(process.env.AIDR_OPENCODE_HOME || path.join(os.homedir(), ".config", "opencode"), "plugins", "aidr-endpoint.js");
const HEALTH_PORT = Number(process.env.AIDR_ENDPOINT_HEALTH_PORT || 8790);
const UI_PORT = Number(process.env.AIDR_ENDPOINT_UI_PORT || 8791);
// 8787 is reserved by the legacy AIDR Guardian on existing installations.
const AGENT_PORT = Number(process.env.AIDR_AGENT_PORT || 8788);
const UI_TOKEN = crypto.randomBytes(24).toString("hex");
const BUILD_INFO = globalThis.__AIDR_BUILD_INFO__ || {
  gitCommit: "development",
  gitDirty: true,
  builtAt: null,
  uiRevision: "filesystem"
};
let activeAgentPort = AGENT_PORT;

let child = null;
let childStartedAt = null;
let restarts = 0;
let lastExit = null;
let stopping = false;
let restartTimer = null;
let consecutiveShortExits = 0;
let restartCircuitOpenUntil = 0;
let localToken = "";
let agentApiReady = false;
let agentApiReadyAt = null;
let agentPayloadVerification = { valid: false, status: "not_checked", checkedAt: null, files: 0 };
const agentGetInFlight = new Map();
const agentGetCache = new Map();
const AGENT_GET_CACHE_TTL_MS = 10000;
const AGENT_GET_STALE_MS = 5 * 60 * 1000;

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function waitSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function copyFileWithRetry(source, target, attempts = 24, delayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.copyFileSync(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === attempts) throw error;
      waitSync(delayMs);
    }
  }
  throw lastError || new Error(`copy_failed: ${source}`);
}

const MAX_ENDPOINT_LOG_BYTES = 10 * 1024 * 1024;
const MAX_AGENT_LOG_BYTES = 20 * 1024 * 1024;

function rotateLogFile(logPath, maxBytes) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxBytes) return;
    const rotated = logPath + ".1";
    try { fs.rmSync(rotated, { force: true }); } catch (_) {}
    fs.renameSync(logPath, rotated);
  } catch (_) {}
}

function log(message) {
  ensureDir(LOG_DIR);
  const logPath = path.join(LOG_DIR, 'endpoint.log');
  rotateLogFile(logPath, MAX_ENDPOINT_LOG_BYTES);
  const line = '[' + new Date().toISOString() + '] ' + message + os.EOL;
  fs.appendFileSync(logPath, line, 'utf8');
  if (process.argv[2] !== 'hook') console.log(line.trim());
}

function run(command, args, options = {}) {
  return childProcess.spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options
  });
}

function findNode() {
  const candidates = [
    process.env.AIDR_NODE,
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe"
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  try {
    const output = childProcess.execFileSync("where.exe", ["node.exe"], { encoding: "utf8", windowsHide: true });
    const first = output.split(/\\r?\\n/).map(value => value.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch (_) {}
  return null;
}

function sourceAgentDir() {
  if (process.env.AIDR_SOURCE_AGENT) return process.env.AIDR_SOURCE_AGENT;
  const candidates = [
    path.resolve(path.dirname(process.execPath), "aidr-agent"),
    path.resolve(process.cwd(), "aidr-agent"),
    path.resolve(process.cwd(), "..", "aidr-agent"),
    path.resolve(__dirname, "..", "aidr-agent")
  ];
  return candidates.find(candidate => fs.existsSync(path.join(candidate, "src", "agent.js"))) || candidates[candidates.length - 1];
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Source agent directory not found: ${src}`);
  ensureDir(dest);
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: source => {
      const rel = path.relative(src, source).replace(/\\/g, "/");
      return !rel || (!rel.startsWith("logs/") && rel !== "logs" && !rel.startsWith(".git/") && rel !== ".git");
    }
  });
}

function listeningPortOwner(port) {
  if (process.platform !== "win32") return null;
  try {
    const script = [
      `$connection=Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -First 1`,
      `if($connection){$process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$connection.OwningProcess) -ErrorAction SilentlyContinue`,
      `[pscustomobject]@{pid=$connection.OwningProcess;name=$process.Name;path=$process.ExecutablePath}|ConvertTo-Json -Compress}`
    ].join(";");
    const result = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 5000
    });
    const raw = String(result.stdout || "").trim();
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function selectAgentPort() {
  const reserved = new Set([HEALTH_PORT, UI_PORT]);
  for (let candidate = AGENT_PORT; candidate < AGENT_PORT + 12; candidate += 1) {
    if (reserved.has(candidate)) continue;
    const owner = listeningPortOwner(candidate);
    if (!owner) {
      activeAgentPort = candidate;
      return candidate;
    }
    log(`Agent port ${candidate} occupied by pid=${owner.pid || "unknown"} process=${owner.name || "unknown"}; trying next port`);
  }
  throw new Error(`No available Agent API port in range ${AGENT_PORT}-${AGENT_PORT + 11}`);
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function hashFile(filePath) {
  return hashBytes(fs.readFileSync(filePath));
}

function writeAgentManifest(files, source = "embedded") {
  const manifest = {
    format: 1,
    product: PRODUCT,
    version: VERSION,
    build: BUILD_INFO,
    source,
    createdAt: new Date().toISOString(),
    required: ["src/agent.js", "src/utils/config.js", "src/utils/apiServer.js"],
    files: files.map(item => ({ path: item[0], size: item[1], sha256: item[2] }))
  };
  ensureDir(path.dirname(AGENT_MANIFEST_FILE));
  fs.writeFileSync(AGENT_MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function buildDirectoryManifest() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relativeName = path.relative(AGENT_DIR, full).replace(/\\/g, "/");
      if (/^(?:logs|\.git)(?:\/|$)/.test(relativeName)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        files.push([relativeName, bytes.length, hashBytes(bytes)]);
      }
    }
  }
  if (fs.existsSync(AGENT_DIR)) walk(AGENT_DIR);
  return writeAgentManifest(files, "directory");
}

function verifyAgentPayload() {
  const checkedAt = new Date().toISOString();
  try {
    if (!fs.existsSync(AGENT_MANIFEST_FILE)) {
      agentPayloadVerification = { valid: false, status: "manifest_missing", checkedAt, files: 0 };
      return agentPayloadVerification;
    }
    const manifest = JSON.parse(fs.readFileSync(AGENT_MANIFEST_FILE, "utf8"));
    if (!manifest || manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error("invalid_agent_manifest");
    const missing = [];
    const mismatched = [];
    for (const required of manifest.required || []) {
      if (!fs.existsSync(path.join(AGENT_DIR, required))) missing.push(required);
    }
    for (const item of manifest.files) {
      const target = path.resolve(AGENT_DIR, item.path);
      const prefix = path.resolve(AGENT_DIR) + path.sep;
      if (!target.startsWith(prefix)) { mismatched.push(`${item.path}:unsafe_path`); continue; }
      if (!fs.existsSync(target)) { missing.push(item.path); continue; }
      const stat = fs.statSync(target);
      const digest = hashFile(target);
      if (Number(item.size) !== stat.size || String(item.sha256) !== digest) mismatched.push(item.path);
    }
    agentPayloadVerification = {
      valid: missing.length === 0 && mismatched.length === 0,
      status: missing.length || mismatched.length ? "mismatch" : "verified",
      checkedAt,
      files: manifest.files.length,
      missing: missing.slice(0, 20),
      mismatched: mismatched.slice(0, 20),
      manifestVersion: manifest.version || null
    };
  } catch (error) {
    agentPayloadVerification = { valid: false, status: "verification_error", checkedAt, files: 0, error: error.message };
  }
  return agentPayloadVerification;
}

function installAgentPayload() {
  const encoded = globalThis.__AIDR_AGENT_PAYLOAD;
  if (!encoded) {
    copyDir(sourceAgentDir(), AGENT_DIR);
    const manifest = buildDirectoryManifest();
    agentPayloadVerification = verifyAgentPayload();
    return manifest;
  }

  const payload = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
  if (!Array.isArray(payload.files)) throw new Error("Invalid embedded Agent payload");
  ensureDir(AGENT_DIR);
  for (const [relativeName, base64, expectedHash] of payload.files) {
    const target = path.resolve(AGENT_DIR, relativeName);
    const prefix = path.resolve(AGENT_DIR) + path.sep;
    if (!target.startsWith(prefix)) throw new Error(`Unsafe Agent payload path: ${relativeName}`);
    ensureDir(path.dirname(target));
    const bytes = Buffer.from(base64, "base64");
    if (expectedHash && hashBytes(bytes) !== expectedHash) throw new Error(`Agent payload hash mismatch: ${relativeName}`);
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, bytes);
    if (fs.statSync(temp).size !== bytes.length) throw new Error(`Agent payload write failed: ${relativeName}`);
    fs.renameSync(temp, target);
  }
  const manifest = writeAgentManifest(payload.files.map(([relativeName, base64, expectedHash]) => {
    const bytes = Buffer.from(base64, "base64");
    return [relativeName, bytes.length, expectedHash || hashBytes(bytes)];
  }));
  agentPayloadVerification = verifyAgentPayload();
  if (!agentPayloadVerification.valid) throw new Error(`Agent payload verification failed: ${agentPayloadVerification.status}`);
  return manifest;
}

function writeRunner() {
  fs.writeFileSync(RUNNER_CMD, `@echo off\\r\\ncd /d "${INSTALL_DIR}"\\r\\nstart "" /min "${ENDPOINT_EXE}" service\\r\\n`, "utf8");
}

function loadOrCreateToken() {
  ensureDir(INSTALL_DIR);
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (token.length >= 32) return token;
    }
  } catch (_) {}
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token, { encoding: "utf8", mode: 0o600 });
  return token;
}

function installOpenCodePlugin() {
  const sourcePlugin = path.join(AGENT_DIR, "src", "adapters", "opencodePlugin.mjs");
  if (!fs.existsSync(sourcePlugin)) throw new Error(`OpenCode adapter payload missing: ${sourcePlugin}`);
  ensureDir(path.dirname(OPENCODE_PLUGIN_FILE));
  fs.copyFileSync(sourcePlugin, OPENCODE_PLUGIN_FILE);
}

function uninstallOpenCodePlugin() {
  try { if (fs.existsSync(OPENCODE_PLUGIN_FILE)) fs.unlinkSync(OPENCODE_PLUGIN_FILE); } catch (_) {}
}

function openCodeHooksStatus() {
  return { status: fs.existsSync(OPENCODE_PLUGIN_FILE) ? "active" : "not_installed", path: OPENCODE_PLUGIN_FILE, protocol: "opencode-plugin-v1" };
}

function installCodexHooks() {
  ensureDir(path.dirname(CODEX_HOOKS_FILE));
  let config = { hooks: {} };
  try {
    if (fs.existsSync(CODEX_HOOKS_FILE)) config = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, "utf8"));
  } catch (error) {
    const backup = CODEX_HOOKS_FILE + ".invalid." + Date.now();
    fs.copyFileSync(CODEX_HOOKS_FILE, backup);
    config = { hooks: {} };
  }
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  removeAidrHookEntries(config);

  const command = `"${ENDPOINT_EXE}" hook`;
  const add = (event, matcher, statusMessage) => {
    if (!Array.isArray(config.hooks[event])) config.hooks[event] = [];
    const group = {
      hooks: [{ type: "command", command, commandWindows: command, timeout: 30, statusMessage }]
    };
    if (matcher) group.matcher = matcher;
    config.hooks[event].push(group);
  };
  add("SessionStart", "startup|resume|clear|compact", "AIDR session protection");
  add("UserPromptSubmit", null, "AIDR intent analysis");
  add("PreToolUse", ".*", "AIDR policy check");
  add("PermissionRequest", ".*", "AIDR approval check");
  add("PostToolUse", ".*", "AIDR response inspection");
  add("Stop", null, "AIDR session close");
  fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(config, null, 2), "utf8");
}

function uninstallCodexHooks() {
  try {
    if (!fs.existsSync(CODEX_HOOKS_FILE)) return;
    const config = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, "utf8"));
    removeAidrHookEntries(config);
    fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (_) {}
}

function removeAidrHookEntries(config) {
  if (!config?.hooks) return;
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) continue;
    config.hooks[event] = groups.filter(group => !(group.hooks || []).some(handler => {
      const command = String(handler.commandWindows || handler.command || "");
      return /AIDR\.Endpoint(?:-[\w.-]+)?\.exe/i.test(command) && /["']?\s*hook(?:\s|$)/i.test(command);
    }));
    if (config.hooks[event].length === 0) delete config.hooks[event];
  }
}

function codexHooksStatus() {
  try {
    const raw = fs.readFileSync(CODEX_HOOKS_FILE, "utf8");
    return { status: /AIDR\.Endpoint(?:-[\w.-]+)?\.exe/i.test(raw) && /["']?\s*hook/i.test(raw) ? "active" : "not_installed", path: CODEX_HOOKS_FILE };
  } catch (_) {
    return { status: "not_installed", path: CODEX_HOOKS_FILE };
  }
}

function install() {
  ensureDir(INSTALL_DIR);
  ensureDir(LOG_DIR);
  localToken = loadOrCreateToken();
  requestEndpointShutdownSync();
  cleanupLegacyAgentService();
  stopNativeService();
  migrateLegacyPolicy();
  if (path.resolve(process.execPath).toLowerCase() !== path.resolve(ENDPOINT_EXE).toLowerCase()) copyFileWithRetry(process.execPath, ENDPOINT_EXE);
  installAgentPayload();
  if (!agentPayloadVerification.valid) throw new Error(`Agent payload verification failed: ${agentPayloadVerification.status}`);
  installOpenCodePlugin();
  installServiceHost();
  installCodexHooks();

  run("schtasks.exe", ["/End", "/TN", TASK_NAME], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"], { stdio: "ignore" });
  installNativeService();

  run("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", RUN_VALUE, "/f"], { stdio: "ignore" });
  startNativeService();
  cleanupStaleEndpointBinaries();
  console.log(`${PRODUCT} ${VERSION} installed to ${INSTALL_DIR}`);
  console.log(`UI: http://127.0.0.1:${UI_PORT}`);
  console.log(`Codex hooks: ${CODEX_HOOKS_FILE}`);
  console.log(`OpenCode plugin: ${OPENCODE_PLUGIN_FILE}`);
}

function installServiceHost() {
  const encoded = globalThis.__AIDR_SERVICE_HOST_PAYLOAD;
  const localHost = path.join(__dirname, "native", SERVICE_HOST_BINARY);
  if (encoded) {
    fs.writeFileSync(SERVICE_HOST_EXE, Buffer.from(encoded, "base64"));
  } else if (fs.existsSync(localHost) && path.resolve(localHost).toLowerCase() !== path.resolve(SERVICE_HOST_EXE).toLowerCase()) {
    copyFileWithRetry(localHost, SERVICE_HOST_EXE);
  }
  if (!fs.existsSync(SERVICE_HOST_EXE)) throw new Error("Native AIDR Service Host payload is missing.");
}

function installNativeService() {
  run("sc.exe", ["stop", SERVICE_NAME], { stdio: "ignore" });
  run("sc.exe", ["delete", SERVICE_NAME], { stdio: "ignore" });
  const create = run("sc.exe", [
    "create", SERVICE_NAME,
    "binPath=", `"${SERVICE_HOST_EXE}" "${ENDPOINT_EXE}" service "${os.homedir()}"`,
    "start=", "auto", "obj=", "LocalSystem", "DisplayName=", PRODUCT
  ]);
  if (create.status !== 0) throw new Error("Failed to create native Windows Service. Run the installer as Administrator.");
  run("sc.exe", ["description", SERVICE_NAME, "AIDR zero-trust endpoint protection service"]);
  run("sc.exe", ["failure", SERVICE_NAME, "reset=", "86400", "actions=", "restart/60000/restart/60000/restart/60000"]);
}

function startNativeService() {
  const result = run("sc.exe", ["start", SERVICE_NAME], { stdio: "ignore" });
  if (result.status !== 0) log("Native service start returned a non-zero status; inspect sc.exe query for details.");
}

function stopNativeService() {
  run("sc.exe", ["stop", SERVICE_NAME], { stdio: "ignore" });
  run("sc.exe", ["delete", SERVICE_NAME], { stdio: "ignore" });
}

function migrateLegacyPolicy() {
  const legacyPath = path.join(AGENT_DIR, "config", "policy.json");
  const dataPath = path.join(INSTALL_DIR, "data", "policy.json");
  try {
    if (!fs.existsSync(dataPath) && fs.existsSync(legacyPath)) {
      ensureDir(path.dirname(dataPath));
      fs.copyFileSync(legacyPath, dataPath);
    }
  } catch (error) {
    log(`Policy migration skipped: ${error.message}`);
  }
}

function cleanupStaleEndpointBinaries() {
  try {
    for (const name of fs.readdirSync(INSTALL_DIR)) {
      if (!/^AIDR\.Endpoint(?:-[\d.]+)?\.exe$/i.test(name) || name.toLowerCase() === ENDPOINT_BINARY.toLowerCase()) continue;
      try { fs.unlinkSync(path.join(INSTALL_DIR, name)); } catch (_) {}
    }
  } catch (_) {}
}

function cleanupLegacyAgentService() {
  run("schtasks.exe", ["/End", "/TN", "AIDR Agent Service"], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", "AIDR Agent Service", "/F"], { stdio: "ignore" });
  run("sc.exe", ["stop", "AIDR Agent Service"], { stdio: "ignore" });
  run("sc.exe", ["delete", "AIDR Agent Service"], { stdio: "ignore" });
  run("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "AIDR Agent Service", "/f"], { stdio: "ignore" });
  run("taskkill.exe", ["/IM", "AIDR.Agent.Service.exe", "/F", "/T"], { stdio: "ignore" });
}

function uninstall() {
  uninstallCodexHooks();
  uninstallOpenCodePlugin();
  localToken = loadOrCreateToken();
  requestEndpointShutdownSync();
  stopNativeService();
  run("schtasks.exe", ["/End", "/TN", TASK_NAME], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"], { stdio: "ignore" });
  run("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", RUN_VALUE, "/f"], { stdio: "ignore" });
  const status = fetchJsonSync(`http://127.0.0.1:${HEALTH_PORT}/health`, 1500);
  if (status?.childPid) run("taskkill.exe", ["/PID", String(status.childPid), "/F", "/T"], { stdio: "ignore" });
  run("taskkill.exe", ["/IM", ENDPOINT_BINARY, "/F", "/T"], { stdio: "ignore" });
  console.log(`${PRODUCT} uninstalled. Data remains at ${INSTALL_DIR}`);
}

function startDetached(mode) {
  if (mode === "service" && nativeServiceStatus().installed) {
    startNativeService();
    return;
  }
  const exe = fs.existsSync(ENDPOINT_EXE) ? ENDPOINT_EXE : process.execPath;
  const childProc = childProcess.spawn(exe, [mode], {
    cwd: fs.existsSync(INSTALL_DIR) ? INSTALL_DIR : process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  childProc.unref();
}

function startAgent() {
  if (stopping || child) return;
  if (Date.now() < restartCircuitOpenUntil) {
    return scheduleRestart(Math.max(1000, restartCircuitOpenUntil - Date.now()));
  }
  const entry = path.join(AGENT_DIR, "src", "agent.js");
  if (!fs.existsSync(entry)) {
    log(`Agent entry not found: ${entry}`);
    return scheduleRestart(10000);
  }
  const seaRuntime = isSeaRuntime();
  const runtime = seaRuntime ? process.execPath : findNode();
  if (!runtime) {
    log("Node.js runtime not found");
    return scheduleRestart(10000);
  }
  localToken = localToken || loadOrCreateToken();
  selectAgentPort();
  ensureDir(LOG_DIR);
  const stdoutPath = path.join(LOG_DIR, "agent.stdout.log");
  const stderrPath = path.join(LOG_DIR, "agent.stderr.log");
  rotateLogFile(stdoutPath, MAX_AGENT_LOG_BYTES);
  rotateLogFile(stderrPath, MAX_AGENT_LOG_BYTES);
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  childStartedAt = new Date().toISOString();
  agentApiReady = false;
  agentApiReadyAt = null;
  child = childProcess.spawn(runtime, seaRuntime ? ["agent-worker"] : [entry], {
    cwd: AGENT_DIR,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
    env: { ...process.env, AIDR_ENDPOINT_HOME: INSTALL_DIR, AIDR_LOCAL_TOKEN: localToken, AIDR_AGENT_PORT: String(activeAgentPort) }
  });
  try { fs.closeSync(stdout); } catch (_) {}
  try { fs.closeSync(stderr); } catch (_) {}
  log(`Started user-mode Agent pid=${child.pid}`);
  child.on("exit", (code, signal) => {
    const lifetimeMs = childStartedAt ? Date.now() - Date.parse(childStartedAt) : 0;
    lastExit = { code, signal, time: new Date().toISOString() };
    child = null;
    agentApiReady = false;
    agentApiReadyAt = null;
    log(`User-mode Agent exited code=${code} signal=${signal}`);
    if (lifetimeMs >= 60000) consecutiveShortExits = 0;
    else consecutiveShortExits += 1;
    if (consecutiveShortExits >= 5) {
      restartCircuitOpenUntil = Date.now() + 5 * 60 * 1000;
      log(`User-mode Agent restart circuit opened for 300000ms after ${consecutiveShortExits} short exits`);
    }
    if (!stopping) scheduleRestart(Math.max(backoffMs(), restartCircuitOpenUntil - Date.now()));
  });
  child.on("error", error => {
    child = null;
    agentApiReady = false;
    agentApiReadyAt = null;
    log(`User-mode Agent start error: ${error.message}`);
    if (!stopping) scheduleRestart(backoffMs());
  });
}

function isSeaRuntime() {
  try { return require("node:sea").isSea(); } catch (_) { return false; }
}

async function runAgentWorker() {
  const entry = path.join(AGENT_DIR, "src", "agent.js");
  const { AIDRAgent } = moduleApi.createRequire(entry)(entry);
  await new AIDRAgent().start();
}

function runSelfTest() {
  const entry = path.join(AGENT_DIR, "src", "agent.js");
  const encoded = globalThis.__AIDR_AGENT_PAYLOAD;
  let payloadFiles = 0;
  if (encoded) {
    const payload = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
    payloadFiles = Array.isArray(payload.files) ? payload.files.length : 0;
  }
  const integrity = verifyAgentPayload();
  const agentRequire = moduleApi.createRequire(entry);
  const dependencies = ["sql.js", "uuid", "ws"].map(name => ({ name, path: agentRequire.resolve(name) }));
  console.log(JSON.stringify({ ok: integrity.valid, version: VERSION, embeddedPayload: !!encoded, payloadFiles, entry, dependencies, agentPayload: integrity }, null, 2));
}

function backoffMs() {
  restarts += 1;
  return Math.min(30000, 2000 + restarts * 1000);
}

function scheduleRestart(delay) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(startAgent, delay);
}

function stopAgent() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (child) try { child.kill("SIGTERM"); } catch (_) {}
}

function nativeServiceStatus() {
  try {
    const result = childProcess.spawnSync("sc.exe", ["query", SERVICE_NAME], {
      windowsHide: true, encoding: "utf8", timeout: 4000
    });
    const output = `${result.stdout || ""}\\n${result.stderr || ""}`;
    if (result.status !== 0 && !/SERVICE_NAME/i.test(output)) return { installed: false, status: "not_installed" };
    if (/does not exist|failed 1060/i.test(output)) return { installed: false, status: "not_installed" };
    if (/RUNNING/i.test(output)) return { installed: true, status: "running" };
    if (/STOPPED/i.test(output)) return { installed: true, status: "stopped" };
    return { installed: true, status: "installed" };
  } catch (error) {
    return { installed: false, status: "unknown", detail: error.message };
  }
}

function serviceStatus() {
  const nativeService = nativeServiceStatus();
  return {
    product: PRODUCT,
    version: VERSION,
    build: BUILD_INFO,
    mode: "edge-control-plane",
    installDir: INSTALL_DIR,
    childPid: child?.pid || null,
    childStartedAt,
    restarts,
    lastExit,
    uptime: process.uptime(),
    components: {
      windowsService: { status: nativeService.status, serviceName: SERVICE_NAME, detail: "Native SCM service with automatic restart and a supervised Endpoint process" },
      kernelDriver: { status: "not_installed", detail: "Signed Minifilter/WFP driver is reserved for the kernel enforcement phase" },
      userModeAgent: {
        status: child ? "running" : Date.now() < restartCircuitOpenUntil ? "circuit_open" : "stopped",
        pid: child?.pid || null,
        startedAt: childStartedAt,
        lastExit,
        consecutiveShortExits,
        restartCircuitOpenUntil: restartCircuitOpenUntil ? new Date(restartCircuitOpenUntil).toISOString() : null
      },
      agentPayload: agentPayloadVerification,
      agentApi: {
        status: child ? agentApiReady ? "ready" : "starting" : "unavailable",
        port: activeAgentPort,
        configuredPort: AGENT_PORT,
        readyAt: agentApiReadyAt,
        authentication: "local-token"
      },
      codexHooks: codexHooksStatus(),
      openCodeHooks: openCodeHooksStatus(),
      localControlPlane: { status: "running", url: `http://127.0.0.1:${UI_PORT}` }
    }
  };
}

function startService() {
  const existing = fetchJsonSync(`http://127.0.0.1:${HEALTH_PORT}/health`, 1200);
  if (existing?.ok) {
    log(`Service already running pid=${existing.pid || "unknown"}`);
    return;
  }
  if (!verifyAgentPayload().valid) {
    log(`Agent payload integrity check failed; refusing to start user-mode Agent (${agentPayloadVerification.status})`);
    return;
  }
  localToken = loadOrCreateToken();
  log(`${PRODUCT} ${VERSION} service mode starting`);
  startHealthServer(() => {
    startUiServer();
    startAgent();
  });
}

function startHealthServer(onListening) {
  const server = http.createServer((req, res) => {
    if ((req.url === "/health" || req.url === "/status") && req.method === "GET") {
      return sendJson(res, 200, { ok: true, pid: process.pid, ...serviceStatus() });
    }
    if (req.url === "/shutdown" && req.method === "POST") {
      if (req.headers["x-aidr-token"] !== localToken) return sendJson(res, 401, { error: "unauthorized" });
      sendJson(res, 202, { ok: true });
      return setTimeout(() => { stopAgent(); process.exit(0); }, 150);
    }
    return sendJson(res, 404, { error: "not_found" });
  });
  server.on("error", error => {
    log(`Health server unavailable: ${error.message}`);
    stopAgent();
    process.exit(error.code === "EADDRINUSE" ? 0 : 1);
  });
  server.listen(HEALTH_PORT, "127.0.0.1", () => {
    log(`Health listening on ${HEALTH_PORT}`);
    onListening();
  });
}

function startUiServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${UI_PORT}`);
    setUiHeaders(res);
    if (url.pathname === "/" || url.pathname === "/index.html") return sendHtml(res, renderUi());
    if (url.pathname === "/local-status") return sendHtml(res, renderLocalStatus());
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    const upstreamPathname = url.pathname.replace(/^\/v1(?=\/|$)/, "/api");
    if (!upstreamPathname.startsWith("/api/")) return sendJson(res, 404, { error: "not_found" });
    if (isMutation(req.method) && req.headers["x-aidr-ui-token"] !== UI_TOKEN) return sendJson(res, 403, { error: "invalid_ui_token" });

    try {
      if (upstreamPathname === "/api/status" && req.method === "GET") {
        try {
          const agent = await agentRequestWithRetry("GET", "/api/status", undefined, 5000);
          return sendJson(res, 200, { endpoint: serviceStatus(), agent });
        } catch (error) {
          return sendJson(res, 200, {
            endpoint: serviceStatus(),
            agent: null,
            degraded: true,
            agentError: error.message || "agent_unavailable"
          });
        }
      }
      if (upstreamPathname === "/api/restart-agent" && req.method === "POST") {
        consecutiveShortExits = 0;
        restartCircuitOpenUntil = 0;
        restarts = 0;
        if (child) try { child.kill("SIGTERM"); } catch (_) {}
        else startAgent();
        return sendJson(res, 200, { ok: true });
      }

      const proxyRoutes = [
        "/api/events", "/api/events/stats", "/api/events/validate", "/api/decision/validate", "/api/sessions", "/api/sensors", "/api/rules", "/api/policy",
        "/api/policy/history", "/api/policy/verify", "/api/policy/rollback", "/api/enforce",
        "/api/enforcement/status", "/api/agents", "/api/adapters", "/api/adapters/events", "/api/approvals", "/api/policy/resolution", "/api/hooks/agent", "/api/intent/analyze", "/api/ui/contract", "/api/audit/status", "/api/audit/verify", "/api/audit/export", "/api/semantic/config", "/api/semantic/providers", "/api/semantic/feedback", "/api/semantic/feedback/stats", "/api/semantic/key", "/api/semantic/test", "/api/semantic/local-config", "/api/semantic/runtime", "/api/policy/templates", "/api/policy/simulate", "/api/policy/validate", "/api/threat/test", "/api/behavior-atoms", "/api/behavior-atoms/stats", "/api/orbits", "/api/diagnostics/performance"
      ];
      const isSessionRoute = /^\/api\/sessions\/[^/]+(?:\/graph|\/policy)?$/.test(upstreamPathname);
      const isRuleRoute = /^\/api\/rules\/[^/]+$/.test(upstreamPathname);
      const isBehaviorAtomRoute = /^\/api\/behavior-atoms\/[^/]+$/.test(upstreamPathname);
      const isAgentBehaviorOrbitRoute = /^\/api\/agents\/[^/]+\/behavior-orbit$/.test(upstreamPathname);
      const isSessionOrbitRoute = /^\/api\/sessions\/[^/]+\/orbit$/.test(upstreamPathname);
      if (proxyRoutes.includes(upstreamPathname) || isSessionRoute || isRuleRoute || isBehaviorAtomRoute || isAgentBehaviorOrbitRoute || isSessionOrbitRoute) {
        const body = isMutation(req.method) ? await readBody(req) : undefined;
        const result = await agentRequestWithRetry(req.method, upstreamPathname + url.search, body, req.method === 'GET' ? 30000 : 5000);
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      return sendJson(res, error.status || 503, { error: error.message || "agent_unavailable" });
    }
  });
  server.listen(UI_PORT, "127.0.0.1", () => log(`Control plane listening on ${UI_PORT}`));
}

function isMutation(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function agentRequest(method, requestPath, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port: activeAgentPort,
      path: requestPath,
      method,
      timeout: timeoutMs,
      headers: {
        "X-AIDR-Token": localToken || loadOrCreateToken(),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {})
      }
    }, response => {
      let raw = "";
      response.on("data", chunk => raw += chunk);
      response.on("end", () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          if (response.statusCode >= 400) {
            const error = new Error(parsed.error || `agent_http_${response.statusCode}`);
            error.status = response.statusCode;
            return reject(error);
          }
          if (!agentApiReady) {
            agentApiReady = true;
            agentApiReadyAt = new Date().toISOString();
          }
          resolve(parsed);
        } catch (_) { reject(new Error("invalid_agent_response")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("agent_timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function agentRequestWithRetry(method, requestPath, body, timeoutMs = 5000) {
  const coalesceKey = method === "GET" ? `${method}:${requestPath}` : null;
  if (coalesceKey) {
    const cached = agentGetCache.get(coalesceKey);
    if (cached && Date.now() - cached.updatedAt <= AGENT_GET_CACHE_TTL_MS) return cached.value;
  }
  if (coalesceKey && agentGetInFlight.has(coalesceKey)) return agentGetInFlight.get(coalesceKey);
  const request = (async () => {
    const attempts = method === "GET" ? 2 : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await agentRequest(method, requestPath, body, timeoutMs);
        if (coalesceKey) {
          agentGetCache.set(coalesceKey, { updatedAt: Date.now(), value: result });
        } else {
          // A successful mutation may change policy, atom state, sessions, or
          // derived Orbit data. Never serve a pre-mutation GET snapshot.
          agentGetCache.clear();
        }
        return result;
      } catch (error) {
        lastError = error;
        if (attempt === attempts || (error.status && error.status !== 503)) throw error;
        await new Promise(resolve => setTimeout(resolve, 350 * attempt));
      }
    }
    if (coalesceKey) {
      const cached = agentGetCache.get(coalesceKey);
      if (cached && Date.now() - cached.updatedAt <= AGENT_GET_STALE_MS) return cached.value;
    }
    throw lastError || new Error("agent_unavailable");
  })();
  if (coalesceKey) {
    agentGetInFlight.set(coalesceKey, request);
    request.finally(() => agentGetInFlight.delete(coalesceKey)).catch(() => {});
  }
  return request;
}

async function handleHookCommand() {
  try {
    localToken = loadOrCreateToken();
    const input = JSON.parse(await readStdin());
    const result = await agentRequest("POST", "/api/hooks/codex", input, 9000);
    process.stdout.write(JSON.stringify(result.output || {}));
  } catch (_) {
    process.stdout.write("{}");
  }
}

function readStdin(maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) reject(new Error("stdin_too_large"));
    });
    process.stdin.on("end", () => resolve(data || "{}"));
    process.stdin.on("error", reject);
  });
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) reject(new Error("request_too_large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function fetchJsonSync(url, timeoutMs) {
  try {
    const script = `(Invoke-WebRequest -UseBasicParsing ${url} -TimeoutSec ${Math.max(1, Math.ceil(timeoutMs / 1000))}).Content`;
    const raw = childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: timeoutMs + 1000 });
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function requestEndpointShutdownSync() {
  try {
    const escapedToken = localToken.replace(/'/g, "''");
    const script = `Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:${HEALTH_PORT}/shutdown -Headers @{'X-AIDR-Token'='${escapedToken}'} -TimeoutSec 2 | Out-Null`;
    childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 3000, stdio: "ignore" });
  } catch (_) {}
}

function setUiHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  res.setHeader("Referrer-Policy", "no-referrer");
  // The desktop app may render the local console in an embedded browser view.
  // Keep framing limited to loopback origins so this does not become a LAN-facing UI.
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res, body) {
  body = body.replace('</head>', `<style id="aidr-policy-border-normalization">body.aidr-unified-page #view-policy.active{display:block!important;max-width:1640px!important;margin:0 auto!important;padding:20px 26px 40px!important}body.aidr-unified-page #view-policy .policy-summary-grid{margin-bottom:12px!important}body.aidr-unified-page #view-policy>.panel{margin:0 0 12px!important;background:#fff!important;border:1px solid #dfe3e8!important;border-radius:7px!important;box-shadow:none!important;overflow:hidden}body.aidr-unified-page #view-policy>.panel:last-child{margin-bottom:0!important}body.aidr-unified-page #view-policy>.panel[style*="margin-top"]{margin-top:0!important}body.aidr-unified-page #view-policy>.panel[style*="margin-bottom"]{margin-bottom:12px!important}body.aidr-unified-page #view-policy>.panel>.panel-head{padding:13px 15px!important;border-bottom:1px solid #e7eaee!important}body.aidr-unified-page #view-policy>.panel>.panel-body{padding:15px!important}</style></head>`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function renderUi() {
  const canonicalUiPath = path.join(__dirname, "ui", "index.html");
  const canonicalAbgcPath = path.join(__dirname, "ui", "abgc.js");
  const canonicalRuntimePath = path.join(__dirname, "ui", "runtime-adapter.js");
  let canonicalUi = globalThis.__AIDR_UI_HTML__ || null;
  if (!canonicalUi && fs.existsSync(canonicalUiPath)) {
    canonicalUi = fs.readFileSync(canonicalUiPath, "utf8");
    if (fs.existsSync(canonicalRuntimePath) && fs.existsSync(canonicalAbgcPath)) {
      const abgcRuntime = fs.readFileSync(canonicalAbgcPath, "utf8");
      const runtime = fs.readFileSync(canonicalRuntimePath, "utf8");
      const upsertInlineScript = (html, id, source) => {
        const expression = new RegExp(`<script\\s+id=["']${id}["'][^>]*>[\\s\\S]*?<\\/script>`, "i");
        const script = `<script id="${id}">${source}</script>`;
        return expression.test(html)
          ? html.replace(expression, () => script)
          : html.replace("</body>", `${script}</body>`);
      };
      canonicalUi = upsertInlineScript(canonicalUi, "aidr-abgc-runtime", abgcRuntime);
      canonicalUi = upsertInlineScript(canonicalUi, "aidr-runtime-adapter", runtime);
    }
  }
  if (canonicalUi) {
    const buildMeta = `<meta name="aidr-build-commit" content="${String(BUILD_INFO.gitCommit || "unknown")}"><meta name="aidr-build-time" content="${String(BUILD_INFO.builtAt || "")}"><meta name="aidr-ui-revision" content="${String(BUILD_INFO.uiRevision || "unknown")}">`;
    return canonicalUi
      .replace("</head>", `${buildMeta}</head>`)
      .replace(/(<meta\s+name=["']aidr-ui-token["']\s+content=["'])[^"']*(["']\s*\/?>)/i, `$1${UI_TOKEN}$2`)
      .replace(/__AIDR_UI_TOKEN__/g, UI_TOKEN)
      .replace(/__AIDR_UI_REVISION__/g, VERSION);
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AIDR UI unavailable</title></head>
  <body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:32px;color:#18212f">
  <h1>AIDR ????????</h1><p>????? UI ??????????? AIDR Endpoint?</p>
  <p>Endpoint version: ${VERSION}</p></body></html>`;
}

function renderLocalStatus() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AIDR Endpoint 本地状态</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6f8;color:#172235;font:14px "Segoe UI","Microsoft YaHei",sans-serif}
  main{max-width:860px;margin:0 auto;padding:32px 22px}.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
  h1{font-size:22px;margin:0}.badge{padding:5px 9px;border-radius:4px;background:#e4f5ef;color:#08745d;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.panel{background:#fff;border:1px solid #d9e2e8;border-radius:7px;padding:17px}
  .label{color:#66758a;font-size:12px;margin-bottom:7px}.value{font-size:17px;font-weight:700;overflow-wrap:anywhere}.wide{grid-column:1/-1}
  .error{color:#b42318}a{color:#08745d}@media(max-width:640px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style></head><body><main><div class="head"><h1>AIDR Endpoint 本地状态</h1><span id="health" class="badge">检查中</span></div>
  <div class="grid"><section class="panel"><div class="label">Endpoint 服务</div><div id="endpoint" class="value">-</div></section>
  <section class="panel"><div class="label">User-mode Agent</div><div id="agent" class="value">-</div></section>
  <section class="panel"><div class="label">中央连接</div><div id="transport" class="value">-</div></section>
  <section class="panel"><div class="label">版本</div><div class="value">${VERSION}</div></section>
  <section class="panel wide"><div class="label">诊断说明</div><div>此页面仅用于本机健康检查。跨 Windows/Linux 的资产、会话、策略和行为分析请使用统一服务端控制台。</div></section>
  </div><script>
  fetch("/api/status",{cache:"no-store"}).then(function(r){return r.json()}).then(function(s){
    var endpoint=s.endpoint||{},agent=s.agent||{},transport=(agent.transport||agent.runtime||{});
    document.getElementById("endpoint").textContent=endpoint.status||endpoint.state||"running";
    document.getElementById("agent").textContent=s.degraded?"unavailable":(agent.status||"running");
    document.getElementById("transport").textContent=transport.transportMode||transport.status||(agent.serverConfigured?"configured":"standalone");
    document.getElementById("health").textContent=s.degraded?"降级":"正常";
    if(s.degraded)document.getElementById("health").classList.add("error");
  }).catch(function(){document.getElementById("health").textContent="不可用";document.getElementById("health").classList.add("error")});
  </script></main></body></html>`;
}

function openUi() {
  if (!fetchJsonSync(`http://127.0.0.1:${HEALTH_PORT}/health`, 1200)?.ok) startDetached("service");
  console.log(`Open UI: http://127.0.0.1:${UI_PORT}`);
}

async function main() {
  const cmd = (process.argv[2] || "ui").toLowerCase();
  if (cmd === "agent-worker") return runAgentWorker();
  if (cmd === "self-test") return runSelfTest();
  if (cmd === "install") return install();
  if (cmd === "uninstall") return uninstall();
  if (cmd === "service") return startService();
  if (cmd === "hook") return handleHookCommand();
  if (cmd === "status") return console.log(JSON.stringify(fetchJsonSync(`http://127.0.0.1:${HEALTH_PORT}/health`, 1500) || { running: false }, null, 2));
  if (cmd === "ui" || cmd === "start") return openUi();
  console.log("Usage: AIDR.Endpoint.exe [install|uninstall|service|hook|ui|status]");
}

process.on("SIGINT", () => { stopAgent(); process.exit(0); });
process.on("SIGTERM", () => { stopAgent(); process.exit(0); });
process.on("uncaughtException", error => { if (process.argv[2] !== "hook") log(`uncaughtException: ${error.stack || error.message}`); });
process.on("unhandledRejection", error => { if (process.argv[2] !== "hook") log(`unhandledRejection: ${error?.stack || error?.message || error}`); });

function runMain() {
  main().catch(error => {
    if (process.argv[2] === "hook") process.stdout.write("{}");
    else {
      console.error(`[AIDR Endpoint] ERROR: ${error.stack || error.message}`);
      process.exitCode = 1;
    }
  });
}

if (isSeaRuntime() || require.main === module) runMain();
module.exports = { renderUi, installAgentPayload };

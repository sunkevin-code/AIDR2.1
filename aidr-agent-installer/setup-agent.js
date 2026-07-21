const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const sea = require("node:sea");

const taskName = "AIDR Agent Service";
const runValueName = "AIDR Agent Service";
const installDir = process.env.AIDR_AGENT_INSTALL_DIR || path.join(os.homedir(), "AppData", "Local", "AIDRAgentService");
const appRoot = sea.isSea() ? path.dirname(process.execPath) : __dirname;
const workspaceRoot = process.env.AIDR_WORKSPACE_ROOT || path.resolve(appRoot, "..", "..");
const sourceAgentDir = process.env.AIDR_SOURCE_AGENT || path.join(workspaceRoot, "aidr-agent");
const serviceExeName = "AIDR.Agent.Service.exe";
const serviceExe = path.join(installDir, serviceExeName);
const installedAgentDir = path.join(installDir, "aidr-agent");
const healthUrl = "http://127.0.0.1:8790/health";
const runnerCmd = path.join(installDir, "run-service.cmd");

function log(message) {
  console.log(`[AIDR Agent Setup] ${message}`);
}

function run(command, args, options = {}) {
  log(`${command} ${args.join(" ")}`);
  return childProcess.spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options
  });
}

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function xorPayload(buffer) {
  const out = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] ^ 0x5a;
  return out;
}

function getServicePayload() {
  if (sea.isSea()) {
    return xorPayload(Buffer.from(sea.getRawAsset("service.bin")));
  }
  return fs.readFileSync(path.join(__dirname, "dist", serviceExeName));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Source agent directory not found: ${src}`);
  ensureDir(dest);
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(src, source).replace(/\\/g, "/");
      if (!rel) return true;
      if (rel === "logs" || rel.startsWith("logs/")) return false;
      if (rel === ".git" || rel.startsWith(".git/")) return false;
      return true;
    }
  });
}

function install() {
  ensureDir(installDir);
  fs.writeFileSync(serviceExe, getServicePayload());
  copyDir(sourceAgentDir, installedAgentDir);
  ensureDir(path.join(installDir, "logs"));
  fs.writeFileSync(
    runnerCmd,
    `@echo off\r\ncd /d "${installDir}"\r\nstart "" /min "${serviceExe}"\r\n`,
    "utf8"
  );

  run("schtasks.exe", ["/End", "/TN", taskName], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { stdio: "ignore" });

  const create = run("schtasks.exe", [
    "/Create",
    "/TN", taskName,
    "/TR", `cmd.exe /c "${runnerCmd}"`,
    "/SC", "ONLOGON",
    "/RL", "LIMITED",
    "/F"
  ]);
  if (create.status !== 0) throw new Error("Failed to create scheduled task.");

  run("schtasks.exe", ["/Run", "/TN", taskName]);
  run("reg.exe", [
    "add",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v", runValueName,
    "/t", "REG_SZ",
    "/d", `"${runnerCmd}"`,
    "/f"
  ]);
  try {
    const child = childProcess.spawn(serviceExe, {
      cwd: installDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch (_) {}
  log(`Installed to: ${installDir}`);
  log("Health: http://127.0.0.1:8790/health");
  log("Agent API: http://127.0.0.1:8787/api/status");
}

function uninstall() {
  let childPid = null;
  try {
    const raw = childProcess.execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Invoke-WebRequest -UseBasicParsing ${healthUrl} -TimeoutSec 2).Content`
    ], { encoding: "utf8", windowsHide: true });
    childPid = JSON.parse(raw).childPid;
  } catch (_) {}

  run("schtasks.exe", ["/End", "/TN", taskName], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { stdio: "ignore" });
  run("reg.exe", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v", runValueName,
    "/f"
  ], { stdio: "ignore" });
  run("taskkill.exe", ["/IM", serviceExeName, "/F", "/T"], { stdio: "ignore" });
  if (childPid) run("taskkill.exe", ["/PID", String(childPid), "/F", "/T"], { stdio: "ignore" });
  log(`Uninstalled scheduled task. Files remain at: ${installDir}`);
}

function status() {
  run("schtasks.exe", ["/Query", "/TN", taskName, "/V", "/FO", "LIST"]);
}

try {
  const command = (process.argv[2] || "install").toLowerCase();
  if (command === "install") install();
  else if (command === "uninstall") uninstall();
  else if (command === "status") status();
  else {
    console.log("Usage: AIDR.Agent.Setup.exe [install|uninstall|status]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`[AIDR Agent Setup] ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
}

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const sea = require("node:sea");

const taskName = "AIDR Guardian Web Service";
const installDir = process.env.AIDR_INSTALL_DIR || path.join(os.homedir(), "AppData", "Local", "AIDRGuardian");
const exeName = "AIDR.Guardian.exe";
const policyName = "policy.json";
const guardianExe = path.join(installDir, exeName);
const policyPath = path.join(installDir, policyName);

function log(message) {
  console.log(`[AIDR Setup] ${message}`);
}

function run(command, args, options = {}) {
  log(`${command} ${args.join(" ")}`);
  return childProcess.spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options
  });
}

function getPayload(name, fallbackPath) {
  if (sea.isSea()) {
    return Buffer.from(sea.getRawAsset(name));
  }
  return fs.readFileSync(fallbackPath);
}

function xorPayload(buffer) {
  const output = Buffer.allocUnsafe(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    output[index] = buffer[index] ^ 0x5a;
  }
  return output;
}

function ensureDir(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function install() {
  ensureDir(installDir);
  const encodedGuardian = getPayload("guardian.bin", path.join(__dirname, "dist", "AIDR.Guardian.exe.xor"));
  fs.writeFileSync(guardianExe, xorPayload(encodedGuardian));
  fs.writeFileSync(policyPath, getPayload("policy.json", path.join(__dirname, "dist", policyName)));

  run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { stdio: "ignore" });
  const taskRun = `"${guardianExe}"`;
  const create = run("schtasks.exe", [
    "/Create",
    "/TN", taskName,
    "/TR", taskRun,
    "/SC", "ONLOGON",
    "/RL", "LIMITED",
    "/F"
  ]);
  if (create.status !== 0) {
    throw new Error("Failed to create scheduled task.");
  }

  run("schtasks.exe", ["/Run", "/TN", taskName]);
  log(`Installed to: ${installDir}`);
  log("Console: http://127.0.0.1:8787");
}

function uninstall() {
  run("schtasks.exe", ["/End", "/TN", taskName], { stdio: "ignore" });
  run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { stdio: "ignore" });
  run("taskkill.exe", ["/IM", exeName, "/F"], { stdio: "ignore" });
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
    console.log("Usage: AIDR.Guardian.Setup.exe [install|uninstall|status]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`[AIDR Setup] ERROR: ${error.message}`);
  process.exitCode = 1;
}

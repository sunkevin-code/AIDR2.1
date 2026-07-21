const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = __dirname;
const dist = path.join(root, "dist");
const setupSource = path.join(root, "setup-installer.js");
const blob = path.join(dist, "aidr-setup.blob");
const exe = path.join(dist, "AIDR.Guardian.Setup.exe");
const config = path.join(dist, "sea-setup-config.json");
const encodedGuardian = path.join(dist, "AIDR.Guardian.exe.xor");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    childProcess.execFileSync("cmd.exe", ["/c", command, ...args], { stdio: "inherit", ...options });
    return;
  }
  childProcess.execFileSync(command, args, { stdio: "inherit", ...options });
}

const guardian = path.join(dist, "AIDR.Guardian.exe");
const policy = path.join(dist, "policy.json");
if (!fs.existsSync(guardian)) throw new Error("dist/AIDR.Guardian.exe not found. Run npm.cmd run build:exe first.");
if (!fs.existsSync(policy)) throw new Error("dist/policy.json not found. Run npm.cmd run build:exe first.");

const original = fs.readFileSync(guardian);
const encoded = Buffer.allocUnsafe(original.length);
for (let index = 0; index < original.length; index += 1) {
  encoded[index] = original[index] ^ 0x5a;
}
fs.writeFileSync(encodedGuardian, encoded);

fs.writeFileSync(config, JSON.stringify({
  main: setupSource,
  output: blob,
  disableExperimentalSEAWarning: true,
  assets: {
    "guardian.bin": encodedGuardian,
    "policy.json": policy
  }
}, null, 2), "utf8");

run(process.execPath, ["--experimental-sea-config", config]);
fs.copyFileSync(process.execPath, exe);

const postjectBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
run(postjectBin, [
  exe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
]);

console.log(`Built installer: ${exe}`);

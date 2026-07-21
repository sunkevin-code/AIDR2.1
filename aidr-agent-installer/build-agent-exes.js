const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = __dirname;
const dist = path.join(root, "dist");
const postject = path.join(root, "..", "aidr-guardian-service", "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    childProcess.execFileSync("cmd.exe", ["/c", command, ...args], { stdio: "inherit" });
    return;
  }
  childProcess.execFileSync(command, args, { stdio: "inherit" });
}

function inject(main, blob, exe, config, assets) {
  try { if (fs.existsSync(exe)) fs.unlinkSync(exe); } catch (_) {}
  fs.writeFileSync(config, JSON.stringify({
    main,
    output: blob,
    disableExperimentalSEAWarning: true,
    assets: assets || {}
  }, null, 2), "utf8");
  run(process.execPath, ["--experimental-sea-config", config]);
  fs.copyFileSync(process.execPath, exe);
  run(postject, [
    exe,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
  ]);
}

function xorFile(src, dest) {
  const input = fs.readFileSync(src);
  const out = Buffer.allocUnsafe(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0x5a;
  fs.writeFileSync(dest, out);
}

fs.mkdirSync(dist, { recursive: true });
if (!fs.existsSync(postject)) {
  throw new Error(`postject not found: ${postject}. Build guardian service first or run npm install there.`);
}

const serviceExe = path.join(dist, "AIDR.Agent.Service.exe");
inject(
  path.join(root, "agent-watchdog.js"),
  path.join(dist, "agent-service.blob"),
  serviceExe,
  path.join(dist, "sea-agent-service.json"),
  {}
);

const encodedService = path.join(dist, "AIDR.Agent.Service.exe.xor");
xorFile(serviceExe, encodedService);

inject(
  path.join(root, "setup-agent.js"),
  path.join(dist, "agent-setup.blob"),
  path.join(dist, "AIDR.Agent.Setup.exe"),
  path.join(dist, "sea-agent-setup.json"),
  { "service.bin": encodedService }
);

console.log("Built:");
console.log(" - " + serviceExe);
console.log(" - " + path.join(dist, "AIDR.Agent.Setup.exe"));

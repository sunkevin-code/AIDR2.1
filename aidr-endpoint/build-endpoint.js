const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const zlib = require("zlib");

const root = __dirname;
const dist = path.join(root, "dist");
const agentRoot = path.join(root, "..", "aidr-agent");
const postject = path.join(root, "..", "aidr-guardian-service", "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    childProcess.execFileSync("cmd.exe", ["/c", command, ...args], { stdio: "inherit" });
    return;
  }
  childProcess.execFileSync(command, args, { stdio: "inherit" });
}

fs.mkdirSync(dist, { recursive: true });
const exe = path.join(dist, "AIDR.Endpoint.exe");
const buildExe = path.join(dist, `AIDR.Endpoint.build-${process.pid}-${Date.now()}.exe`);
const blob = path.join(dist, "endpoint.blob");
const config = path.join(dist, "sea-endpoint.json");
const bundle = path.join(dist, "endpoint.bundle.js");

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relativeName = path.relative(agentRoot, full).replace(/\\/g, "/");
    if (/^(?:logs|\.git)(?:\/|$)/.test(relativeName)) continue;
    if (entry.isDirectory()) collectFiles(full, files);
    else if (entry.isFile()) files.push([relativeName, fs.readFileSync(full).toString("base64")]);
  }
  return files;
}

const payload = zlib.gzipSync(Buffer.from(JSON.stringify({
  format: 1,
  files: collectFiles(agentRoot)
}), "utf8"), { level: 9 }).toString("base64");
const endpointSource = fs.readFileSync(path.join(root, "endpoint.js"), "utf8");
childProcess.execFileSync(process.execPath, [path.join(root, "build-service-host.js")], { stdio: "inherit" });
const serviceHostPath = path.join(root, "native", "AIDR.ServiceHost.exe");
const serviceHostPayload = fs.readFileSync(serviceHostPath).toString("base64");
fs.writeFileSync(bundle, `globalThis.__AIDR_AGENT_PAYLOAD=${JSON.stringify(payload)};\nglobalThis.__AIDR_SERVICE_HOST_PAYLOAD=${JSON.stringify(serviceHostPayload)};\n${endpointSource}`, "utf8");
fs.writeFileSync(config, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true
}, null, 2), "utf8");
run(process.execPath, ["--experimental-sea-config", config]);
fs.copyFileSync(process.execPath, buildExe);
run(postject, [
  buildExe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
]);
if (fs.existsSync(exe)) fs.unlinkSync(exe);
fs.renameSync(buildExe, exe);
console.log(`Built ${exe}`);

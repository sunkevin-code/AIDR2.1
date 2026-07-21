const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = __dirname;
const dist = path.join(root, "dist");
const source = path.join(root, "aidr-service.js");
const bundle = path.join(dist, "aidr-service.bundle.js");
const blob = path.join(dist, "aidr-service.blob");
const exe = path.join(dist, "AIDR.Guardian.exe");
const config = path.join(dist, "sea-config.json");

function escapeTemplate(content) {
  return content
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    childProcess.execFileSync("cmd.exe", ["/c", command, ...args], { stdio: "inherit", ...options });
    return;
  }
  childProcess.execFileSync(command, args, { stdio: "inherit", ...options });
}

fs.mkdirSync(dist, { recursive: true });

let code = fs.readFileSync(source, "utf8");
const assets = {
  "__AIDR_INDEX_HTML__": fs.readFileSync(path.join(root, "public", "index.html"), "utf8"),
  "__AIDR_APP_JS__": fs.readFileSync(path.join(root, "public", "app.js"), "utf8"),
  "__AIDR_STYLES_CSS__": fs.readFileSync(path.join(root, "public", "styles.css"), "utf8")
};

for (const [token, value] of Object.entries(assets)) {
  code = code.replace(token, escapeTemplate(value));
}
fs.writeFileSync(bundle, code, "utf8");

fs.writeFileSync(config, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true
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

fs.copyFileSync(path.join(root, "policy.json"), path.join(dist, "policy.json"));
console.log(`Built ${exe}`);

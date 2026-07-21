const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const source = path.join(root, "native", "AIDR.ServiceHost.cs");
const output = path.join(root, "native", "AIDR.ServiceHost.exe");
const candidates = [
  process.env.AIDR_CSC,
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
].filter(Boolean);
const compiler = candidates.find(candidate => fs.existsSync(candidate));
if (!compiler) throw new Error("Microsoft C# compiler (csc.exe) was not found.");
childProcess.execFileSync(compiler, [
  "/nologo", "/target:exe", "/platform:x64", "/optimize+",
  `/out:${output}`, "/r:System.dll", "/r:System.ServiceProcess.dll", source
], { stdio: "inherit" });
console.log(`Built ${output}`);

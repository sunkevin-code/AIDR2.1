const fs = require("fs");
const path = require("path");

function readJsonWithBackup(filePath, fallback = null) {
  const candidates = [
    { path: filePath, source: "primary" },
    { path: `${filePath}.bak`, source: "backup" }
  ];
  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate.path || !fs.existsSync(candidate.path)) continue;
    try {
      const value = JSON.parse(fs.readFileSync(candidate.path, "utf8").replace(/^\uFEFF/, ""));
      return { value, source: candidate.source, recovered: candidate.source === "backup", error: null };
    } catch (error) {
      lastError = error;
    }
  }
  return { value: fallback, source: "default", recovered: false, error: lastError };
}

function writeJsonAtomic(filePath, value, options = {}) {
  if (!filePath) throw new Error("json_path_required");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backupPath = `${filePath}.bak`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    if (options.backup !== false && fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.copyFileSync(tempPath, filePath); } finally {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    if (!fs.existsSync(filePath)) throw error;
  }
  return filePath;
}

module.exports = { readJsonWithBackup, writeJsonAtomic };

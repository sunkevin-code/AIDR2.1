const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const initSqlJs = require("sql.js");
const { HermesSessionSensor } = require("../src/sensors/hermesSessionSensor");
const { KimiSessionSensor } = require("../src/sensors/kimiSessionSensor");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidr-native-sensors-"));
  const prompts = [];
  const bus = { publish(name, payload) { if (name === "agent:user_prompt") prompts.push(payload); } };
  const addEvent = () => {};

  const SQL = await initSqlJs();
  const hermesDb = path.join(root, "state.db");
  const db = new SQL.Database();
  db.run("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT)");
  db.run("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp TEXT, active INTEGER)");
  db.run("INSERT INTO sessions VALUES ('h-1','hermes-model','/workspace')");
  fs.writeFileSync(hermesDb, Buffer.from(db.export()));
  const hermes = new HermesSessionSensor({ workspaceRoot: "/workspace" }, addEvent, bus);
  hermes.dbPath = hermesDb;
  hermes.active = true;
  hermes.SQL = SQL;
  await hermes.poll();
  db.run("INSERT INTO messages VALUES (1,'h-1','user','review the source code','2026-07-27T10:00:00Z',1)");
  fs.writeFileSync(hermesDb, Buffer.from(db.export()));
  await hermes.poll();
  assert(prompts.some(item => item.agent === "hermes" && item.prompt === "review the source code"));

  const kimiRoot = path.join(root, "kimi", "conv-test", "agents", "main");
  fs.mkdirSync(kimiRoot, { recursive: true });
  const wire = path.join(kimiRoot, "wire.jsonl");
  fs.writeFileSync(wire, "");
  const kimi = new KimiSessionSensor({ workspaceRoot: "/workspace" }, addEvent, bus);
  kimi.root = path.join(root, "kimi");
  kimi.active = true;
  await kimi.poll();
  fs.appendFileSync(wire, JSON.stringify({ type: "turn.prompt", input: "inspect README", time: "2026-07-27T10:01:00Z" }) + "\n");
  await kimi.poll();
  assert(prompts.some(item => item.agent === "kimi" && item.prompt === "inspect README"));

  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log("native session sensor tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LEDGER_VERSION = "aidr-audit-ledger-v1";
const GENESIS_HASH = "GENESIS";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function ledgerBody(record) {
  const { recordHash, ...body } = record;
  return body;
}

function recordHash(record) {
  return sha256(ledgerBody(record));
}

class AuditLedger {
  constructor(logDir, options = {}) {
    this.logDir = logDir;
    this.filePath = options.filePath || path.join(logDir, "aidr-audit-ledger.jsonl");
    this.maxExport = Number(options.maxExport || 500);
    this.checkpointEvery = Math.max(1, Number(options.checkpointEvery || process.env.AIDR_AUDIT_CHECKPOINT_EVERY || 10));
    this.signingKeyPath = options.signingKeyPath || path.join(logDir, "aidr-audit-signing-key.pem");
    this.publicKeyPath = options.publicKeyPath || path.join(logDir, "aidr-audit-signing-key.pub.pem");
    this.checkpointPath = options.checkpointPath || path.join(logDir, "aidr-audit-checkpoint.json");
    this.privateKey = null;
    this.publicKey = null;
    this.keyId = null;
    this.checkpoint = { status: "not_created", valid: null, path: this.checkpointPath, keyId: null };
    this.sequence = 0;
    this.lastHash = GENESIS_HASH;
    this.tamperedAt = null;
    this.loaded = false;
    this.verification = { valid: true, status: "empty", path: this.filePath, records: 0, lastHash: GENESIS_HASH };
    this._ensureSigningKey();
    this._load();
    this.verifyCheckpoint();
  }

  _ensureSigningKey() {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      if (fs.existsSync(this.signingKeyPath) && fs.existsSync(this.publicKeyPath)) {
        this.privateKey = fs.readFileSync(this.signingKeyPath, "utf8");
        this.publicKey = fs.readFileSync(this.publicKeyPath, "utf8");
      } else {
        const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
        this.privateKey = pair.privateKey;
        this.publicKey = pair.publicKey;
        fs.writeFileSync(this.signingKeyPath, this.privateKey, { encoding: "utf8", mode: 0o600 });
        fs.writeFileSync(this.publicKeyPath, this.publicKey, { encoding: "utf8", mode: 0o644 });
      }
      this.keyId = sha256(this.publicKey).slice(0, 16);
    } catch (_) {
      this.privateKey = null;
      this.publicKey = null;
      this.keyId = null;
    }
  }

  _load() {
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return;
    try {
      const lines = fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
      let previousHash = GENESIS_HASH;
      let expectedSequence = 1;
      for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch (_) {
          this.tamperedAt = { sequence: expectedSequence, reason: "invalid_json" };
          break;
        }
        const validation = this._validateRecord(record, expectedSequence, previousHash);
        if (!validation.valid) {
          this.tamperedAt = { sequence: record.sequence || expectedSequence, reason: validation.reason };
          break;
        }
        previousHash = record.recordHash;
        expectedSequence += 1;
      }
      this.sequence = expectedSequence - 1;
      this.lastHash = previousHash;
      this.verification = this.tamperedAt
        ? { valid: false, status: this.tamperedAt.reason, path: this.filePath, records: this.sequence, tamperedAt: this.tamperedAt.sequence, lastHash: this.lastHash }
        : { valid: true, status: "verified", path: this.filePath, records: this.sequence, lastHash: this.lastHash };
    } catch (error) {
      this.tamperedAt = { sequence: 0, reason: `read_error:${error.message}` };
      this.verification = { valid: false, status: "read_error", path: this.filePath, records: 0, error: error.message };
    }
  }

  append(event) {
    if (this.tamperedAt) return { ok: false, status: "tampered", tamperedAt: this.tamperedAt };
    const nextSequence = this.sequence + 1;
    const record = {
      ledgerVersion: LEDGER_VERSION,
      sequence: nextSequence,
      timestamp: event.timestamp || event.time || new Date().toISOString(),
      eventId: event.eventId || null,
      eventHash: sha256(event),
      category: event.category || null,
      eventType: event.eventType || null,
      severity: event.severity || "info",
      verdict: event.verdict || "allow",
      sessionId: event.sessionId || null,
      agentId: event.agentId || null,
      traceId: event.traceId || null,
      parentEventId: event.parentEventId || null,
      policyVersion: event.policyVersion || null,
      previousHash: this.lastHash
    };
    record.recordHash = recordHash(record);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf8");
      this.sequence = nextSequence;
      this.lastHash = record.recordHash;
      this.verification = { valid: true, status: "verified", path: this.filePath, records: this.sequence, lastHash: this.lastHash };
      if (this.sequence % this.checkpointEvery === 0) this._writeCheckpoint(record);
      return { ok: true, status: "appended", sequence: this.sequence, recordHash: this.lastHash };
    } catch (error) {
      return { ok: false, status: "write_error", error: error.message };
    }
  }

  verify() {
    if (!fs.existsSync(this.filePath)) {
      return this._setVerification({ valid: true, status: "empty", path: this.filePath, records: 0, lastHash: GENESIS_HASH });
    }
    try {
      const lines = fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
      let previousHash = GENESIS_HASH;
      let expectedSequence = 1;
      for (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch (_) {
          return this._setVerification({ valid: false, status: "invalid_json", path: this.filePath, records: expectedSequence - 1, tamperedAt: expectedSequence });
        }
        const validation = this._validateRecord(record, expectedSequence, previousHash);
        if (!validation.valid) {
          return this._setVerification({ valid: false, status: validation.reason, path: this.filePath, records: expectedSequence - 1, tamperedAt: record.sequence || expectedSequence, lastHash: previousHash });
        }
        previousHash = record.recordHash;
        expectedSequence += 1;
      }
      return this._setVerification({ valid: true, status: "verified", path: this.filePath, records: lines.length, lastHash: previousHash });
    } catch (error) {
      return this._setVerification({ valid: false, status: "read_error", path: this.filePath, records: 0, error: error.message });
    }
  }

  export(limit = this.maxExport) {
    if (!fs.existsSync(this.filePath)) return [];
    const size = Math.max(1, Math.min(this.maxExport, Number(limit) || this.maxExport));
    try {
      return fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean).slice(-size).map(line => JSON.parse(line));
    } catch (_) {
      return [];
    }
  }

  getStatus() {
    let bytes = 0;
    try { bytes = fs.statSync(this.filePath).size; } catch (_) {}
    const verification = this.verification;
    return {
      ...verification,
      ledgerVersion: LEDGER_VERSION,
      bytes,
      sequence: this.sequence,
      loaded: this.loaded,
      tamperedAt: this.tamperedAt,
      checkpoint: this.checkpoint,
      checkpointEvery: this.checkpointEvery,
      keyId: this.keyId
    };
  }

  _writeCheckpoint(record) {
    if (!this.privateKey || !this.publicKey) return;
    const payload = { ledgerVersion: LEDGER_VERSION, sequence: record.sequence, lastHash: record.recordHash };
    try {
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(canonicalJson(payload));
      signer.end();
      const checkpoint = { version: "aidr-audit-checkpoint-v1", keyId: this.keyId, createdAt: new Date().toISOString(), payload, signature: signer.sign(this.privateKey, "base64") };
      const tmp = this.checkpointPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf8");
      fs.renameSync(tmp, this.checkpointPath);
      this.checkpoint = { status: "verified", valid: true, path: this.checkpointPath, keyId: this.keyId, sequence: payload.sequence, lastHash: payload.lastHash, createdAt: checkpoint.createdAt };
    } catch (error) {
      this.checkpoint = { status: "write_error", valid: false, path: this.checkpointPath, keyId: this.keyId, error: error.message };
    }
  }

  verifyCheckpoint() {
    if (!fs.existsSync(this.checkpointPath)) {
      this.checkpoint = { status: "not_created", valid: null, path: this.checkpointPath, keyId: this.keyId };
      return this.checkpoint;
    }
    try {
      const checkpoint = JSON.parse(fs.readFileSync(this.checkpointPath, "utf8"));
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(canonicalJson(checkpoint.payload));
      verifier.end();
      const signatureValid = Boolean(this.publicKey && verifier.verify(this.publicKey, checkpoint.signature, "base64"));
      const sequenceValid = Number(checkpoint.payload?.sequence || 0) <= this.sequence;
      const hashValid = Number(checkpoint.payload?.sequence || 0) === this.sequence ? checkpoint.payload.lastHash === this.lastHash : true;
      this.checkpoint = { status: signatureValid && sequenceValid && hashValid ? "verified" : "invalid", valid: signatureValid && sequenceValid && hashValid, path: this.checkpointPath, keyId: this.keyId, sequence: checkpoint.payload?.sequence || 0, lastHash: checkpoint.payload?.lastHash || null };
      return this.checkpoint;
    } catch (error) {
      this.checkpoint = { status: "invalid", valid: false, path: this.checkpointPath, keyId: this.keyId, error: error.message };
      return this.checkpoint;
    }
  }

  _setVerification(value) {
    this.verification = value;
    if (!value.valid && value.status !== "empty") this.tamperedAt = { sequence: value.tamperedAt || 0, reason: value.status };
    return value;
  }

  _validateRecord(record, expectedSequence, previousHash) {
    if (!record || record.ledgerVersion !== LEDGER_VERSION) return { valid: false, reason: "version_mismatch" };
    if (Number(record.sequence) !== expectedSequence) return { valid: false, reason: "sequence_gap" };
    if (record.previousHash !== previousHash) return { valid: false, reason: "previous_hash_mismatch" };
    if (!/^[a-f0-9]{64}$/i.test(String(record.eventHash || ""))) return { valid: false, reason: "event_hash_invalid" };
    if (!/^[a-f0-9]{64}$/i.test(String(record.recordHash || ""))) return { valid: false, reason: "record_hash_invalid" };
    if (recordHash(record) !== record.recordHash) return { valid: false, reason: "record_hash_mismatch" };
    return { valid: true };
  }
}

module.exports = { AuditLedger, LEDGER_VERSION, GENESIS_HASH, canonicalJson, recordHash };

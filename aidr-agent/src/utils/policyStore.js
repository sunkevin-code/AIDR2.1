const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadPolicy, mergePolicy } = require("./config");

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

function unsignedPolicy(policy) {
  const copy = JSON.parse(JSON.stringify(policy || {}));
  delete copy.signature;
  return copy;
}

function policyHash(policy) {
  return crypto.createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.copyFileSync(tempPath, filePath); } finally {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    if (!fs.existsSync(filePath)) throw error;
  }
}

class PolicyStore {
  constructor(policyPath, baselinePath, options = {}) {
    this.policyPath = policyPath;
    this.baselinePath = baselinePath;
    this.dataDir = options.dataDir || path.dirname(policyPath);
    this.historyDir = path.join(this.dataDir, "policy-history");
    this.privateKeyPath = path.join(this.dataDir, "policy-signing-private.pem");
    this.publicKeyPath = path.join(this.dataDir, "policy-signing-public.pem");
    this.active = null;
    this.verification = { status: "unloaded" };
  }

  _ensureKeys() {
    if (fs.existsSync(this.privateKeyPath) && fs.existsSync(this.publicKeyPath)) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const pair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    fs.writeFileSync(this.privateKeyPath, pair.privateKey, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(this.publicKeyPath, pair.publicKey, { encoding: "utf8", mode: 0o644 });
  }

  _keyId() {
    this._ensureKeys();
    return crypto.createHash("sha256")
      .update(fs.readFileSync(this.publicKeyPath))
      .digest("hex")
      .slice(0, 16);
  }

  verify(policy) {
    if (!policy?.signature?.value) {
      return { valid: false, status: "unsigned", revision: policy?.policyMeta?.revision || 0 };
    }
    try {
      this._ensureKeys();
      const publicKey = fs.readFileSync(this.publicKeyPath, "utf8");
      const expectedKeyId = this._keyId();
      const algorithm = policy.signature.algorithm || "RSA-SHA256";
      if (algorithm !== "RSA-SHA256" || !policy.signature.keyId || policy.signature.keyId !== expectedKeyId) {
        return { valid: false, status: "signature_key_mismatch", revision: policy.policyMeta?.revision || 0, keyId: policy.signature.keyId || null, expectedKeyId };
      }
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(canonicalJson(unsignedPolicy(policy)));
      verifier.end();
      const valid = verifier.verify(publicKey, Buffer.from(policy.signature.value, "base64"));
      return {
        valid,
        status: valid ? "verified" : "invalid",
        revision: policy.policyMeta?.revision || 0,
        keyId: policy.signature.keyId,
        expectedKeyId,
        hash: policyHash(policy)
      };
    } catch (error) {
      return { valid: false, status: "verification_error", error: error.message };
    }
  }

  load() {
    const baseline = readJson(this.baselinePath) || loadPolicy(null, null);
    const stored = readJson(this.policyPath);
    if (!stored) {
      this.active = baseline;
      this.verification = { valid: false, status: "bundled_baseline", revision: 0, hash: policyHash(baseline) };
      return { policy: baseline, verification: this.verification };
    }

    if (!stored.signature) {
      this.active = mergePolicy(baseline, stored);
      this.active.version = baseline.version || this.active.version;
      this.verification = { valid: false, status: "unsigned_legacy", revision: 0, hash: policyHash(this.active) };
      return { policy: this.active, verification: this.verification };
    }

    const verification = this.verify(stored);
    if (verification.valid) {
      this.active = stored;
      this.verification = verification;
      return { policy: stored, verification };
    }

    const fallback = this._readVerifiedHistory();
    if (fallback) {
      this.active = fallback.policy;
      this.verification = { ...fallback.verification, status: "history_fallback", invalidActive: true };
      return { policy: fallback.policy, verification: this.verification };
    }

    this.active = baseline;
    this.verification = {
      valid: false,
      status: "bundled_fallback",
      invalidActive: true,
      revision: 0,
      hash: policyHash(baseline)
    };
    return { policy: baseline, verification: this.verification };
  }

  save(policy, options = {}) {
    this._ensureKeys();
    const current = this.active || this.load().policy;
    const currentRevision = Number(current?.policyMeta?.revision || 0);
    const next = JSON.parse(JSON.stringify(policy || {}));
    delete next.signature;
    next.policyMeta = {
      ...(next.policyMeta || {}),
      revision: currentRevision + 1,
      previousHash: current ? policyHash(current) : null,
      updatedAt: new Date().toISOString(),
      signer: options.signer || "aidr-local",
      ...(options.rollbackOf ? { rollbackOf: Number(options.rollbackOf) } : {})
    };

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(canonicalJson(next));
    signer.end();
    next.signature = {
      algorithm: "RSA-SHA256",
      keyId: this._keyId(),
      value: signer.sign(fs.readFileSync(this.privateKeyPath, "utf8")).toString("base64")
    };

    writeAtomic(this.policyPath, next);
    fs.mkdirSync(this.historyDir, { recursive: true });
    writeAtomic(path.join(this.historyDir, `policy-${String(next.policyMeta.revision).padStart(8, "0")}.json`), next);
    this.active = next;
    this.verification = this.verify(next);
    return next;
  }

  verifyActive() {
    const current = readJson(this.policyPath) || this.active;
    this.verification = current ? this.verify(current) : { valid: false, status: "missing" };
    return this.verification;
  }

  getHistory() {
    if (!fs.existsSync(this.historyDir)) return [];
    return fs.readdirSync(this.historyDir)
      .filter(name => /^policy-\d+\.json$/i.test(name))
      .map(name => {
        try {
          const policy = readJson(path.join(this.historyDir, name));
          const verification = this.verify(policy);
          return {
            revision: Number(policy.policyMeta?.revision || 0),
            updatedAt: policy.policyMeta?.updatedAt || null,
            rollbackOf: policy.policyMeta?.rollbackOf || null,
            hash: policyHash(policy),
            verification: verification.status
          };
        } catch (error) {
          return { revision: Number(name.match(/\d+/)?.[0] || 0), verification: "invalid", error: error.message };
        }
      })
      .sort((a, b) => b.revision - a.revision);
  }

  rollback(revision) {
    const target = path.join(this.historyDir, `policy-${String(Number(revision)).padStart(8, "0")}.json`);
    const policy = readJson(target);
    if (!policy) throw new Error(`policy_revision_not_found:${revision}`);
    const verification = this.verify(policy);
    if (!verification.valid) throw new Error(`policy_revision_invalid:${revision}`);
    const restored = JSON.parse(JSON.stringify(policy));
    delete restored.signature;
    delete restored.policyMeta;
    return this.save(restored, { rollbackOf: revision, signer: "aidr-local-rollback" });
  }

  _readVerifiedHistory() {
    const history = this.getHistory();
    for (const entry of history) {
      const file = path.join(this.historyDir, `policy-${String(entry.revision).padStart(8, "0")}.json`);
      const policy = readJson(file);
      const verification = this.verify(policy);
      if (verification.valid) return { policy, verification };
    }
    return null;
  }
}

module.exports = { PolicyStore, canonicalJson, policyHash };

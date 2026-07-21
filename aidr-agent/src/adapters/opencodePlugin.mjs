import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const endpointUrl = process.env.AIDR_AGENT_URL || "http://127.0.0.1:8787/api/hooks/agent";
const HOOK_PROTOCOL_VERSION = "aidr-hook-v1";
const tokenPath = process.env.AIDR_TOKEN_FILE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AIDREndpoint", ".local-token");

function localToken() {
  try { return fs.readFileSync(tokenPath, "utf8").trim(); } catch (_) { return process.env.AIDR_LOCAL_TOKEN || ""; }
}

function text(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (value && typeof value === "object") return text(value.text || value.content || value.prompt || value.message || "");
  return "";
}

async function callAidr(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AIDR_HOOK_TIMEOUT_MS || 1800));
  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AIDR-Token": localToken() },
      body: JSON.stringify({ ...payload, protocol: HOOK_PROTOCOL_VERSION, source: payload.source || "opencode-native-plugin" }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AIDR hook HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function safeCall(payload) {
  try {
    return await callAidr(payload);
  } catch (error) {
    const mode = String(process.env.AIDR_HOOK_FAIL_MODE || "fail_closed").toLowerCase();
    if (mode === "fail_open") {
      return { decision: { verdict: "allow", reason: "AIDR unavailable; fail-open configured", rule: "hook.fail_open" }, hookError: String(error.message || error) };
    }
    throw error;
  }
}

function denied(result) {
  return result?.decision?.verdict === "block" || result?.decision?.requiresApproval === true;
}

function messageFromEvent(event) {
  const properties = event?.properties || event?.data || {};
  const role = properties.role || properties.info?.role || properties.message?.role;
  if (role && role !== "user") return "";
  return text(properties.text || properties.content || properties.message?.content || properties.parts || event?.text || "");
}

export const AIDREndpoint = async ({ directory } = {}) => {
  const send = payload => safeCall({ ...payload, agent: "opencode", cwd: payload.cwd || directory || "" });
  return {
    "tool.execute.before": async (input) => {
      const result = await send({
        hook_event_name: "PreToolUse",
        session_id: input?.sessionID,
        turn_id: input?.callID,
        tool_name: input?.tool,
        tool_input: input?.args || {},
        model: input?.model || "unknown"
      });
      if (denied(result)) throw new Error(`AIDR blocked ${input?.tool || "tool"}: ${result?.decision?.reason || "policy decision"}`);
    },
    "tool.execute.after": async (input, output) => {
      const result = await send({
        hook_event_name: "PostToolUse",
        session_id: input?.sessionID,
        turn_id: input?.callID,
        tool_name: input?.tool,
        tool_input: input?.args || {},
        tool_response: output?.output || output?.result || output,
        model: input?.model || "unknown"
      });
      if (denied(result)) throw new Error(`AIDR blocked tool response: ${result?.decision?.reason || "response policy"}`);
    },
    event: async ({ event }) => {
      const type = event?.type || "";
      const properties = event?.properties || event?.data || {};
      const sessionId = properties.sessionID || properties.session_id || properties.info?.sessionID || properties.info?.id;
      if (["session.created", "session.status"].includes(type)) {
        await send({ hook_event_name: "SessionStart", session_id: sessionId, model: properties.model || "unknown" });
      } else if (["session.idle", "session.deleted"].includes(type)) {
        await send({ hook_event_name: "Stop", session_id: sessionId });
      } else if (["message.updated", "message.part.updated"].includes(type)) {
        const prompt = messageFromEvent(event);
        if (prompt) {
          const result = await send({ hook_event_name: "UserPromptSubmit", session_id: sessionId, prompt, fullPrompt: prompt, model: properties.model || "unknown" });
          if (denied(result)) throw new Error(`AIDR blocked prompt: ${result?.decision?.reason || "prompt policy"}`);
        }
      }
    },
    "tui.prompt.append": async (input) => {
      const prompt = text(input?.text || input?.prompt || input?.content || input);
      if (!prompt) return;
      const result = await send({ hook_event_name: "UserPromptSubmit", session_id: input?.sessionID || input?.session_id, prompt, fullPrompt: prompt });
      if (denied(result)) throw new Error(`AIDR blocked prompt: ${result?.decision?.reason || "prompt policy"}`);
    }
  };
};

const ENVIRONMENT_BLOCK = /<environment_context>[\s\S]*?<\/environment_context>/gi;
const BROWSER_CONTEXT_BLOCK = /<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/gi;
const ABORT_BLOCK = /<turn_aborted>[\s\S]*?<\/turn_aborted>/gi;
const ATTACHMENT_HEADER = "# Files mentioned by the user:";
const TRANSCRIPT_ENTRY = /\n\s*\[\d+\]\s+(?:assistant|developer|user|tool exec(?: call| result))\s*:/i;

const INTERNAL_PROMPT_PATTERNS = [
  /^\s*#\s*Overview\s+Generate\s+0\s+to\s+3\s+hyperpersonalized\s+suggestions\b/i,
  /^\s*The following is the Codex agent history added since your last approval assessment\b/i,
  /^\s*The following is the Codex agent history whose request action you are assessing\b/i,
  /^\s*You are a helpful assistant\. You will be presented with a user prompt, and your job is to provide a short title for a task/i,
  /^\s*<\/?(?:environment_context|in-app-browser-context|turn_aborted)>\s*$/i,
  /assert\.strictEqual\([\s\S]*promptSanitizer\.test\.js[\s\S]*(?:tool exec call|custom_tool_call)/i,
  /^\s*.*(?:tool exec call|custom_tool_call):[\s\S]{80,}/i
];

function cleanPrompt(prompt) {
  let text = String(prompt || "")
    .replace(BROWSER_CONTEXT_BLOCK, "")
    .replace(ENVIRONMENT_BLOCK, "")
    .replace(ABORT_BLOCK, "");

  if (text.trimStart().startsWith(ATTACHMENT_HEADER)) {
    const lines = text.trimStart().split(/\r?\n/);
    let index = 1;
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line || line.startsWith("## ") || /(?:[A-Za-z]:[\\/]|attachments[\\/])/i.test(line)) index += 1;
      else break;
    }
    text = lines.slice(index).join("\n");
  }

  const marker = text.lastIndexOf("## My request for Codex:");
  if (marker >= 0) text = text.slice(marker + "## My request for Codex:".length);
  const transcriptMarker = text.search(TRANSCRIPT_ENTRY);
  if (transcriptMarker >= 0) text = text.slice(0, transcriptMarker);
  return text.replace(/## My request for Codex:\s*/gi, "").trim();
}

function isInternalPrompt(prompt) {
  const text = cleanPrompt(prompt);
  return !text || INTERNAL_PROMPT_PATTERNS.some((pattern) => pattern.test(text));
}

function isGarbledPrompt(prompt) {
  const text = String(prompt || "");
  if (/[?]{2,}/.test(text)) return true;
  const asciiQuestionMarks = (text.match(/\?{3,}/g) || []).join("");
  const compact = text.replace(/\s/g, "");
  return asciiQuestionMarks.length >= 3 && asciiQuestionMarks.length / Math.max(compact.length, 1) >= 0.15;
}

function sanitizePrompt(prompt) {
  const text = cleanPrompt(prompt);
  return isInternalPrompt(text) || isGarbledPrompt(text) ? "" : text;
}

module.exports = { cleanPrompt, isInternalPrompt, isGarbledPrompt, sanitizePrompt };

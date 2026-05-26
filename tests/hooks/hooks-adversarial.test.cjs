"use strict";
// Behavioral tests for the adversarial-read-guard isolation (REGRA 2):
// a subagent with a context file may ONLY read its allowed_files.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.resolve(__dirname, "../../.claude/hooks/aidd-adversarial-read-guard.cjs");

function setupCtx(allowedFiles) {
  const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidd-adv-ctx-"));
  const telDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidd-adv-tel-"));
  fs.writeFileSync(
    path.join(ctxDir, "advX.json"),
    JSON.stringify({ agent_id: "advX", ts: new Date().toISOString(), ttl_seconds: 600, allowed_files: allowedFiles })
  );
  return { ctxDir, telDir };
}

function runGuard(ctxDir, telDir, payload) {
  try {
    return execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify(payload),
      env: { ...process.env, AIDD_ADVERSARIAL_CTX_DIR: ctxDir, AIDD_TELEMETRY_DIR: telDir },
      timeout: 10000, encoding: "utf8",
    }).trim();
  } catch (e) { return (e.stdout || "").toString().trim(); }
}
function isDeny(out) {
  try { return JSON.parse(out)?.hookSpecificOutput?.permissionDecision === "deny"; } catch { return false; }
}

test("REGRA 2: subagent ALLOWED to read a whitelisted file", () => {
  const { ctxDir, telDir } = setupCtx(["src/review/target.ts"]);
  const out = runGuard(ctxDir, telDir, { tool_name: "Read", agent_id: "advX", tool_input: { file_path: "src/review/target.ts" } });
  assert.strictEqual(out, "", "whitelisted file should be allowed (empty stdout)");
});

test("REGRA 2: subagent DENIED reading an out-of-whitelist file", () => {
  const { ctxDir, telDir } = setupCtx(["src/review/target.ts"]);
  const out = runGuard(ctxDir, telDir, { tool_name: "Read", agent_id: "advX", tool_input: { file_path: "src/secret/other.ts" } });
  assert.ok(isDeny(out), "out-of-whitelist read must be denied");
});

test("REGRA 2: subagent DENIED reading the PARENT directory of a whitelisted file (escalation regression)", () => {
  const { ctxDir, telDir } = setupCtx(["src/review/target.ts"]);
  const out = runGuard(ctxDir, telDir, { tool_name: "Grep", agent_id: "advX", tool_input: { path: "src/review" } });
  assert.ok(isDeny(out), "reading the parent dir of an allowed file must NOT be allowed");
});

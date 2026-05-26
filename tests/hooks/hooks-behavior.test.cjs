"use strict";
// Behavioral tests: verify guards actually DENY/ALLOW correctly (not just "load").
// These lock in the MultiEdit-bypass fix and the core deny paths.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const HOOKS = path.resolve(__dirname, "../../.claude/hooks");
const ROOT = path.resolve(__dirname, "../..");

function runHook(hook, payload) {
  try {
    const out = execFileSync(process.execPath, [path.join(HOOKS, hook)], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      timeout: 10000,
      encoding: "utf8",
    });
    return out.trim();
  } catch (e) {
    return (e.stdout || "").toString().trim();
  }
}
function isDeny(out) {
  if (!out) return false;
  try { return JSON.parse(out)?.hookSpecificOutput?.permissionDecision === "deny"; }
  catch { return false; }
}

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

test("secrets-guard DENIES a Write containing an AWS key", () => {
  const out = runHook("aidd-secrets-guard.cjs", {
    tool_name: "Write", tool_input: { file_path: "src/c.ts", content: `const k="${AWS_KEY}";` }, session_id: "t",
  });
  assert.ok(isDeny(out), "should deny secret in Write");
});

test("secrets-guard DENIES a MultiEdit containing an AWS key (bypass regression)", () => {
  const out = runHook("aidd-secrets-guard.cjs", {
    tool_name: "MultiEdit", tool_input: { file_path: "src/c.ts", edits: [{ old_string: "x", new_string: `const k="${AWS_KEY}";` }] }, session_id: "t",
  });
  assert.ok(isDeny(out), "MultiEdit must NOT bypass the secrets guard");
});

test("secrets-guard ALLOWS a clean Write (empty stdout)", () => {
  const out = runHook("aidd-secrets-guard.cjs", {
    tool_name: "Write", tool_input: { file_path: "src/x.ts", content: "export const a = 1;" }, session_id: "t",
  });
  assert.strictEqual(out, "", "clean write should be allowed (empty stdout)");
});

test("contract-guard DENIES a MultiEdit to AIDD.md (bypass regression)", () => {
  const out = runHook("aidd-contract-guard.cjs", {
    tool_name: "MultiEdit", tool_input: { file_path: "AIDD.md", edits: [{ old_string: "a", new_string: "b" }] }, session_id: "t",
  });
  assert.ok(isDeny(out), "MultiEdit must NOT bypass the contract guard");
});

test("domain-guard DENIES a domain->infrastructure import", () => {
  const out = runHook("aidd-domain-guard.cjs", {
    tool_name: "Write", tool_input: { file_path: "src/domain/User.ts", content: 'import { Db } from "../infrastructure/db";' }, session_id: "t",
  });
  assert.ok(isDeny(out), "cross-layer import should be denied");
});

test("adversarial-read-guard ALLOWS the main agent (no agent_id) — empty stdout", () => {
  const out = runHook("aidd-adversarial-read-guard.cjs", {
    tool_name: "Read", tool_input: { file_path: "anything.ts" }, session_id: "t",
  });
  assert.strictEqual(out, "", "main agent reads are allowed (empty stdout)");
});

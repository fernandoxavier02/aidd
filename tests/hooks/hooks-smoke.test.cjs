"use strict";
// Smoke test: every AIDD hook must LOAD and RUN without crashing.
// Catches missing modules (e.g. an un-vendored dependency) and syntax errors
// that `node --check` might miss in edge cases. A hook always exits 0 (allow or
// deny both call process.exit(0)); a non-zero exit means an uncaught crash.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HOOKS_DIR = path.resolve(__dirname, "../../.claude/hooks");
const ROOT = path.resolve(__dirname, "../..");

const hooks = fs
  .readdirSync(HOOKS_DIR)
  .filter((f) => f.startsWith("aidd-") && f.endsWith(".cjs"));

// A benign non-write payload makes every PreToolUse write-guard allow early.
const payload = JSON.stringify({
  tool_name: "Read",
  tool_input: {},
  session_id: "smoke-test",
});

assert.ok(hooks.length >= 12, `expected >= 12 hooks, found ${hooks.length}`);

for (const hook of hooks) {
  test(`hook loads and runs without crashing: ${hook}`, () => {
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [path.join(HOOKS_DIR, hook)], {
        input: payload,
        env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
        timeout: 10000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      throw new assert.AssertionError({
        message: `${hook} exited non-zero (crash): ${(e.stderr || e.message || "").toString().slice(0, 300)}`,
      });
    }
    // Output is either empty (allow) or a valid JSON decision object.
    const trimmed = stdout.trim();
    if (trimmed) {
      assert.doesNotThrow(
        () => JSON.parse(trimmed),
        `${hook} emitted non-JSON stdout: ${trimmed.slice(0, 150)}`
      );
    }
  });
}

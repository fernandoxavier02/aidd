"use strict";
// Codex adapter — golden-payload translation tests (schema per the verified
// 2026 research in .claude/skills/provider-agnostic-guards/SKILL.md).
// Warn-tier by design; fail-OPEN on unrecognized payloads (spec R1 f6/f8).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ADAPTER = path.resolve(__dirname, "../../.claude/hooks/lib/adapters/codex.cjs");
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function runAdapter(payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [ADAPTER], { input, encoding: "utf8", timeout: 10000 });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: r.stderr || "" };
}

function isDeny(out) {
  if (!out) return false;
  try { return JSON.parse(out)?.hookSpecificOutput?.permissionDecision === "deny"; }
  catch { return false; }
}

function tmpProj() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aidd-codex-"));
}

const patch = (body) => `*** Begin Patch\n${body}*** End Patch\n`;

test("Add File with a secret → deny (strongest signal when the hook runs)", () => {
  const r = runAdapter({
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    cwd: tmpProj(),
    tool_input: { patch: patch(`*** Add File: src/leak.ts\n+const k = "${AWS_KEY}";\n`) },
  });
  assert.strictEqual(r.status, 0, "adapter always exits 0");
  assert.ok(isDeny(r.stdout), `expected deny JSON, got: ${r.stdout.slice(0, 200)}`);
});

test("multi-file fan-out: one clean + one leaky file → deny names the leaky path", () => {
  const r = runAdapter({
    tool_name: "apply_patch",
    cwd: tmpProj(),
    tool_input: {
      patch: patch(
        `*** Add File: src/ok.ts\n+export const a = 1;\n` +
        `*** Add File: src/leak.ts\n+const k = "${AWS_KEY}";\n`
      ),
    },
  });
  assert.ok(isDeny(r.stdout));
  const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes("src/leak.ts"), `reason cites the file: ${reason}`);
});

test("Update File: secret in CONTEXT lines only (not introduced) does not deny", () => {
  const r = runAdapter({
    tool_name: "apply_patch",
    cwd: tmpProj(),
    tool_input: {
      patch: patch(
        `*** Update File: src/existing.ts\n` +
        `@@\n` +
        ` const old = "${AWS_KEY}";\n` + // context line (space prefix) — pre-existing
        `+export const added = 1;\n`
      ),
    },
  });
  assert.strictEqual(r.status, 0);
  assert.ok(!isDeny(r.stdout), "context lines must not be scanned as introduced content");
});

test("creating a new ADR via Add File is allowed (write + not exists)", () => {
  const r = runAdapter({
    tool_name: "apply_patch",
    cwd: tmpProj(),
    tool_input: { patch: patch(`*** Add File: docs/adr/0001-choice.md\n+# decision\n`) },
  });
  assert.ok(!isDeny(r.stdout), "new ADR creation is the sanctioned path");
});

test("fail-open: unrecognized tool_input shape → loud warn + pass through", () => {
  const r = runAdapter({ tool_name: "apply_patch", cwd: tmpProj(), tool_input: { something: "else" } });
  assert.strictEqual(r.status, 0);
  assert.ok(!isDeny(r.stdout), "must not block on protocol drift");
  assert.ok(/aidd-codex/i.test(r.stderr), `warns loudly on stderr: ${r.stderr.slice(0, 200)}`);
});

test("fail-open: malformed stdin JSON → exit 0, no deny", () => {
  const r = runAdapter("this is not json {");
  assert.strictEqual(r.status, 0);
  assert.ok(!isDeny(r.stdout));
});

test("unmatched tool name → silent allow", () => {
  const r = runAdapter({ tool_name: "shell", cwd: tmpProj(), tool_input: { command: "ls" } });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
});

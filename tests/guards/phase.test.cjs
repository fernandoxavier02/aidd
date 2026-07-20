"use strict";
// Neutral core: phase guard — phase-fit of the edited path vs CURRENT_TASK phase.
// Config (phase, status, mode) arrives IN the event, pre-loaded by the adapter.
const test = require("node:test");
const assert = require("node:assert");

const { evaluate, classifyPath } = require("../../.claude/hooks/lib/guards/phase.cjs");

const base = { action: "edit", content: "x", projectRoot: "/proj", fileExists: true };
const cfg = (over = {}) => ({ phaseGuard: { enabled: true, mode: "warn", present: true, phase: "9", status: "in_progress", ...over } });

test("classifyPath mirrors the shipped taxonomy", () => {
  assert.strictEqual(classifyPath(".aidd/current/CURRENT_TASK.md"), "aidd-working");
  assert.strictEqual(classifyPath("apps/web/src/index.ts"), "production");
  assert.strictEqual(classifyPath("docs/x.md"), "docs");
  assert.strictEqual(classifyPath(".claude/settings.json"), "config");
});

test("disabled guard → allow", () => {
  const v = evaluate({ ...base, path: "apps/web/src/a.ts", config: cfg({ enabled: false, phase: "5" }) });
  assert.strictEqual(v.verdict, "allow");
});

test("no CURRENT_TASK (present:false) → allow (documented opt-in)", () => {
  const v = evaluate({ ...base, path: "apps/web/src/a.ts", config: cfg({ present: false, phase: undefined }) });
  assert.strictEqual(v.verdict, "allow");
});

test("phase 9 allows production edits", () => {
  const v = evaluate({ ...base, path: "apps/web/src/a.ts", config: cfg({ phase: "9" }) });
  assert.strictEqual(v.verdict, "allow");
});

test("phase 5 + production edit → warn in warn mode", () => {
  const v = evaluate({ ...base, path: "apps/web/src/a.ts", config: cfg({ phase: "5", mode: "warn" }) });
  assert.strictEqual(v.verdict, "warn");
  assert.ok(v.message.length > 0);
});

test("phase 5 + production edit → deny in block mode", () => {
  const v = evaluate({ ...base, path: "apps/web/src/a.ts", config: cfg({ phase: "5", mode: "block" }) });
  assert.strictEqual(v.verdict, "deny");
});

test("status done + non-working edit → warn/deny per mode", () => {
  const warn = evaluate({ ...base, path: "src/a.ts", config: cfg({ status: "done", mode: "warn" }) });
  assert.strictEqual(warn.verdict, "warn");
  const block = evaluate({ ...base, path: "src/a.ts", config: cfg({ status: "done", mode: "block" }) });
  assert.strictEqual(block.verdict, "deny");
});

test("fail-safe: malformed envelope → deny", () => {
  const v = evaluate({ ...base, path: "", config: cfg() });
  assert.strictEqual(v.verdict, "deny");
});

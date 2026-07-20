"use strict";
// Neutral core: contract guard — immutable methodology files, steering, ADRs.
// Disk state (file exists) comes from the EVENT, never from fs (R1 finding 5).
const test = require("node:test");
const assert = require("node:assert");

const { evaluate } = require("../../.claude/hooks/lib/guards/contract.cjs");

const base = { action: "edit", content: "x", projectRoot: "/proj", fileExists: true, config: {} };

test("denies edit to AIDD.md (protected core file)", () => {
  const v = evaluate({ ...base, path: "AIDD.md" });
  assert.strictEqual(v.verdict, "deny");
  assert.ok(v.message.includes("AIDD"), "message names the protected file family");
});

test("allows CREATING a protected file when absent (fresh-install bootstrap)", () => {
  for (const p of ["AIDD.md", "CLAUDE.md", ".kiro/steering/product.md"]) {
    const v = evaluate({ ...base, action: "write", path: p, fileExists: false });
    assert.strictEqual(v.verdict, "allow", `${p}: criação não é modificação`);
  }
});

test("still denies OVERWRITING a protected file via write when it exists", () => {
  const v = evaluate({ ...base, action: "write", path: "AIDD.md", fileExists: true });
  assert.strictEqual(v.verdict, "deny");
});

test("denies edit to CLAUDE.md / AGENTS.md / CONTEXT_INDEX.md", () => {
  for (const p of ["CLAUDE.md", "AGENTS.md", "CONTEXT_INDEX.md"]) {
    assert.strictEqual(evaluate({ ...base, path: p }).verdict, "deny", p);
  }
});

test("denies edit to Kiro steering docs", () => {
  const v = evaluate({ ...base, path: ".kiro/steering/product.md" });
  assert.strictEqual(v.verdict, "deny");
});

test("allows a normal source file", () => {
  const v = evaluate({ ...base, path: "src/app.ts" });
  assert.strictEqual(v.verdict, "allow");
});

test("ADR: allows creating a NEW adr file (write + not exists) — via event state", () => {
  const v = evaluate({ ...base, action: "write", path: "docs/adr/0042-new-decision.md", fileExists: false });
  assert.strictEqual(v.verdict, "allow");
});

test("ADR: denies overwriting an EXISTING adr (write + exists)", () => {
  const v = evaluate({ ...base, action: "write", path: "docs/adr/0042-new-decision.md", fileExists: true });
  assert.strictEqual(v.verdict, "deny");
});

test("ADR: denies editing an adr regardless of existence", () => {
  const v = evaluate({ ...base, action: "edit", path: "docs/adr/0042-new-decision.md", fileExists: true });
  assert.strictEqual(v.verdict, "deny");
});

test("fail-safe: malformed envelope (missing path) → deny", () => {
  const v = evaluate({ ...base, path: undefined });
  assert.strictEqual(v.verdict, "deny");
});

test("fail-safe: malformed envelope (empty path) → deny", () => {
  const v = evaluate({ ...base, path: "" });
  assert.strictEqual(v.verdict, "deny");
});

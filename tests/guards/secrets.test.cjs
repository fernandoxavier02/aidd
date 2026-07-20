"use strict";
// Neutral core: secrets guard — catalog scan, .env rules, docs warn-path,
// fail-safe deny on missing/short catalog. No env-var overrides in the core.
const test = require("node:test");
const assert = require("node:assert");

const { evaluate } = require("../../.claude/hooks/lib/guards/secrets.cjs");

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const CATALOG = {
  ok: true,
  patterns: [{ id: "aws-akid", family: "aws", re: /AKIA[0-9A-Z]{16}/ }],
};
const base = { action: "write", projectRoot: "/proj", fileExists: false, config: { secrets: { catalog: CATALOG } } };

test("denies content matching a catalog pattern", () => {
  const v = evaluate({ ...base, path: "src/c.ts", content: `const k="${AWS_KEY}";` });
  assert.strictEqual(v.verdict, "deny");
  assert.strictEqual(v.evidence.pattern, "aws-akid");
});

test("allows clean content", () => {
  const v = evaluate({ ...base, path: "src/c.ts", content: "export const a = 1;" });
  assert.strictEqual(v.verdict, "allow");
});

test("warns (not denies) on match inside docs/ or *.md", () => {
  for (const p of ["docs/setup.md", "notes.md"]) {
    const v = evaluate({ ...base, path: p, content: AWS_KEY });
    assert.strictEqual(v.verdict, "warn", p);
  }
});

test("denies any .env write unconditionally", () => {
  for (const p of [".env", ".env.local", "packages/a/.env.production"]) {
    const v = evaluate({ ...base, path: p, content: "X=1" });
    assert.strictEqual(v.verdict, "deny", p);
  }
});

test("allows .env.example / .env.template without scanning", () => {
  const v = evaluate({ ...base, path: ".env.example", content: AWS_KEY });
  assert.strictEqual(v.verdict, "allow");
});

test("fail-safe: catalog not ok → deny", () => {
  const v = evaluate({ ...base, path: "src/c.ts", content: "clean", config: { secrets: { catalog: { ok: false, reason: "too few" } } } });
  assert.strictEqual(v.verdict, "deny");
});

test("fail-safe: malformed envelope → deny", () => {
  const v = evaluate({ ...base, path: "", content: "x" });
  assert.strictEqual(v.verdict, "deny");
});

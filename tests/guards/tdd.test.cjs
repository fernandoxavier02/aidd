"use strict";
// Neutral core: TDD guard — edit-time RED semantics vs the DISTINCT commit-time
// policy (R1 finding 3): commit-time accepts RED or GREEN regardless of TTL and
// NEVER denies on absent heartbeat (warn only).
const test = require("node:test");
const assert = require("node:assert");

const { evaluate, classifyTddPath } = require("../../.claude/hooks/lib/guards/tdd.cjs");

const PROD = "apps/web/src/feature.ts";
const base = { action: "edit", path: PROD, content: "x", projectRoot: "/proj", fileExists: true };
const NOW = Date.now();

function cfg(entries, over = {}) {
  return { tdd: { enabled: true, policy: "edit", heartbeat: { entries }, ...over } };
}
const red = (over = {}) => ({ test_path: "tests/feature.test.ts", result: "RED", ts: NOW, coverage_paths: [PROD], pending_green: false, ...over });

test("classifyTddPath: test / production / ignore", () => {
  assert.strictEqual(classifyTddPath("tests/x.test.ts"), "test");
  assert.strictEqual(classifyTddPath(PROD), "production");
  assert.strictEqual(classifyTddPath("README.md"), "ignore");
});

test("disabled → allow", () => {
  const v = evaluate({ ...base, config: cfg([], { enabled: false }) });
  assert.strictEqual(v.verdict, "allow");
});

test("edit policy: fresh RED covering the prod file → allow", () => {
  const v = evaluate({ ...base, config: cfg([red()]) });
  assert.strictEqual(v.verdict, "allow");
});

test("edit policy: no covering entry → deny", () => {
  const v = evaluate({ ...base, config: cfg([]) });
  assert.strictEqual(v.verdict, "deny");
});

test("edit policy: expired RED (>30min) → deny", () => {
  const v = evaluate({ ...base, config: cfg([red({ ts: NOW - 31 * 60 * 1000 })]) });
  assert.strictEqual(v.verdict, "deny");
});

test("edit policy: pending_green → deny", () => {
  const v = evaluate({ ...base, config: cfg([red({ pending_green: true })]) });
  assert.strictEqual(v.verdict, "deny");
});

test("edit policy: wildcard covers only the test-file subtree", () => {
  const inSubtree = evaluate({
    ...base,
    path: "tests/sub/prod.ts",
    config: cfg([red({ test_path: "tests/sub/x.test.ts", coverage_paths: ["*"] })]),
  });
  assert.strictEqual(inSubtree.verdict, "allow");
  const outside = evaluate({
    ...base,
    config: cfg([red({ test_path: "tests/sub/x.test.ts", coverage_paths: ["*"] })]),
  });
  assert.strictEqual(outside.verdict, "deny");
});

test("commit policy: GREEN entry, ancient, still counts as evidence → allow", () => {
  const v = evaluate({
    ...base,
    config: cfg([red({ result: "GREEN", ts: NOW - 90 * 24 * 60 * 60 * 1000 })], { policy: "commit" }),
  });
  assert.strictEqual(v.verdict, "allow");
});

test("commit policy: expired RED still counts → allow (no TTL at commit)", () => {
  const v = evaluate({ ...base, config: cfg([red({ ts: NOW - 3 * 60 * 60 * 1000 })], { policy: "commit" }) });
  assert.strictEqual(v.verdict, "allow");
});

test("commit policy: absent heartbeat → WARN, never deny (humans/Codex must not be blocked)", () => {
  const v = evaluate({ ...base, config: cfg([], { policy: "commit" }) });
  assert.strictEqual(v.verdict, "warn");
});

test("commit policy: empty/corrupt heartbeat object → warn, no crash", () => {
  const v = evaluate({ ...base, config: { tdd: { enabled: true, policy: "commit", heartbeat: null } } });
  assert.strictEqual(v.verdict, "warn");
});

test("non-prod, non-test path → allow", () => {
  const v = evaluate({ ...base, path: "scripts/build.js", config: cfg([]) });
  assert.strictEqual(v.verdict, "allow");
});

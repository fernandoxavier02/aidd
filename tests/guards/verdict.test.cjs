"use strict";
// Core contract: verdict constructors produce exactly {verdict, message, evidence}.
const test = require("node:test");
const assert = require("node:assert");

const V = require("../../.claude/hooks/lib/guards/verdict.cjs");

test("allow() produces the exact verdict shape", () => {
  const v = V.allow();
  assert.deepStrictEqual(v, { verdict: "allow", message: "", evidence: null });
});

test("allow(message) carries the message", () => {
  assert.deepStrictEqual(V.allow("ok"), { verdict: "allow", message: "ok", evidence: null });
});

test("warn(message, evidence) produces the exact shape", () => {
  const v = V.warn("careful", { a: 1 });
  assert.deepStrictEqual(v, { verdict: "warn", message: "careful", evidence: { a: 1 } });
});

test("deny(message, evidence) produces the exact shape", () => {
  const v = V.deny("no", [1, 2]);
  assert.deepStrictEqual(v, { verdict: "deny", message: "no", evidence: [1, 2] });
});

test("only three verdict values exist", () => {
  assert.deepStrictEqual(V.VERDICTS, ["allow", "warn", "deny"]);
});

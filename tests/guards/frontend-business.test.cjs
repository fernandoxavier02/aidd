"use strict";
// Neutral core: frontend-business guard — WARN-only by hard contract.
// It must NEVER return deny, not even on malformed input (amended AC, R1 f.4).
const test = require("node:test");
const assert = require("node:assert");

const { evaluate } = require("../../.claude/hooks/lib/guards/frontend-business.cjs");

const MAP = { layers: { frontend: ["apps/web/src/**"] }, frontend_business_suppress: ["apps/web/src/mocks/**"] };
const base = { action: "write", projectRoot: "/proj", fileExists: false, config: { frontendBusiness: { map: MAP } } };

test("warns on hardcoded authz role in a frontend file", () => {
  const v = evaluate({ ...base, path: "apps/web/src/Nav.tsx", content: `if (user.role === 'admin') { show(); }` });
  assert.strictEqual(v.verdict, "warn");
  assert.ok(Array.isArray(v.evidence) && v.evidence.length >= 1);
});

test("allows clean frontend content", () => {
  const v = evaluate({ ...base, path: "apps/web/src/Nav.tsx", content: "export const Nav = () => null;" });
  assert.strictEqual(v.verdict, "allow");
});

test("non-frontend path → allow (silent)", () => {
  const v = evaluate({ ...base, path: "services/api/src/calc.ts", content: "total * tax" });
  assert.strictEqual(v.verdict, "allow");
});

test("suppressed path → allow", () => {
  const v = evaluate({ ...base, path: "apps/web/src/mocks/fixtures.ts", content: `if (user.role === 'admin') {}` });
  assert.strictEqual(v.verdict, "allow");
});

test("missing map → allow (opt-in preserved)", () => {
  const v = evaluate({ ...base, path: "apps/web/src/Nav.tsx", content: `if (user.role === 'admin') {}`, config: { frontendBusiness: { map: null } } });
  assert.strictEqual(v.verdict, "allow");
});

test("NEVER denies: malformed envelope → warn, not deny", () => {
  const v = evaluate({ ...base, path: "" });
  assert.strictEqual(v.verdict, "warn");
});

test("NEVER denies: every possible outcome is allow or warn", () => {
  const cases = [
    { ...base, path: "apps/web/src/A.tsx", content: "const API_SECRET_KEY = 'x';" },
    { ...base, path: "apps/web/src/B.tsx", content: "if (balance < 0) {}" },
    { ...base, path: "x", content: null },
  ];
  for (const c of cases) {
    const v = evaluate(c);
    assert.ok(["allow", "warn"].includes(v.verdict), `got ${v.verdict}`);
  }
});

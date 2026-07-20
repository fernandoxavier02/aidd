"use strict";
// Neutral core: domain guard — DDD layer boundaries from the domain map.
// Missing map preserves the shipped opt-in behavior: warn, not deny.
const test = require("node:test");
const assert = require("node:assert");

const { evaluate } = require("../../.claude/hooks/lib/guards/domain.cjs");

const MAP = {
  layers: {
    domain: ["src/domain/**"],
    infrastructure: ["src/infrastructure/**"],
  },
  rules: [{ from: "domain", cannot_import_from: ["infrastructure"], rationale: "domain must stay pure" }],
};
const base = { action: "write", projectRoot: "/proj", fileExists: false, config: { domain: { map: MAP } } };

test("denies a domain→infrastructure import", () => {
  const v = evaluate({ ...base, path: "src/domain/User.ts", content: 'import { Db } from "../infrastructure/db";' });
  assert.strictEqual(v.verdict, "deny");
  assert.strictEqual(v.evidence.fromLayer, "domain");
  assert.strictEqual(v.evidence.targetLayer, "infrastructure");
});

test("allows same-layer import", () => {
  const v = evaluate({ ...base, path: "src/domain/User.ts", content: 'import { Email } from "./Email";' });
  assert.strictEqual(v.verdict, "allow");
});

test("missing map → warn (opt-in preserved), never deny", () => {
  const v = evaluate({ ...base, path: "src/domain/User.ts", content: 'import x from "../infrastructure/db";', config: { domain: { map: null } } });
  assert.strictEqual(v.verdict, "warn");
});

test("file outside any known layer → allow", () => {
  const v = evaluate({ ...base, path: "tools/misc.ts", content: 'import x from "../infrastructure/db";' });
  assert.strictEqual(v.verdict, "allow");
});

test("no imports → allow", () => {
  const v = evaluate({ ...base, path: "src/domain/User.ts", content: "export const x = 1;" });
  assert.strictEqual(v.verdict, "allow");
});

test("fail-safe: malformed envelope → deny", () => {
  const v = evaluate({ ...base, path: "" });
  assert.strictEqual(v.verdict, "deny");
});

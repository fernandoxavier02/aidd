"use strict";
// Registry: all 7 fiscal guards exposed uniformly + config.rigor pass-through
// (the sibling proportional-rigor task's carrier — delivered untouched, AC 16).
const test = require("node:test");
const assert = require("node:assert");

const registry = require("../../.claude/hooks/lib/guards/index.cjs");

const NAMES = ["contract", "phase", "tdd", "secrets", "domain", "rls", "frontend-business"];

test("registry exposes exactly the 7 fiscal guards", () => {
  assert.deepStrictEqual(Object.keys(registry.guards).sort(), [...NAMES].sort());
  for (const n of NAMES) {
    assert.strictEqual(typeof registry.guards[n].evaluate, "function", `${n}.evaluate`);
  }
});

test("config.rigor passes through byte-identical and unmutated for every guard", () => {
  const rigor = { level: "SIMPLES", guards: { tdd: "warn", secrets: "block" } };
  for (const n of NAMES) {
    const config = { rigor: JSON.parse(JSON.stringify(rigor)) };
    const before = JSON.stringify(config);
    const event = { action: "write", path: "src/anything.ts", content: "export const a = 1;", projectRoot: "/proj", fileExists: false, config };
    const v = registry.guards[n].evaluate(event);
    assert.ok(v && typeof v.verdict === "string", `${n} returns a verdict`);
    assert.strictEqual(JSON.stringify(config), before, `${n} must not mutate config (rigor carrier)`);
  }
});

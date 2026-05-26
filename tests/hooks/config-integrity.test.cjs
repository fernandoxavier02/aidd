"use strict";
// Integrity tests for the harness configuration — methodology SSOT invariants.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

test("stop-rules.json declares exactly 6 stop rules (matches AIDD.md)", () => {
  const sr = readJson(".claude/aidd-stop-rules.json");
  assert.strictEqual(sr.rules.length, 6, "AIDD defines 6 stop rules");
  const aidd = read("AIDD.md");
  // AIDD.md lists the 6 rules as an ordered list under "## ⚠️ Stop Rules"
  const ids = ["TDD", "BDD", "DDD", "TWO_ATTEMPT", "NON_INVENTIVE", "SPEC_BOUNDARY"];
  for (const id of ids) {
    assert.ok(sr.rules.some((r) => r.id === id), `stop rule ${id} present`);
  }
});

test("secrets-patterns.json has >= 12 patterns (hook fail-safe minimum)", () => {
  const cat = readJson(".claude/hooks/aidd-secrets-patterns.json");
  assert.ok(Array.isArray(cat.patterns));
  assert.ok(cat.patterns.length >= 12, `found ${cat.patterns.length} patterns, need >= 12`);
  // every pattern compiles as a regex
  for (const p of cat.patterns) {
    assert.doesNotThrow(() => new RegExp(p.regex, p.flags || ""), `pattern ${p.id} compiles`);
  }
});

test("domain-map.json is valid and has layers + rules", () => {
  const m = readJson(".aidd/domain-map.json");
  assert.strictEqual(m.version, 1);
  assert.ok(m.layers && typeof m.layers === "object");
  assert.ok(Object.keys(m.layers).length >= 1);
  assert.ok(Array.isArray(m.rules) && m.rules.length >= 1);
  // every rule.from references a declared layer
  for (const r of m.rules) {
    assert.ok(m.layers[r.from], `rule.from "${r.from}" is a declared layer`);
  }
});

test("all .claude config JSON files parse", () => {
  const configs = [
    ".claude/settings.json",
    ".claude/aidd-stop-rules.json",
    ".claude/aidd-tdd-config.json",
    ".claude/aidd-phase-guard-config.json",
    ".claude/aidd-rls-config.json",
  ];
  for (const c of configs) {
    assert.doesNotThrow(() => readJson(c), `${c} parses as JSON`);
  }
});

test("settings.json registers the core hooks", () => {
  const raw = read(".claude/settings.json");
  for (const h of [
    "aidd-session-bootstrap",
    "aidd-sensor",
    "aidd-contract-guard",
    "aidd-tdd-guard",
    "aidd-phase-guard",
  ]) {
    assert.ok(raw.includes(h), `settings.json registers ${h}`);
  }
});

test("AIDD.md documents every shipped hook (self-consistency invariant)", () => {
  const aidd = read("AIDD.md");
  const hooks = fs.readdirSync(path.join(ROOT, ".claude/hooks")).filter((f) => f.startsWith("aidd-") && f.endsWith(".cjs"));
  assert.ok(hooks.length >= 12, `expected >= 12 hooks, found ${hooks.length}`);
  for (const h of hooks) {
    assert.ok(aidd.includes(h), `AIDD.md must mention ${h}`);
  }
});

test("package.json declares js-yaml dependency", () => {
  const pkg = readJson("package.json");
  assert.ok(pkg.dependencies && pkg.dependencies["js-yaml"], "js-yaml must be declared");
});

test("secret-family count matches the docs (drift guard)", () => {
  const cat = readJson(".claude/hooks/aidd-secrets-patterns.json");
  const prereq = read("PREREQUISITES.md");
  const m = prereq.match(/\((\d+)\s+secret families\)/);
  assert.ok(m, "PREREQUISITES.md should state the secret-family count");
  assert.strictEqual(Number(m[1]), cat.patterns.length, "doc count must match catalog length");
});

test("README component counts match reality", () => {
  const readme = read("README.md");
  const fsx = require("node:fs");
  const hooks = fsx.readdirSync(path.join(ROOT, ".claude/hooks")).filter((f) => f.startsWith("aidd-") && f.endsWith(".cjs")).length;
  const skills = fsx.readdirSync(path.join(ROOT, ".claude/skills")).filter((d) => d.startsWith("aidd")).length;
  assert.ok(readme.includes("Hooks (" + hooks + ")"), `README should say Hooks (${hooks})`);
  assert.ok(readme.includes("Skills (" + skills + ")"), `README should say Skills (${skills})`);
});

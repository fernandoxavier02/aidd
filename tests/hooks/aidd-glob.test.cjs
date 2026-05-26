"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { minimatch, globToRegExp } = require("../../.claude/hooks/lib/aidd-glob.cjs");

// [path, glob, expected]
const CASES = [
  // trailing globstar
  ["src/domain/entities/User.ts", "src/domain/**", true],
  ["src/application/use-cases/Create.ts", "src/domain/**", false],
  ["src/domain", "src/domain/**", false], // dir itself without trailing content does not match
  // single star does not cross slash
  ["apps/mobile/lib/calculators/tax.ts", "apps/*/lib/calculators/**", true],
  ["apps/mobile/screens/Home.tsx", "apps/*/lib/calculators/**", false],
  ["apps/a/b/lib/calculators/x.ts", "apps/*/lib/calculators/**", false], // * is one segment only
  // broad globstar
  ["apps/web/dashboard/x.ts", "apps/**", true],
  ["packages/shared/types.ts", "packages/shared/**", true],
  // mid-pattern globstar matches zero or more segments
  ["src/user/entities/User.ts", "src/**/entities/**", true],
  ["src/entities/User.ts", "src/**/entities/**", true],
  // dotfiles are matched (dot:true behavior)
  [".aidd/current/x.md", ".aidd/**", true],
  // literal hyphen in segment
  ["frontend/app.ts", "front-end/**", false],
  ["front-end/app.ts", "front-end/**", true],
  // backslash normalization
  ["src\\domain\\x.ts", "src/domain/**", true],
];

test("minimatch: glob subset behaves correctly", () => {
  for (const [p, g, exp] of CASES) {
    assert.strictEqual(minimatch(p, g), exp, `minimatch(${JSON.stringify(p)}, ${JSON.stringify(g)}) should be ${exp}`);
  }
});

test("minimatch: non-string inputs return false (fail-safe)", () => {
  assert.strictEqual(minimatch(null, "src/**"), false);
  assert.strictEqual(minimatch("src/x", null), false);
  assert.strictEqual(minimatch(undefined, undefined), false);
});

test("globToRegExp: anchors the whole path", () => {
  const re = globToRegExp("src/domain/**");
  assert.ok(re.source.startsWith("^"));
  assert.ok(re.source.endsWith("$"));
});

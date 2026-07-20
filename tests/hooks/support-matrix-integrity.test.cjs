"use strict";
// Support-matrix coherence: the guard × provider × moment matrix in AIDD.md
// must not promise enforcement the delivered adapters do not register.
// Same SSOT philosophy as config-integrity.test.cjs — prose == reality.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const GUARDS = ["contract", "phase", "tdd", "secrets", "domain", "rls", "frontend-business"];
const HOOK_FILE = {
  "contract": "aidd-contract-guard.cjs",
  "phase": "aidd-phase-guard.cjs",
  "tdd": "aidd-tdd-guard.cjs",
  "secrets": "aidd-secrets-guard.cjs",
  "domain": "aidd-domain-guard.cjs",
  "rls": "aidd-rls-guard.cjs",
  "frontend-business": "aidd-frontend-business-guard.cjs",
};

/** Extract {claude, codex, git} cells per guard from the AIDD.md matrix table. */
function parseMatrix(aidd) {
  const rows = {};
  for (const g of GUARDS) {
    const re = new RegExp(`^\\| ${g.replace(/[-]/g, "\\-")} \\| ([^|]+) \\| ([^|]+) \\| ([^|]+) \\|`, "m");
    const m = aidd.match(re);
    if (m) rows[g] = { claude: m[1].trim(), codex: m[2].trim(), git: m[3].trim() };
  }
  return rows;
}

const aidd = read("AIDD.md");
const matrix = parseMatrix(aidd);
const settings = read(".claude/settings.json");
const codexAdapterSrc = read(".claude/hooks/lib/adapters/codex.cjs");
const gitNetSrc = read(".claude/hooks/lib/git-net.cjs");

const registers = (src, guard) => src.includes(`["${guard}"`);

test("matrix exists in AIDD.md with a row for every fiscal guard", () => {
  for (const g of GUARDS) {
    assert.ok(matrix[g], `AIDD.md support matrix must have a row for "${g}"`);
  }
});

test("Claude column: every promised guard is registered in .claude/settings.json", () => {
  for (const g of GUARDS) {
    const cell = matrix[g].claude;
    if (cell === "—") continue;
    assert.ok(settings.includes(HOOK_FILE[g]), `matrix promises Claude enforcement for "${g}" but ${HOOK_FILE[g]} is not registered in settings.json`);
  }
});

test("Codex column: promised guards registered in the adapter; omitted guards absent", () => {
  for (const g of GUARDS) {
    const cell = matrix[g].codex;
    if (cell === "—") {
      assert.ok(!registers(codexAdapterSrc, g), `matrix says "${g}" is NOT Codex-enforced, but the adapter registers it`);
    } else {
      assert.ok(registers(codexAdapterSrc, g), `matrix promises Codex enforcement for "${g}" but the adapter does not register it`);
    }
  }
});

test("Codex column is honest: best-effort only, never a guaranteed/deny promise", () => {
  for (const g of GUARDS) {
    const cell = matrix[g].codex;
    if (cell === "—") continue;
    assert.ok(/best-effort/i.test(cell), `Codex cell for "${g}" must say best-effort (trust-gated layer): "${cell}"`);
    assert.ok(!/guaranteed|deny/i.test(cell), `Codex cell for "${g}" must not promise deny/guaranteed: "${cell}"`);
  }
});

test("git column: promised guards registered in the net engine; omitted guards absent", () => {
  for (const g of GUARDS) {
    const cell = matrix[g].git;
    if (cell === "—") {
      assert.ok(!registers(gitNetSrc, g), `matrix says "${g}" is NOT git-enforced, but the net registers it`);
    } else {
      assert.ok(registers(gitNetSrc, g), `matrix promises git enforcement for "${g}" but the net does not register it`);
    }
  }
});

test("session machinery is declared Claude-only in AIDD.md", () => {
  const sessionHooks = [
    "aidd-session-bootstrap.cjs",
    "aidd-sensor.cjs",
    "aidd-stop-rules-preserver.cjs",
    "aidd-adversarial-read-guard.cjs",
  ];
  const claudeOnly = aidd.match(/Session machinery is Claude Code-only[\s\S]{0,600}/);
  assert.ok(claudeOnly, "AIDD.md must contain the Claude-only session machinery declaration");
  for (const h of sessionHooks) {
    assert.ok(claudeOnly[0].includes(h), `session-machinery declaration must name ${h}`);
  }
});

test(".codex/hooks.json is generate-only — never shipped in the tarball (R1 f16)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(
    !(pkg.files || []).some((f) => f.includes(".codex")),
    "package.json files[] must not ship any .codex/ path"
  );
});

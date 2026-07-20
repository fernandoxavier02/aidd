"use strict";
// Provider layers: detection, layered init/update, manifest.layers, doctor
// per layer, veto flags, and the copy-mode e2e (spec R1 finding 1 — CRITICAL).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const PKG_ROOT = path.resolve(__dirname, "../..");
const fm = require("../../lib/cli/files-map.cjs");
const { init } = require("../../lib/cli/init.cjs");
const { update } = require("../../lib/cli/update.cjs");
const { doctor } = require("../../lib/cli/doctor.cjs");

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aidd-layers-"));
}

function gitInit(root) {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".aidd", "harness.json"), "utf8"));
}

test("detectProviders: dir/file presence maps to provider booleans", () => {
  const root = tmp();
  assert.deepStrictEqual(fm.detectProviders(root), { claude: false, codex: false, git: false });
  fs.mkdirSync(path.join(root, ".claude"));
  fs.mkdirSync(path.join(root, ".codex"));
  gitInit(root);
  assert.deepStrictEqual(fm.detectProviders(root), { claude: true, codex: true, git: true });

  const root2 = tmp();
  fs.writeFileSync(path.join(root2, "AGENTS.md"), "# agents");
  assert.strictEqual(fm.detectProviders(root2).codex, true, "AGENTS.md presence triggers the codex layer (R1 f13)");
});

test("init in a git repo: git layer installed and recorded in manifest.layers", () => {
  const root = tmp();
  gitInit(root);
  const res = init({ dir: root, mode: "copy" });
  assert.deepStrictEqual(readManifest(root).layers, { claude: true, codex: false, git: true });
  assert.ok(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")), "git net installed");
  assert.ok(res.results.some((r) => r.rel.includes("pre-commit")), "reported in results");
});

test("init with .codex/ present: hooks.json generated, command-type only, apply_patch matcher", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, ".codex"));
  init({ dir: root, mode: "copy" });
  const hooksPath = path.join(root, ".codex", "hooks.json");
  assert.ok(fs.existsSync(hooksPath), ".codex/hooks.json generated (generate-only, never shipped)");
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const groups = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(groups) && groups.length >= 1);
  for (const g of groups) {
    assert.strictEqual(g.matcher, "apply_patch", "matcher is apply_patch only — no Bash (R1 f11)");
    for (const h of g.hooks) assert.strictEqual(h.type, "command", "only command type enforces");
  }
  assert.strictEqual(readManifest(root).layers.codex, true);
});

test("init merges into an existing user .codex/hooks.json instead of clobbering", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, ".codex"));
  const userHooks = { hooks: { PreToolUse: [{ matcher: "shell", hooks: [{ type: "command", command: "echo user" }] }] } };
  fs.writeFileSync(path.join(root, ".codex", "hooks.json"), JSON.stringify(userHooks));
  init({ dir: root, mode: "copy" });
  const merged = JSON.parse(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"));
  const commands = JSON.stringify(merged);
  assert.ok(commands.includes("echo user"), "user entry preserved");
  assert.ok(commands.includes("codex.cjs"), "aidd adapter added");
});

test("veto: --providers git installs ONLY the git layer (no claude settings/bootloader)", () => {
  const root = tmp();
  gitInit(root);
  init({ dir: root, mode: "copy", providers: ["git"] });
  const m = readManifest(root);
  assert.deepStrictEqual(m.layers, { claude: false, codex: false, git: true });
  assert.ok(!fs.existsSync(path.join(root, ".claude", "settings.json")), "claude layer skipped");
  assert.ok(!fs.existsSync(path.join(root, "CLAUDE.md")), "claude bootloader skipped");
  assert.ok(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")), "git net present");
});

test("veto: noGitHooks skips the net even in a git repo", () => {
  const root = tmp();
  gitInit(root);
  init({ dir: root, mode: "copy", noGitHooks: true });
  assert.strictEqual(readManifest(root).layers.git, false);
  assert.ok(!fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")));
});

test("COPY-MODE E2E: no node_modules — engine delivered, net enforces at commit (R1 f1)", () => {
  const root = tmp();
  gitInit(root);
  init({ dir: root, mode: "copy" });
  assert.ok(!fs.existsSync(path.join(root, "node_modules")), "premise: no node_modules");
  assert.ok(fs.existsSync(path.join(root, ".claude", "hooks", "lib", "guards", "index.cjs")), "core copied");
  assert.ok(fs.existsSync(path.join(root, ".claude", "hooks", "lib", "git-net.cjs")), "net engine copied");

  // 1) commit inicial do scaffold (AIDD.md etc. como A/added) DEVE passar
  git(root, ["add", "-A"]);
  const first = git(root, ["commit", "-m", "scaffold"]);
  assert.strictEqual(first.status, 0, `fresh-install commit must pass: ${first.stderr}`);

  // 2) segredo staged DEVE ser bloqueado pelo engine copiado
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "leak.ts"), `const k = "${AWS_KEY}";\n`);
  git(root, ["add", "-A"]);
  const bad = git(root, ["commit", "-m", "leak"]);
  assert.notStrictEqual(bad.status, 0, "copy-mode net must block the secret");
});

test("update refreshes recorded layers; doctor reports git layer healthy", () => {
  const root = tmp();
  gitInit(root);
  init({ dir: root, mode: "copy" });

  const up = update({ dir: root });
  assert.ok(up.results.some((r) => r.rel.includes("pre-commit")), "update touched the git layer");

  const d = doctor({ dir: root });
  const gitFindings = d.findings.filter((f) => f.check === "git-net");
  assert.ok(gitFindings.length >= 1, "doctor emits a git-net finding");
  assert.ok(gitFindings.every((f) => f.level !== "error"), JSON.stringify(gitFindings));

  // sabotagem: remover o hook → doctor acusa erro
  fs.rmSync(path.join(root, ".git", "hooks", "pre-commit"));
  const d2 = doctor({ dir: root });
  assert.ok(d2.findings.some((f) => f.check === "git-net" && f.level === "error"), "missing net detected");
});

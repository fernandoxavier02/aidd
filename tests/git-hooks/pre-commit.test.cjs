"use strict";
// E2E: universal git pre-commit net — real temp repos, real commits.
// Covers spec R1 findings: staged-blob sourcing (2), chain-never-overwrite,
// core.hooksPath awareness (7), portable wrapper (8), marker-based update (14).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const PKG_ROOT = path.resolve(__dirname, "../..");
const gitHooks = require("../../lib/cli/git-hooks.cjs");

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

function git(root, args, opts = {}) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", ...opts });
}

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidd-gitnet-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  // copy-mode style engine delivery: the whole hooks tree ships with the project
  fs.cpSync(path.join(PKG_ROOT, ".claude", "hooks"), path.join(root, ".claude", "hooks"), { recursive: true });
  return root;
}

function installNet(root, opts = {}) {
  const results = [];
  const manifest = { files: {}, layers: {} };
  gitHooks.installGitHooksLayer(root, manifest, results, { mode: "copy", ...opts });
  return { results, manifest };
}

function commit(root, msg) {
  git(root, ["add", "-A"]);
  return git(root, ["commit", "-m", msg]);
}

function stage(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, ["add", rel]);
}

test("install writes a portable wrapper: sh shebang, LF-only, AIDD marker", () => {
  const root = tmpRepo();
  installNet(root);
  const hookPath = path.join(root, ".git", "hooks", "pre-commit");
  assert.ok(fs.existsSync(hookPath), "pre-commit hook installed");
  const text = fs.readFileSync(hookPath, "utf8");
  assert.ok(text.startsWith("#!/bin/sh\n"), "sh shebang first line");
  assert.ok(!text.includes("\r"), "LF-only, no CR");
  assert.ok(text.includes(gitHooks.MARKER), "AIDD marker present");
  if (process.platform !== "win32") {
    const mode = fs.statSync(hookPath).mode & 0o777;
    assert.ok(mode & 0o111, "hook is executable");
  }
});

test("clean commit passes; staged secret is blocked with a clear message", () => {
  const root = tmpRepo();
  installNet(root);
  stage(root, "src/ok.ts", "export const a = 1;\n");
  const okRes = commit(root, "clean");
  assert.strictEqual(okRes.status, 0, `clean commit should pass: ${okRes.stderr}`);

  stage(root, "src/leak.ts", `const k = "${AWS_KEY}";\n`);
  const badRes = commit(root, "leak");
  assert.notStrictEqual(badRes.status, 0, "commit with staged secret must be blocked");
  const out = `${badRes.stdout}\n${badRes.stderr}`;
  assert.ok(/secret/i.test(out), `message names the violation: ${out.slice(0, 300)}`);
});

test("staged-blob sourcing: secret staged but scrubbed from worktree is STILL blocked (R1 f2)", () => {
  const root = tmpRepo();
  installNet(root);
  stage(root, "src/first.ts", "export const a = 1;\n");
  assert.strictEqual(commit(root, "base").status, 0);

  // stage the secret, then clean the worktree copy BEFORE committing
  stage(root, "src/smuggle.ts", `const k = "${AWS_KEY}";\n`);
  fs.writeFileSync(path.join(root, "src", "smuggle.ts"), "export const clean = true;\n");
  const res = git(root, ["commit", "-m", "smuggle"]);
  assert.notStrictEqual(res.status, 0, "index content must be scanned, not worktree");
});

test("secret only in the WORKTREE (not staged) does not block the commit (R1 f2 inverse)", () => {
  const root = tmpRepo();
  installNet(root);
  stage(root, "src/ok.ts", "export const a = 1;\n");
  // unstaged worktree file with a secret — never added
  fs.writeFileSync(path.join(root, "src-notes.txt.bak"), AWS_KEY);
  const res = git(root, ["commit", "-m", "only staged inspected"]);
  assert.strictEqual(res.status, 0, `unstaged content must not block: ${res.stderr}`);
});

test("pre-existing user hook is chained, never overwritten — and can still block", () => {
  const root = tmpRepo();
  const hooksDir = path.join(root, ".git", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const sentinel = path.join(root, "user-hook-ran.txt");
  fs.writeFileSync(
    path.join(hooksDir, "pre-commit"),
    `#!/bin/sh\necho user-hook >> "${sentinel.replace(/\\/g, "/")}"\nexit 0\n`
  );
  installNet(root);

  assert.ok(fs.existsSync(path.join(hooksDir, "pre-commit.local")), "user hook renamed aside, preserved");

  stage(root, "src/ok.ts", "export const a = 1;\n");
  const res = commit(root, "chained");
  assert.strictEqual(res.status, 0, `commit passes with chain: ${res.stderr}`);
  assert.ok(fs.existsSync(sentinel), "the user hook still ran");

  // now make the user hook fail — its exit code must propagate (block)
  fs.writeFileSync(path.join(hooksDir, "pre-commit.local"), `#!/bin/sh\nexit 1\n`);
  stage(root, "src/ok2.ts", "export const b = 2;\n");
  const res2 = git(root, ["commit", "-m", "user hook blocks"]);
  assert.notStrictEqual(res2.status, 0, "user hook exit code propagates");
});

test("update: marker intact → regenerated; hand-edited (no marker) → refused (R1 f14)", () => {
  const root = tmpRepo();
  installNet(root);
  const hookPath = path.join(root, ".git", "hooks", "pre-commit");

  const results1 = [];
  gitHooks.updateGitHooksLayer(root, { files: {}, layers: { git: true } }, results1, { mode: "copy" });
  assert.ok(
    results1.some((r) => /regenerated|up-to-date/.test(r.action)),
    `marker intact should regenerate: ${JSON.stringify(results1)}`
  );

  fs.writeFileSync(hookPath, "#!/bin/sh\n# my own hook now\nexit 0\n");
  const results2 = [];
  gitHooks.updateGitHooksLayer(root, { files: {}, layers: { git: true } }, results2, { mode: "copy" });
  assert.ok(
    results2.some((r) => /kept|refused/.test(r.action)),
    `hand-edited hook must be refused, not clobbered: ${JSON.stringify(results2)}`
  );
  assert.ok(fs.readFileSync(hookPath, "utf8").includes("my own hook"), "hand edit preserved");
});

test("core.hooksPath is honored: net installs into the EFFECTIVE hooks dir (R1 f7)", () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, ".githooks"), { recursive: true });
  git(root, ["config", "core.hooksPath", ".githooks"]);
  installNet(root);

  assert.ok(
    fs.existsSync(path.join(root, ".githooks", "pre-commit")),
    "wrapper installed where git actually looks"
  );
  assert.ok(
    !fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")),
    "nothing installed in the ignored default dir"
  );

  stage(root, "src/leak.ts", `const k = "${AWS_KEY}";\n`);
  const res = git(root, ["commit", "-m", "leak"]);
  assert.notStrictEqual(res.status, 0, "net enforces from the hooksPath dir");
});

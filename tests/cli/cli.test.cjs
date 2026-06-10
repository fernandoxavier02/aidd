"use strict";
// Tests for the aidd CLI (init / update / doctor) and its pure helpers.
// Every scenario runs against a throwaway temp directory — the repo itself is
// never mutated.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const fm = require("../../lib/cli/files-map.cjs");
const { sha256, loadManifest, classify, newManifest } = require("../../lib/cli/manifest.cjs");
const { buildConsumerSettings, mergeSettings, HYBRID_PREFIX, LOCAL_PREFIX } = require("../../lib/cli/settings.cjs");
const { applyBlock, BEGIN, END } = require("../../lib/cli/bootloader.cjs");
const { init } = require("../../lib/cli/init.cjs");
const { update } = require("../../lib/cli/update.cjs");
const { doctor } = require("../../lib/cli/doctor.cjs");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aidd-cli-test-"));
}

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
}

function write(root, rel, content) {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ---------------------------------------------------------------------------
// files-map
// ---------------------------------------------------------------------------

test("scaffoldList includes docs, configs and every skill file", () => {
  const list = fm.scaffoldList();
  assert.ok(list.includes("AIDD.md"));
  assert.ok(list.includes(".claude/aidd-stop-rules.json"));
  assert.ok(list.some((f) => f.startsWith(".claude/skills/aidd/") && f.endsWith("SKILL.md")));
  assert.ok(list.includes(".aidd/current/CURRENT_TASK.template.md"));
});

test("engineList contains the hooks but not the secrets catalog", () => {
  const engine = fm.engineList();
  assert.ok(engine.includes(".claude/hooks/aidd-sensor.cjs"));
  assert.ok(engine.includes(".claude/hooks/lib/aidd-paths.cjs"));
  assert.ok(!engine.includes(fm.SECRETS_CATALOG.src));
});

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

test("classify distinguishes absent / untracked / clean / modified", () => {
  const root = tmpProject();
  try {
    const manifest = newManifest("0.0.0", "hybrid");
    assert.strictEqual(classify(root, "a.txt", manifest), "absent");
    write(root, "a.txt", "hello");
    assert.strictEqual(classify(root, "a.txt", manifest), "untracked");
    manifest.files["a.txt"] = sha256(Buffer.from("hello"));
    assert.strictEqual(classify(root, "a.txt", manifest), "clean");
    write(root, "a.txt", "edited");
    assert.strictEqual(classify(root, "a.txt", manifest), "modified");
  } finally {
    rm(root);
  }
});

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

test("hybrid settings reference the engine inside node_modules", () => {
  const settings = buildConsumerSettings("hybrid");
  const text = JSON.stringify(settings);
  assert.ok(text.includes(HYBRID_PREFIX.replace(/\\/g, "")) || text.includes("node_modules/@fx-studio-ai/aidd"));
  assert.ok(!JSON.stringify(settings).includes(LOCAL_PREFIX + "aidd-sensor"));
});

test("copy settings keep project-local engine paths", () => {
  const text = JSON.stringify(buildConsumerSettings("copy"));
  assert.ok(text.includes("/.claude/hooks/aidd-sensor.cjs"));
  assert.ok(!text.includes("node_modules/@fx-studio-ai/aidd"));
});

test("mergeSettings preserves user hooks and is idempotent", () => {
  const user = {
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: "node my-hook.cjs", timeout: 3 }] },
      ],
    },
  };
  const incoming = buildConsumerSettings("hybrid");
  const { merged, added } = mergeSettings(user, incoming);

  assert.deepStrictEqual(merged.permissions, user.permissions, "non-hook settings preserved");
  const flat = JSON.stringify(merged);
  assert.ok(flat.includes("my-hook.cjs"), "user hook preserved");
  assert.ok(flat.includes("aidd-sensor.cjs"), "aidd hooks added");
  assert.ok(added.length > 0);

  const second = mergeSettings(merged, incoming);
  assert.strictEqual(second.added.length, 0, "re-merge adds nothing");
  assert.deepStrictEqual(second.merged, merged, "re-merge is a no-op");
});

// ---------------------------------------------------------------------------
// bootloader block
// ---------------------------------------------------------------------------

test("applyBlock creates, appends, replaces and detects unchanged", () => {
  const created = applyBlock(null, "CLAUDE.md");
  assert.strictEqual(created.action, "created");
  assert.ok(created.text.startsWith(BEGIN));
  assert.ok(created.text.trimEnd().endsWith(END));

  const appended = applyBlock("# My project\n", "CLAUDE.md");
  assert.strictEqual(appended.action, "block-added");
  assert.ok(appended.text.startsWith("# My project\n"));

  const unchanged = applyBlock(appended.text, "CLAUDE.md");
  assert.strictEqual(unchanged.action, "unchanged");

  // mutate the block body without touching the BEGIN/END markers
  const stale = appended.text.replace("Bootloader", "Bootloader-OLD");
  const replaced = applyBlock(stale, "CLAUDE.md");
  assert.strictEqual(replaced.action, "block-replaced");
  assert.ok(replaced.text.includes("# My project"), "content outside block untouched");
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

test("init (hybrid) scaffolds docs, merges settings, writes manifest", () => {
  const root = tmpProject();
  try {
    const res = init({ dir: root });
    assert.strictEqual(res.mode, "hybrid");

    assert.ok(fs.existsSync(path.join(root, "AIDD.md")));
    assert.ok(fs.existsSync(path.join(root, "PROJECT_BRIEF.md")));
    assert.ok(fs.existsSync(path.join(root, ".claude", "aidd-stop-rules.json")));
    assert.ok(fs.existsSync(path.join(root, ".claude", "aidd-secrets-patterns.json")), "catalog at project override location");
    assert.ok(fs.existsSync(path.join(root, ".claude", "skills", "aidd", "SKILL.md")));
    assert.ok(!fs.existsSync(path.join(root, ".claude", "hooks")), "hybrid does not copy the engine");
    assert.ok(fs.existsSync(path.join(root, ".aidd", "current")));

    const settings = JSON.parse(read(root, ".claude/settings.json"));
    assert.ok(JSON.stringify(settings).includes("node_modules/@fx-studio-ai/aidd"));

    const manifest = loadManifest(root);
    assert.strictEqual(manifest.package, "@fx-studio-ai/aidd");
    assert.strictEqual(manifest.mode, "hybrid");
    assert.ok(Object.keys(manifest.files).length > 10);
    assert.strictEqual(classify(root, "AIDD.md", manifest), "clean");

    const claude = read(root, "CLAUDE.md");
    assert.ok(claude.includes(BEGIN) && claude.includes(END));
  } finally {
    rm(root);
  }
});

test("init refuses a second run without --force", () => {
  const root = tmpProject();
  try {
    init({ dir: root });
    assert.throws(() => init({ dir: root }), /already installed/);
  } finally {
    rm(root);
  }
});

test("init never overwrites differing pre-existing files, adopts identical ones", () => {
  const root = tmpProject();
  try {
    write(root, "PROJECT_BRIEF.md", "# my own brief\n");
    const pkgAidd = fs.readFileSync(path.join(fm.packageRoot(), "AIDD.md"));
    write(root, "AIDD.md", pkgAidd);

    init({ dir: root });

    assert.strictEqual(read(root, "PROJECT_BRIEF.md"), "# my own brief\n", "user file untouched");
    const manifest = loadManifest(root);
    assert.strictEqual(manifest.files["PROJECT_BRIEF.md"], undefined, "differing file not adopted");
    assert.ok(manifest.files["AIDD.md"], "identical file adopted into manifest");
  } finally {
    rm(root);
  }
});

test("init preserves an existing CLAUDE.md and appends the block", () => {
  const root = tmpProject();
  try {
    write(root, "CLAUDE.md", "# Project rules\nDo X.\n");
    init({ dir: root });
    const text = read(root, "CLAUDE.md");
    assert.ok(text.startsWith("# Project rules"));
    assert.ok(text.includes(BEGIN));
  } finally {
    rm(root);
  }
});

test("init --mode copy ships the engine into the project", () => {
  const root = tmpProject();
  try {
    init({ dir: root, mode: "copy" });
    assert.ok(fs.existsSync(path.join(root, ".claude", "hooks", "aidd-sensor.cjs")));
    assert.ok(fs.existsSync(path.join(root, ".claude", "hooks", "lib", "aidd-paths.cjs")));
    const settings = read(root, ".claude/settings.json");
    assert.ok(!settings.includes("node_modules/@fx-studio-ai/aidd"));
  } finally {
    rm(root);
  }
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

test("update restores deleted files, keeps user edits, refreshes stale ones", () => {
  const root = tmpProject();
  try {
    init({ dir: root });

    // user edits a managed file
    write(root, "PROJECT_BRIEF.md", "# filled in by the user\n");
    // a managed file is deleted
    fs.rmSync(path.join(root, ".aidd", "domain-map.json"));
    // simulate a stale-but-unmodified file from an older release
    const manifest = loadManifest(root);
    write(root, "AIDD-RUNBOOK.md", "old shipped content\n");
    manifest.files["AIDD-RUNBOOK.md"] = sha256(Buffer.from("old shipped content\n"));
    fs.writeFileSync(path.join(root, ".aidd", "harness.json"), JSON.stringify(manifest, null, 2));

    const res = update({ dir: root });
    const byRel = Object.fromEntries(res.results.map((r) => [r.rel, r.action]));

    assert.strictEqual(byRel["PROJECT_BRIEF.md"], "kept (user-modified)");
    assert.strictEqual(byRel[".aidd/domain-map.json"], "restored");
    assert.strictEqual(byRel["AIDD-RUNBOOK.md"], "updated");
    assert.strictEqual(read(root, "PROJECT_BRIEF.md"), "# filled in by the user\n");
    assert.strictEqual(
      read(root, "AIDD-RUNBOOK.md"),
      fs.readFileSync(path.join(fm.packageRoot(), "AIDD-RUNBOOK.md"), "utf8")
    );
  } finally {
    rm(root);
  }
});

test("update without init fails with guidance", () => {
  const root = tmpProject();
  try {
    assert.throws(() => update({ dir: root }), /aidd init/);
  } finally {
    rm(root);
  }
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

test("doctor is green after a copy-mode init", () => {
  const root = tmpProject();
  try {
    init({ dir: root, mode: "copy" });
    const res = doctor({ dir: root });
    const errors = res.findings.filter((f) => f.level === "error");
    assert.deepStrictEqual(errors, [], JSON.stringify(errors, null, 2));
  } finally {
    rm(root);
  }
});

test("doctor flags an unreachable engine on hybrid installs without node_modules", () => {
  const root = tmpProject();
  try {
    init({ dir: root });
    const res = doctor({ dir: root });
    const engine = res.findings.find((f) => f.check === "engine");
    assert.strictEqual(engine.level, "error");
    assert.ok(engine.detail.includes("npm i -D"));
  } finally {
    rm(root);
  }
});

test("doctor reports drift on user-modified managed files", () => {
  const root = tmpProject();
  try {
    init({ dir: root, mode: "copy" });
    write(root, "CONTEXT_INDEX.md", "edited\n");
    const res = doctor({ dir: root });
    const drift = res.findings.find((f) => f.check === "drift");
    assert.strictEqual(drift.level, "warn");
    assert.ok(drift.detail.includes("CONTEXT_INDEX.md"));
  } finally {
    rm(root);
  }
});

// ---------------------------------------------------------------------------
// bin smoke
// ---------------------------------------------------------------------------

test("bin/aidd.cjs version and help run", () => {
  const bin = path.join(fm.packageRoot(), "bin", "aidd.cjs");
  const version = execFileSync(process.execPath, [bin, "version"], { encoding: "utf8" });
  assert.ok(version.includes("@fx-studio-ai/aidd@"));
  const help = execFileSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.ok(help.includes("aidd init"));
});

test("bin/aidd.cjs init --dry-run writes nothing", () => {
  const root = tmpProject();
  try {
    const bin = path.join(fm.packageRoot(), "bin", "aidd.cjs");
    const out = execFileSync(process.execPath, [bin, "init", "--dir", root, "--dry-run"], { encoding: "utf8" });
    assert.ok(out.includes("dry-run"));
    assert.ok(!fs.existsSync(path.join(root, "AIDD.md")));
    assert.ok(!fs.existsSync(path.join(root, ".aidd", "harness.json")));
  } finally {
    rm(root);
  }
});

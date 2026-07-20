"use strict";
// Classification of everything the package ships, from the installer's point
// of view. Three categories:
//
//   SCAFFOLD  — copied into the consumer project once, hash-tracked in the
//               manifest so `aidd update` can tell user edits from stale copies.
//   ENGINE    — the hook runtime (.claude/hooks/**). In hybrid mode it is
//               referenced from node_modules and never copied; in copy mode it
//               is copied and hash-tracked like scaffold.
//   BOOTLOADER— CLAUDE.md / AGENTS.md. Managed as a marked block inside the
//               consumer's file (created if absent), replaced on update.

const path = require("node:path");
const fs = require("node:fs");

const PKG_NAME = "@fx-studio-ai/aidd";

function packageRoot() {
  return path.resolve(__dirname, "..", "..");
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf8")).version;
}

// Copied as-is to the consumer project root.
const SCAFFOLD_FILES = [
  "AIDD.md",
  "AIDD-RUNBOOK.md",
  "CONTEXT_INDEX.md",
  "PROJECT_BRIEF.md",
  "PREREQUISITES.md",
  ".claude/aidd-stop-rules.json",
  ".claude/aidd-phase-guard-config.json",
  ".claude/aidd-rls-config.json",
  ".claude/aidd-tdd-config.json",
  ".aidd/domain-map.json",
  ".aidd/domain-map.schema.json",
  ".aidd/current/CURRENT_TASK.template.md",
];

// Directory trees copied recursively (every file hash-tracked individually).
const SCAFFOLD_DIRS = [".claude/skills"];

// The secrets catalog ships inside the engine dir but is user-customizable, so
// it is scaffolded to a project-level override location that the guard checks
// before falling back to its bundled copy.
const SECRETS_CATALOG = {
  src: ".claude/hooks/aidd-secrets-patterns.json",
  dest: ".claude/aidd-secrets-patterns.json",
};

const BOOTLOADERS = ["CLAUDE.md", "AGENTS.md"];

const SETTINGS_REL = ".claude/settings.json";
const MANIFEST_REL = ".aidd/harness.json";

/** Recursively list files under `dir`, returning project-relative POSIX paths. */
function walkRel(rootDir, relDir) {
  const out = [];
  const abs = path.join(rootDir, relDir);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkRel(rootDir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Every scaffold file as a project-relative POSIX path, resolved against the package. */
function scaffoldList() {
  const root = packageRoot();
  const fromDirs = SCAFFOLD_DIRS.flatMap((d) => walkRel(root, d));
  return [...SCAFFOLD_FILES, ...fromDirs];
}

/** Engine files (.claude/hooks/**), project-relative POSIX paths. */
function engineList() {
  return walkRel(packageRoot(), ".claude/hooks").filter((f) => f !== SECRETS_CATALOG.src);
}

/**
 * Detecta as ferramentas presentes no projeto-alvo (base do install por
 * camadas). Codex: `.codex/` OU `AGENTS.md` pré-existente (R1 f13 — muitos
 * projetos Codex só têm o bootloader). Git: `.git` dir ou file (worktrees).
 */
function detectProviders(targetRoot) {
  return {
    claude: fs.existsSync(path.join(targetRoot, ".claude")),
    codex:
      fs.existsSync(path.join(targetRoot, ".codex")) ||
      fs.existsSync(path.join(targetRoot, "AGENTS.md")),
    git: fs.existsSync(path.join(targetRoot, ".git")),
  };
}

module.exports = {
  PKG_NAME,
  packageRoot,
  packageVersion,
  detectProviders,
  SCAFFOLD_FILES,
  SCAFFOLD_DIRS,
  SECRETS_CATALOG,
  BOOTLOADERS,
  SETTINGS_REL,
  MANIFEST_REL,
  scaffoldList,
  engineList,
  walkRel,
};

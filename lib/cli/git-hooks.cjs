"use strict";
// Git pre-commit net installer — the "chain, never overwrite" layer.
//
// Resolution: the EFFECTIVE hooks dir comes from `git rev-parse --git-path
// hooks`, which honors core.hooksPath (husky et al.) and worktrees (R1 f7).
// Wrapper: #!/bin/sh, LF-only, mode 0755, AIDD marker line; missing node at
// commit time → warn + exit 0 (environment fail-open, R1 f8).
// Install cases: absent → write; ours (marker) → rewrite (idempotent);
// foreign → rename aside to pre-commit.local and dispatch to it first.
// Update: marker intact → regenerate; hand-edited → refuse loudly (R1 f14).

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fm = require("./files-map.cjs");

const MARKER = "# AIDD-GIT-NET";
const HOOK_NAME = "pre-commit";
const LOCAL_NAME = "pre-commit.local";

/** Effective hooks dir (absolute) or null when not a git repo. */
function resolveHooksDir(targetRoot) {
  const r = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: targetRoot, encoding: "utf8" });
  if (r.status !== 0) return null;
  const p = r.stdout.trim();
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(targetRoot, p);
}

function engineRelPath(mode) {
  return mode === "copy"
    ? ".claude/hooks/lib/git-net.cjs"
    : `node_modules/${fm.PKG_NAME}/.claude/hooks/lib/git-net.cjs`;
}

function wrapperText(mode, version) {
  const engine = engineRelPath(mode);
  // LF-only por construção; git executa hooks com cwd = raiz do worktree.
  return [
    "#!/bin/sh",
    `${MARKER} v${version} — managed by aidd; hand-edits are preserved but never auto-updated`,
    `hook_dir=$(dirname "$0")`,
    `if [ -f "$hook_dir/${LOCAL_NAME}" ]; then`,
    `  sh "$hook_dir/${LOCAL_NAME}" || exit $?`,
    `fi`,
    `command -v node >/dev/null 2>&1 || { echo "[aidd] node nao encontrado no PATH — guardas pulados (fail-open de ambiente)" >&2; exit 0; }`,
    `node "${engine}" || exit $?`,
    "",
  ].join("\n");
}

function writeHook(hookPath, text) {
  fs.writeFileSync(hookPath, text); // \n-only por construção
  try { fs.chmodSync(hookPath, 0o755); } catch { /* no-op no Windows */ }
}

/** Camada git no init. Registra em manifest.layers.git. */
function installGitHooksLayer(targetRoot, manifest, results, opts = {}) {
  const hooksDir = resolveHooksDir(targetRoot);
  const relLabel = ".git hooks: pre-commit";
  if (!hooksDir) {
    results.push({ rel: relLabel, action: "skipped (not a git repo)" });
    return;
  }
  if (opts.dryRun) {
    results.push({ rel: relLabel, action: "dry-run (would install)" });
    manifest.layers = { ...(manifest.layers || {}), git: true };
    return;
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, HOOK_NAME);
  const text = wrapperText(opts.mode || "hybrid", fm.packageVersion());

  if (fs.existsSync(hookPath)) {
    const current = fs.readFileSync(hookPath, "utf8");
    if (current.includes(MARKER)) {
      writeHook(hookPath, text);
      results.push({ rel: relLabel, action: "reinstalled (marker)" });
    } else if (fs.existsSync(path.join(hooksDir, LOCAL_NAME))) {
      results.push({ rel: relLabel, action: `skipped (${LOCAL_NAME} ja existe — resolva manualmente)` });
      return;
    } else {
      fs.renameSync(hookPath, path.join(hooksDir, LOCAL_NAME));
      writeHook(hookPath, text);
      results.push({ rel: relLabel, action: `installed (hook existente encadeado como ${LOCAL_NAME})` });
    }
  } else {
    writeHook(hookPath, text);
    results.push({ rel: relLabel, action: "installed" });
  }

  manifest.layers = { ...(manifest.layers || {}), git: true };
}

/** Camada git no update: regenerar com marcador; recusar mão-editada. */
function updateGitHooksLayer(targetRoot, manifest, results, opts = {}) {
  const hooksDir = resolveHooksDir(targetRoot);
  const relLabel = ".git hooks: pre-commit";
  if (!hooksDir) {
    results.push({ rel: relLabel, action: "skipped (not a git repo)" });
    return;
  }
  const hookPath = path.join(hooksDir, HOOK_NAME);
  const text = wrapperText(opts.mode || (manifest && manifest.mode) || "hybrid", fm.packageVersion());

  if (opts.dryRun) {
    results.push({ rel: relLabel, action: "dry-run (would refresh)" });
    return;
  }

  if (!fs.existsSync(hookPath)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    writeHook(hookPath, text);
    results.push({ rel: relLabel, action: "restored" });
    return;
  }
  const current = fs.readFileSync(hookPath, "utf8");
  if (current.includes(MARKER)) {
    if (current === text) {
      results.push({ rel: relLabel, action: "up-to-date" });
    } else {
      writeHook(hookPath, text);
      results.push({ rel: relLabel, action: "regenerated (marker intact)" });
    }
    return;
  }
  results.push({ rel: relLabel, action: "kept (hand-edited/foreign pre-commit — refused to touch; use `aidd init --force` para reinstalar)" });
}

/** Checagens da camada git para o doctor. */
function checkGitHooksLayer(targetRoot, manifest, ok, warn, error) {
  const hooksDir = resolveHooksDir(targetRoot);
  if (!hooksDir) {
    error("git-net", "nao e um repositorio git — a camada git registrada no manifesto nao pode operar");
    return;
  }
  const hookPath = path.join(hooksDir, HOOK_NAME);
  if (!fs.existsSync(hookPath)) {
    error("git-net", `pre-commit ausente em ${hookPath} — rode \`aidd update\` (per-clone: cada clone precisa de \`aidd init\`)`);
    return;
  }
  const text = fs.readFileSync(hookPath, "utf8");
  if (!text.includes(MARKER)) {
    warn("git-net", "pre-commit existe mas sem marcador AIDD (hook estrangeiro/mao-editado) — a rede NAO esta ativa");
    return;
  }
  if (text.includes("\r")) {
    error("git-net", "pre-commit contem CRLF — quebra em Linux/macOS; rode `aidd update` para regenerar");
    return;
  }
  if (process.platform !== "win32") {
    try {
      const mode = fs.statSync(hookPath).mode & 0o777;
      if (!(mode & 0o111)) {
        error("git-net", "pre-commit sem bit de execucao — git vai ignora-lo silenciosamente; rode `aidd update`");
        return;
      }
    } catch { /* stat falhou — segue */ }
  }
  const nodeCheck = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], { encoding: "utf8" });
  if (nodeCheck.status !== 0) {
    warn("git-net", "node nao encontrado no PATH — a rede vai pular os guardas no commit (fail-open de ambiente)");
  }
  ok("git-net", `${hookPath} (marker OK)`);
}

module.exports = {
  MARKER,
  resolveHooksDir,
  engineRelPath,
  wrapperText,
  installGitHooksLayer,
  updateGitHooksLayer,
  checkGitHooksLayer,
};

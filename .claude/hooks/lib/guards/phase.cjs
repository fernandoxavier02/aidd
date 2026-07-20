"use strict";
// Neutral core: phase guard — does the edited path fit the current AIDD phase?
// Phase/status/mode arrive pre-loaded in event.config.phaseGuard; loadConfig()
// is the fs helper adapters call to build that config.

const fs = require("node:fs");
const path = require("node:path");
const { allow, warn, deny } = require("./verdict.cjs");

const PHASE_NAMES = {
  1: "intake", 2: "context-discovery", 3: "domain", 4: "process-mapping",
  5: "requirements", 6: "spec-validate", 7: "design", 8: "tasks",
  9: "implementation", 10: "verification", 11: "review", 12: "documentation",
};

function classifyPath(rel) {
  if (/^\.aidd\//.test(rel)) return "aidd-working";
  if (/^\.kiro\/specs\//.test(rel)) return "spec";
  if (/^\.kiro\/steering\//.test(rel)) return "steering";
  if (/^docs\/adr\//.test(rel)) return "adr";
  if (/^docs\//.test(rel)) return "docs";
  if (/^(apps|services|packages)\/[^/]+\/(src|app)\//.test(rel)) return "production";
  if (/^scripts\//.test(rel)) return "scripts";
  if (/^infra\//.test(rel)) return "infra";
  if (/^\.claude\//.test(rel) || rel === ".gitignore" || /\.json$/.test(rel)) return "config";
  return "other";
}

function evaluatePhaseFit(phase, status, pathClass) {
  const phaseNum = parseInt(phase, 10);
  if (status === "done" || status === "done-local") {
    if (pathClass === "aidd-working") return { ok: true };
    return { ok: false, reason: `Tarefa atual está com status=${status}. Edits em ${pathClass} antes de /aidd-intake são suspeitos. Considere: /aidd-close (se ainda não fechou) ou /aidd-intake (se é nova tarefa).` };
  }
  if (!Number.isInteger(phaseNum)) {
    return { ok: false, reason: `CURRENT_TASK.md não tem campo 'phase' no frontmatter. Invoque /aidd para diagnosticar ou /aidd-intake para iniciar tarefa formalmente.` };
  }
  if (phaseNum >= 1 && phaseNum <= 4) {
    if (pathClass === "aidd-working" || pathClass === "docs" || pathClass === "config") return { ok: true };
    if (pathClass === "production" || pathClass === "spec") {
      return { ok: false, reason: `Phase=${phaseNum} (${PHASE_NAMES[phaseNum]}) — esperado completar discovery antes de tocar ${pathClass}. Avance phase via /aidd e fases 5-8 antes de production.` };
    }
    return { ok: true };
  }
  if (phaseNum >= 5 && phaseNum <= 8) {
    if (pathClass === "spec" || pathClass === "aidd-working" || pathClass === "docs" || pathClass === "adr" || pathClass === "config") return { ok: true };
    if (pathClass === "production") {
      return { ok: false, reason: `Phase=${phaseNum} (${PHASE_NAMES[phaseNum]}) — phase de spec/design/tasks NÃO permite edit em production. Use /aidd-impl-start primeiro (após gate humano #3).` };
    }
    return { ok: true };
  }
  if (phaseNum === 9) {
    return { ok: true }; // tdd-guard cuida do enforcement de TDD aqui
  }
  if (phaseNum === 10 || phaseNum === 11) {
    if (pathClass === "production") {
      return { ok: false, reason: `Phase=${phaseNum} (${PHASE_NAMES[phaseNum]}) — phase de verify/review espera leitura + fixes pontuais. Edits massivos sugerem retorno para Phase 9.` };
    }
    return { ok: true };
  }
  if (phaseNum === 12) {
    if (pathClass === "aidd-working" || pathClass === "docs" || pathClass === "config") return { ok: true };
    return { ok: false, reason: `Phase=12 (${PHASE_NAMES[12]}) — fechamento. Edits substanciais sugerem nova tarefa via /aidd-intake.` };
  }
  return { ok: true };
}

/** Reads a file's YAML-ish frontmatter as flat key/value pairs. */
function readFrontmatter(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); } catch { return {}; }
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const result = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (kv) result[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

/** fs helper for adapters: builds event.config.phaseGuard from disk. */
function loadConfig(projectRoot) {
  let enabled = true;
  let mode = "warn";
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "aidd-phase-guard-config.json"), "utf8"));
    enabled = raw.enabled !== false;
    mode = raw.mode === "block" ? "block" : "warn";
  } catch { /* defaults */ }
  const taskFile = path.join(projectRoot, ".aidd", "current", "CURRENT_TASK.md");
  const present = fs.existsSync(taskFile);
  const fm = present ? readFrontmatter(taskFile) : {};
  return { enabled, mode, present, phase: fm.phase, status: fm.status };
}

function evaluate(event) {
  const cfg = (event && event.config && event.config.phaseGuard) || {};
  if (cfg.enabled === false) return allow();
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("phase-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  if (!cfg.present) return allow(); // projeto fresh, antes de /aidd-intake
  const rel = event.path.replace(/\\/g, "/");
  const fit = evaluatePhaseFit(cfg.phase, cfg.status, classifyPath(rel));
  if (fit.ok) return allow();
  if (cfg.mode === "block") {
    return deny(fit.reason + " (mode=block; override: AIDD_PHASE_OVERRIDE=1)", { rel });
  }
  return warn(fit.reason, { rel });
}

module.exports = { evaluate, loadConfig, classifyPath, evaluatePhaseFit, readFrontmatter, PHASE_NAMES };

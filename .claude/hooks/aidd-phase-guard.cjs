#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, currentTaskFile, verificationFile, validateSafePath, safeAppend } = require("./lib/aidd-paths.cjs");

const WATCHED_TOOLS = new Set(["Edit", "Write"]);
const CONFIG_FILE = path.join(getProjectRoot(), ".claude", "aidd-phase-guard-config.json");

const PHASE_NAMES = {
  1: "intake", 2: "context-discovery", 3: "domain", 4: "process-mapping",
  5: "requirements", 6: "spec-validate", 7: "design", 8: "tasks",
  9: "implementation", 10: "verification", 11: "review", 12: "documentation",
};

function readStdin() {
  return new Promise((res) => {
    let d = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => res(d));
  });
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function allow() { process.exit(0); }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return {
      enabled: raw.enabled !== false,
      mode: raw.mode === "block" ? "block" : "warn",
    };
  } catch {
    return { enabled: true, mode: "warn" };
  }
}

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

function logWarning(rel, reason) {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    const block = [
      "",
      `### ${ts} - phase-guard-warn`,
      `**File:** ${rel}`,
      `**Reason:** ${reason.slice(0, 400)}`,
      `**Action required:** review se foi falso positivo (phase desatualizada) ou genuíno (pulou fase).`,
      "",
    ].join("\n");
    const header = "## Phase-guard warnings (auto-logged)";
    let existing = "";
    try { existing = fs.readFileSync(verificationFile(), "utf8"); } catch { existing = ""; }
    if (!existing.includes(header)) {
      safeAppend(verificationFile(), `\n${header}\n${block}`);
    } else {
      safeAppend(verificationFile(), block);
    }
  } catch { /* non-fatal */ }
}

(async () => {
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { allow(); return; }

  const tool = payload.tool_name;
  if (!WATCHED_TOOLS.has(tool)) { allow(); return; }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) { allow(); return; }

  const config = loadConfig();
  if (!config.enabled) { allow(); return; }
  if (process.env.AIDD_PHASE_OVERRIDE === "1") { allow(); return; }

  const root = getProjectRoot();
  const safe = validateSafePath(filePath, root);
  if (!safe.ok) {
    deny(`phase-guard rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`);
    return;
  }
  const rel = safe.rel;

  // Se CURRENT_TASK.md não existe (projeto fresh, antes de /aidd-intake), passa-through
  // para não bloquear setup inicial. Stop Rule "Non-inventive" cobre o resto.
  if (!fs.existsSync(currentTaskFile())) { allow(); return; }

  const fm = readFrontmatter(currentTaskFile());
  const verdict = evaluatePhaseFit(fm.phase, fm.status, classifyPath(rel));

  if (verdict.ok) { allow(); return; }

  if (config.mode === "block") {
    deny(verdict.reason + " (mode=block; override: AIDD_PHASE_OVERRIDE=1)");
    return;
  }

  // mode=warn — registra mas permite
  logWarning(rel, verdict.reason);
  allow();
})();

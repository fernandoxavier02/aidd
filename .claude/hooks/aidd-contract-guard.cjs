#!/usr/bin/env node
const path = require("node:path");
const fs = require("node:fs");
const { getProjectRoot, validateSafePath } = require("./lib/aidd-paths.cjs");

const WATCHED = new Set(["Edit", "Write", "MultiEdit"]);

const PROTECTED_FILES = [
  /^AIDD\.md$/,
  /^CONTEXT_INDEX\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
];

// ---------------------------------------------------------------------------
// Aidd_Contract_Guard_V1.1 — bypass para install de v2
//
// Problema: v2 precisa editar arquivos protegidos (AIDD.md, CONTEXT_INDEX.md,
// etc.) durante o processo de install — paradoxo de auto-instalacao.
// Solucao (design §3.12): env var AIDD_V2_INSTALL=1 + whitelist fixa em codigo
// habilita bypass auditado. Whitelist NAO e lida de arquivo externo (risco de
// injecao via arquivo de config). Todo bypass gera entry em .aidd/telemetry/
// contract-bypass.jsonl para auditoria (propriedade P2 do design).
// ---------------------------------------------------------------------------

/** Whitelist fixa — NAO modificar sem ADR superseding este. */
const INSTALL_WHITELIST = [
  "AIDD.md",
  "CONTEXT_INDEX.md",
  "AGENTS.md",
  "CLAUDE.md",
];

/**
 * Retorna true somente se AIDD_V2_INSTALL=1 E o path esta na whitelist.
 * Qualquer outra combinacao retorna false (deny preservado).
 */
function isInstallBypassAllowed(relPath) {
  if (process.env.AIDD_V2_INSTALL !== "1") return false;
  return INSTALL_WHITELIST.includes(relPath);
}

/**
 * Persiste entrada de auditoria em .aidd/telemetry/contract-bypass.jsonl.
 * Falhas de IO nao bloqueiam o bypass — log best-effort.
 */
function logBypass(relPath, sessionId) {
  const telemetryDir = path.join(getProjectRoot(), ".aidd", "telemetry");
  try { fs.mkdirSync(telemetryDir, { recursive: true }); } catch (_e) {}
  const entry = JSON.stringify({
    file_path: relPath,
    ts: new Date().toISOString(),
    session_id: sessionId ?? "unknown",
    reason: "v2-install",
  });
  try {
    fs.appendFileSync(path.join(telemetryDir, "contract-bypass.jsonl"), entry + "\n", "utf8");
  } catch (_e) {}
}

// ---------------------------------------------------------------------------

const PROTECTED_DIRS = [
  /^\.kiro\/steering\/[^/]+\.md$/,
];

const ADR_PATTERN = /^docs\/adr\/(\d+)-[^/]+\.md$/;

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

(async () => {
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { allow(); return; }

  const tool = payload.tool_name;
  if (!WATCHED.has(tool)) { allow(); return; }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) { allow(); return; }

  const root = getProjectRoot();
  const safe = validateSafePath(filePath, root);
  if (!safe.ok) {
    deny(`contract-guard rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`);
    return;
  }
  const rel = safe.rel;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);

  // V1.1: bypass auditado para install de v2 — verificar ANTES do deny
  let matchedProtected = false;
  for (const pat of PROTECTED_FILES) {
    if (pat.test(rel)) { matchedProtected = true; break; }
  }
  if (matchedProtected && isInstallBypassAllowed(rel)) {
    logBypass(rel, payload.session_id);
    allow();
    return;
  }

  for (const pat of PROTECTED_FILES) {
    if (pat.test(rel)) {
      deny(
        `${rel} e parte do nucleo AIDD (metodologia/bootloader/index). ` +
        `Mudancas exigem ADR + atualizacao de CURRENT_TASK.md. ` +
        `Se for intencional, registre o plano em .aidd/current/CURRENT_TASK.md primeiro e desabilite este gate temporariamente em .claude/settings.json.`
      );
      return;
    }
  }

  for (const pat of PROTECTED_DIRS) {
    if (pat.test(rel)) {
      deny(
        `${rel} e canonical steering Kiro v3. ` +
        `Mudar product/structure/tech requer ADR. ` +
        `Se for intencional, abra ADR em docs/adr/ primeiro.`
      );
      return;
    }
  }

  const adrMatch = rel.match(ADR_PATTERN);
  if (adrMatch) {
    if (tool === "Write" && !fs.existsSync(abs)) {
      allow();
      return;
    }
    deny(
      `${rel} e um ADR. ADRs aceitos sao imutaveis - mudancas exigem novo ADR (superseding). ` +
      `Para criar novo ADR: use proximo numero sequencial em docs/adr/.`
    );
    return;
  }

  allow();
})();

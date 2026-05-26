#!/usr/bin/env node
/**
 * aidd-secrets-guard.cjs — PreToolUse hook
 *
 * Bloqueia escrita de credentials/secrets antes que entrem no repo.
 *
 * Ordem de avaliacao:
 *   1. DENY incondicional se file_path == .env* (exceto .example/.template)
 *   2. Fail-safe DENY se catalog < 12 patterns
 *   3. Para cada pattern no catalog:
 *      - WARN+ALLOW em docs/ ou *.md (WARN_PATHS)
 *      - DENY + telemetria em qualquer outro path
 *      - Override via AIDD_OVERRIDE_SECRETS >= 20 chars → ALLOW + auditoria
 *   4. ALLOW se nenhum pattern casou
 *
 * NFR-5: telemetria NAO vaza o valor do secret — apenas pattern.id e file_path.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent } = require("./lib/aidd-paths.cjs");

// ---------------------------------------------------------------------------
// Ferramentas que escrevem conteudo (PreToolUse scan de new_string / content)
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// ---------------------------------------------------------------------------
// Path rules
// ---------------------------------------------------------------------------
/** .env, .env.local, .env.production, .env.development, etc. — DENY incondicional */
const DENY_PATHS = /(?:^|[\\/])\.(env)(?:\.[^/\\]+)?$/;
/** Excecoes ao DENY_PATHS: arquivos de exemplo/template sao OK */
const EXAMPLE_OK = /\.env\.(example|template)$/;
/** Paths de documentacao/exemplos — WARN+ALLOW em vez de DENY */
const WARN_PATHS = /(?:^|[\\/])docs[\\/]|\.md$/i;

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------
const PROJECT_ROOT = getProjectRoot();
const TELEMETRY_DIR = path.join(PROJECT_ROOT, ".aidd", "telemetry");

function logTelemetry(filename, entry) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    const filePath = path.join(TELEMETRY_DIR, filename);
    safeAppend(filePath, JSON.stringify(entry) + "\n");
  } catch {
    // telemetria nunca deve crashar o hook
  }
}

// ---------------------------------------------------------------------------
// Output helpers (formato padrao Claude Code hooks)
// ---------------------------------------------------------------------------
function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function allowWithWarn(warnMessage) {
  // Escreve no stderr para o agente ver; stdout vazio = allow
  process.stderr.write(`[aidd-secrets-guard] WARN: ${warnMessage}\n`);
  process.stdout.write("");
  process.exit(0);
}

function allow() {
  process.stdout.write("");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Catalog loader — fail-safe DENY se catalog < 12 patterns
// ---------------------------------------------------------------------------
function loadCatalog() {
  const catalogPath =
    process.env.AIDD_SECRETS_CATALOG ||
    path.join(__dirname, "aidd-secrets-patterns.json");

  let raw;
  try {
    raw = fs.readFileSync(catalogPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `Catalog nao encontrado: ${catalogPath} — ${e.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `Catalog JSON invalido: ${e.message}` };
  }

  if (!Array.isArray(parsed.patterns) || parsed.patterns.length < 12) {
    return {
      ok: false,
      reason: `Catalog tem ${(parsed.patterns || []).length} patterns — minimo 12 requerido (fail-safe ativo)`,
    };
  }

  // Compilar regex de cada pattern
  const compiled = parsed.patterns.map((p) => ({
    id: p.id,
    family: p.family,
    re: new RegExp(p.regex, p.flags || ""),
  }));

  return { ok: true, patterns: compiled };
}

// ---------------------------------------------------------------------------
// Extrai conteudo relevante do payload do hook
// ---------------------------------------------------------------------------
function extractContent(toolInput) {
  // Edit envia new_string; Write envia content
  return extractWriteContent(toolInput);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let inputRaw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { inputRaw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(inputRaw);
  } catch {
    // Payload invalido — allow por seguranca (nao bloquear sem evidencia)
    allow();
  }

  const toolName = payload.tool_name || "";
  const sessionId = payload.session_id || "unknown";
  const toolInput = payload.tool_input || {};
  const rawFilePath = toolInput.file_path || "";

  // Apenas ferramentas de escrita sao monitoradas
  if (!WRITE_TOOLS.has(toolName)) {
    allow();
    return;
  }

  // Validar path (anti-traversal)
  const pathCheck = validateSafePath(rawFilePath, PROJECT_ROOT);
  const filePath = pathCheck.ok ? pathCheck.rel : rawFilePath;

  const ts = new Date().toISOString();

  // ------------------------------------------------------------------
  // Regra 1: DENY incondicional em .env* (exceto .example/.template)
  // EXAMPLE_OK verificado PRIMEIRO para evitar false positive em .env.example
  // ------------------------------------------------------------------
  if (!EXAMPLE_OK.test(filePath) && DENY_PATHS.test(filePath)) {
    logTelemetry("secrets-block.jsonl", {
      pattern: "env-file-rule",
      file_path: filePath,
      ts,
      session_id: sessionId,
      override_used: false,
    });
    deny(
      `Arquivo .env detectado: '${filePath}'. Nao edite arquivos .env diretamente — ` +
      "use .env.example para placeholders e carregue secrets server-side. " +
      "Document any exception in an ADR."
    );
    return;
  }

  // ------------------------------------------------------------------
  // Regra 1b: ALLOW direto para .env.example/.env.template (placeholder files)
  // Estes arquivos existem PARA conter exemplos de secrets — nao escanear patterns.
  // ------------------------------------------------------------------
  if (EXAMPLE_OK.test(filePath)) {
    allow();
    return;
  }

  // ------------------------------------------------------------------
  // Regra 2: Carregar catalog (fail-safe)
  // ------------------------------------------------------------------
  const catalog = loadCatalog();
  if (!catalog.ok) {
    deny(`[aidd-secrets-guard] Fail-safe ativado — ${catalog.reason}`);
    return;
  }

  // ------------------------------------------------------------------
  // Regra 3: Escanear conteudo contra patterns
  // ------------------------------------------------------------------
  const content = extractContent(toolInput);

  for (const p of catalog.patterns) {
    // Reset lastIndex para regex globais
    p.re.lastIndex = 0;
    if (!p.re.test(content)) continue;
    p.re.lastIndex = 0;

    // Pattern casou — verificar se e path de aviso (docs/)
    if (WARN_PATHS.test(filePath)) {
      logTelemetry("secrets-warn.jsonl", {
        pattern: p.id,
        file_path: filePath,
        ts,
        session_id: sessionId,
        override_used: false,
      });
      allowWithWarn(
        `Pattern '${p.family}' (${p.id}) encontrado em path de documentacao '${filePath}'. ` +
        "Se for placeholder, esta OK. Verifique se nao e valor real."
      );
      return;
    }

    // Path nao e docs/ — registrar bloco
    logTelemetry("secrets-block.jsonl", {
      pattern: p.id,
      file_path: filePath,
      ts,
      session_id: sessionId,
      override_used: false,
    });

    // Verificar override
    const overrideVal = process.env.AIDD_OVERRIDE_SECRETS || "";
    if (overrideVal.length >= 20) {
      logTelemetry("secrets-overrides.jsonl", {
        pattern: p.id,
        file_path: filePath,
        reason: overrideVal.slice(0, 120), // NFR-5: razao truncada, sem valor do secret
        ts,
        session_id: sessionId,
      });
      allowWithWarn(
        `Override aplicado: '${overrideVal.slice(0, 60)}'. ` +
        `Pattern '${p.family}' (${p.id}) em '${filePath}'.`
      );
      return;
    }

    // Sem override valido — DENY
    deny(
      `Secret pattern '${p.family}' (${p.id}) detectado em '${filePath}'. ` +
      "Mova o secret para env var carregada server-side ou use placeholder em .env.example. " +
      "Para override emergencial, defina AIDD_OVERRIDE_SECRETS com razao >= 20 caracteres."
    );
    return;
  }

  // Nenhum pattern casou — allow
  allow();
});

#!/usr/bin/env node
// aidd-rls-guard.cjs — PreToolUse hook
//
// Bloqueia migrations SQL que criam tabelas sem ENABLE ROW LEVEL SECURITY
// ou que removem/desativam politicas sem justificativa ADR documentada.
// Tambem emite WARN para modelos Prisma sem anotacao @rls-policy.
//
//
// Trigger paths:
//   - supabase/migrations/**
//   - migrations/*.sql
//   - policies/*.sql
//   - schema.prisma
//
// Algoritmo:
//   1. Verificar se o path e acionavel (SQL migration ou schema.prisma)
//   2. Para schema.prisma: detectar model sem @rls-policy -> WARN+ALLOW
//   3. Para SQL: detectar CREATE TABLE -> checar ENABLE RLS local + companions
//   4. Para SQL: detectar DROP POLICY / DISABLE ROW LEVEL SECURITY -> checar ADR comment
//   5. Override via AIDD_OVERRIDE_RLS=ADR-NNNN (padrao estrito)
//   6. Telemetria: rls-block.jsonl, rls-warn.jsonl, rls-overrides.jsonl
//
// AIDD_RLS_MIGRATION_DIR: override do dir de migrations para testes

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent, adrExists } = require("./lib/aidd-paths.cjs");

// Opt-in gate: RLS enforcement is OFF by default in the generic harness.
// Enable per-project by creating .claude/aidd-rls-config.json with { "enabled": true }.
function rlsEnabled() {
  try {
    const cfgPath = path.join(getProjectRoot(), ".claude", "aidd-rls-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return cfg.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ferramentas que escrevem conteudo (PreToolUse scan)
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// ---------------------------------------------------------------------------
// Path patterns que acionam este hook
// ---------------------------------------------------------------------------
const SQL_MIGRATION_RE = /(?:(?:^|[\\/])migrations[\\/].*\.sql$|^supabase[\\/]migrations[\\/].*\.sql$|(?:^|[\\/])policies[\\/].*\.sql$)/i;
const PRISMA_SCHEMA_RE = /schema\.prisma$/i;

// ---------------------------------------------------------------------------
// Patterns de deteccao (AC 7.1-7.4)
// ---------------------------------------------------------------------------
const CREATE_TABLE_RE = /\bCREATE\s+TABLE\b/i;
const ENABLE_RLS_RE = /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i;
const DROP_POLICY_RE = /\bDROP\s+POLICY\b/i;
const DISABLE_RLS_RE = /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i;
const DISABLE_TRIGGER_RE = /\bALTER\s+TABLE\s+.*\bDISABLE\s+TRIGGER\b/i;

/**
 * Remove linhas de comentario SQL (-- ...) do conteudo para evitar
 * falsos negativos onde instrucoes aparecem em comentarios de intencao.
 * Ex: "-- Sem ENABLE ROW LEVEL SECURITY" nao deve ser detectado como ENABLE.
 */
function stripSqlLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      // Remove tudo apos -- (exceto dentro de strings, que nao tratamos aqui)
      const commentIdx = line.indexOf("--");
      if (commentIdx === -1) return line;
      // Preservar comentarios ADR-NNNN (sao usados para verificar justificativa)
      // mas remover o resto para deteccao de instrucoes
      return line.slice(0, commentIdx);
    })
    .join("\n");
}

/** ADR comment obrigatorio: -- ADR-NNNN: <justificativa >= 10 chars> */
const ADR_COMMENT_RE = /--\s+ADR-(\d{4}):\s+(.{10,})/;

/** Override valido: AIDD_OVERRIDE_RLS=ADR-NNNN (4 digitos exatos) */
const OVERRIDE_ADR_RE = /^ADR-\d{4}$/;

/** Prisma model sem @rls-policy */
const PRISMA_MODEL_RE = /^model\s+\w+\s*\{/gm;
const PRISMA_RLS_POLICY_RE = /\/\/\/\s*@rls-policy\b|\/\/\/\s*@rls-exempt-reason\b/;

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
// Output protocol
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

function allow() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "allow",
      },
    })
  );
  process.exit(0);
}

function warnAndAllow(warnMessage) {
  process.stderr.write(`[aidd-rls-guard] WARN: ${warnMessage}\n`);
  // ALLOW implicito (nao emite deny)
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Companion file detection (AC 7.2)
//
// "Migration unit" = arquivos na mesma pasta que compartilham o mesmo
// prefixo de timestamp (formato: YYYYMMDDHHMMSS_ ou qualquer prefixo
// numerico antes do primeiro underscore).
// ---------------------------------------------------------------------------
function readSiblingsInMigration(filePath) {
  // Usa AIDD_RLS_MIGRATION_DIR como override para testes
  const migDir = process.env.AIDD_RLS_MIGRATION_DIR || path.dirname(filePath);

  if (!fs.existsSync(migDir)) return [];

  const basename = path.basename(filePath);
  // Extrai prefixo de timestamp (digits antes do primeiro underscore)
  const prefixMatch = basename.match(/^(\d+)_/);
  const prefix = prefixMatch ? prefixMatch[1] : null;

  let siblings = [];
  try {
    const entries = fs.readdirSync(migDir);
    for (const entry of entries) {
      const entryPath = path.join(migDir, entry);
      if (entryPath === filePath) continue;
      if (!entry.endsWith(".sql")) continue;

      // Se tem mesmo prefixo de timestamp, e companion
      if (prefix) {
        if (entry.startsWith(prefix + "_")) {
          try {
            siblings.push(fs.readFileSync(entryPath, "utf8"));
          } catch {
            // ignora arquivos ilegíveis
          }
        }
      }
    }
  } catch {
    // ignora erros de listagem de diretorio
  }

  return siblings;
}

// ---------------------------------------------------------------------------
// Verificacao de ADR comment em linha anterior ou proximo ao comando
// ---------------------------------------------------------------------------
function hasAdrComment(content, commandRe) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (commandRe.test(lines[i])) {
      // Verifica a linha atual e as 3 anteriores para ADR comment
      const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (ADR_COMMENT_RE.test(window)) {
        // Extrai justificativa e verifica tamanho minimo (>= 10 chars)
        const match = window.match(ADR_COMMENT_RE);
        if (match && match[2] && match[2].trim().length >= 10) {
          return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Verificacao de Prisma models sem @rls-policy
// ---------------------------------------------------------------------------
function checkPrismaSchema(content, filePath) {
  const modelMatches = [...content.matchAll(PRISMA_MODEL_RE)];
  if (modelMatches.length === 0) return; // Nenhum model — OK

  const missingRls = [];
  for (const match of modelMatches) {
    // Extrai o bloco do model (ate o fechamento da chave)
    const start = match.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const modelBlock = content.slice(start, end);

    // Verifica se ha anotacao @rls-policy ou @rls-exempt-reason
    if (!PRISMA_RLS_POLICY_RE.test(modelBlock)) {
      const nameMatch = match[0].match(/^model\s+(\w+)/);
      missingRls.push(nameMatch ? nameMatch[1] : "unknown");
    }
  }

  if (missingRls.length > 0) {
    const warnMsg = `Prisma model(s) sem /// @rls-policy ou /// @rls-exempt-reason: ${missingRls.join(", ")}. Adicione anotacao ou justificativa de excecao.`;
    process.stderr.write(`[aidd-rls-guard] WARN: ${warnMsg}\n`);
    logTelemetry("rls-warn.jsonl", {
      ts: new Date().toISOString(),
      file_path: filePath,
      models: missingRls,
      warn: "prisma-model-no-rls-policy",
    });
    // WARN-only: nao DENY
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // JSON invalido — fail-safe ALLOW
    allow();
  }

  const toolName = payload?.tool_name ?? "";
  if (!WRITE_TOOLS.has(toolName)) {
    allow();
  }

  if (!rlsEnabled()) {
    allow();
  }

  const toolInput = payload?.tool_input ?? {};
  const filePath = toolInput?.file_path ?? "";
  const sessionId = payload?.session_id ?? "unknown";

  // Validar path
  const pathCheck = validateSafePath(filePath, PROJECT_ROOT);
  if (!pathCheck.ok) {
    allow(); // path fora do projeto — deixa outros hooks tratarem
  }

  const relPath = pathCheck.rel || filePath;

  // Normalizar para forward-slash para matching
  const relPathNorm = relPath.replace(/\\/g, "/");

  // Verifica se e um path acionavel
  const isSqlMigration = SQL_MIGRATION_RE.test(relPathNorm);
  const isPrismaSchema = PRISMA_SCHEMA_RE.test(relPathNorm);

  if (!isSqlMigration && !isPrismaSchema) {
    allow(); // Nao e nosso dominio
  }

  // Extrai conteudo
  const content = extractWriteContent(toolInput);

  // ---------------------------------------------------------------------------
  // Verificar override global AIDD_OVERRIDE_RLS=ADR-NNNN
  // ---------------------------------------------------------------------------
  const overrideVal = (process.env.AIDD_OVERRIDE_RLS || "").trim();
  if (overrideVal) {
    if (!OVERRIDE_ADR_RE.test(overrideVal) || !adrExists(overrideVal)) {
      deny(
        `[aidd-rls-guard] AIDD_OVERRIDE_RLS invalido ou ADR inexistente: "${overrideVal}". Exigido: ADR-NNNN (4 digitos) com arquivo em docs/adr/.`
      );
    }
    // Override valido — registra telemetria e permite
    logTelemetry("rls-overrides.jsonl", {
      ts: new Date().toISOString(),
      session_id: sessionId,
      file_path: relPath,
      override: overrideVal,
    });
    allow();
  }

  // ---------------------------------------------------------------------------
  // Prisma schema check (WARN-only)
  // ---------------------------------------------------------------------------
  if (isPrismaSchema) {
    checkPrismaSchema(content, relPath);
    allow(); // Sempre ALLOW para Prisma
  }

  // ---------------------------------------------------------------------------
  // SQL migration checks
  // Usa contentNoComments para deteccao de instrucoes SQL (evita falso negativo
  // com instrucoes mencionadas em comentarios de intencao como "-- Sem ENABLE RLS").
  // O content original e preservado para verificacao de ADR comments.
  // ---------------------------------------------------------------------------
  const contentNoComments = stripSqlLineComments(content);

  // 1. DROP POLICY sem ADR comment → DENY
  if (DROP_POLICY_RE.test(contentNoComments)) {
    if (!hasAdrComment(content, DROP_POLICY_RE)) {
      logTelemetry("rls-block.jsonl", {
        ts: new Date().toISOString(),
        session_id: sessionId,
        file_path: relPath,
        reason: "DROP_POLICY sem ADR comment",
      });
      deny(
        `[aidd-rls-guard] DROP POLICY detectado em ${relPath} sem comentario ADR-NNNN obrigatorio. ` +
        `Adicione: -- ADR-NNNN: <justificativa de pelo menos 10 chars> na linha anterior ao DROP POLICY.`
      );
    }
  }

  // 2. DISABLE ROW LEVEL SECURITY sem ADR comment → DENY
  if (DISABLE_RLS_RE.test(contentNoComments)) {
    if (!hasAdrComment(content, DISABLE_RLS_RE)) {
      logTelemetry("rls-block.jsonl", {
        ts: new Date().toISOString(),
        session_id: sessionId,
        file_path: relPath,
        reason: "DISABLE ROW LEVEL SECURITY sem ADR comment",
      });
      deny(
        `[aidd-rls-guard] DISABLE ROW LEVEL SECURITY detectado em ${relPath} sem comentario ADR-NNNN obrigatorio. ` +
        `Adicione: -- ADR-NNNN: <justificativa de pelo menos 10 chars> antes do comando.`
      );
    }
  }

  // 3. ALTER TABLE DISABLE TRIGGER sem ADR comment → DENY
  if (DISABLE_TRIGGER_RE.test(contentNoComments)) {
    if (!hasAdrComment(content, DISABLE_TRIGGER_RE)) {
      logTelemetry("rls-block.jsonl", {
        ts: new Date().toISOString(),
        session_id: sessionId,
        file_path: relPath,
        reason: "ALTER TABLE DISABLE TRIGGER sem ADR comment",
      });
      deny(
        `[aidd-rls-guard] ALTER TABLE ... DISABLE TRIGGER detectado em ${relPath} sem comentario ADR-NNNN obrigatorio.`
      );
    }
  }

  // 4. CREATE TABLE sem ENABLE ROW LEVEL SECURITY → DENY (se nao coberto por companion)
  if (CREATE_TABLE_RE.test(contentNoComments)) {
    // Checar ENABLE RLS no arquivo atual (sem comentarios — evita match em "-- Sem ENABLE RLS")
    if (ENABLE_RLS_RE.test(contentNoComments)) {
      allow(); // RLS presente no mesmo arquivo — OK
    }

    // Checar companions na mesma migration unit
    const absFilePath = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
    const siblings = readSiblingsInMigration(absFilePath);
    const companionHasRls = siblings.some((sibContent) =>
      ENABLE_RLS_RE.test(stripSqlLineComments(sibContent))
    );

    if (companionHasRls) {
      allow(); // Companion cobre o RLS — OK
    }

    // Nenhum ENABLE RLS encontrado — DENY
    logTelemetry("rls-block.jsonl", {
      ts: new Date().toISOString(),
      session_id: sessionId,
      file_path: relPath,
      reason: "CREATE TABLE sem ENABLE ROW LEVEL SECURITY",
    });
    deny(
      `[aidd-rls-guard] CREATE TABLE em ${relPath} sem ENABLE ROW LEVEL SECURITY. ` +
      `Adicione 'ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;' no mesmo arquivo ou em companion file com mesmo prefixo de timestamp. ` +
      `Para excecoes justificadas: AIDD_OVERRIDE_RLS=ADR-NNNN`
    );
  }

  allow();
});

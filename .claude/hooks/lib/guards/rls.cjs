"use strict";
// Neutral core: RLS guard — opt-in (off by default). SQL migration checks with
// companion (sibling) contents supplied via event.config.rls.siblings.
// The ADR-backed env override (AIDD_OVERRIDE_RLS) is edit-time only (shell).

const fs = require("node:fs");
const path = require("node:path");
const { allow, warn, deny } = require("./verdict.cjs");

const SQL_MIGRATION_RE = /(?:(?:^|[\\/])migrations[\\/].*\.sql$|^supabase[\\/]migrations[\\/].*\.sql$|(?:^|[\\/])policies[\\/].*\.sql$)/i;
const PRISMA_SCHEMA_RE = /schema\.prisma$/i;

const CREATE_TABLE_RE = /\bCREATE\s+TABLE\b/i;
const ENABLE_RLS_RE = /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i;
const DROP_POLICY_RE = /\bDROP\s+POLICY\b/i;
const DISABLE_RLS_RE = /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i;
const DISABLE_TRIGGER_RE = /\bALTER\s+TABLE\s+.*\bDISABLE\s+TRIGGER\b/i;

const ADR_COMMENT_RE = /--\s+ADR-(\d{4}):\s+(.{10,})/;

const PRISMA_MODEL_RE = /^model\s+\w+\s*\{/gm;
const PRISMA_RLS_POLICY_RE = /\/\/\/\s*@rls-policy\b|\/\/\/\s*@rls-exempt-reason\b/;

function stripSqlLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("--");
      if (commentIdx === -1) return line;
      return line.slice(0, commentIdx);
    })
    .join("\n");
}

function hasAdrComment(content, commandRe) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (commandRe.test(lines[i])) {
      const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (ADR_COMMENT_RE.test(window)) {
        const match = window.match(ADR_COMMENT_RE);
        if (match && match[2] && match[2].trim().length >= 10) return true;
      }
    }
  }
  return false;
}

function prismaModelsWithoutPolicy(content) {
  const modelMatches = [...content.matchAll(PRISMA_MODEL_RE)];
  const missing = [];
  for (const match of modelMatches) {
    const start = match.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const modelBlock = content.slice(start, end);
    if (!PRISMA_RLS_POLICY_RE.test(modelBlock)) {
      const nameMatch = match[0].match(/^model\s+(\w+)/);
      missing.push(nameMatch ? nameMatch[1] : "unknown");
    }
  }
  return missing;
}

/** fs helper for adapters: opt-in flag from .claude/aidd-rls-config.json. */
function loadRlsConfig(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "aidd-rls-config.json"), "utf8"));
    return { enabled: cfg.enabled === true };
  } catch {
    return { enabled: false };
  }
}

/**
 * fs helper for adapters: companion files da mesma migration unit (mesmo
 * prefixo de timestamp). AIDD_RLS_MIGRATION_DIR honrado (test affordance).
 */
function readSiblings(absFilePath, opts = {}) {
  const honorEnv = opts.honorEnv !== false; // a rede git passa {honorEnv:false}
  const migDir = (honorEnv && process.env.AIDD_RLS_MIGRATION_DIR) || path.dirname(absFilePath);
  if (!fs.existsSync(migDir)) return [];
  const basename = path.basename(absFilePath);
  const prefixMatch = basename.match(/^(\d+)_/);
  const prefix = prefixMatch ? prefixMatch[1] : null;
  const siblings = [];
  try {
    for (const entry of fs.readdirSync(migDir)) {
      const entryPath = path.join(migDir, entry);
      if (entryPath === absFilePath) continue;
      if (!entry.endsWith(".sql")) continue;
      if (prefix && entry.startsWith(prefix + "_")) {
        try { siblings.push(fs.readFileSync(entryPath, "utf8")); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return siblings;
}

function evaluate(event) {
  const cfg = (event && event.config && event.config.rls) || {};
  if (cfg.enabled !== true) return allow(); // opt-in: off by default
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("rls-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  const rel = event.path.replace(/\\/g, "/");
  const isSqlMigration = SQL_MIGRATION_RE.test(rel);
  const isPrismaSchema = PRISMA_SCHEMA_RE.test(rel);
  if (!isSqlMigration && !isPrismaSchema) return allow();

  const content = typeof event.content === "string" ? event.content : "";

  if (isPrismaSchema) {
    const missing = prismaModelsWithoutPolicy(content);
    if (missing.length > 0) {
      return warn(
        `Prisma model(s) sem /// @rls-policy ou /// @rls-exempt-reason: ${missing.join(", ")}. ` +
        "Adicione anotacao ou justificativa de excecao.",
        { rel, models: missing }
      );
    }
    return allow();
  }

  const contentNoComments = stripSqlLineComments(content);

  if (DROP_POLICY_RE.test(contentNoComments) && !hasAdrComment(content, DROP_POLICY_RE)) {
    return deny(
      `[rls-guard] DROP POLICY detectado em ${rel} sem comentario ADR-NNNN obrigatorio. ` +
      `Adicione: -- ADR-NNNN: <justificativa de pelo menos 10 chars> na linha anterior ao DROP POLICY.`,
      { rel, rule: "drop-policy-no-adr" }
    );
  }
  if (DISABLE_RLS_RE.test(contentNoComments) && !hasAdrComment(content, DISABLE_RLS_RE)) {
    return deny(
      `[rls-guard] DISABLE ROW LEVEL SECURITY detectado em ${rel} sem comentario ADR-NNNN obrigatorio. ` +
      `Adicione: -- ADR-NNNN: <justificativa de pelo menos 10 chars> antes do comando.`,
      { rel, rule: "disable-rls-no-adr" }
    );
  }
  if (DISABLE_TRIGGER_RE.test(contentNoComments) && !hasAdrComment(content, DISABLE_TRIGGER_RE)) {
    return deny(
      `[rls-guard] ALTER TABLE ... DISABLE TRIGGER detectado em ${rel} sem comentario ADR-NNNN obrigatorio.`,
      { rel, rule: "disable-trigger-no-adr" }
    );
  }

  if (CREATE_TABLE_RE.test(contentNoComments)) {
    if (ENABLE_RLS_RE.test(contentNoComments)) return allow();
    const siblings = Array.isArray(cfg.siblings) ? cfg.siblings : [];
    const companionHasRls = siblings.some((sib) => ENABLE_RLS_RE.test(stripSqlLineComments(sib)));
    if (companionHasRls) return allow();
    return deny(
      `[rls-guard] CREATE TABLE em ${rel} sem ENABLE ROW LEVEL SECURITY. ` +
      `Adicione 'ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;' no mesmo arquivo ou em companion file com mesmo prefixo de timestamp. ` +
      `Para excecoes justificadas: AIDD_OVERRIDE_RLS=ADR-NNNN`,
      { rel, rule: "create-table-no-rls" }
    );
  }

  return allow();
}

module.exports = {
  evaluate,
  loadRlsConfig,
  readSiblings,
  stripSqlLineComments,
  hasAdrComment,
  prismaModelsWithoutPolicy,
  SQL_MIGRATION_RE,
  PRISMA_SCHEMA_RE,
};

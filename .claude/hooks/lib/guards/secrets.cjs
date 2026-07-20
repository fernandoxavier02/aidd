"use strict";
// Neutral core: secrets guard — catalog-driven scan, .env path rules, docs
// warn-path, fail-safe deny when the catalog is missing/short. The emergency
// env override (AIDD_OVERRIDE_SECRETS) is edit-time only and lives in the
// Claude shell — the git net does not honor env bypasses (spec R1 finding 10).

const fs = require("node:fs");
const path = require("node:path");
const { allow, warn, deny } = require("./verdict.cjs");

/** .env, .env.local, .env.production, etc. — DENY incondicional */
const DENY_PATHS = /(?:^|[\\/])\.(env)(?:\.[^/\\]+)?$/;
/** Excecoes: arquivos de exemplo/template sao OK */
const EXAMPLE_OK = /\.env\.(example|template)$/;
/** Paths de documentacao — WARN em vez de DENY */
const WARN_PATHS = /(?:^|[\\/])docs[\\/]|\.md$/i;

const MIN_PATTERNS = 12;

/** Compila um catálogo parseado; fail-safe se < MIN_PATTERNS. */
function compileCatalog(parsed) {
  if (!parsed || !Array.isArray(parsed.patterns) || parsed.patterns.length < MIN_PATTERNS) {
    return {
      ok: false,
      reason: `Catalog tem ${(parsed && parsed.patterns || []).length} patterns — minimo ${MIN_PATTERNS} requerido (fail-safe ativo)`,
    };
  }
  return {
    ok: true,
    patterns: parsed.patterns.map((p) => ({ id: p.id, family: p.family, re: new RegExp(p.regex, p.flags || "") })),
  };
}

/**
 * fs helper for adapters. Resolução: env override → catálogo do projeto →
 * catálogo embutido no pacote (.claude/hooks/aidd-secrets-patterns.json).
 */
function loadCatalog(projectRoot) {
  const projectCatalog = path.join(projectRoot, ".claude", "aidd-secrets-patterns.json");
  const catalogPath =
    process.env.AIDD_SECRETS_CATALOG ||
    (fs.existsSync(projectCatalog) ? projectCatalog : path.join(__dirname, "..", "..", "aidd-secrets-patterns.json"));
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
  return compileCatalog(parsed);
}

function patternRegex(p) {
  if (p.re instanceof RegExp) return p.re;
  return new RegExp(p.regex, p.flags || "");
}

function evaluate(event) {
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("secrets-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  const rel = event.path.replace(/\\/g, "/");

  // Regra 1b primeiro: example/template existem PARA conter placeholders
  if (EXAMPLE_OK.test(rel)) return allow();

  // Regra 1: .env* → deny incondicional
  if (DENY_PATHS.test(rel)) {
    return deny(
      `Arquivo .env detectado: '${rel}'. Nao edite arquivos .env diretamente — ` +
      "use .env.example para placeholders e carregue secrets server-side. " +
      "Document any exception in an ADR.",
      { rel, rule: "env-file-rule" }
    );
  }

  // Regra 2: catálogo fail-safe
  const catalog = event.config && event.config.secrets && event.config.secrets.catalog;
  if (!catalog || catalog.ok !== true || !Array.isArray(catalog.patterns)) {
    const reason = (catalog && catalog.reason) || "catálogo ausente no evento";
    return deny(`[secrets-guard] Fail-safe ativado — ${reason}`, { rel, rule: "catalog-fail-safe" });
  }

  // Regra 3: scan
  const content = typeof event.content === "string" ? event.content : "";
  for (const p of catalog.patterns) {
    const re = patternRegex(p);
    re.lastIndex = 0;
    if (!re.test(content)) continue;
    re.lastIndex = 0;

    if (WARN_PATHS.test(rel)) {
      return warn(
        `Pattern '${p.family}' (${p.id}) encontrado em path de documentacao '${rel}'. ` +
        "Se for placeholder, esta OK. Verifique se nao e valor real.",
        { rel, pattern: p.id, family: p.family }
      );
    }
    return deny(
      `Secret pattern '${p.family}' (${p.id}) detectado em '${rel}'. ` +
      "Mova o secret para env var carregada server-side ou use placeholder em .env.example. " +
      "Para override emergencial, defina AIDD_OVERRIDE_SECRETS com razao >= 20 caracteres.",
      { rel, pattern: p.id, family: p.family }
    );
  }

  return allow();
}

module.exports = { evaluate, loadCatalog, compileCatalog, DENY_PATHS, EXAMPLE_OK, WARN_PATHS, MIN_PATTERNS };

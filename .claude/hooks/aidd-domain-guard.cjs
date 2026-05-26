#!/usr/bin/env node
/**
 * aidd-domain-guard.cjs — PreToolUse hook
 *
 * Bloqueia imports cross-camada DDD baseado em .aidd/domain-map.json.
 *
 * Algoritmo:
 *   1. Ler domain-map.json; se ausente → WARN + ALLOW (AC 5.4)
 *   2. Classificar file_path em layer (classifyLayer)
 *   3. Parsear imports do new_string/content (parseImports)
 *   4. Para cada import: classificar target; verificar regra
 *      - exception_via: se target == exception_via → skip
 *      - cannot_import_from: se target está na lista → deny
 *   5. Override exige AIDD_OVERRIDE_DOMAIN com ADR-NNNN (AC 5.5)
 *   6. NFR-5: telemetria em .aidd/telemetry/domain-{block,overrides}.jsonl
 *
 * AIDD_DOMAIN_MAP_PATH: env var para override de path (usado nos testes).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("./lib/aidd-glob.cjs");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent, adrExists } = require("./lib/aidd-paths.cjs");

// ---------------------------------------------------------------------------
// Ferramentas que escrevem conteudo (PreToolUse scan)
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// ---------------------------------------------------------------------------
// Output protocol (consistente com outros hooks AIDD)
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
  process.stderr.write(`[aidd-domain-guard] WARN: ${warnMessage}\n`);
  process.stdout.write("");
  process.exit(0);
}

function allow() {
  process.stdout.write("");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------

function logTelemetry(filename, entry) {
  try {
    const root = getProjectRoot();
    const dir = path.join(root, ".aidd", "telemetry");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    safeAppend(filePath, JSON.stringify(entry) + "\n");
  } catch (_e) {
    // Telemetria nunca bloqueia execução
  }
}

// ---------------------------------------------------------------------------
// Domain-map loader
// ---------------------------------------------------------------------------

/**
 * Carrega .aidd/domain-map.json.
 * Retorna o objeto parseado ou null se ausente/inválido.
 * Path pode ser sobreposto via AIDD_DOMAIN_MAP_PATH (para testes).
 */
function loadDomainMap(root) {
  const override = process.env.AIDD_DOMAIN_MAP_PATH;
  const mapPath = override || path.join(root, ".aidd", "domain-map.json");

  if (!fs.existsSync(mapPath)) return null;

  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.layers !== "object" || !Array.isArray(parsed.rules)) {
      return null;
    }
    return parsed;
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

/**
 * Classifica um filePath em layer usando os globs do domain-map.
 * Retorna o nome da layer ou null se nenhum glob casar.
 *
 * @param {string} filePath  - relativo ao project root (forward slashes)
 * @param {Object} layers    - { layerName: string[] }
 */
function classifyLayer(filePath, layers) {
  const normalized = filePath.replace(/\\/g, "/");
  for (const [layerName, globs] of Object.entries(layers)) {
    for (const glob of globs) {
      if (minimatch(normalized, glob, { dot: true, matchBase: false })) {
        return layerName;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import parser
// ---------------------------------------------------------------------------

/**
 * Extrai todos os módulos importados de um bloco de código TypeScript/JavaScript.
 * Suporta:
 *   import ... from "..."
 *   import "..."
 *   require("...")
 *   export ... from "..."
 *
 * Retorna apenas imports relativos ou de projeto (começa com . ou /) — ignora
 * node_modules (não começam com . ou /).
 */
function parseImports(content) {
  if (!content || typeof content !== "string") return [];

  const results = [];
  // ESM static imports / exports
  const esmRe = /(?:import|export)(?:\s+\w+\s*,?\s*)?(?:\s*\{[^}]*\}\s*,?\s*)?(?:\s*\*\s*as\s+\w+\s*)?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = esmRe.exec(content)) !== null) {
    results.push(m[1]);
  }

  // CJS require
  const cjsRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) {
    results.push(m[1]);
  }

  // Side-effect imports: import "module"
  const sideRe = /import\s+["']([^"']+)["']/g;
  while ((m = sideRe.exec(content)) !== null) {
    results.push(m[1]);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Path resolver — converte import especificador → relPath desde root
// ---------------------------------------------------------------------------

/**
 * Resolve um import especificador em relPath relativo ao project root.
 * Suporta imports relativos (./foo, ../../bar) e imports absolutos de projeto.
 * Ignora node_modules (sem . prefix → null).
 *
 * Estratégia dual para imports com ../:
 *   1. Tenta resolução real via path.posix.join (acurada quando file está no root)
 *   2. Fallback: extrai o segmento real strippando prefixos ../ (heurística para
 *      imports que sobem além do root em tests — funciona para caminhos de projeto)
 *
 * @param {string} importSpec   - o que está dentro do from "..."
 * @param {string} fileRelPath  - arquivo de origem relativo ao root
 */
function resolveImportPath(importSpec, fileRelPath, layers) {
  // Ignora node_modules e packages externos completamente
  if (!importSpec.startsWith(".") && !importSpec.startsWith("/")) {
    // importSpec sem prefix relativo pode ser path de projeto (ex: "services/billing/...")
    // Retornar diretamente para classificar pelo glob
    return importSpec.replace(/\\/g, "/");
  }

  if (importSpec.startsWith("/")) {
    return importSpec.slice(1).replace(/\\/g, "/");
  }

  try {
    const fileDir = path.dirname(fileRelPath.replace(/\\/g, "/"));
    const resolved = path.posix.normalize(path.posix.join(fileDir, importSpec));

    // Verificar se o resolved casa com algum layer
    const directLayer = classifyLayer(resolved, layers);
    if (directLayer) return resolved.replace(/\\/g, "/");

    // Fallback: strip dos ../ prefixos para obter o segmento real
    // Ex: "../../services/billing/src/domain/entities/X" -> "services/billing/src/domain/entities/X"
    // Necessário quando importSpec navega acima do diretório raiz do arquivo
    const stripped = importSpec.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    return stripped.replace(/\\/g, "/");
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rule checker
// ---------------------------------------------------------------------------

/**
 * Verifica se um import de fromLayer → targetLayer é permitido pelas rules.
 * Retorna: 'allow' | 'deny' | 'exception_via_match'
 *
 * @param {string} fromLayer
 * @param {string} targetLayer
 * @param {Array} rules
 */
function applyRules(fromLayer, targetLayer, rules) {
  if (!fromLayer || !targetLayer) return "allow"; // layer desconhecida = allow (sem dados suficientes)
  if (fromLayer === targetLayer) return "allow";  // mesma camada = sempre ok

  const rule = rules.find((r) => r.from === fromLayer);
  if (!rule) return "allow"; // sem regra para esta camada = allow

  const forbidden = rule.cannot_import_from || [];
  if (!forbidden.includes(targetLayer)) return "allow"; // não está na lista de proibidos

  // Está proibido — verificar exception_via
  if (rule.exception_via && targetLayer === rule.exception_via) {
    return "exception_via_match"; // exception applies
  }

  return "deny";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main — async stdin (padrão dos hooks AIDD)
// ---------------------------------------------------------------------------

let inputRaw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { inputRaw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(inputRaw);
  } catch (_e) {
    allow();
    return;
  }

  const toolName = payload?.tool_name || "";
  if (!WRITE_TOOLS.has(toolName)) {
    allow();
    return;
  }

  const toolInput = payload?.tool_input || {};
  const sessionId = payload?.session_id || "unknown";
  const ts = new Date().toISOString();

  // ------------------------------------------------------------------
  // Extrair file_path
  // ------------------------------------------------------------------
  const rawFilePath = toolInput.file_path || "";
  const root = getProjectRoot();
  const pathCheck = validateSafePath(rawFilePath, root);
  if (!pathCheck.ok) {
    allow(); // path inválido — deixar outros hooks tratar
    return;
  }
  const relPath = pathCheck.rel; // forward slashes

  // ------------------------------------------------------------------
  // Carregar domain-map
  // ------------------------------------------------------------------
  const map = loadDomainMap(root);
  if (!map) {
    allowWithWarn(
      `domain-map.json ausente ou inválido em '${relPath}'. ` +
      "Execute /aidd-domain-init para gerar o mapa de camadas. " +
      "Domain_Guard está desabilitado até o mapa existir."
    );
    return;
  }

  // ------------------------------------------------------------------
  // Classificar camada de origem
  // ------------------------------------------------------------------
  const fromLayer = classifyLayer(relPath, map.layers);
  if (!fromLayer) {
    // Arquivo fora de qualquer camada conhecida — allow sem noise
    allow();
    return;
  }

  // ------------------------------------------------------------------
  // Extrair conteúdo sendo escrito
  // ------------------------------------------------------------------
  const content = extractWriteContent(toolInput);
  const imports = parseImports(content);

  if (imports.length === 0) {
    allow();
    return;
  }

  // ------------------------------------------------------------------
  // Checar cada import
  // ------------------------------------------------------------------
  for (const importSpec of imports) {
    const resolvedRel = resolveImportPath(importSpec, relPath, map.layers);
    if (!resolvedRel) continue; // node_modules ou não-relativo — skip

    const targetLayer = classifyLayer(resolvedRel, map.layers);
    if (!targetLayer) continue; // target fora de camada conhecida — skip

    const verdict = applyRules(fromLayer, targetLayer, map.rules);

    if (verdict === "allow" || verdict === "exception_via_match") {
      continue;
    }

    // verdict === 'deny'
    const rule = map.rules.find((r) => r.from === fromLayer);
    const rationale = rule?.rationale || "sem rationale";

    // Gravar telemetria (P2 — DENY auditable)
    logTelemetry("domain-block.jsonl", {
      from_layer: fromLayer,
      target_layer: targetLayer,
      rule_violated: `${fromLayer} cannot import from ${targetLayer}`,
      import_spec: importSpec,
      file_path: relPath,
      ts,
      session_id: sessionId,
      override_used: false,
    });

    // Verificar override (AC 5.5: exige ADR-NNNN)
    const overrideVal = process.env.AIDD_OVERRIDE_DOMAIN || "";
    if (overrideVal && /ADR-\d{4}/.test(overrideVal) && adrExists(overrideVal)) {
      // Override válido — ALLOW + auditoria
      logTelemetry("domain-overrides.jsonl", {
        from_layer: fromLayer,
        target_layer: targetLayer,
        rule_violated: `${fromLayer} cannot import from ${targetLayer}`,
        import_spec: importSpec,
        file_path: relPath,
        adr: overrideVal.match(/ADR-\d{4}/)?.[0] ?? "unknown",
        override_used: true,
        reason: overrideVal.slice(0, 200),
        ts,
        session_id: sessionId,
      });
      allowWithWarn(
        `Domain rule override aplicado: ${overrideVal.slice(0, 80)}. ` +
        `Layer '${fromLayer}' importando de '${targetLayer}' — ${rationale}.`
      );
      return;
    }

    // Sem override válido — DENY
    deny(
      `[Domain_Guard] Layer boundary violada: '${fromLayer}' não pode importar de '${targetLayer}'. ` +
      `Import: '${importSpec}' em '${relPath}'. ` +
      `Regra: ${rationale}. ` +
      "Para override emergencial, defina AIDD_OVERRIDE_DOMAIN=ADR-NNNN (com ADR válido). " +
      "Para corrigir: (1) use interface em 'ports/', (2) mova o arquivo para a camada correta, " +
      "ou (3) registre uma exceção via ADR."
    );
    return;
  }

  allow();
});

"use strict";
// Neutral core: domain guard — DDD layer boundaries from .aidd/domain-map.json.
// The map arrives in event.config.domain.map; loadDomainMap() is the fs helper.
// Missing map preserves the shipped opt-in behavior: warn, never deny.
// The ADR-backed env override (AIDD_OVERRIDE_DOMAIN) is edit-time only (shell).

const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("../aidd-glob.cjs");
const { allow, warn, deny } = require("./verdict.cjs");

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

function parseImports(content) {
  if (!content || typeof content !== "string") return [];
  const results = [];
  const esmRe = /(?:import|export)(?:\s+\w+\s*,?\s*)?(?:\s*\{[^}]*\}\s*,?\s*)?(?:\s*\*\s*as\s+\w+\s*)?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = esmRe.exec(content)) !== null) results.push(m[1]);
  const cjsRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) results.push(m[1]);
  const sideRe = /import\s+["']([^"']+)["']/g;
  while ((m = sideRe.exec(content)) !== null) results.push(m[1]);
  return results;
}

function resolveImportPath(importSpec, fileRelPath, layers) {
  if (!importSpec.startsWith(".") && !importSpec.startsWith("/")) {
    return importSpec.replace(/\\/g, "/");
  }
  if (importSpec.startsWith("/")) {
    return importSpec.slice(1).replace(/\\/g, "/");
  }
  try {
    const fileDir = path.dirname(fileRelPath.replace(/\\/g, "/"));
    const resolved = path.posix.normalize(path.posix.join(fileDir, importSpec));
    const directLayer = classifyLayer(resolved, layers);
    if (directLayer) return resolved.replace(/\\/g, "/");
    const stripped = importSpec.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    return stripped.replace(/\\/g, "/");
  } catch {
    return null;
  }
}

function applyRules(fromLayer, targetLayer, rules) {
  if (!fromLayer || !targetLayer) return "allow";
  if (fromLayer === targetLayer) return "allow";
  const rule = rules.find((r) => r.from === fromLayer);
  if (!rule) return "allow";
  const forbidden = rule.cannot_import_from || [];
  if (!forbidden.includes(targetLayer)) return "allow";
  if (rule.exception_via && targetLayer === rule.exception_via) return "exception_via_match";
  return "deny";
}

/** fs helper for adapters (env AIDD_DOMAIN_MAP_PATH honored — test affordance). */
function loadDomainMap(projectRoot) {
  const override = process.env.AIDD_DOMAIN_MAP_PATH;
  const mapPath = override || path.join(projectRoot, ".aidd", "domain-map.json");
  if (!fs.existsSync(mapPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    if (!parsed || typeof parsed.layers !== "object" || !Array.isArray(parsed.rules)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function evaluate(event) {
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("domain-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  const rel = event.path.replace(/\\/g, "/");
  const map = event.config && event.config.domain && event.config.domain.map;
  if (!map) {
    return warn(
      `domain-map.json ausente ou inválido em '${rel}'. ` +
      "Execute /aidd-domain-init para gerar o mapa de camadas. " +
      "Domain_Guard está desabilitado até o mapa existir.",
      { rel, rule: "map-missing" }
    );
  }

  const fromLayer = classifyLayer(rel, map.layers);
  if (!fromLayer) return allow();

  const imports = parseImports(typeof event.content === "string" ? event.content : "");
  if (imports.length === 0) return allow();

  for (const importSpec of imports) {
    const resolvedRel = resolveImportPath(importSpec, rel, map.layers);
    if (!resolvedRel) continue;
    const targetLayer = classifyLayer(resolvedRel, map.layers);
    if (!targetLayer) continue;
    const verdict = applyRules(fromLayer, targetLayer, map.rules);
    if (verdict === "allow" || verdict === "exception_via_match") continue;

    const rule = map.rules.find((r) => r.from === fromLayer);
    const rationale = (rule && rule.rationale) || "sem rationale";
    return deny(
      `[Domain_Guard] Layer boundary violada: '${fromLayer}' não pode importar de '${targetLayer}'. ` +
      `Import: '${importSpec}' em '${rel}'. ` +
      `Regra: ${rationale}. ` +
      "Para override emergencial, defina AIDD_OVERRIDE_DOMAIN=ADR-NNNN (com ADR válido). " +
      "Para corrigir: (1) use interface em 'ports/', (2) mova o arquivo para a camada correta, " +
      "ou (3) registre uma exceção via ADR.",
      { rel, fromLayer, targetLayer, importSpec, rationale }
    );
  }
  return allow();
}

module.exports = { evaluate, loadDomainMap, classifyLayer, parseImports, resolveImportPath, applyRules };

"use strict";
// Neutral core: frontend-business guard — WARN-only by hard contract
// ("NUNCA DENY"). Every path out of evaluate() is allow or warn, including the
// malformed-envelope fail-safe (spec R1 finding 4).

const { minimatch } = require("../aidd-glob.cjs");
const { allow, warn } = require("./verdict.cjs");

const BUSINESS_PATTERNS = [
  {
    id: "authz-hardcoded",
    description: "Authz hardcoded com role literal (admin/super/root)",
    re: /if\s*\(\s*\w+\.role\s*[!=]==?\s*['"](?:admin|super|root)['"]/g,
  },
  {
    id: "financial-calc",
    description: "Calculo financeiro no frontend (tax/discount/fee/commission)",
    re: /\*\s*(?:tax|discount|fee|commission)\b/gi,
  },
  {
    id: "crypto-secrets",
    description: "Operacao criptografica com credencial no frontend",
    re: /\b(?:hash|encrypt|sign|verify)\b.*\(.*\b(?:password|secret|token|key)\b/gi,
  },
  {
    id: "balance-validation",
    description: "Validacao de saldo no frontend",
    re: /\bif\s*\(.*\bbalance\s*[<>]=?/g,
  },
  {
    id: "top-level-secret-var",
    description: "Variavel top-level com SECRET ou PRIVATE_KEY no nome",
    re: /^(?:const|let|var)\s+\w*(?:SECRET|PRIVATE_KEY)\w*\s*=/gm,
  },
];

function matchesGlobs(relPath, globs) {
  if (!Array.isArray(globs)) return false;
  const normalized = relPath.replace(/\\/g, "/");
  return globs.some((glob) => minimatch(normalized, glob.replace(/\\/g, "/"), { dot: true }));
}

function evaluate(event) {
  // WARN-only: até o fail-safe de envelope malformado é warn, nunca deny.
  if (!event || typeof event.path !== "string" || !event.path) {
    return warn("frontend-business-guard: evento malformado (path ausente) — verifique o adaptador.", { rule: "malformed-envelope" });
  }
  const rel = event.path.replace(/\\/g, "/");

  const map = event.config && event.config.frontendBusiness && event.config.frontendBusiness.map;
  if (!map) return allow(); // opt-in: sem mapa, guarda inerte

  const frontendGlobs = (map.layers && map.layers.frontend) || [];
  const suppressGlobs = map.frontend_business_suppress || [];

  if (!matchesGlobs(rel, frontendGlobs)) return allow();
  if (matchesGlobs(rel, suppressGlobs)) return allow();

  const content = typeof event.content === "string" ? event.content : "";
  const warnings = [];
  for (const pattern of BUSINESS_PATTERNS) {
    pattern.re.lastIndex = 0;
    const matches = content.match(pattern.re);
    if (matches && matches.length > 0) {
      warnings.push({ pattern: pattern.id, description: pattern.description, count: matches.length });
    }
  }

  if (warnings.length === 0) return allow();
  const msg = warnings
    .map((w) => `${w.description} em ${rel} (${w.count} ocorrencia(s)). Considere mover para servico/backend.`)
    .join(" | ");
  return warn(msg, warnings);
}

module.exports = { evaluate, BUSINESS_PATTERNS, matchesGlobs };

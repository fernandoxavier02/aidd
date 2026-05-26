#!/usr/bin/env node
// aidd-frontend-business-guard.cjs — PreToolUse hook
//
// WARN-only (NUNCA DENY): detecta padroes de regra de negocio em paths de
// frontend. Emite aviso no stderr e registra telemetria, mas sempre retorna
// allow() para nao bloquear o fluxo de trabalho.
//
//
// Algoritmo:
//   1. Ler domain-map.json -> layers.frontend (globs) + frontend_business_suppress
//   2. Se file_path nao e frontend -> ALLOW silencioso
//   3. Se file_path e suppression path -> ALLOW silencioso
//   4. Para cada pattern family: regex match -> WARN + telemetria
//   5. Sempre return allow() — NUNCA deny()
//
// 5 pattern families:
//   authz-hardcoded   : role === admin/super/root
//   financial-calc    : calculo com tax/discount/fee/commission
//   crypto-secrets    : hash/encrypt/sign com password/secret/token/key
//   balance-validation: validacao de balance no if
//   top-level-secret-var: const/let/var com SECRET ou PRIVATE_KEY no nome
//
// AIDD_DOMAIN_MAP_PATH: override do caminho do domain-map (para testes)

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("./lib/aidd-glob.cjs");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent } = require("./lib/aidd-paths.cjs");

// ---------------------------------------------------------------------------
// Ferramentas que escrevem conteudo (PreToolUse scan)
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// ---------------------------------------------------------------------------
// 5 pattern families de regra de negocio no frontend
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------
const PROJECT_ROOT = getProjectRoot();
const TELEMETRY_DIR = path.join(PROJECT_ROOT, ".aidd", "telemetry");
const WARNS_LOG = path.join(TELEMETRY_DIR, "frontend-business-warns.jsonl");

function logWarnTelemetry(entry) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    safeAppend(WARNS_LOG, JSON.stringify(entry) + "\n");
  } catch {
    // telemetria nunca deve crashar o hook
  }
}

// ---------------------------------------------------------------------------
// Output protocol — APENAS allow() (nunca deny())
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Carrega domain-map.json
// ---------------------------------------------------------------------------
function loadDomainMap() {
  const mapPath =
    process.env.AIDD_DOMAIN_MAP_PATH ||
    path.join(PROJECT_ROOT, ".aidd", "domain-map.json");

  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verifica se um path relativo casa com algum glob da lista
// ---------------------------------------------------------------------------
function matchesGlobs(relPath, globs) {
  if (!Array.isArray(globs)) return false;
  const normalized = relPath.replace(/\\/g, "/");
  return globs.some((glob) => {
    const normalizedGlob = glob.replace(/\\/g, "/");
    return minimatch(normalized, normalizedGlob, { dot: true });
  });
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
    allow();
  }

  const toolName = payload?.tool_name ?? "";
  if (!WRITE_TOOLS.has(toolName)) {
    allow();
  }

  const toolInput = payload?.tool_input ?? {};
  const filePath = toolInput?.file_path ?? "";
  const sessionId = payload?.session_id ?? "unknown";

  // Validar path
  const pathCheck = validateSafePath(filePath, PROJECT_ROOT);
  if (!pathCheck.ok) {
    allow();
  }

  const relPath = (pathCheck.rel || filePath).replace(/\\/g, "/");

  // ---------------------------------------------------------------------------
  // Carregar domain-map (fail-safe: se ausente, ALLOW silencioso)
  // ---------------------------------------------------------------------------
  const domainMap = loadDomainMap();
  if (!domainMap) {
    allow();
  }

  const frontendGlobs = domainMap?.layers?.frontend || [];
  const suppressGlobs = domainMap?.frontend_business_suppress || [];

  // ---------------------------------------------------------------------------
  // 1. Verificar se e path de frontend
  // ---------------------------------------------------------------------------
  if (!matchesGlobs(relPath, frontendGlobs)) {
    allow(); // Nao e frontend — ignorar
  }

  // ---------------------------------------------------------------------------
  // 2. Verificar suppression paths
  // ---------------------------------------------------------------------------
  if (matchesGlobs(relPath, suppressGlobs)) {
    allow(); // Path suprimido — ignorar
  }

  // ---------------------------------------------------------------------------
  // 3. Escanear 5 pattern families
  // ---------------------------------------------------------------------------
  const content = extractWriteContent(toolInput);
  const warnings = [];

  for (const pattern of BUSINESS_PATTERNS) {
    // Reset lastIndex para cada verificacao (necessario para regex com /g)
    pattern.re.lastIndex = 0;
    const matches = content.match(pattern.re);
    if (matches && matches.length > 0) {
      warnings.push({
        pattern: pattern.id,
        description: pattern.description,
        count: matches.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Emitir WARN e telemetria para cada pattern encontrado
  // ---------------------------------------------------------------------------
  for (const warn of warnings) {
    const msg = `[aidd-frontend-business-guard] WARN: ${warn.description} em ${relPath} (${warn.count} ocorrencia(s)). Considere mover para servico/backend.`;
    process.stderr.write(msg + "\n");

    logWarnTelemetry({
      ts: new Date().toISOString(),
      session_id: sessionId,
      file_path: relPath,
      pattern: warn.pattern,
      description: warn.description,
      count: warn.count,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. SEMPRE ALLOW — nunca deny()
  // ---------------------------------------------------------------------------
  allow();
});

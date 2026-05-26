#!/usr/bin/env node
/**
 * aidd-tdd-guard-v2.cjs — TDD_Guard_V2
 *
 * Hook PreToolUse (Edit|Write) que enforça o ciclo RED→GREEN:
 *  - Edição em test file → executa vitest sync → upsert heartbeat v2
 *  - Edição em prod file → exige entry RED recente cobrindo o arquivo
 *
 * Property: CI-1 (heartbeat schema integrity)
 *
 * @version 2.0.0
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  getProjectRoot,
  validateSafePath,
  safeWrite,
  safeAppend,
  verificationFile,
} = require("./lib/aidd-paths.cjs");

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const WATCHED_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const HEARTBEAT_FILE = path.join(getProjectRoot(), ".aidd", ".tdd-heartbeat.json");
const TELEMETRY_DIR = path.join(getProjectRoot(), ".aidd", "telemetry");
const HEURISTIC_LOG = path.join(TELEMETRY_DIR, "tdd-heuristic.jsonl");
const OVERRIDES_LOG = path.join(TELEMETRY_DIR, "tdd-overrides.jsonl");

const HEARTBEAT_TTL_MS = 30 * 60 * 1000; // 30 minutos
const OVERRIDE_MIN_LENGTH = 20;

// SKILL_MAP fixo — basename do test → skill/hook cobrido
const SKILL_MAP = {
  "batch-loop": "aidd-impl-batch",
  "impl-batch": "aidd-impl-batch",
  "finalize": "aidd-impl-finalize",
  "impl-finalize": "aidd-impl-finalize",
  "cross-batch-emergent": "aidd-cross-batch-emergent",
  "cross-batch": "aidd-cross-batch-emergent",
  "confidence-score": null, // consumido por aidd-impl-start + aidd-close (sem skill direta)
  "domain-init": "aidd-domain-init",
};

// Padrões de arquivos de teste
const TEST_PATTERNS = [
  /\.(test|spec)\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /^test_.*\.py$/,
  /_test\.py$/,
];

// Padrões de produção (production roots)
const PRODUCTION_PATTERNS = [
  /^apps\/[^/]+\/(src|app)\//,
  /^services\/[^/]+\/(src|app)\//,
  /^packages\/[^/]+\/src\//,
];

// Padrões a ignorar (não são nem test nem prod)
const IGNORE_PATTERNS = [
  /\.md$/,
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.lock$/,
  /^docs\//,
  /^scripts\//,
  /^infra\//,
  /^\.aidd\//,
  /^\.kiro\//,
  /^\.claude\//,
  /^\.pipeline\//,
  /^\.gitignore$/,
  /package(-lock)?\.json$/,
];

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function readStdin() {
  return new Promise((res) => {
    let d = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => res(d));
  });
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

function matchesAny(rel, patterns) {
  return patterns.some((p) => p.test(rel));
}

// ---------------------------------------------------------------------------
// Heartbeat v2
// ---------------------------------------------------------------------------

/**
 * Lê o heartbeat — suporta schemas v1 e v2.
 * @returns {{ entries: Array, lastTestEditTs?: number, buffer_reason?: string }}
 */
function readHeartbeat() {
  try {
    const raw = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, "utf8"));
    // Garante que sempre tem campo entries (schema v2)
    if (!Array.isArray(raw.entries)) {
      raw.entries = [];
    }
    return raw;
  } catch {
    return { entries: [] };
  }
}

function writeHeartbeat(state) {
  try {
    safeWrite(HEARTBEAT_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal */ }
}

/**
 * Upsert de entry no heartbeat v2.
 */
function upsertEntry(heartbeat, testPath, fields) {
  const idx = heartbeat.entries.findIndex((e) => e.test_path === testPath);
  const entry = {
    test_path: testPath,
    result: fields.result,
    ts: fields.ts ?? Date.now(),
    coverage_paths: fields.coverage_paths ?? [],
    pending_green: fields.pending_green ?? false,
    cache_mtime: fields.cache_mtime ?? 0,
  };
  if (idx >= 0) {
    heartbeat.entries[idx] = entry;
  } else {
    heartbeat.entries.push(entry);
  }
  return heartbeat;
}

/**
 * Busca entry RED recente que cobre o arquivo de produção especificado.
 * Retorna { entry, wildcardOutsideSubtree } onde wildcardOutsideSubtree=true
 * indica que havia um candidato wildcard mas fora da subtree (para mensagem específica).
 */
function findRedEntryCovering(heartbeat, prodPath, root) {
  const now = Date.now();
  let wildcardOutsideSubtree = null; // guarda entry wildcard fora de subtree para mensagem específica

  for (const entry of heartbeat.entries) {
    if (entry.result !== "RED") continue;
    const age = now - (entry.ts ?? 0);
    if (age > HEARTBEAT_TTL_MS) continue;

    const paths = entry.coverage_paths ?? [];

    // Verificar cobertura exata
    if (paths.includes(prodPath)) return { entry, wildcardOutsideSubtree: null };
    if (paths.includes(prodPath.replace(/\\/g, "/"))) return { entry, wildcardOutsideSubtree: null };

    // Wildcard Rule 5 — só cobre subtree do test file (mitigação adversarial)
    if (paths.length === 1 && paths[0] === "*") {
      const testDir = path.dirname(entry.test_path);
      const absTestDir = path.isAbsolute(testDir)
        ? testDir
        : path.join(root, testDir);
      const absProd = path.isAbsolute(prodPath)
        ? prodPath
        : path.join(root, prodPath);
      const normalTestDir = path.normalize(absTestDir);
      const normalProd = path.normalize(absProd);
      const targetIsInSubtree =
        normalProd === normalTestDir ||
        normalProd.startsWith(normalTestDir + path.sep);
      if (!targetIsInSubtree) {
        wildcardOutsideSubtree = entry; // guarda para mensagem específica
        continue; // fora da subtree → não conta como cobertura válida
      }
      return { entry, wildcardOutsideSubtree: null };
    }
  }
  return { entry: null, wildcardOutsideSubtree };
}

/**
 * Marca uma entry como pending_green=true após prod edit.
 */
function markPendingGreen(heartbeat, testPath) {
  const entry = heartbeat.entries.find((e) => e.test_path === testPath);
  if (entry) entry.pending_green = true;
}

// ---------------------------------------------------------------------------
// Coverage Inference — 6 regras determinísticas (§3.3)
// Aplica em ordem; primeira que casa vence.
// Rule >= 2 → log em tdd-heuristic.jsonl
// ---------------------------------------------------------------------------

/**
 * Inferência de coverage_paths para um arquivo de teste.
 * @param {string} testPath — caminho relativo ao project root
 * @param {string} testContent — conteúdo lido do arquivo de teste (ou "")
 * @param {string} root — project root absoluto
 * @param {string} sessionId — para telemetria
 * @returns {{ rule: number, paths: string[], warn?: string }}
 */
function inferCoverage(testPath, testContent, root, sessionId) {
  // Regra 1: Header `// covers:`
  // Procura na primeira linha (ou primeiras 5 para tolerância)
  const firstLines = testContent.split("\n").slice(0, 5).join("\n");
  const headerMatch = firstLines.match(/^\/\/\s*covers:\s*(.+)$/m);
  if (headerMatch) {
    const paths = headerMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { rule: 1, paths };
  }

  // Regra 2: Co-located twin — `<dir>/<name>.test.<ext>` → `<dir>/<name>.<ext>`
  const twinMatch = testPath.match(/^(.+)\.(test|spec)\.([jt]sx?)$/);
  if (twinMatch) {
    const twinPath = `${twinMatch[1]}.${twinMatch[3]}`;
    const twinAbs = path.isAbsolute(twinPath)
      ? twinPath
      : path.join(root, twinPath);
    if (fs.existsSync(twinAbs)) {
      logHeuristic({ test_path: testPath, inferred_paths: [twinPath], rule_id: 2, ts: Date.now(), session_id: sessionId });
      return { rule: 2, paths: [twinPath] };
    }
  }

  // Regra 3: Hook test convention — `tests/aidd/hook-<NAME>.test.ts` → `.claude/hooks/aidd-<NAME>.cjs`
  const hookConvMatch = testPath.match(/(?:^|\/)tests\/aidd\/hook-([^/]+?)\.test\.[jt]s$/);
  if (hookConvMatch) {
    const hookName = hookConvMatch[1]; // ex: "secrets-guard"
    const hookPath = `.claude/hooks/aidd-${hookName}.cjs`;
    logHeuristic({ test_path: testPath, inferred_paths: [hookPath], rule_id: 3, ts: Date.now(), session_id: sessionId });
    return { rule: 3, paths: [hookPath] };
  }

  // Regra 4: Skill test convention — basename casa SKILL_MAP
  const basename = path.basename(testPath, path.extname(testPath)); // ex: "hook-batch-loop.test" → remove .ts → ainda tem .test
  const basenameNoExt = basename.replace(/\.(test|spec)$/, ""); // remove .test
  // Tentar com e sem prefixo "hook-"
  const skillKey = basenameNoExt.replace(/^hook-/, "");
  if (SKILL_MAP.hasOwnProperty(skillKey) && SKILL_MAP[skillKey] !== null) {
    const skillPath = `.claude/skills/${SKILL_MAP[skillKey]}/SKILL.md`;
    logHeuristic({ test_path: testPath, inferred_paths: [skillPath], rule_id: 4, ts: Date.now(), session_id: sessionId });
    return { rule: 4, paths: [skillPath] };
  }

  // Regra 5: Property / integration / E2E / smoke — wildcard de subtree
  // Nome contém property|integration|e2e|smoke E sem header covers
  const lowerPath = testPath.toLowerCase();
  if (/property|integration|e2e|smoke/.test(lowerPath)) {
    logHeuristic({ test_path: testPath, inferred_paths: ["*"], rule_id: 5, ts: Date.now(), session_id: sessionId });
    return { rule: 5, paths: ["*"] };
  }

  // Regra 6: Fallback sem match
  const warn = `Test sem // covers:; exige // covers: antes do próximo prod edit. Arquivo: ${testPath}`;
  logHeuristic({ test_path: testPath, inferred_paths: [], rule_id: 6, ts: Date.now(), session_id: sessionId, warn });
  return { rule: 6, paths: [], warn };
}

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------

function logHeuristic(entry) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    safeAppend(HEURISTIC_LOG, JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

function logOverride(entry) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    safeAppend(OVERRIDES_LOG, JSON.stringify(entry) + "\n");
  } catch { /* non-fatal */ }
}

function logDenial(rel, reason) {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    const block = [
      "",
      `### ${ts} - tdd-guard-v2-deny`,
      `**File:** ${rel}`,
      `**Reason:** ${reason.slice(0, 400)}`,
      `**Action:** escreva o teste primeiro (red), depois implemente (green). ` +
        `Override legítimo: AIDD_TDD_OVERRIDE=<reason ≥ 20 chars>.`,
      "",
    ].join("\n");
    const header = "## TDD-guard-v2 denials (auto-logged)";
    let existing = "";
    try {
      existing = fs.readFileSync(verificationFile(), "utf8");
    } catch {
      existing = "";
    }
    if (!existing.includes(header)) {
      safeAppend(verificationFile(), `\n${header}\n${block}`);
    } else {
      safeAppend(verificationFile(), block);
    }
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Execução de testes (sync) com cache por mtime
// ---------------------------------------------------------------------------

/**
 * Carrega o comando de teste de .claude/aidd-tdd-config.json (campo testCommand: string[]).
 * Default: vitest. O caminho do teste e anexado como ultimo argumento.
 */
function loadTestCommand(testPath) {
  let cmd = ["npx", "vitest", "run", "--reporter=verbose"];
  try {
    const cfgPath = path.join(getProjectRoot(), ".claude", "aidd-tdd-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (Array.isArray(cfg.testCommand) && cfg.testCommand.length > 0) {
      cmd = cfg.testCommand.map(String);
    }
  } catch { /* defaults */ }
  return { bin: cmd[0], args: [...cmd.slice(1), testPath] };
}

/**
 * Executa o runner de teste configurado e retorna "RED" | "GREEN".
 */
function execTestSync(testPath, root) {
  try {
    const cmd = loadTestCommand(testPath);
    const result = spawnSync(
      cmd.bin,
      cmd.args,
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, CI: "1" },
      }
    );
    return result.status === 0 ? "GREEN" : "RED";
  } catch {
    return "RED";
  }
}

/**
 * Obtém mtime do arquivo em ms. Retorna 0 se não existe.
 */
function getMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    allow();
    return;
  }

  const tool = payload.tool_name;
  if (!WATCHED_TOOLS.has(tool)) {
    allow();
    return;
  }

  // Opt-in: TDD RED-gate honors enabled:false in aidd-tdd-config.json
  // (armed at Phase 9 via /aidd-impl-start; off during setup/scaffolding).
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(getProjectRoot(), ".claude", "aidd-tdd-config.json"), "utf8"));
    if (cfg.enabled === false) { allow(); return; }
  } catch { /* default: active */ }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) {
    allow();
    return;
  }

  const sessionId = payload.session_id ?? "unknown";
  const root = getProjectRoot();
  const safe = validateSafePath(filePath, root);

  if (!safe.ok) {
    deny(
      `tdd-guard-v2 rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`
    );
    return;
  }

  const rel = safe.rel;

  // Ignorar arquivos não relevantes
  if (matchesAny(rel, IGNORE_PATTERNS)) {
    allow();
    return;
  }

  // ---------------------------------------------------------------------------
  // Override check — AIDD_TDD_OVERRIDE ≥ 20 chars
  // ---------------------------------------------------------------------------
  const overrideReason = process.env.AIDD_TDD_OVERRIDE ?? "";
  if (overrideReason && overrideReason.trim().length >= OVERRIDE_MIN_LENGTH) {
    logOverride({
      file_path: rel,
      reason: overrideReason.slice(0, 200),
      ts: Date.now(),
      session_id: sessionId,
      override_used: true,
    });
    allow();
    return;
  }

  // ---------------------------------------------------------------------------
  // Test file path → exec + heartbeat upsert
  // ---------------------------------------------------------------------------
  const isTest = matchesAny(rel, TEST_PATTERNS);

  if (isTest) {
    const absPath = path.join(root, rel);
    const currentMtime = getMtime(absPath);
    const heartbeat = readHeartbeat();

    // Cache hit — mtime não mudou → reusar resultado
    const existingEntry = heartbeat.entries.find((e) => e.test_path === rel);
    if (existingEntry && existingEntry.cache_mtime === currentMtime && currentMtime > 0) {
      // Cache hit — não re-executa, mas reseta pending_green (nova intenção de edit)
      existingEntry.pending_green = false;
      existingEntry.ts = Date.now();
      writeHeartbeat(heartbeat);
      allow();
      return;
    }

    // Cache miss → executar vitest
    const testContent = (() => {
      try {
        return fs.readFileSync(absPath, "utf8");
      } catch {
        return payload.tool_input?.content ?? payload.tool_input?.new_string ?? "";
      }
    })();

    const coverage = inferCoverage(rel, testContent, root, sessionId);

    // Emitir WARN Rule 6 no stderr (visível no terminal)
    if (coverage.rule === 6 && coverage.warn) {
      process.stderr.write(`[tdd-guard-v2 WARN] ${coverage.warn}\n`);
    }

    const testResult = execTestSync(rel, root);

    upsertEntry(heartbeat, rel, {
      result: testResult,
      ts: Date.now(),
      coverage_paths: coverage.paths,
      pending_green: false,
      cache_mtime: currentMtime,
    });

    writeHeartbeat(heartbeat);
    allow();
    return;
  }

  // ---------------------------------------------------------------------------
  // Production file → verificar RED heartbeat cobrindo este arquivo
  // ---------------------------------------------------------------------------
  const isProd = matchesAny(rel, PRODUCTION_PATTERNS);

  if (isProd) {
    const heartbeat = readHeartbeat();
    const { entry: candidate, wildcardOutsideSubtree } = findRedEntryCovering(heartbeat, rel, root);

    // Wildcard Rule 5 fora da subtree — mensagem específica de subtree
    if (!candidate && wildcardOutsideSubtree) {
      const testDir = path.dirname(wildcardOutsideSubtree.test_path);
      const reason =
        `Rule 5 wildcard só cobre subtree de ${testDir}; ${rel} está fora da subtree. ` +
        `Adicione // covers: ${rel} no arquivo de teste ${wildcardOutsideSubtree.test_path} ou escreva um teste específico.`;
      logDenial(rel, reason);
      deny(reason);
      return;
    }

    if (!candidate) {
      const reason =
        `${rel} é production code mas nenhum teste RED recente cobre este arquivo nos últimos 30 min. ` +
        `TDD_Guard_V2 (AIDD Req 3): escreva o teste primeiro (RED), depois implemente (GREEN). ` +
        `Override legítimo: defina AIDD_TDD_OVERRIDE=<reason ≥ ${OVERRIDE_MIN_LENGTH} chars> nesta sessão.`;
      logDenial(rel, reason);
      deny(reason);
      return;
    }

    // candidate.pending_green=true → segundo prod edit sem re-exec do teste → DENY
    if (candidate.pending_green) {
      const reason =
        `${rel}: o teste ${candidate.test_path} está pendente de GREEN. ` +
        `Re-execute o teste (edite-o novamente ou rode os testes) antes de continuar com prod edits.`;
      logDenial(rel, reason);
      deny(reason);
      return;
    }

    // ALLOW + marcar pending_green
    markPendingGreen(heartbeat, candidate.test_path);
    writeHeartbeat(heartbeat);
    allow();
    return;
  }

  // Arquivo não é test nem prod (ex: .claude/hooks, docs, etc.) → ALLOW
  allow();
})();

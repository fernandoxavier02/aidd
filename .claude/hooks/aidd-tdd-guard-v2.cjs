#!/usr/bin/env node
/**
 * aidd-tdd-guard-v2.cjs — TDD_Guard_V2 (thin shell over lib/guards/tdd.cjs)
 *
 * Hook PreToolUse (Edit|Write) que enforça o ciclo RED→GREEN:
 *  - Edição em test file → executa o runner configurado (sync) → upsert heartbeat v2
 *  - Edição em prod file → decisão delegada ao núcleo neutro (policy "edit")
 *
 * O núcleo (lib/guards/tdd.cjs) detém a REGRA (classificação, cobertura, TTL,
 * pending_green); esta casca detém a MAQUINARIA edit-time: spawnSync do runner,
 * escrita do heartbeat, cache por mtime, telemetria e o override de sessão.
 *
 * Property: CI-1 (heartbeat schema integrity)
 *
 * @version 2.1.0
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
const core = require("./lib/guards/tdd.cjs");

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const WATCHED_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const HEARTBEAT_FILE = path.join(getProjectRoot(), ".aidd", ".tdd-heartbeat.json");
const TELEMETRY_DIR = path.join(getProjectRoot(), ".aidd", "telemetry");
const HEURISTIC_LOG = path.join(TELEMETRY_DIR, "tdd-heuristic.jsonl");
const OVERRIDES_LOG = path.join(TELEMETRY_DIR, "tdd-overrides.jsonl");

const OVERRIDE_MIN_LENGTH = core.OVERRIDE_MIN_LENGTH;

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

// ---------------------------------------------------------------------------
// Heartbeat v2 (escrita — leitura vem do core)
// ---------------------------------------------------------------------------

function writeHeartbeat(state) {
  try {
    safeWrite(HEARTBEAT_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal */ }
}

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

function markPendingGreen(heartbeat, testPath) {
  const entry = heartbeat.entries.find((e) => e.test_path === testPath);
  if (entry) entry.pending_green = true;
}

// ---------------------------------------------------------------------------
// Coverage Inference — 6 regras determinísticas (§3.3)
// ---------------------------------------------------------------------------

function inferCoverage(testPath, testContent, root, sessionId) {
  // Regra 1: Header `// covers:`
  const firstLines = testContent.split("\n").slice(0, 5).join("\n");
  const headerMatch = firstLines.match(/^\/\/\s*covers:\s*(.+)$/m);
  if (headerMatch) {
    const paths = headerMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { rule: 1, paths };
  }

  // Regra 2: Co-located twin
  const twinMatch = testPath.match(/^(.+)\.(test|spec)\.([jt]sx?)$/);
  if (twinMatch) {
    const twinPath = `${twinMatch[1]}.${twinMatch[3]}`;
    const twinAbs = path.isAbsolute(twinPath) ? twinPath : path.join(root, twinPath);
    if (fs.existsSync(twinAbs)) {
      logHeuristic({ test_path: testPath, inferred_paths: [twinPath], rule_id: 2, ts: Date.now(), session_id: sessionId });
      return { rule: 2, paths: [twinPath] };
    }
  }

  // Regra 3: Hook test convention
  const hookConvMatch = testPath.match(/(?:^|\/)tests\/aidd\/hook-([^/]+?)\.test\.[jt]s$/);
  if (hookConvMatch) {
    const hookPath = `.claude/hooks/aidd-${hookConvMatch[1]}.cjs`;
    logHeuristic({ test_path: testPath, inferred_paths: [hookPath], rule_id: 3, ts: Date.now(), session_id: sessionId });
    return { rule: 3, paths: [hookPath] };
  }

  // Regra 4: Skill test convention
  const basename = path.basename(testPath, path.extname(testPath));
  const basenameNoExt = basename.replace(/\.(test|spec)$/, "");
  const skillKey = basenameNoExt.replace(/^hook-/, "");
  if (SKILL_MAP.hasOwnProperty(skillKey) && SKILL_MAP[skillKey] !== null) {
    const skillPath = `.claude/skills/${SKILL_MAP[skillKey]}/SKILL.md`;
    logHeuristic({ test_path: testPath, inferred_paths: [skillPath], rule_id: 4, ts: Date.now(), session_id: sessionId });
    return { rule: 4, paths: [skillPath] };
  }

  // Regra 5: Property / integration / E2E / smoke — wildcard de subtree
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

  const root = getProjectRoot();

  // Opt-in: TDD RED-gate honors enabled:false in aidd-tdd-config.json
  if (!core.loadTddConfig(root).enabled) {
    allow();
    return;
  }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) {
    allow();
    return;
  }

  const sessionId = payload.session_id ?? "unknown";
  const safe = validateSafePath(filePath, root);

  if (!safe.ok) {
    deny(
      `tdd-guard-v2 rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`
    );
    return;
  }

  const rel = safe.rel;
  const kind = core.classifyTddPath(rel);

  if (kind === "ignore" || kind === "other") {
    allow();
    return;
  }

  // ---------------------------------------------------------------------------
  // Override check — AIDD_TDD_OVERRIDE ≥ 20 chars (sessão supervisionada)
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
  // Test file path → exec + heartbeat upsert (maquinaria edit-time)
  // ---------------------------------------------------------------------------
  if (kind === "test") {
    const absPath = path.join(root, rel);
    const currentMtime = getMtime(absPath);
    const heartbeat = core.readHeartbeat(root);

    const existingEntry = heartbeat.entries.find((e) => e.test_path === rel);
    if (existingEntry && existingEntry.cache_mtime === currentMtime && currentMtime > 0) {
      existingEntry.pending_green = false;
      existingEntry.ts = Date.now();
      writeHeartbeat(heartbeat);
      allow();
      return;
    }

    const testContent = (() => {
      try {
        return fs.readFileSync(absPath, "utf8");
      } catch {
        return payload.tool_input?.content ?? payload.tool_input?.new_string ?? "";
      }
    })();

    const coverage = inferCoverage(rel, testContent, root, sessionId);

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
  // Production file → decisão do núcleo neutro (policy "edit")
  // ---------------------------------------------------------------------------
  const heartbeat = core.readHeartbeat(root);
  const verdict = core.evaluate({
    action: tool === "Write" ? "write" : "edit",
    path: rel,
    content: "",
    projectRoot: root,
    fileExists: true,
    config: { tdd: { enabled: true, policy: "edit", heartbeat } },
  });

  if (verdict.verdict === "deny") {
    logDenial(rel, verdict.message);
    deny(verdict.message);
    return;
  }

  // ALLOW + marcar pending_green no teste que cobriu
  if (verdict.evidence?.test_path) {
    markPendingGreen(heartbeat, verdict.evidence.test_path);
    writeHeartbeat(heartbeat);
  }
  allow();
})();

#!/usr/bin/env node
// aidd-rls-guard.cjs — thin Claude Code shell over lib/guards/rls.cjs.
// Keeps: stdin protocol (allow = JSON allow object), telemetry, and the
// strict ADR env override AIDD_OVERRIDE_RLS (edit-time only).
// Opt-in gate: OFF by default; enable via .claude/aidd-rls-config.json.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent, adrExists } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/rls.cjs");

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/** Override valido: AIDD_OVERRIDE_RLS=ADR-NNNN (4 digitos exatos) */
const OVERRIDE_ADR_RE = /^ADR-\d{4}$/;

const PROJECT_ROOT = getProjectRoot();
const TELEMETRY_DIR = path.join(PROJECT_ROOT, ".aidd", "telemetry");

function logTelemetry(filename, entry) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    safeAppend(path.join(TELEMETRY_DIR, filename), JSON.stringify(entry) + "\n");
  } catch {
    // telemetria nunca deve crashar o hook
  }
}

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
  process.exit(0);
}

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

  if (!core.loadRlsConfig(PROJECT_ROOT).enabled) {
    allow();
  }

  const toolInput = payload?.tool_input ?? {};
  const filePath = toolInput?.file_path ?? "";
  const sessionId = payload?.session_id ?? "unknown";

  const pathCheck = validateSafePath(filePath, PROJECT_ROOT);
  if (!pathCheck.ok) {
    allow();
  }

  const relPath = pathCheck.rel || filePath;
  const relPathNorm = relPath.replace(/\\/g, "/");

  // Override global AIDD_OVERRIDE_RLS=ADR-NNNN — verificado ANTES das regras
  const overrideVal = (process.env.AIDD_OVERRIDE_RLS || "").trim();
  if (overrideVal) {
    if (!OVERRIDE_ADR_RE.test(overrideVal) || !adrExists(overrideVal)) {
      deny(
        `[aidd-rls-guard] AIDD_OVERRIDE_RLS invalido ou ADR inexistente: "${overrideVal}". Exigido: ADR-NNNN (4 digitos) com arquivo em docs/adr/.`
      );
    }
    logTelemetry("rls-overrides.jsonl", {
      ts: new Date().toISOString(),
      session_id: sessionId,
      file_path: relPath,
      override: overrideVal,
    });
    allow();
  }

  // Siblings apenas para migrations SQL (companion detection)
  let siblings = [];
  if (core.SQL_MIGRATION_RE.test(relPathNorm)) {
    const absFilePath = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
    siblings = core.readSiblings(absFilePath);
  }

  const verdict = core.evaluate({
    action: toolName === "Write" ? "write" : "edit",
    path: relPathNorm,
    content: extractWriteContent(toolInput),
    projectRoot: PROJECT_ROOT,
    fileExists: undefined,
    config: { rls: { enabled: true, siblings } },
  });

  if (verdict.verdict === "deny") {
    logTelemetry("rls-block.jsonl", {
      ts: new Date().toISOString(),
      session_id: sessionId,
      file_path: relPath,
      reason: verdict.evidence?.rule || verdict.message.slice(0, 120),
    });
    deny(verdict.message);
  }

  if (verdict.verdict === "warn") {
    logTelemetry("rls-warn.jsonl", {
      ts: new Date().toISOString(),
      file_path: relPath,
      models: verdict.evidence?.models,
      warn: "prisma-model-no-rls-policy",
    });
    warnAndAllow(verdict.message);
  }

  allow();
});

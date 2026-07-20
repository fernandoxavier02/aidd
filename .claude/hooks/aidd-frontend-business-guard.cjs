#!/usr/bin/env node
// aidd-frontend-business-guard.cjs — thin Claude Code shell over
// lib/guards/frontend-business.cjs. WARN-only (NUNCA DENY): sempre allow.
// Keeps: stdin protocol (JSON allow), telemetria por warning.
// AIDD_DOMAIN_MAP_PATH: override do caminho do domain-map (para testes).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/frontend-business.cjs");

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

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

// Loader permissivo (fidelidade ao hook shipped): qualquer JSON parseável vale.
function loadDomainMap() {
  const mapPath =
    process.env.AIDD_DOMAIN_MAP_PATH ||
    path.join(PROJECT_ROOT, ".aidd", "domain-map.json");
  try {
    return JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch {
    return null;
  }
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

  const toolInput = payload?.tool_input ?? {};
  const filePath = toolInput?.file_path ?? "";
  const sessionId = payload?.session_id ?? "unknown";

  const pathCheck = validateSafePath(filePath, PROJECT_ROOT);
  if (!pathCheck.ok) {
    allow();
  }

  const relPath = (pathCheck.rel || filePath).replace(/\\/g, "/");

  const verdict = core.evaluate({
    action: toolName === "Write" ? "write" : "edit",
    path: relPath,
    content: extractWriteContent(toolInput),
    projectRoot: PROJECT_ROOT,
    fileExists: undefined,
    config: { frontendBusiness: { map: loadDomainMap() } },
  });

  if (verdict.verdict === "warn" && Array.isArray(verdict.evidence)) {
    for (const w of verdict.evidence) {
      const msg = `[aidd-frontend-business-guard] WARN: ${w.description} em ${relPath} (${w.count} ocorrencia(s)). Considere mover para servico/backend.`;
      process.stderr.write(msg + "\n");
      logWarnTelemetry({
        ts: new Date().toISOString(),
        session_id: sessionId,
        file_path: relPath,
        pattern: w.pattern,
        description: w.description,
        count: w.count,
      });
    }
  }

  // SEMPRE ALLOW — nunca deny()
  allow();
});

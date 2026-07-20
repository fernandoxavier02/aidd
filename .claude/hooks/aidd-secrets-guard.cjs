#!/usr/bin/env node
/**
 * aidd-secrets-guard.cjs — thin Claude Code shell over lib/guards/secrets.cjs.
 * Keeps: stdin protocol (allow = empty stdout), telemetry, and the emergency
 * env override AIDD_OVERRIDE_SECRETS (edit-time only — the git net ignores it).
 * NFR-5: telemetria NAO vaza o valor do secret — apenas pattern.id e file_path.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/secrets.cjs");

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

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

function allowWithWarn(warnMessage) {
  process.stderr.write(`[aidd-secrets-guard] WARN: ${warnMessage}\n`);
  process.stdout.write("");
  process.exit(0);
}

function allow() {
  process.stdout.write("");
  process.exit(0);
}

let inputRaw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { inputRaw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(inputRaw);
  } catch {
    allow();
  }

  const toolName = payload.tool_name || "";
  const sessionId = payload.session_id || "unknown";
  const toolInput = payload.tool_input || {};
  const rawFilePath = toolInput.file_path || "";

  if (!WRITE_TOOLS.has(toolName)) {
    allow();
    return;
  }

  const pathCheck = validateSafePath(rawFilePath, PROJECT_ROOT);
  const filePath = pathCheck.ok ? pathCheck.rel : rawFilePath;
  const ts = new Date().toISOString();

  const verdict = core.evaluate({
    action: toolName === "Write" ? "write" : "edit",
    path: filePath,
    content: extractWriteContent(toolInput),
    projectRoot: PROJECT_ROOT,
    fileExists: undefined,
    config: { secrets: { catalog: core.loadCatalog(PROJECT_ROOT) } },
  });

  if (verdict.verdict === "allow") {
    allow();
    return;
  }

  if (verdict.verdict === "warn") {
    logTelemetry("secrets-warn.jsonl", {
      pattern: verdict.evidence?.pattern,
      file_path: filePath,
      ts,
      session_id: sessionId,
      override_used: false,
    });
    allowWithWarn(verdict.message);
    return;
  }

  // deny — telemetria + override apenas para pattern-match (não .env / fail-safe)
  const rule = verdict.evidence?.rule;
  if (rule === "env-file-rule") {
    logTelemetry("secrets-block.jsonl", {
      pattern: "env-file-rule",
      file_path: filePath,
      ts,
      session_id: sessionId,
      override_used: false,
    });
    deny(verdict.message);
    return;
  }
  if (rule === "catalog-fail-safe" || rule === undefined && !verdict.evidence?.pattern) {
    deny(verdict.message);
    return;
  }

  // pattern-match deny
  logTelemetry("secrets-block.jsonl", {
    pattern: verdict.evidence?.pattern,
    file_path: filePath,
    ts,
    session_id: sessionId,
    override_used: false,
  });

  const overrideVal = process.env.AIDD_OVERRIDE_SECRETS || "";
  if (overrideVal.length >= 20) {
    logTelemetry("secrets-overrides.jsonl", {
      pattern: verdict.evidence?.pattern,
      file_path: filePath,
      reason: overrideVal.slice(0, 120),
      ts,
      session_id: sessionId,
    });
    allowWithWarn(
      `Override aplicado: '${overrideVal.slice(0, 60)}'. ` +
      `Pattern '${verdict.evidence?.family}' (${verdict.evidence?.pattern}) em '${filePath}'.`
    );
    return;
  }

  deny(verdict.message);
});

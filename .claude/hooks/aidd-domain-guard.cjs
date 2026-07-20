#!/usr/bin/env node
/**
 * aidd-domain-guard.cjs — thin Claude Code shell over lib/guards/domain.cjs.
 * Keeps: stdin protocol, telemetry, and the ADR-backed env override
 * AIDD_OVERRIDE_DOMAIN (edit-time only — the git net ignores it).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot, validateSafePath, safeAppend, extractWriteContent, adrExists } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/domain.cjs");

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

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

function logTelemetry(filename, entry) {
  try {
    const root = getProjectRoot();
    const dir = path.join(root, ".aidd", "telemetry");
    fs.mkdirSync(dir, { recursive: true });
    safeAppend(path.join(dir, filename), JSON.stringify(entry) + "\n");
  } catch (_e) {
    // Telemetria nunca bloqueia execução
  }
}

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

  const rawFilePath = toolInput.file_path || "";
  const root = getProjectRoot();
  const pathCheck = validateSafePath(rawFilePath, root);
  if (!pathCheck.ok) {
    allow(); // path inválido — deixar outros hooks tratar
    return;
  }

  const verdict = core.evaluate({
    action: toolName === "Write" ? "write" : "edit",
    path: pathCheck.rel,
    content: extractWriteContent(toolInput),
    projectRoot: root,
    fileExists: undefined,
    config: { domain: { map: core.loadDomainMap(root) } },
  });

  if (verdict.verdict === "allow") { allow(); return; }
  if (verdict.verdict === "warn") { allowWithWarn(verdict.message); return; }

  // deny — telemetria + override ADR
  const ev = verdict.evidence || {};
  logTelemetry("domain-block.jsonl", {
    from_layer: ev.fromLayer,
    target_layer: ev.targetLayer,
    rule_violated: `${ev.fromLayer} cannot import from ${ev.targetLayer}`,
    import_spec: ev.importSpec,
    file_path: pathCheck.rel,
    ts,
    session_id: sessionId,
    override_used: false,
  });

  const overrideVal = process.env.AIDD_OVERRIDE_DOMAIN || "";
  if (overrideVal && /ADR-\d{4}/.test(overrideVal) && adrExists(overrideVal)) {
    logTelemetry("domain-overrides.jsonl", {
      from_layer: ev.fromLayer,
      target_layer: ev.targetLayer,
      rule_violated: `${ev.fromLayer} cannot import from ${ev.targetLayer}`,
      import_spec: ev.importSpec,
      file_path: pathCheck.rel,
      adr: overrideVal.match(/ADR-\d{4}/)?.[0] ?? "unknown",
      override_used: true,
      reason: overrideVal.slice(0, 200),
      ts,
      session_id: sessionId,
    });
    allowWithWarn(
      `Domain rule override aplicado: ${overrideVal.slice(0, 80)}. ` +
      `Layer '${ev.fromLayer}' importando de '${ev.targetLayer}' — ${ev.rationale}.`
    );
    return;
  }

  deny(verdict.message);
});

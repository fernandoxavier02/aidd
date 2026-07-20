#!/usr/bin/env node
// Thin Claude Code shell over the neutral core (lib/guards/contract.cjs).
// Keeps: stdin protocol, path validation, the audited V1.1 install-bypass
// (edit-time affordance — NOT honored by the git net).
const path = require("node:path");
const fs = require("node:fs");
const { getProjectRoot, validateSafePath } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/contract.cjs");

const WATCHED = new Set(["Edit", "Write", "MultiEdit"]);

// ---------------------------------------------------------------------------
// Aidd_Contract_Guard_V1.1 — bypass para install de v2
// Whitelist fixa — NAO modificar sem ADR superseding este.
// ---------------------------------------------------------------------------
const INSTALL_WHITELIST = [
  "AIDD.md",
  "CONTEXT_INDEX.md",
  "AGENTS.md",
  "CLAUDE.md",
];

function isInstallBypassAllowed(relPath) {
  if (process.env.AIDD_V2_INSTALL !== "1") return false;
  return INSTALL_WHITELIST.includes(relPath);
}

function logBypass(relPath, sessionId) {
  const telemetryDir = path.join(getProjectRoot(), ".aidd", "telemetry");
  try { fs.mkdirSync(telemetryDir, { recursive: true }); } catch (_e) {}
  const entry = JSON.stringify({
    file_path: relPath,
    ts: new Date().toISOString(),
    session_id: sessionId ?? "unknown",
    reason: "v2-install",
  });
  try {
    fs.appendFileSync(path.join(telemetryDir, "contract-bypass.jsonl"), entry + "\n", "utf8");
  } catch (_e) {}
}

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
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function allow() { process.exit(0); }

(async () => {
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { allow(); return; }

  const tool = payload.tool_name;
  if (!WATCHED.has(tool)) { allow(); return; }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) { allow(); return; }

  const root = getProjectRoot();
  const safe = validateSafePath(filePath, root);
  if (!safe.ok) {
    deny(`contract-guard rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`);
    return;
  }
  const rel = safe.rel;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);

  // V1.1: bypass auditado para install de v2 — verificar ANTES do deny
  if (isInstallBypassAllowed(rel)) {
    logBypass(rel, payload.session_id);
    allow();
    return;
  }

  const verdict = core.evaluate({
    action: tool === "Write" ? "write" : "edit",
    path: rel,
    content: "",
    projectRoot: root,
    fileExists: fs.existsSync(abs),
    config: {},
  });

  if (verdict.verdict === "deny") { deny(verdict.message); return; }
  allow();
})();

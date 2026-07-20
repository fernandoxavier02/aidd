#!/usr/bin/env node
// Thin Claude Code shell over the neutral core (lib/guards/phase.cjs).
// Keeps: stdin protocol, env override, path validation, VERIFICATION_REPORT
// warn logging (adapter-side side effect).
const fs = require("node:fs");
const { getProjectRoot, verificationFile, validateSafePath, safeAppend } = require("./lib/aidd-paths.cjs");
const core = require("./lib/guards/phase.cjs");

const WATCHED_TOOLS = new Set(["Edit", "Write"]);

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

function logWarning(rel, reason) {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    const block = [
      "",
      `### ${ts} - phase-guard-warn`,
      `**File:** ${rel}`,
      `**Reason:** ${reason.slice(0, 400)}`,
      `**Action required:** review se foi falso positivo (phase desatualizada) ou genuíno (pulou fase).`,
      "",
    ].join("\n");
    const header = "## Phase-guard warnings (auto-logged)";
    let existing = "";
    try { existing = fs.readFileSync(verificationFile(), "utf8"); } catch { existing = ""; }
    if (!existing.includes(header)) {
      safeAppend(verificationFile(), `\n${header}\n${block}`);
    } else {
      safeAppend(verificationFile(), block);
    }
  } catch { /* non-fatal */ }
}

(async () => {
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { allow(); return; }

  const tool = payload.tool_name;
  if (!WATCHED_TOOLS.has(tool)) { allow(); return; }

  const filePath = payload.tool_input?.file_path;
  if (!filePath) { allow(); return; }

  const root = getProjectRoot();
  const cfg = core.loadConfig(root);
  if (!cfg.enabled) { allow(); return; }
  if (process.env.AIDD_PHASE_OVERRIDE === "1") { allow(); return; }

  const safe = validateSafePath(filePath, root);
  if (!safe.ok) {
    deny(`phase-guard rejeita path inseguro: ${safe.reason}. Edits devem ser dentro do project root, sem path-traversal.`);
    return;
  }

  const verdict = core.evaluate({
    action: tool === "Write" ? "write" : "edit",
    path: safe.rel,
    content: "",
    projectRoot: root,
    fileExists: true,
    config: { phaseGuard: cfg },
  });

  if (verdict.verdict === "deny") { deny(verdict.message); return; }
  if (verdict.verdict === "warn") { logWarning(safe.rel, verdict.message); allow(); return; }
  allow();
})();

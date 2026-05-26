"use strict";
/**
 * aidd-adversarial-read-guard.cjs
 *
 * PreToolUse hook — enforces Context_Isolation for adversarial agents.
 *
 * Intercepts Read | Grep | Glob tool calls from subagents and applies 4 mutually-exclusive rules:
 *
 *   REGRA 1: Main agent (no agent_id in STDIN) -> allow unconditionally
 *   REGRA 2: Subagent + matching context file  -> enforce TTL + allowed_files
 *   REGRA 3: Subagent + _ACTIVE.lock + no match -> deny (fail-closed) unless file in lock.allowed_files (benign race)
 *   REGRA 4: Subagent + no context + no lock    -> allow (no active adversarial session)
 *
 * Context directory: .aidd/current/adversarial-context/
 *   - _ACTIVE.lock  -> signals session is live (PRE-SPAWN)
 *   - <id>.json     -> per-agent context (POST-SPAWN)
 *
 * Telemetry: .aidd/telemetry/adversarial-isolation-block.jsonl (appended on every DENY).
 *
 * STDIN:  JSON hook payload from Claude Code
 * STDOUT: empty (allow) or { hookSpecificOutput: { hookEventName, permissionDecision:"deny", permissionDecisionReason } }
 */

const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot } = require("./lib/aidd-paths.cjs");

// AIDD_ADVERSARIAL_CTX_DIR / AIDD_TELEMETRY_DIR: test overrides
const ENV_CTX_DIR = process.env.AIDD_ADVERSARIAL_CTX_DIR || null;
const ENV_TELEMETRY_DIR = process.env.AIDD_TELEMETRY_DIR || null;

function getCtxDir() {
  if (ENV_CTX_DIR) return ENV_CTX_DIR;
  return path.join(getProjectRoot(), ".aidd", "current", "adversarial-context");
}

function getTelemetryDir() {
  if (ENV_TELEMETRY_DIR) return ENV_TELEMETRY_DIR;
  return path.join(getProjectRoot(), ".aidd", "telemetry");
}

function normalizePath(p) {
  return path.normalize(String(p)).replace(/\\/g, "/").toLowerCase();
}

/**
 * Strict, segment-boundary path match. Prevents "evil-config.ts" from matching
 * an allowed "config.ts": matches only on full path-segment boundaries.
 */
function pathMatchesAllowed(requested, allowedList) {
  const r = normalizePath(requested);
  if (!r) return false;
  return allowedList.map(normalizePath).some((a) => {
    if (!a) return false;
    return (
      r === a ||
      r.endsWith("/" + a) ||
      a.endsWith("/" + r) ||
      r.startsWith(a + "/")
    );
  });
}

function allow(message) { return { decision: "allow", message: message || "allowed" }; }
function deny(reason, message) { return { decision: "deny", reason, message: message || reason }; }

function fileExists(filePath) {
  try { return fs.existsSync(filePath); } catch { return false; }
}
function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function logTelemetry(entry) {
  const telemetryDir = getTelemetryDir();
  try {
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.appendFileSync(
      path.join(telemetryDir, "adversarial-isolation-block.jsonl"),
      JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n",
      "utf8"
    );
  } catch (e) {
    process.stderr.write(`[aidd-adversarial-read-guard] telemetry write failed: ${e.message}\n`);
  }
}

function loadContextFiles(ctxDir) {
  const lockPath = path.join(ctxDir, "_ACTIVE.lock");
  const lock = fileExists(lockPath) ? readJSON(lockPath) : null;
  let ctxFiles = [];
  if (fileExists(ctxDir)) {
    try {
      for (const entry of fs.readdirSync(ctxDir)) {
        if (entry.endsWith(".json") && !entry.startsWith("_")) {
          const parsed = readJSON(path.join(ctxDir, entry));
          if (parsed) ctxFiles.push(parsed);
        }
      }
    } catch (e) {
      process.stderr.write(`[aidd-adversarial-read-guard] readdir failed: ${e.message}\n`);
    }
  }
  return { lock, ctxFiles };
}

function applyRule1(agentId) { return !agentId; }

function applyRule2(matching, filePath, agentId, now) {
  const active = matching.filter((j) => {
    const age = (now - new Date(j.ts).getTime()) / 1000;
    return age <= (j.ttl_seconds || 600);
  });

  if (active.length === 0) {
    logTelemetry({ reason: "ttl-expired", agent_id: agentId, file_path: filePath });
    return deny("ttl-expired", `Adversarial context for ${agentId} expired (>${matching[0].ttl_seconds || 600}s old). Context_Isolation: DENY.`);
  }

  const allowed = active.flatMap((j) => j.allowed_files || []);
  if (!pathMatchesAllowed(filePath, allowed)) {
    logTelemetry({ reason: "out-of-whitelist", agent_id: agentId, file_path: filePath });
    return deny("out-of-whitelist", `File ${filePath} not in adversarial allowed_files. Context_Isolation enforced. out-of-whitelist.`);
  }
  return allow(`File ${filePath} is in allowed_files for agent ${agentId}.`);
}

function applyRule3(lock, filePath, agentId, now) {
  const lockAge = (now - new Date(lock.ts).getTime()) / 1000;
  const lockTtl = lock.ttl_seconds || 600;

  if (lockAge > lockTtl) {
    logTelemetry({ reason: "lock-expired", agent_id: agentId, file_path: filePath });
    return deny("lock-expired", `Adversarial lock expired (>${lockTtl}s old). Cleanup likely failed. lock-expired.`);
  }

  if (pathMatchesAllowed(filePath, lock.allowed_files || [])) {
    return allow(`Race window: agent_id not yet enriched but ${filePath} is in lock.allowed_files. Allowing.`);
  }

  logTelemetry({ reason: "lock-active-no-context-match", agent_id: agentId, file_path: filePath });
  return deny("lock-active-no-context-match", `Subagent ${agentId} has no matching context file but _ACTIVE.lock is set and file ${filePath} not in lock.allowed_files. lock-active-no-context-match.`);
}

function applyRule4() { return allow("No active adversarial session. Subagent allowed unconditionally."); }

function emit(decision) {
  if (decision && decision.decision === "deny") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.message || decision.reason || "Context_Isolation: DENY",
      },
    }));
  }
  // allow -> empty stdout (Claude Code treats empty as allow)
  process.exit(0);
}

function readStdin() {
  return new Promise((res) => {
    let d = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => res(d));
  });
}

(async () => {
  const raw = await readStdin();

  let input;
  try { input = JSON.parse(raw || "{}"); } catch { emit(allow("invalid JSON input — defaulting allow")); return; }

  const GUARDED_TOOLS = ["Read", "Grep", "Glob"];
  const toolName = input.tool_name || "";
  if (!GUARDED_TOOLS.includes(toolName)) { emit(allow(`Tool ${toolName} not guarded`)); return; }

  const agent_id = input.agent_id || null;
  const filePath =
    (input.tool_input && (input.tool_input.file_path || input.tool_input.pattern || input.tool_input.path)) || "";

  const ctxDir = getCtxDir();
  const now = Date.now();

  if (applyRule1(agent_id)) { emit(allow("REGRA 1: main agent — no agent_id")); return; }

  const { lock, ctxFiles } = loadContextFiles(ctxDir);
  const matching = ctxFiles.filter((j) => j.agent_id === agent_id);

  if (matching.length > 0) { emit(applyRule2(matching, filePath, agent_id, now)); return; }
  if (lock) { emit(applyRule3(lock, filePath, agent_id, now)); return; }
  emit(applyRule4());
})();

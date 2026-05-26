"use strict";
/**
 * aidd-adversarial-context.cjs
 *
 * Helper library for AIDD v2 adversarial Context_Isolation lifecycle.
 * Used by skills (aidd-impl-batch, aidd-impl-finalize) to manage:
 *   - _ACTIVE.lock file (signals adversarial session is live)
 *   - <id>.json context files (per-agent allowed_files whitelist)
 *   - Atomic lock transition via fs.renameSync (ISSUE-R4-3 fix)
 *   - Cleanup after batch/finalize completes
 *
 * Design: design.md §3.8
 * Tasks: tasks.md 7.2
 */

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Resolve context directory
// ---------------------------------------------------------------------------

/**
 * Resolve the adversarial context directory.
 * Priority: opts.ctxDir > opts.projectRoot/.aidd/current/adversarial-context > cwd default
 */
function resolveCtxDir(opts = {}) {
  if (opts.ctxDir) return opts.ctxDir;
  const root = opts.projectRoot || process.cwd();
  return path.join(root, ".aidd", "current", "adversarial-context");
}

/**
 * Ensure the context directory exists.
 */
function ensureCtxDir(ctxDir) {
  fs.mkdirSync(ctxDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Lock file operations
// ---------------------------------------------------------------------------

/**
 * writeAdversarialLock — FASE 1 of adversarial protocol (PRE-SPAWN).
 *
 * Writes _ACTIVE.lock signaling that an adversarial session is live.
 * Any subagent spawned after this point will be subject to REGRA 2/3.
 *
 * @param {string} session      - Identifier e.g. "batch-1" | "finalize-trio" | "cbd"
 * @param {number} expectedSpawns - How many adversarial agents will be spawned
 * @param {string[]} allowedFiles - Paths (relative to project root) agents may read
 * @param {object} opts         - { projectRoot?, ctxDir?, ttl? }
 */
function writeAdversarialLock(session, expectedSpawns, allowedFiles, opts = {}) {
  const ctxDir = resolveCtxDir(opts);
  ensureCtxDir(ctxDir);
  const lockData = {
    session,
    expected_spawns: expectedSpawns,
    allowed_files: allowedFiles,
    ts: new Date().toISOString(),
    ttl_seconds: opts.ttl || 600,
  };
  fs.writeFileSync(
    path.join(ctxDir, "_ACTIVE.lock"),
    JSON.stringify(lockData, null, 2),
    "utf8"
  );
  return lockData;
}

/**
 * writeAdversarialContext — FASE 2 of adversarial protocol (POST-SPAWN).
 *
 * Written after spawn returns and agent_id is captured.
 * The hook uses this to enforce allowed_files per REGRA 2.
 *
 * @param {string} id           - Context identifier (e.g. "batch-1", "finalize-security")
 * @param {string} agentId      - agent_id captured from Agent spawn return
 * @param {string[]} allowedFiles - Files the agent is permitted to read
 * @param {object} opts         - { projectRoot?, ctxDir?, ttl? }
 */
function writeAdversarialContext(id, agentId, allowedFiles, opts = {}) {
  const ctxDir = resolveCtxDir(opts);
  ensureCtxDir(ctxDir);
  const ctxData = {
    id,
    agent_id: agentId,
    allowed_files: allowedFiles,
    ts: new Date().toISOString(),
    ttl_seconds: opts.ttl || 600,
  };
  fs.writeFileSync(
    path.join(ctxDir, `${id}.json`),
    JSON.stringify(ctxData, null, 2),
    "utf8"
  );
  return ctxData;
}

// ---------------------------------------------------------------------------
// Atomic lock transition (ISSUE-R4-3 fix)
// ---------------------------------------------------------------------------

/**
 * atomicTransitionLock — Replaces _ACTIVE.lock atomically (Lifecycle B step 5).
 *
 * Protocol:
 *   5.a: write _ACTIVE.lock.new with new lock data
 *   5.b: fs.renameSync(_ACTIVE.lock.new → _ACTIVE.lock)  ← atomic on ext4/NTFS
 *   5.c: remove old finalize-{dim}.json context files
 *
 * This ensures the hook NEVER sees a moment without a lock between
 * the finalize-trio and CBD phases. If any trio subagent residually
 * fires a Read during the transition, REGRA 3 covers it.
 *
 * @param {object} newLockData  - The new lock data to write
 * @param {object} opts         - { projectRoot?, ctxDir? }
 */
function atomicTransitionLock(newLockData, opts = {}) {
  const ctxDir = resolveCtxDir(opts);
  ensureCtxDir(ctxDir);

  const lockPath = path.join(ctxDir, "_ACTIVE.lock");
  const lockNewPath = path.join(ctxDir, "_ACTIVE.lock.new");

  // Step 5.a: write new lock to .lock.new
  const lockToWrite = {
    ...newLockData,
    ts: newLockData.ts || new Date().toISOString(),
    ttl_seconds: newLockData.ttl_seconds || 600,
  };
  fs.writeFileSync(lockNewPath, JSON.stringify(lockToWrite, null, 2), "utf8");

  // Step 5.b: atomic rename — on ext4/NTFS this is an atomic replacement
  fs.renameSync(lockNewPath, lockPath);

  // Step 5.c: remove old finalize-{dim}.json context files
  try {
    const files = fs.readdirSync(ctxDir);
    for (const f of files) {
      if (f.startsWith("finalize-") && f.endsWith(".json")) {
        fs.rmSync(path.join(ctxDir, f), { force: true });
      }
    }
  } catch (e) {
    // Non-fatal: cleanup failure should not break the atomic transition
    process.stderr.write(
      `[aidd-adversarial-context] cleanup finalize files failed: ${e.message}\n`
    );
  }

  return lockToWrite;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * cleanupAdversarialContext — Remove lock + all <id>.json files.
 *
 * Called after adversarial session completes (after fix loops resolved).
 * After cleanup, REGRA 4 applies: subagents are allowed unconditionally.
 *
 * @param {object} opts - { projectRoot?, ctxDir? }
 */
function cleanupAdversarialContext(opts = {}) {
  const ctxDir = resolveCtxDir(opts);
  if (!fs.existsSync(ctxDir)) return;

  const lockPath = path.join(ctxDir, "_ACTIVE.lock");
  if (fs.existsSync(lockPath)) {
    fs.rmSync(lockPath, { force: true });
  }

  // Remove all *.json context files (not the lock, already removed)
  try {
    const files = fs.readdirSync(ctxDir);
    for (const f of files) {
      if (f.endsWith(".json") && !f.startsWith("_")) {
        fs.rmSync(path.join(ctxDir, f), { force: true });
      }
    }
  } catch (e) {
    process.stderr.write(
      `[aidd-adversarial-context] cleanup context files failed: ${e.message}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  writeAdversarialLock,
  writeAdversarialContext,
  atomicTransitionLock,
  cleanupAdversarialContext,
  resolveCtxDir, // exported for testing
};

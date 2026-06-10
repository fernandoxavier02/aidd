"use strict";
// Consumer .claude/settings.json generation and merge.
//
// The package's own settings.json is the single source of truth for which
// hooks run on which events. For hybrid installs we rewrite the command paths
// to point inside node_modules, so `npm update` upgrades the engine with no
// file copying. For copy installs the paths stay project-local.
//
// Merging is idempotent and additive: existing user hooks are preserved; an
// AIDD hook is added only if no hook with the same command string is already
// registered for that event.

const fs = require("node:fs");
const path = require("node:path");
const { packageRoot, PKG_NAME } = require("./files-map.cjs");

const LOCAL_PREFIX = "${CLAUDE_PROJECT_DIR}/.claude/hooks/";
const HYBRID_PREFIX = `\${CLAUDE_PROJECT_DIR}/node_modules/${PKG_NAME}/.claude/hooks/`;

/** The settings object the consumer should end up with (before merging). */
function buildConsumerSettings(mode) {
  const raw = fs.readFileSync(path.join(packageRoot(), ".claude", "settings.json"), "utf8");
  const text = mode === "hybrid" ? raw.split(LOCAL_PREFIX).join(HYBRID_PREFIX) : raw;
  return JSON.parse(text);
}

/** All hook command strings present in a settings object, per event. */
function commandsByEvent(settings) {
  const map = {};
  const hooks = (settings && settings.hooks) || {};
  for (const [event, groups] of Object.entries(hooks)) {
    map[event] = new Set();
    for (const group of groups || []) {
      for (const h of group.hooks || []) {
        if (h && typeof h.command === "string") map[event].add(h.command);
      }
    }
  }
  return map;
}

/**
 * Merge `incoming` AIDD hook registrations into `existing` user settings.
 * Returns { merged, added } where `added` lists the command strings inserted.
 * `existing` may be null/undefined (fresh project) — incoming is returned as-is.
 */
function mergeSettings(existing, incoming) {
  if (!existing || typeof existing !== "object") {
    return { merged: incoming, added: flattenCommands(incoming) };
  }
  const merged = JSON.parse(JSON.stringify(existing));
  if (!merged.hooks || typeof merged.hooks !== "object") merged.hooks = {};
  const have = commandsByEvent(merged);
  const added = [];

  for (const [event, groups] of Object.entries(incoming.hooks || {})) {
    if (!Array.isArray(merged.hooks[event])) merged.hooks[event] = [];
    const haveSet = have[event] || new Set();
    for (const group of groups || []) {
      const missing = (group.hooks || []).filter((h) => !haveSet.has(h.command));
      if (missing.length === 0) continue;
      // Prefer appending into an existing group with the same matcher.
      const sibling = merged.hooks[event].find((g) => g.matcher === group.matcher);
      if (sibling) {
        sibling.hooks = [...(sibling.hooks || []), ...missing];
      } else {
        merged.hooks[event].push({ ...group, hooks: missing });
      }
      for (const h of missing) {
        haveSet.add(h.command);
        added.push(h.command);
      }
    }
  }
  return { merged, added };
}

function flattenCommands(settings) {
  const out = [];
  for (const groups of Object.values((settings && settings.hooks) || {})) {
    for (const group of groups || []) {
      for (const h of group.hooks || []) out.push(h.command);
    }
  }
  return out;
}

module.exports = { buildConsumerSettings, mergeSettings, flattenCommands, LOCAL_PREFIX, HYBRID_PREFIX };

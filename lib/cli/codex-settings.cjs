"use strict";
// Consumer .codex/hooks.json generation, merge and doctor checks.
// Generate-only: this file is written into the CONSUMER project at init and is
// never shipped in the package tarball (spec R1 finding 16). Merge is the same
// idempotent additive strategy as .claude/settings.json (reused directly).
// Schema per the verified 2026 research (provider-agnostic-guards skill):
// only "type": "command" enforces; matcher is apply_patch (no Bash — R1 f11).

const fs = require("node:fs");
const path = require("node:path");
const fm = require("./files-map.cjs");
const { mergeSettings } = require("./settings.cjs");

const CODEX_HOOKS_REL = ".codex/hooks.json";

function adapterRelPath(mode) {
  return mode === "copy"
    ? ".claude/hooks/lib/adapters/codex.cjs"
    : `node_modules/${fm.PKG_NAME}/.claude/hooks/lib/adapters/codex.cjs`;
}

/** hooks.json que o consumidor deve ter (antes do merge). */
function buildConsumerCodexHooks(mode) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "apply_patch",
          hooks: [
            {
              type: "command",
              command: `node "${adapterRelPath(mode)}"`,
              timeout: 10,
            },
          ],
        },
      ],
    },
  };
}

/** Camada codex no init/update: gerar + merge idempotente. */
function installCodexLayer(targetRoot, manifest, results, opts = {}) {
  const abs = path.join(targetRoot, ...CODEX_HOOKS_REL.split("/"));
  let existing = null;
  if (fs.existsSync(abs)) {
    try {
      existing = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      results.push({ rel: CODEX_HOOKS_REL, action: `skipped (JSON invalido — corrija primeiro: ${e.message})` });
      return;
    }
  }
  const { merged, added } = mergeSettings(existing, buildConsumerCodexHooks(opts.mode || "hybrid"));
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(merged, null, 2) + "\n");
  }
  results.push({
    rel: CODEX_HOOKS_REL,
    action: added.length ? `merged (+${added.length} hook registrations)` : "up-to-date",
  });
  manifest.layers = { ...(manifest.layers || {}), codex: true };
}

/** Checagens da camada codex para o doctor. */
function checkCodexLayer(targetRoot, manifest, ok, warn, error) {
  const abs = path.join(targetRoot, ...CODEX_HOOKS_REL.split("/"));
  if (!fs.existsSync(abs)) {
    error("codex", `${CODEX_HOOKS_REL} ausente — rode \`aidd update\``);
    return;
  }
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    error("codex", `${CODEX_HOOKS_REL} nao e JSON valido (${e.message})`);
    return;
  }
  let aiddFound = false;
  for (const groups of Object.values(hooks.hooks || {})) {
    for (const g of groups || []) {
      for (const h of g.hooks || []) {
        const isAidd = typeof h.command === "string" && /codex\.cjs|aidd/.test(h.command);
        if (h.type !== "command") {
          // Pitfall #1 da pesquisa: "prompt"/"agent" sao parseados e IGNORADOS
          const fn = isAidd ? error : warn;
          fn("codex", `hook type "${h.type}" nao executa no Codex 2026 (so "command") — entrada silenciosamente ignorada: ${String(h.command || "").slice(0, 80)}`);
          continue;
        }
        if (isAidd) {
          aiddFound = true;
          const m = String(h.command).match(/"([^"]+)"/);
          if (m) {
            const scriptPath = path.isAbsolute(m[1]) ? m[1] : path.join(targetRoot, m[1]);
            if (!fs.existsSync(scriptPath)) {
              error("codex", `adaptador registrado mas nao encontrado: ${m[1]}`);
              return;
            }
          }
        }
      }
    }
  }
  if (!aiddFound) {
    warn("codex", `${CODEX_HOOKS_REL} existe mas sem registro aidd — rode \`aidd update\``);
    return;
  }
  ok("codex", `${CODEX_HOOKS_REL} (type=command, adaptador resolve). Lembrete: hooks Codex exigem trust do usuario (camada best-effort/warn)`);
}

module.exports = { CODEX_HOOKS_REL, adapterRelPath, buildConsumerCodexHooks, installCodexLayer, checkCodexLayer };

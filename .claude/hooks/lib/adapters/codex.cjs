#!/usr/bin/env node
"use strict";
// Codex PreToolUse adapter — warn-tier, best-effort (the Codex hook-trust
// model means this may not run until the user trusts it; the git net is the
// guaranteed layer). Schema per the verified 2026 research:
// .claude/skills/provider-agnostic-guards/SKILL.md.
//
// Translation: `apply_patch` payload → one neutral event PER touched file
// (fan-out, spec R1 f6). Introduced content = the patch's "+" lines only —
// context lines are never scanned (no false positives from pre-existing code).
// ponytail: full hunk-application (patch applied to base) only if a real-world
// false negative shows up; secrets/imports patterns are line-local.
//
// Fail-safe: this ADAPTER fails OPEN — unparseable payload → loud stderr warn
// + exit 0 (protocol drift must never brick the user's tool). Any guard DENY
// → the strongest signal Codex permits (hookSpecificOutput deny JSON).

const fs = require("node:fs");
const path = require("node:path");
const { guards } = require("../guards/index.cjs");
const secretsCore = require("../guards/secrets.cjs");
const domainCore = require("../guards/domain.cjs");
const rlsCore = require("../guards/rls.cjs");

const MATCHED_TOOLS = new Set(["apply_patch"]);

function warnOpen(msg) {
  process.stderr.write(`[aidd-codex] AVISO: ${msg}\n`);
  process.exit(0);
}

function denyOut(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

/** Permissive domain-map loader (frontend-business semantics). */
function loadPermissiveMap(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".aidd", "domain-map.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Parse do envelope apply_patch:
 *   *** Begin Patch / *** Add File: p / *** Update File: p / *** Delete File: p / *** End Patch
 * Retorna [{op, rel, content}] onde content = linhas introduzidas ("+").
 */
function parsePatch(text) {
  const files = [];
  let current = null;
  for (const line of text.split("\n")) {
    const add = line.match(/^\*\*\* Add File: (.+)$/);
    const upd = line.match(/^\*\*\* Update File: (.+)$/);
    const del = line.match(/^\*\*\* Delete File: (.+)$/);
    if (add || upd || del) {
      if (current) files.push(current);
      current = {
        op: add ? "add" : upd ? "update" : "delete",
        rel: (add || upd || del)[1].trim().replace(/\\/g, "/"),
        lines: [],
      };
      continue;
    }
    if (line.startsWith("*** ")) {
      if (current) { files.push(current); current = null; }
      continue;
    }
    if (current && line.startsWith("+")) current.lines.push(line.slice(1));
  }
  if (current) files.push(current);
  return files.map((f) => ({ op: f.op, rel: f.rel, content: f.lines.join("\n") }));
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input || "{}");
  } catch {
    warnOpen("payload nao parseavel como JSON — guardas nao avaliados (fail-open).");
    return;
  }

  const toolName = payload.tool_name || "";
  if (!MATCHED_TOOLS.has(toolName)) {
    process.exit(0); // não é nosso matcher — silêncio
  }

  const projectRoot = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ti = payload.tool_input;
  const patchText =
    (ti && typeof ti.patch === "string" && ti.patch) ||
    (ti && typeof ti.input === "string" && ti.input) ||
    (ti && typeof ti.content === "string" && ti.content) ||
    (typeof ti === "string" ? ti : null);

  if (!patchText || !patchText.includes("*** Begin Patch")) {
    warnOpen("formato de apply_patch nao reconhecido (protocolo mudou?) — guardas nao avaliados (fail-open).");
    return;
  }

  const filesTouched = parsePatch(patchText).filter((f) => f.op !== "delete");
  if (filesTouched.length === 0) {
    process.exit(0);
  }

  // Config carregada uma vez (loaders edit-time; env de teste honrado como nas cascas Claude)
  const catalog = secretsCore.loadCatalog(projectRoot);
  const domainMap = domainCore.loadDomainMap(projectRoot);
  const permissiveMap = loadPermissiveMap(projectRoot);
  const rlsEnabled = rlsCore.loadRlsConfig(projectRoot).enabled;

  const denies = [];
  const warns = [];

  for (const f of filesTouched) {
    const abs = path.join(projectRoot, ...f.rel.split("/"));
    const base = {
      action: f.op === "add" ? "write" : "edit",
      path: f.rel,
      content: f.content,
      projectRoot,
      fileExists: fs.existsSync(abs),
    };

    const checks = [
      ["contract", {}],
      ["secrets", { secrets: { catalog } }],
    ];
    if (domainMap) checks.push(["domain", { domain: { map: domainMap } }]);
    if (permissiveMap) checks.push(["frontend-business", { frontendBusiness: { map: permissiveMap } }]);
    if (rlsEnabled) {
      const siblings = rlsCore.SQL_MIGRATION_RE.test(f.rel) ? rlsCore.readSiblings(abs) : [];
      checks.push(["rls", { rls: { enabled: true, siblings } }]);
    }
    // tdd/phase: maquinaria edit-time do Claude (heartbeat/CURRENT_TASK) —
    // fora do escopo Codex; declarado na matriz de suporte.

    for (const [name, config] of checks) {
      const v = guards[name].evaluate({ ...base, config });
      if (v.verdict === "deny") denies.push(`${name}: ${v.message}`);
      else if (v.verdict === "warn") warns.push(`${name}: ${v.message}`);
    }
  }

  for (const w of warns) process.stderr.write(`[aidd-codex] AVISO ${w}\n`);

  if (denies.length > 0) {
    denyOut(denies.slice(0, 2).join(" | ") + (denies.length > 2 ? ` (+${denies.length - 2})` : ""));
    return;
  }
  process.exit(0);
});

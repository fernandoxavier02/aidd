#!/usr/bin/env node
"use strict";
// AIDD harness CLI — install/update/verify the harness in a consumer project.
//
//   aidd init    [--dir <path>] [--mode hybrid|copy] [--force] [--dry-run]
//   aidd update  [--dir <path>] [--force] [--dry-run]
//   aidd doctor  [--dir <path>] [--json]
//   aidd version

const fm = require("../lib/cli/files-map.cjs");

function parseArgs(argv) {
  const args = { command: argv[0] || "help", dir: undefined, mode: undefined, force: false, dryRun: false, json: false, providers: undefined, noGitHooks: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") args.dir = argv[(i += 1)];
    else if (a.startsWith("--dir=")) args.dir = a.slice(6);
    else if (a === "--mode") args.mode = argv[(i += 1)];
    else if (a.startsWith("--mode=")) args.mode = a.slice(7);
    else if (a === "--providers") args.providers = String(argv[(i += 1)] || "").split(",").filter(Boolean);
    else if (a.startsWith("--providers=")) args.providers = a.slice(12).split(",").filter(Boolean);
    else if (a === "--no-git-hooks") args.noGitHooks = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.command = "help";
    else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

function printResults(title, res) {
  console.log(`\n${title} — ${res.targetRoot}${res.dryRun ? "  (dry-run: nothing written)" : ""}`);
  const counts = {};
  for (const { rel, action } of res.results) {
    counts[action] = (counts[action] || 0) + 1;
    console.log(`  ${action.padEnd(38)} ${rel}`);
  }
  console.log("\nSummary:");
  for (const [action, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)}  ${action}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "init": {
      const { init } = require("../lib/cli/init.cjs");
      const res = init(args);
      printResults(`aidd init (${res.mode})`, res);
      if (!res.engineReachable) {
        console.log(`\n⚠ engine not reachable yet: add the package to the project so the hooks can run:`);
        console.log(`    npm install --save-dev ${fm.PKG_NAME}`);
        console.log(`  (or re-run init with --mode copy for projects that do not keep node_modules)`);
      }
      console.log(`\nInstalled ${fm.PKG_NAME}@${res.version}. Next steps:`);
      console.log(`  1. Fill the placeholders in PROJECT_BRIEF.md`);
      console.log(`  2. Read AIDD.md and AIDD-RUNBOOK.md`);
      console.log(`  3. Run \`aidd doctor\` (or \`npx aidd doctor\`) to verify the wiring`);
      console.log(`  4. Restart your Claude Code session so the hooks load`);
      break;
    }
    case "update": {
      const { update } = require("../lib/cli/update.cjs");
      const res = update(args);
      printResults(`aidd update ${res.fromVersion} → ${res.toVersion}`, res);
      break;
    }
    case "doctor": {
      const { doctor } = require("../lib/cli/doctor.cjs");
      const res = doctor(args);
      if (args.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`\naidd doctor — ${res.targetRoot}`);
        const icon = { ok: "✔", warn: "⚠", error: "✘" };
        for (const f of res.findings) console.log(`  ${icon[f.level]} [${f.check}] ${f.detail}`);
      }
      const errors = res.findings.filter((f) => f.level === "error").length;
      const warns = res.findings.filter((f) => f.level === "warn").length;
      console.log(`\n${errors} error(s), ${warns} warning(s).`);
      if (errors > 0) process.exit(1);
      break;
    }
    case "version": {
      console.log(`${fm.PKG_NAME}@${fm.packageVersion()}`);
      break;
    }
    case "help":
    default: {
      console.log(`${fm.PKG_NAME}@${fm.packageVersion()} — AIDD harness installer

Usage:
  aidd init    [--dir <path>] [--mode hybrid|copy] [--providers claude,codex,git]
               [--no-git-hooks] [--force] [--dry-run]
  aidd update  [--dir <path>] [--force] [--dry-run]
  aidd doctor  [--dir <path>] [--json]
  aidd version

Layers:
  init detecta as ferramentas presentes (.claude/, .codex/ ou AGENTS.md, .git/)
  e instala as camadas de enforcement correspondentes (claude edit-time, codex
  warn-tier, git pre-commit net). --providers força a lista; --no-git-hooks
  veta a rede git. O manifesto .aidd/harness.json registra as camadas; update
  as atualiza; doctor checa camada por camada.

Modes:
  hybrid (default)  engine hooks run from node_modules/${fm.PKG_NAME} and
                    upgrade via npm; editable docs/configs/skills are copied
                    once and tracked in .aidd/harness.json.
  copy              everything is copied into the project (for stacks that do
                    not keep node_modules around). \`aidd update\` refreshes
                    unmodified files; user-edited files are never touched.`);
      if (args.command !== "help") process.exit(1);
      break;
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`aidd: ${err.message}`);
  process.exit(1);
}

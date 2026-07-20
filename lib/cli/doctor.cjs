"use strict";
// `aidd doctor` — verify that an installed harness is correctly wired.
// Read-only. Returns findings; exit code is decided by the bin.

const fs = require("node:fs");
const path = require("node:path");
const fm = require("./files-map.cjs");
const { loadManifest, classify } = require("./manifest.cjs");
const { BEGIN } = require("./bootloader.cjs");
const { checkGitHooksLayer } = require("./git-hooks.cjs");
const { checkCodexLayer } = require("./codex-settings.cjs");

function toAbs(root, rel) {
  return path.join(root, ...rel.split("/"));
}

function doctor(opts = {}) {
  const targetRoot = path.resolve(opts.dir || process.cwd());
  const findings = []; // { level: "ok"|"warn"|"error", check, detail }
  const ok = (check, detail) => findings.push({ level: "ok", check, detail });
  const warn = (check, detail) => findings.push({ level: "warn", check, detail });
  const error = (check, detail) => findings.push({ level: "error", check, detail });

  // Node version
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) ok("node", `v${process.versions.node}`);
  else error("node", `v${process.versions.node} — harness requires Node >= 18`);

  // Manifest
  const manifest = loadManifest(targetRoot);
  if (!manifest) {
    error("manifest", ".aidd/harness.json missing — run `aidd init`");
    return { targetRoot, findings };
  }
  ok("manifest", `${manifest.package}@${manifest.version} (mode: ${manifest.mode})`);
  const layers = manifest.layers || { claude: true, codex: false, git: false };
  ok("layers", Object.entries(layers).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)");
  if (manifest.version !== fm.packageVersion()) {
    warn("version", `installed ${manifest.version}, package is ${fm.packageVersion()} — run \`aidd update\``);
  } else {
    ok("version", manifest.version);
  }

  // Engine reachability (hybrid: node_modules; copy: local hooks dir)
  const mode = manifest.mode || "hybrid";
  const probeRel = mode === "hybrid"
    ? `node_modules/${fm.PKG_NAME}/.claude/hooks/aidd-sensor.cjs`
    : ".claude/hooks/aidd-sensor.cjs";
  if (fs.existsSync(toAbs(targetRoot, probeRel))) ok("engine", probeRel);
  else error("engine", `${probeRel} not found${mode === "hybrid" ? ` — add the package: npm i -D ${fm.PKG_NAME}` : " — re-run `aidd update`"}`);

  // settings.json: parses, every aidd hook command's script exists
  const settingsAbs = toAbs(targetRoot, fm.SETTINGS_REL);
  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsAbs, "utf8"));
    ok("settings", fm.SETTINGS_REL);
  } catch (e) {
    error("settings", `${fm.SETTINGS_REL} missing or invalid JSON (${e.message})`);
  }
  if (settings) {
    const cmds = [];
    for (const groups of Object.values(settings.hooks || {})) {
      for (const g of groups || []) for (const h of g.hooks || []) {
        if (h.command && h.command.includes("aidd-")) cmds.push(h.command);
      }
    }
    if (cmds.length === 0) {
      error("hooks", "no aidd-* hook registered in settings.json — run `aidd init`/`aidd update`");
    } else {
      let missing = 0;
      for (const cmd of cmds) {
        const m = cmd.match(/"([^"]+)"/);
        if (!m) continue;
        const scriptPath = m[1].replace("${CLAUDE_PROJECT_DIR}", targetRoot);
        if (!fs.existsSync(scriptPath)) {
          missing += 1;
          error("hook-script", `registered but not found: ${m[1]}`);
        }
      }
      if (missing === 0) ok("hooks", `${cmds.length} aidd hook registrations, all scripts resolve`);
    }
  }

  // Configs parse
  for (const rel of [
    ".claude/aidd-stop-rules.json",
    ".claude/aidd-phase-guard-config.json",
    ".claude/aidd-rls-config.json",
    ".claude/aidd-tdd-config.json",
    fm.SECRETS_CATALOG.dest,
  ]) {
    const abs = toAbs(targetRoot, rel);
    if (!fs.existsSync(abs)) { warn("config", `${rel} missing`); continue; }
    try { JSON.parse(fs.readFileSync(abs, "utf8")); ok("config", rel); }
    catch (e) { error("config", `${rel} is not valid JSON (${e.message})`); }
  }

  // Working memory + bootloaders
  if (fs.existsSync(toAbs(targetRoot, ".aidd/current"))) ok("working-memory", ".aidd/current/");
  else warn("working-memory", ".aidd/current/ missing — create it or re-run `aidd init`");

  for (const name of fm.BOOTLOADERS) {
    const abs = toAbs(targetRoot, name);
    if (!fs.existsSync(abs)) { warn("bootloader", `${name} missing`); continue; }
    const text = fs.readFileSync(abs, "utf8");
    if (text.includes(BEGIN) || text.includes("AIDD")) ok("bootloader", name);
    else warn("bootloader", `${name} exists but has no AIDD block — run \`aidd update\``);
  }

  // Per-layer health checks (camadas registradas no manifesto)
  if (layers.git) checkGitHooksLayer(targetRoot, manifest, ok, warn, error);
  if (layers.codex) checkCodexLayer(targetRoot, manifest, ok, warn, error);

  // Drift report: user-modified managed files (informational)
  const modified = Object.keys(manifest.files).filter(
    (rel) => classify(targetRoot, rel, manifest) === "modified"
  );
  if (modified.length) warn("drift", `${modified.length} managed file(s) locally modified (preserved on update): ${modified.join(", ")}`);
  else ok("drift", "no local modifications to managed files");

  return { targetRoot, findings };
}

module.exports = { doctor };

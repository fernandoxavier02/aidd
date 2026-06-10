"use strict";
// `aidd init` — install the harness into a target project.
//
// Hybrid mode (default): engine hooks are referenced from node_modules via the
// generated settings.json; only editable content is copied. Copy mode: the
// engine is also copied into .claude/hooks/ (for projects that do not keep
// node_modules around, e.g. non-npm stacks).

const fs = require("node:fs");
const path = require("node:path");
const fm = require("./files-map.cjs");
const { sha256, fileHash, loadManifest, newManifest, saveManifest } = require("./manifest.cjs");
const { buildConsumerSettings, mergeSettings } = require("./settings.cjs");
const { applyBlock } = require("./bootloader.cjs");

function toAbs(root, rel) {
  return path.join(root, ...rel.split("/"));
}

function copyTracked(targetRoot, rel, manifest, results, { force, dryRun, srcRel }) {
  const src = toAbs(fm.packageRoot(), srcRel || rel);
  const dest = toAbs(targetRoot, rel);
  const content = fs.readFileSync(src);
  const existing = fileHash(dest);

  if (existing !== null && !force) {
    if (existing === sha256(content)) {
      manifest.files[rel] = existing; // identical → safe to adopt
      results.push({ rel, action: "adopted (identical)" });
    } else {
      results.push({ rel, action: "skipped (pre-existing, left unmanaged)" });
    }
    return;
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  manifest.files[rel] = sha256(content);
  results.push({ rel, action: existing === null ? "installed" : "overwritten (--force)" });
}

function init(opts = {}) {
  const targetRoot = path.resolve(opts.dir || process.cwd());
  const mode = opts.mode || "hybrid";
  const force = !!opts.force;
  const dryRun = !!opts.dryRun;
  const results = [];

  if (!["hybrid", "copy"].includes(mode)) throw new Error(`unknown mode: ${mode}`);
  if (path.resolve(fm.packageRoot()) === targetRoot) {
    throw new Error("refusing to init into the harness package itself");
  }
  if (!fs.existsSync(targetRoot)) throw new Error(`target directory does not exist: ${targetRoot}`);

  const existingManifest = loadManifest(targetRoot);
  if (existingManifest && !force) {
    throw new Error(
      `already installed (${existingManifest.package}@${existingManifest.version}); run \`aidd update\` instead, or init --force`
    );
  }

  const manifest = newManifest(fm.packageVersion(), mode);

  // 1. Scaffold: docs, configs, skills.
  for (const rel of fm.scaffoldList()) {
    copyTracked(targetRoot, rel, manifest, results, { force, dryRun });
  }

  // 2. Secrets catalog → project-level override location.
  copyTracked(targetRoot, fm.SECRETS_CATALOG.dest, manifest, results, {
    force,
    dryRun,
    srcRel: fm.SECRETS_CATALOG.src,
  });

  // 3. Engine: copied only in copy mode; referenced from node_modules in hybrid.
  if (mode === "copy") {
    for (const rel of fm.engineList()) {
      copyTracked(targetRoot, rel, manifest, results, { force, dryRun });
    }
  }

  // 4. settings.json — generate for the mode, merge into whatever exists.
  const settingsAbs = toAbs(targetRoot, fm.SETTINGS_REL);
  let existingSettings = null;
  if (fs.existsSync(settingsAbs)) {
    try {
      existingSettings = JSON.parse(fs.readFileSync(settingsAbs, "utf8"));
    } catch (e) {
      throw new Error(`${fm.SETTINGS_REL} exists but is not valid JSON — fix it first (${e.message})`);
    }
  }
  const { merged, added } = mergeSettings(existingSettings, buildConsumerSettings(mode));
  if (!dryRun) {
    fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
    fs.writeFileSync(settingsAbs, JSON.stringify(merged, null, 2) + "\n");
  }
  results.push({ rel: fm.SETTINGS_REL, action: `merged (+${added.length} hook registrations)` });

  // 5. Bootloaders — marked block inside CLAUDE.md / AGENTS.md.
  for (const name of fm.BOOTLOADERS) {
    const abs = toAbs(targetRoot, name);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    const { text, action } = applyBlock(current, name);
    if (!dryRun && action !== "unchanged") fs.writeFileSync(abs, text);
    results.push({ rel: name, action });
  }

  // 6. Working-memory dir.
  if (!dryRun) {
    fs.mkdirSync(toAbs(targetRoot, ".aidd/current"), { recursive: true });
    fs.mkdirSync(toAbs(targetRoot, ".aidd/archive"), { recursive: true });
  }

  // 7. Hybrid sanity: is the engine reachable from the target?
  const engineProbe = toAbs(targetRoot, `node_modules/${fm.PKG_NAME}/.claude/hooks/aidd-sensor.cjs`);
  const engineReachable = mode === "copy" || fs.existsSync(engineProbe);

  if (!dryRun) saveManifest(targetRoot, manifest);

  return { targetRoot, mode, dryRun, results, engineReachable, version: fm.packageVersion() };
}

module.exports = { init };

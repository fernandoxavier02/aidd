"use strict";
// `aidd update` — bring an installed harness up to the package's version.
//
// Per-file decision table (manifest hash = what we installed; disk = now):
//   clean + package changed   → overwrite, retrack    ("updated")
//   clean + package same      → nothing               ("up-to-date")
//   modified by user          → never touch           ("kept (user-modified)") [--force overrides]
//   tracked but deleted       → restore               ("restored")
//   new file in this version  → install               ("added")
//   untracked & on disk       → never touch           ("skipped (unmanaged)")
// Files we once shipped but no longer do are reported, not deleted.

const fs = require("node:fs");
const path = require("node:path");
const fm = require("./files-map.cjs");
const { sha256, loadManifest, saveManifest, classify } = require("./manifest.cjs");
const { buildConsumerSettings, mergeSettings } = require("./settings.cjs");
const { applyBlock } = require("./bootloader.cjs");

function toAbs(root, rel) {
  return path.join(root, ...rel.split("/"));
}

function syncFile(targetRoot, rel, manifest, results, { force, dryRun, srcRel }) {
  const src = toAbs(fm.packageRoot(), srcRel || rel);
  const dest = toAbs(targetRoot, rel);
  const content = fs.readFileSync(src);
  const newHash = sha256(content);
  const state = classify(targetRoot, rel, manifest);

  const write = () => {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
    manifest.files[rel] = newHash;
  };

  switch (state) {
    case "clean":
      if (manifest.files[rel] === newHash) results.push({ rel, action: "up-to-date" });
      else { write(); results.push({ rel, action: "updated" }); }
      break;
    case "modified":
      if (force) { write(); results.push({ rel, action: "overwritten (--force)" }); }
      else results.push({ rel, action: "kept (user-modified)" });
      break;
    case "absent":
      write();
      results.push({ rel, action: manifest.files[rel] ? "restored" : "added" });
      break;
    case "untracked":
      results.push({ rel, action: "skipped (unmanaged)" });
      break;
  }
}

function update(opts = {}) {
  const targetRoot = path.resolve(opts.dir || process.cwd());
  const force = !!opts.force;
  const dryRun = !!opts.dryRun;
  const results = [];

  const manifest = loadManifest(targetRoot);
  if (!manifest) throw new Error("no .aidd/harness.json found — run `aidd init` first");
  const fromVersion = manifest.version;
  const mode = manifest.mode || "hybrid";

  const shipped = new Set();
  for (const rel of fm.scaffoldList()) {
    shipped.add(rel);
    syncFile(targetRoot, rel, manifest, results, { force, dryRun });
  }
  shipped.add(fm.SECRETS_CATALOG.dest);
  syncFile(targetRoot, fm.SECRETS_CATALOG.dest, manifest, results, {
    force, dryRun, srcRel: fm.SECRETS_CATALOG.src,
  });
  if (mode === "copy") {
    for (const rel of fm.engineList()) {
      shipped.add(rel);
      syncFile(targetRoot, rel, manifest, results, { force, dryRun });
    }
  }

  // Tracked files this version no longer ships.
  for (const rel of Object.keys(manifest.files)) {
    if (!shipped.has(rel)) results.push({ rel, action: "orphaned (no longer shipped — review manually)" });
  }

  // settings.json — re-merge (idempotent; picks up new hook registrations).
  const settingsAbs = toAbs(targetRoot, fm.SETTINGS_REL);
  let existingSettings = null;
  if (fs.existsSync(settingsAbs)) {
    existingSettings = JSON.parse(fs.readFileSync(settingsAbs, "utf8"));
  }
  const { merged, added } = mergeSettings(existingSettings, buildConsumerSettings(mode));
  if (!dryRun) {
    fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
    fs.writeFileSync(settingsAbs, JSON.stringify(merged, null, 2) + "\n");
  }
  results.push({ rel: fm.SETTINGS_REL, action: added.length ? `merged (+${added.length} hook registrations)` : "up-to-date" });

  // Bootloader blocks.
  for (const name of fm.BOOTLOADERS) {
    const abs = toAbs(targetRoot, name);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    const { text, action } = applyBlock(current, name);
    if (!dryRun && action !== "unchanged") fs.writeFileSync(abs, text);
    results.push({ rel: name, action });
  }

  manifest.version = fm.packageVersion();
  manifest.updatedAt = new Date().toISOString();
  if (!dryRun) saveManifest(targetRoot, manifest);

  return { targetRoot, mode, dryRun, results, fromVersion, toVersion: manifest.version };
}

module.exports = { update };

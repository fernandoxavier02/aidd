"use strict";
// The install manifest (.aidd/harness.json) records, per installed file, the
// sha256 of the content WE wrote. On update, comparing the disk file against
// the manifest answers "did the user edit this?" — edited files are never
// overwritten. Files that pre-existed init are never tracked: the tool does
// not adopt what it did not create.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { MANIFEST_REL, PKG_NAME } = require("./files-map.cjs");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Hash a file on disk; null when missing/unreadable. */
function fileHash(absPath) {
  try {
    return sha256(fs.readFileSync(absPath));
  } catch {
    return null;
  }
}

function manifestPath(targetRoot) {
  return path.join(targetRoot, ...MANIFEST_REL.split("/"));
}

function loadManifest(targetRoot) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(targetRoot), "utf8"));
  } catch {
    return null;
  }
}

function newManifest(version, mode) {
  return {
    package: PKG_NAME,
    version,
    mode, // "hybrid" | "copy"
    installedAt: new Date().toISOString(),
    files: {}, // relPath (POSIX) -> sha256 of installed content
  };
}

function saveManifest(targetRoot, manifest) {
  const p = manifestPath(targetRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Classify one file for install/update purposes.
 * Returns one of:
 *   "absent"     — not on disk
 *   "untracked"  — on disk but not in the manifest (pre-existing / unmanaged)
 *   "clean"      — on disk, matches the hash we installed
 *   "modified"   — on disk, diverged from the hash we installed (user edit)
 */
function classify(targetRoot, relPath, manifest) {
  const abs = path.join(targetRoot, ...relPath.split("/"));
  const onDisk = fileHash(abs);
  if (onDisk === null) return "absent";
  const tracked = manifest && manifest.files ? manifest.files[relPath] : undefined;
  if (tracked === undefined) return "untracked";
  return onDisk === tracked ? "clean" : "modified";
}

module.exports = { sha256, fileHash, manifestPath, loadManifest, newManifest, saveManifest, classify };

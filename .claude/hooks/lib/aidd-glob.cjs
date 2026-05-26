"use strict";

/**
 * aidd-glob.cjs — zero-dependency glob matcher (minimatch-compatible subset).
 *
 * Vendored so the harness has no external runtime dependencies. Supports the
 * glob features the AIDD hooks actually use:
 *   - `*`   matches any run of characters except `/`
 *   - `**`  (globstar) matches across path separators (zero or more segments)
 *   - `?`   matches a single character except `/`
 *   - literal segments (regex specials are escaped)
 *
 * Always matches dotfiles (equivalent to minimatch `{ dot: true }`), which is
 * how every AIDD hook calls it. `matchBase` is not implemented (hooks pass
 * `matchBase: false`). Paths and patterns are normalized to forward slashes.
 *
 * Exports `{ minimatch }` with the same call signature the hooks expect:
 *   minimatch(path, pattern, opts?) -> boolean
 */

const REGEX_SPECIALS = new Set("\\^$+.()|{}[]".split(""));

function segmentToRegex(seg) {
  const collapsed = seg.replace(/\*+/g, "*");
  let out = "";
  for (const c of collapsed) {
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (REGEX_SPECIALS.has(c)) out += "\\" + c;
    else out += c;
  }
  return out;
}

function globToRegExp(glob) {
  const segments = String(glob).replace(/\\/g, "/").split("/");
  let re = "^";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (seg === "**") {
      // Globstar: matches zero or more path segments.
      re += isLast ? "(?:.*)?" : "(?:[^/]+/)*";
      continue; // slash already accounted for
    }

    re += segmentToRegex(seg);
    if (!isLast) re += "/";
  }
  re += "$";
  return new RegExp(re);
}

const _cache = new Map();

function minimatch(targetPath, pattern /*, opts */) {
  if (typeof targetPath !== "string" || typeof pattern !== "string") return false;
  const normalized = targetPath.replace(/\\/g, "/");
  let re = _cache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    _cache.set(pattern, re);
  }
  return re.test(normalized);
}

module.exports = { minimatch, globToRegExp };

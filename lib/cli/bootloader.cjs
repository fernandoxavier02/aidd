"use strict";
// CLAUDE.md / AGENTS.md management. The consumer's bootloader file is never
// owned by the harness: we manage a clearly marked block inside it. If the
// file does not exist it is created containing only the block. On update the
// block content is replaced in place; everything outside it is untouched.

const fs = require("node:fs");
const path = require("node:path");
const { packageRoot } = require("./files-map.cjs");

const BEGIN = "<!-- AIDD-BOOTLOADER:BEGIN — managed by @fx-studio-ai/aidd; do not edit inside this block -->";
const END = "<!-- AIDD-BOOTLOADER:END -->";

function blockFor(bootloaderName) {
  const content = fs.readFileSync(path.join(packageRoot(), bootloaderName), "utf8").trim();
  return `${BEGIN}\n${content}\n${END}\n`;
}

/**
 * Returns the new full text for the consumer's bootloader file.
 * { text, action } where action is "created" | "block-added" | "block-replaced" | "unchanged".
 */
function applyBlock(existingText, bootloaderName) {
  const block = blockFor(bootloaderName);
  if (existingText == null) return { text: block, action: "created" };

  const begin = existingText.indexOf(BEGIN);
  const end = existingText.indexOf(END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = existingText.slice(0, begin);
    const after = existingText.slice(end + END.length).replace(/^\r?\n/, "");
    const text = `${before}${block}${after}`;
    return { text, action: text === existingText ? "unchanged" : "block-replaced" };
  }
  const sep = existingText.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${existingText}${sep}${block}`, action: "block-added" };
}

module.exports = { applyBlock, BEGIN, END };

#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { getProjectRoot } = require("./lib/aidd-paths.cjs");

const STOP_RULES_FILE = path.join(getProjectRoot(), ".claude", "aidd-stop-rules.json");
const MAX_OUTPUT = 6000;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function format(data) {
  if (!data || !Array.isArray(data.rules)) {
    return "<!-- aidd-stop-rules-preserver: stop-rules.json ausente ou malformado — leia AIDD.md §⚠️ Stop Rules -->";
  }
  const lines = [
    "<!-- AIDD-STOP-RULES-PRESERVED — re-injected on context compaction -->",
    "",
    "## ⚠️ Stop Rules (preserved verbatim across compaction)",
    "",
    "Estas regras MUST sobreviver compaction. Se alguma estiver ausente abaixo, releia AIDD.md §⚠️ Stop Rules antes de continuar.",
    "",
  ];
  for (const r of data.rules) {
    lines.push(`### ${r.id} — ${r.title}`);
    lines.push(r.summary);
    if (Array.isArray(r.forbid) && r.forbid.length) {
      lines.push(`**Forbidden:** ${r.forbid.join("; ")}.`);
    }
    if (Array.isArray(r.enforced_by) && r.enforced_by.length) {
      lines.push(`**Enforced by:** ${r.enforced_by.join("; ")}.`);
    }
    lines.push("");
  }
  lines.push("Source of truth: `AIDD.md` §⚠️ Stop Rules. Machine-readable: `.claude/aidd-stop-rules.json`.");
  lines.push("<!-- /AIDD-STOP-RULES-PRESERVED -->");
  let text = lines.join("\n");
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + "\n... [truncado]";
  return text;
}

const data = readJson(STOP_RULES_FILE);
const additionalContext = format(data);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext,
  },
}));

#!/usr/bin/env node
const fs = require("node:fs");
const { verificationFile } = require("./lib/aidd-paths.cjs");

const WATCHED_TOOLS = new Set(["Edit", "Write", "Bash"]);
const SECTION_HEADER = "## Issues encountered (auto-logged by aidd-sensor)";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function classify(err) {
  const s = String(err).toLowerCase();
  if (s.includes("syntax") || s.includes("parse")) return "syntax-error";
  if (s.includes("type") && !s.includes("typeerror is not")) return "type-error";
  if (s.includes("test") || s.includes("assert") || s.includes("expect")) return "test-fail";
  if (s.includes("lint") || s.includes("eslint") || s.includes("ruff")) return "lint-fail";
  if (s.includes("permission") || s.includes("denied")) return "permission";
  return "other";
}

function appendIssue({ tag, tool, target, error }) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const block = [
    "",
    `### ${ts} - ${tag}`,
    `**Tool:** ${tool}`,
    `**Target:** ${target || "(n/a)"}`,
    `**Error:** ${String(error).slice(0, 600)}`,
    `**Action required:** review manually e decida se vira finding/ADR ou se corrige inline.`,
    "",
  ].join("\n");

  let existing = "";
  try { existing = fs.readFileSync(verificationFile(), "utf8"); } catch { existing = ""; }

  if (!existing.includes(SECTION_HEADER)) {
    existing = existing.replace(/\s*$/, "") + `\n\n${SECTION_HEADER}\n`;
  }
  fs.writeFileSync(verificationFile(), existing + block);
}

(async () => {
  const raw = await readStdin();
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }

  const tool = payload.tool_name;
  if (!WATCHED_TOOLS.has(tool)) process.exit(0);

  const resp = payload.tool_response || {};
  const error = resp.error || resp.stderr;
  if (!error) process.exit(0);

  const target = payload.tool_input?.file_path
    || payload.tool_input?.command?.slice(0, 100)
    || null;

  appendIssue({ tag: classify(error), tool, target, error });
  process.exit(0);
})();

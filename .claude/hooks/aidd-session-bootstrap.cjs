#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  currentTaskFile,
  verificationFile,
  decisionLogFile,
  specsDir,
} = require("./lib/aidd-paths.cjs");

const MAX_OUTPUT = 7800;

function readSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

function extractSection(content, heading) {
  if (!content) return null;
  // Match from the heading to the next "##" heading OR end of string.
  // End-of-string is expressed as (?![\s\S]) — JavaScript has no \Z anchor.
  const re = new RegExp(`^##+\\s+${heading}.*?$([\\s\\S]*?)(?=^##+\\s|(?![\\s\\S]))`, "mi");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function tailLines(content, n) {
  if (!content) return "";
  const lines = content.trim().split("\n");
  return lines.slice(-n).join("\n");
}

function summarizeCurrentTask() {
  const content = readSafe(currentTaskFile());
  if (!content) return "Nenhum CURRENT_TASK.md ativo.";
  const goal = extractSection(content, "Goal") || "(sem goal definido)";
  const status = extractSection(content, "Status") || "(sem status)";
  const scope = extractSection(content, "Scope") || "(sem scope)";
  const acs = extractSection(content, "Acceptance criteria") || "";
  return [
    "### Goal", goal.split("\n").slice(0, 4).join("\n"),
    "### Status", status.split("\n").slice(0, 2).join("\n"),
    "### Scope", scope.split("\n").slice(0, 8).join("\n"),
    acs ? "### ACs (estado)" : "", acs ? acs.split("\n").slice(0, 8).join("\n") : "",
  ].filter(Boolean).join("\n\n");
}

function summarizeVerification() {
  const content = readSafe(verificationFile());
  if (!content) return null;
  const head = content.split("\n").slice(0, 25).join("\n");
  return head.length > 1500 ? head.slice(0, 1500) + "\n... [truncado]" : head;
}

function findActiveSpec() {
  const taskContent = readSafe(currentTaskFile()) || "";
  let entries;
  try { entries = fs.readdirSync(specsDir()); } catch { return null; }
  for (const dir of entries) {
    if (taskContent.includes(`specs/${dir}`) || taskContent.includes(`/specs/${dir}/`)) {
      const tasksPath = path.join(specsDir(), dir, "tasks.md");
      const tasks = readSafe(tasksPath);
      return { name: dir, tasks: tasks ? tasks.slice(0, 1500) : "(tasks.md ausente)" };
    }
  }
  return null;
}

function recentDecisions() {
  const content = readSafe(decisionLogFile());
  if (!content) return null;
  return tailLines(content, 30);
}

function build() {
  const parts = ["<!-- AIDD-CONTEXT-START -->", "# AIDD harness context (auto-injetado pelo hook)"];

  parts.push("## Task ativa em .aidd/current/CURRENT_TASK.md");
  parts.push(summarizeCurrentTask());

  const ver = summarizeVerification();
  if (ver) {
    parts.push("## VERIFICATION_REPORT.md (head)");
    parts.push(ver);
  }

  const spec = findActiveSpec();
  if (spec) {
    parts.push(`## Spec ativa: ${spec.name}/tasks.md (excerpt)`);
    parts.push(spec.tasks);
  }

  const log = recentDecisions();
  if (log) {
    parts.push("## DECISION_LOG.md (tail 30 linhas)");
    parts.push(log);
  }

  parts.push("## Lembrete AIDD");
  parts.push("- Stop Rules ativas: TDD, BDD, DDD, Two-attempt, Non-inventive, Spec-is-contract");
  parts.push("- 5 human gates: requirements, design, tasks, REVIEW, merge");
  parts.push("- Antes de editar, atualize CURRENT_TASK.md");

  parts.push("<!-- AIDD-CONTEXT-END -->");

  let text = parts.join("\n\n");
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + "\n... [truncado para caber em 8KB]";
  return text;
}

const additionalContext = build();
const output = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext,
  },
};
process.stdout.write(JSON.stringify(output));

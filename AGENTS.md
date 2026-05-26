---
title: AGENTS.md
description: AIDD bootloader for Codex. Mandates MUST READ on session start, reading order, .aidd/current/ logging, and prohibitions. Symmetric to CLAUDE.md.
type: bootloader
audience: codex
scope: project-wide
globs: ["**/*"]
alwaysApply: true
tags: [aidd, bootloader, codex, agents, methodology, entry-point]
related: [CLAUDE.md, CONTEXT_INDEX.md, AIDD.md, PROJECT_BRIEF.md]
---

# AGENTS.md — Bootloader AIDD (Codex)

This project follows **AIDD — AI-Driven Development**. This file is a *bootloader* and an *adapter*: it tells Codex how to consume the project's single context system. The methodology itself lives in `AIDD.md`.

## MUST READ on session start

Before any other action, open and read these three files:

1. **[AIDD.md](AIDD.md)** — methodology, mandatory practices, `## ⚠️ Stop Rules`.
2. **[PROJECT_BRIEF.md](PROJECT_BRIEF.md)** — project snapshot (goal, stack, modules, commands).
3. **[CONTEXT_INDEX.md](CONTEXT_INDEX.md)** — decides which other documents to load for the task at hand.

Do not skip these. The rest of this bootloader assumes they are loaded.

## Reading order

For every task, in order:

1. The 3 MUST READ files above.
2. The rows from `CONTEXT_INDEX.md`'s trigger table that match the current task (Lane A or B).
3. If your project tracks product/spec/roadmap state in an external system (issue tracker, project board), consult it first during context discovery when that source is available in the session.
4. **On demand only** — never bulk-load all `.md` files. Stop when you have enough context to act.

If a document referenced by the index is missing, **do not invent it** — record the gap in `.aidd/current/CURRENT_TASK.md` under "Open questions".

## Logging

For every task, keep `.aidd/current/` current. Update **as you work**, not at the end:

- `CURRENT_TASK.md` — original request, problem, goal, scope, out-of-scope, open questions, requirements, acceptance criteria, status. Write this **before** editing any file.
- `FILES_READ.md` — append every file consulted with reason and conclusion.
- `FILES_CHANGED.md` — append every file modified with type of change and motive.
- `VERIFICATION_REPORT.md` — commands executed, tests run, results, acceptance criteria checked, problems, residual risks. The task is **not done** until this file shows green.

## How Codex follows AIDD

Codex-specific bindings for the abstract operations defined in `AIDD.md`:

- **Discrete decisions (2–4 options):** present a multi-choice prompt in the terminal. Never ask for free-form prose when alternatives are enumerable.
- **Runbook:** when you need the concrete execution flow or command surface for AIDD, open `AIDD-RUNBOOK.md`. When the current phase or next step is unclear, start with `/aidd` before choosing the next lifecycle command (if skills are available in your Codex setup).
- **Hooks (asymmetry with Claude Code):** Claude Code has `.claude/hooks/` active (context injection, error logging, core immutability, TDD/phase guards). Codex **has no equivalent runtime today** — the Codex agent must follow the rules manually: read MUST READ at session start, update `VERIFICATION_REPORT.md` when errors occur, and respect the immutability of the core (AIDD.md, bootloaders, steering docs, accepted ADRs).
- **Reading:** lazy. Open files individually as the trigger table dictates. Never bulk auto-load.
- **Tool inventory:** standard Codex tools (file open, edit, terminal, search). No assumed integrations beyond that.
- **Verification:** use the real repo commands documented in `PROJECT_BRIEF.md` (test, lint, build). For Markdown-only work, prefer a Markdown linter if your project has one. Treat end-to-end/integration suites as real gates: if a runtime dependency is not configured, record the expected red instead of masking it.
- **Two-attempt rule:** two consecutive failures on the same root cause ⇒ stop, write the diagnosis in `VERIFICATION_REPORT.md` (root-cause hypotheses, what was tried, what is unknown), then retry.

## Prohibitions

- Do not bulk-read all `.md` files.
- Do not invent missing requirements, files, or facts.
- Do not edit project files before recording the task plan in `.aidd/current/CURRENT_TASK.md`.
- Do not declare work done without an updated `VERIFICATION_REPORT.md`.
- Do not bypass tests or use `--no-verify`.
- Do not store personal/sensitive data without anonymization where your project's privacy policy requires it.

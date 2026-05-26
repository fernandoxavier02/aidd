# CLAUDE.md — Bootloader AIDD (Claude Code)

This project follows **AIDD — AI-Driven Development**. This file is a *bootloader* and an *adapter*: it tells Claude Code how to consume the project's single context system. The methodology itself lives in `AIDD.md`.

> Keep your personal/global Claude Code instructions in `~/.claude/CLAUDE.md`. This file is the project-level bootloader and ships with the harness.

## MUST READ on session start

Claude Code injects this file automatically as project memory. **The rest of the project context is NOT auto-loaded.** Before any other action, open and read these three files:

1. **[AIDD.md](AIDD.md)** — methodology, mandatory practices, `## ⚠️ Stop Rules`.
2. **[PROJECT_BRIEF.md](PROJECT_BRIEF.md)** — project snapshot (goal, stack, modules, commands).
3. **[CONTEXT_INDEX.md](CONTEXT_INDEX.md)** — decides which other documents to load for the task at hand.

Without these three files in context, the agent will operate on bootloader-only memory and miss critical methodology and constraints.

## Reading order

For every task, in order:

1. The 3 MUST READ files above.
2. The rows from `CONTEXT_INDEX.md`'s trigger table that match the current task (Lane A or B).
3. **On demand only** — use Read/Grep/Glob targeted at specific files. Never bulk-read all Markdown.

If a document referenced by the index is missing, **do not invent it** — record the gap in `.aidd/current/CURRENT_TASK.md` under "Open questions".

## Logging

For every task, keep `.aidd/current/` current. Update **as you work**, not at the end:

- `CURRENT_TASK.md` — original request, problem, goal, scope, out-of-scope, open questions, requirements, acceptance criteria, status. Write this **before** editing any file.
  - Frontmatter YAML with: `phase`, `status`, `task_type`, `complexity`, `iteration`, `slug` (plus any tracker id you use).
  - Deterministic parsing helper: `.claude/skills/aidd/scripts/parse-current-task.js`.
- `FILES_READ.md` — append every file consulted with reason and conclusion.
- `FILES_CHANGED.md` — append every file modified with type of change and motive.
- `VERIFICATION_REPORT.md` — commands executed, tests run, results, acceptance criteria checked, problems, residual risks. The task is **not done** until this file shows green.

## How Claude Code follows AIDD

Claude Code–specific bindings for the abstract operations defined in `AIDD.md`:

- **Discrete decisions (2–4 options):** use the `AskUserQuestion` tool. Never request free-form prose when alternatives are enumerable. The first option of technical questions must be the agent's recommendation, labeled `(Recommended)`.
- **Subagents:** invoke via the `Agent` tool when the task benefits from parallelism, isolated context, or specialized expertise. Subagents act on the same project artifacts — they do not carry their own copy of the context.
- **Hooks (`.claude/settings.json`):** Node `.cjs` hooks automate parts of the AIDD flow. See `AIDD.md` "Mechanized enforcement" for the full list and `INSTALL.md` for registration:
  - `SessionStart` → `aidd-session-bootstrap.cjs` injects a summary of `.aidd/current/*` + tail of the decision log at the start of every session.
  - `PostToolUse` → `aidd-sensor.cjs` appends to `VERIFICATION_REPORT.md` when Edit/Write/Bash returns an error.
  - `PreToolUse` → `aidd-contract-guard.cjs` blocks edits to immutable core files; `aidd-phase-guard.cjs` blocks out-of-root and out-of-phase edits; `aidd-tdd-guard.cjs` enforces the RED gate.
- The bootstrap reduces but **does not replace** the MUST READ rule — in sessions with compacted context, reload the 3 files manually.
- **Reading:** use `Read` for known paths, `Grep` for content searches, `Glob` for file discovery. Never bulk-read.
- **Two-attempt rule:** two consecutive failures on the same root cause ⇒ stop, write the diagnosis in `VERIFICATION_REPORT.md` (root-cause hypotheses, what was tried, what is unknown), then retry.

## Spec workflow (if installed)

If your project uses a spec-driven workflow (e.g. Kiro) for specs under your spec folder, follow it end-to-end whenever a spec is created, modified, or advanced — **no step may be skipped**. See `PREREQUISITES.md` for installation and `AIDD.md` "Spec-driven workflow" for the phase order and human gates.

- **Never create `design.md` or `tasks.md` manually** when a spec workflow is installed — use its skills/commands.
- **Never skip validation gates** (gap validation, design validation).
- The spec status file (`spec.json` when present) is the source of truth for a feature's phase; update it at each phase.
- If the spec tooling is not installed, AIDD runs standalone — produce the same artifacts (`requirements.md`, `design.md`, `tasks.md`) manually under the same human gates.

## Prohibitions

- Do not bulk-read all `.md` files.
- Do not invent missing requirements, files, or facts.
- Do not edit project files before recording the task plan in `.aidd/current/CURRENT_TASK.md`.
- Do not declare work done without an updated `VERIFICATION_REPORT.md`.
- Do not bypass tests or use `--no-verify`.
- Do not store personal/sensitive data without anonymization where your project's privacy policy requires it.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool as your first action rather than answering ad hoc. The AIDD lifecycle skills are:

- `/aidd` — diagnose current phase, recommend next skill (read-only).
- `/aidd-intake` — start a task (Phase 1): archive previous, populate `CURRENT_TASK.md`.
- `/aidd-impl-start` — begin implementation (Phase 9): arm the TDD guard.
- `/aidd-close` — close a task (Phase 12): disable TDD guard, archive, propose commit.

Advanced (batched Phase 9): `/aidd-impl-batch`, `/aidd-impl-finalize`, `/aidd-cross-batch-emergent`, `/aidd-domain-init`. See `AIDD-RUNBOOK.md`.

---
title: AIDD-RUNBOOK.md
description: Operational runbook for the AIDD cycle — how to start, transition between phases, and close a task. Maps the 12 phases to the lifecycle skills and the phase-guard enforcement.
type: runbook
audience: human + agent
scope: project-wide
globs: ["AIDD-RUNBOOK.md"]
alwaysApply: false
tags: [aidd, runbook, lifecycle, kickoff, skills, hooks]
related: [AIDD.md, CONTEXT_INDEX.md]
---

# AIDD-RUNBOOK.md

Operational recipe for the AIDD cycle. Use this document when:

- Starting a new task.
- In the middle of a task and unsure which phase comes next.
- Closing a task (commit, merge, archive).

> **Bootloader vs Runbook:** `CLAUDE.md` / `AGENTS.md` (bootloaders) inject MUST READ + lifecycle. `AIDD.md` defines the abstract methodology. **This runbook describes the concrete HOW** — which commands to invoke, in what order, with which checks.

## Cycle map

```
+-------------------------------------------------------------------+
| Phase 1   intake          /aidd-intake                            |
| Phase 2   context         (manual + CONTEXT_INDEX trigger table)  |
| Phase 3   domain          (manual; update steering if needed)     |
| Phase 4   process         (manual; diagram in spec or note)       |
| Phase 5   requirements    spec workflow requirements (gate #1)    |
| Phase 6   spec-validate   spec workflow validation                |
| Phase 7   design          spec workflow design (gate #2)          |
| Phase 8   tasks           spec workflow tasks (gate #3)           |
| Phase 9   implementation  /aidd-impl-start -> /aidd-impl-batch    |
|           (adversarial loop between batches)                      |
|           -> /aidd-impl-finalize (parallel trio + cross-batch)    |
| Phase 10  verification    goal-backward verification              |
| Phase 11  review          code review OR adversarial review       |
|           (gate #4 — criticals)                                   |
| Phase 12  doc & learning  /aidd-close (gate #5 — merge;           |
|           blocks if CONFIDENCE.verdict = FAIL)                    |
+-------------------------------------------------------------------+
```

Phases 5–8 use your installed spec workflow (e.g. Kiro) when present; otherwise produce `requirements.md` / `design.md` / `tasks.md` manually under the same human gates. See `PREREQUISITES.md`.

## Recipe 1 — Start a new task

```
1. Open Claude Code in the project.
2. SessionStart hook injects current state.
3. Invoke /aidd  (or /aidd-intake directly if the previous task is closed).
4. Answer: archive the previous task?
5. Answer: goal, type, complexity.
6. Skill populates CURRENT_TASK.md with phase=1.
7. Next automatic step: read CONTEXT_INDEX.md for your task.
```

**Stop:** if `/aidd-intake` fails twice, do not force. Stop, read VERIFICATION_REPORT.md, diagnose.

## Recipe 2 — Transition to implementation

```
1. Confirm specs/<feat>/tasks.md exists.
2. Confirm the human approved it (gate #3) — log in CURRENT_TASK or explicit commit.
3. Invoke /aidd-impl-start.
4. Skill arms the TDD guard (.claude/aidd-tdd-config.json enabled=true).
5. Skill updates phase=9 + status=implementing.
6. Start TDD: write the FIRST test, then the minimal code.
7. Repeat per task in tasks.md (or per batch with /aidd-impl-batch).
```

**Stop:** if the TDD guard denies incorrectly during a post-green refactor, set `AIDD_TDD_OVERRIDE=1` for the session and justify it in the log.

## Recipe 3 — Close a task

```
1. Verify all ACs in CURRENT_TASK are marked [x].
2. Verify VERIFICATION_REPORT.md has no open TDD-guard denials.
3. If a REVIEW.md exists, confirm criticals resolved (gate #4).
4. Invoke /aidd-close.
5. Answer: archive now or stack?
6. Skill disables TDD guard, updates phase=12, proposes a commit.
7. You decide: local commit? PR? Merge? (gate #5)
```

**Stop:** if ACs are not all green, do NOT force closure. Return to `/aidd-impl-start` or the tasks phase (if scope changed).

## Enforcement layers (edit-time is not the only net)

The guards enforce on up to three layers — full coverage in `AIDD.md § Provider support matrix`:

1. **Claude Code edit-time** (`.claude/settings.json` hooks) — full enforcement, session overrides available.
2. **Codex edit-time** (`.codex/hooks.json`, warn-tier/best-effort — trust-gated).
3. **git pre-commit** (the guaranteed net; scans staged blobs; ignores session overrides). Operational note: a commit blocked with `[aidd-git-net] BLOQUEADO ...` is this layer firing — fix the staged content; `--no-verify` remains forbidden by the methodology.

## Enforcement — `aidd-phase-guard.cjs`

PreToolUse hook that validates edits against the current phase:

| Phase | Edits allowed without warning | Edits that trigger warning/block |
|---|---|---|
| 1-4 | `.aidd/current/*`, `docs/`, `.claude/` | Edits in app/source code, spec folders (still in discovery) |
| 5-8 | spec folders, ADRs (new), docs | Edits in app/source code (need /aidd-impl-start) |
| 9 | anything (TDD guard handles it) | — |
| 10-11 | reads + targeted fixes | Massive production edits (suggests returning to 9) |
| 12 / done | `.aidd/`, `docs/`, configs | Production edits (suggests a new /aidd-intake) |

Default mode: `warn` (logs to VERIFICATION_REPORT.md but allows). To escalate to `block`, edit `.claude/aidd-phase-guard-config.json` `mode: "block"`. Per-session override: `AIDD_PHASE_OVERRIDE=1`.

## Stop Rules in play

At any moment, the **6 Stop Rules** from `AIDD.md § ⚠️ Stop Rules` apply (machine-readable SSOT in `.claude/aidd-stop-rules.json`):

1. **TDD** — armed mechanically in phase 9 via `/aidd-impl-start`.
2. **BDD** — validated by your spec validator in phase 6.
3. **DDD** — validated by `aidd-domain-guard.cjs` (cross-layer imports) + review in phase 11.
4. **Two-attempt** — captured via `aidd-sensor.cjs`; the agent reads VERIFICATION_REPORT before retrying.
5. **Non-inventive** — all lifecycle skills use multi-choice prompts for decisions; never presume.
6. **Spec is contract — inviolable** — `AIDD.md § Spec Boundary Rule`. Enforced by agent discipline + REVIEW gate in phase 11.

## Lifecycle skills — quick reference

| Command | When | What it does |
|---|---|---|
| `/aidd` | Don't know where I am | Diagnoses current phase, recommends next skill. Read-only. |
| `/aidd-intake` | Starting a task | Archives previous, populates template, phase=1. |
| `/aidd-impl-start` | Tasks approved, about to code | Arms TDD guard, phase=9. |
| `/aidd-close` | All green, closing | Disables TDD guard, archive, proposes commit. |

Advanced (batched Phase 9): `/aidd-impl-batch`, `/aidd-impl-finalize`, `/aidd-cross-batch-emergent`, `/aidd-domain-init`.

## What the runbook does NOT do

- Does not replace the human gate. The 5 AIDD gates still require your decision at the key points.
- Does not write code. Skills are routers and infrastructure-armers.
- Does not commit or push automatically. You decide when the work is ready for the world.

## When this runbook goes stale

If the AIDD phases change (in `AIDD.md`) or the skills evolve, update this page first. Inconsistency between the runbook and `AIDD.md` is a smell of drift — fix it before proceeding.

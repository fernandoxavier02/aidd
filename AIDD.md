---
title: AIDD.md
description: AI-Driven Development methodology
---

# AIDD — AI-Driven Development

AIDD is the methodology this repository uses for end-to-end AI-driven development. It is project-agnostic: the rules below apply unchanged to any stack. Project-specific facts live in `PROJECT_BRIEF.md`; what to read for a given task lives in `CONTEXT_INDEX.md`.

## ⚠️ Stop Rules

1. **TDD** — red → green → refactor.
2. **BDD** — EARS or Given/When/Then.
3. **DDD** — domain → application → infrastructure.
4. **Two-attempt rule.**
5. **Non-inventive rule.**
6. **Spec is contract — inviolable.** If a behavior, endpoint, field, or rule is not written in requirements.md, design.md, or tasks.md, it MUST NOT be implemented. No agent may invent, extrapolate, or add "nice to have" features outside the spec. If a gap is discovered during implementation, STOP — log the gap in CURRENT_TASK.md and ask the human before proceeding. Code that implements unspecified behavior is rejected at review.

## Flow (12 phases)

| # | Phase | Purpose | Primary artifact |
|---|---|---|---|
| 1 | Intake | Capture the original ask | CURRENT_TASK.md |
| 2 | Context discovery | Read via CONTEXT_INDEX.md | FILES_READ.md |
| 3 | Domain understanding | Confirm ubiquitous language | Notes in CURRENT_TASK.md |
| 4 | Process mapping | Trace user/system flow | Mermaid diagram |
| 5 | Requirements | Express behavior in EARS/GWT | requirements.md |
| 6 | Specification (validate) | Reject specs without testable scenarios | spec validator + human approval |
| 7 | Architecture / design | Layer per DDD | design.md, ADRs |
| 8 | Tasks | Break into ordered steps | tasks.md |
| 9 | Implementation | Red → green → refactor | Code + tests |
| 10 | Verification | Goal-backward check | VERIFICATION_REPORT.md |
| 11 | Review | Code + adversarial review | REVIEW.md |
| 12 | Documentation & learning | Update docs, capture lessons | Updated docs |

## Mandatory practices: TDD + BDD + DDD

Non-negotiable.

### TDD
- Red → green → refactor every time.
- Every business rule covered by a unit test.
- Forbidden: production code before its test; --no-verify.

### BDD
- Every requirement uses EARS or Given/When/Then.
- Each scenario maps to one executable acceptance test.

### DDD
- Vocabulary in code = ubiquitous language in steering.
- Layering: domain → application → infrastructure.
- Bounded contexts per module.

## Human gates

1. Approve requirements.md before design.
2. Approve design.md before tasks.
3. Approve tasks.md before implementation.
4. Resolve critical REVIEW findings.
5. Authorize merge after VERIFICATION passes.

## Test Contract Gate (ATDD)

Before any implementation begins (Phase 9):

1. **Acceptance tests in natural language first.** Write test contracts in EARS or Given/When/Then before any production code.
2. **Human approval of test contracts.** The human MUST approve test contracts before implementation. No code before sign-off.
3. **Tests must fail first (RED phase).** Run tests after writing them — they MUST fail. If a test passes before implementation, it is invalid.
4. **Traceability.** Every test contract maps to at least one AC in tasks.md and one requirement in requirements.md.

## Spec Boundary Rule

The spec is a hard boundary. This rule applies to every line of code written in Phase 9.

- **If it is not in requirements.md, it does not exist.** The agent may not assume, infer, or guess requirements. It implements exactly what requirements.md says — no extra fields, no extra endpoints, no extra validations.
- **If it is not in design.md, it is not architected.** The agent may not choose technologies, patterns, or data structures not specified in design.md.
- **If it is not in tasks.md, it is not scheduled.** The agent may not implement tasks out of order, skip tasks, or add "bonus" tasks.
- **Gaps are blockers, not invitations.** If the spec is ambiguous, incomplete, or contradicts itself, the agent MUST stop and ask. It is forbidden to "fill in the blank" with the agent's own judgment.

## Working artifacts (.aidd/current/)

- CURRENT_TASK.md
- FILES_READ.md
- FILES_CHANGED.md
- VERIFICATION_REPORT.md

## Operating rules

- **Spec is contract.** Implementation that diverges from the spec is rejected. Fix the spec first, then the code. Code that implements behavior outside the spec is rejected outright — no fixes, no patches, only deletion.
- **Every significant decision becomes an ADR.**
- **Adversarial review is mandatory on risk phases.**
- **Research before plan, plan before code.**
- **Two-attempt rule.**
- **No invention.** If a fact, file, or requirement is missing, log a gap in CURRENT_TASK.md or ask the human. Never fabricate. Never add "just in case" code.

## Spec-driven workflow (optional integration)

AIDD is the umbrella methodology. It works standalone, but it can delegate the spec phases (5–8) to an external spec-driven workflow when one is installed (for example the Kiro spec workflow). See `PREREQUISITES.md` for what is optional and how the harness degrades gracefully without it.

When a spec workflow IS installed, all feature work MUST follow it end-to-end:

1. Spec initialization → `spec.json` + `requirements.md` (template)
2. Requirements generation → full requirements in EARS format
3. Validate gap → coverage and lacuna check (quality gate — do not skip)
4. Design generation → `design.md`
5. Validate design → consistency check (quality gate — do not skip)
6. Tasks generation → `tasks.md` (ACs per task, dependencies, order)
7. Implementation → Phase 9

The spec status file (`spec.json` when present) is the source of truth for a feature's phase. No implementation begins while it shows `approved: false`.

### Format requirements

- Requirements: EARS format.
- User stories: As a [role], I want [action], so that [benefit].
- Design: architecture, schema, API contracts, error handling, testing strategy.
- Tasks: ACs per task, dependencies, estimates, execution order.

## Mechanized enforcement (hooks)

The harness ships Node hooks under `.claude/hooks/` (Claude Code). They mechanize parts of the methodology so discipline does not depend on memory alone. Core (project-agnostic):

- `aidd-session-bootstrap.cjs` (SessionStart) — injects a summary of `.aidd/current/*` + tail of the decision log so each session starts oriented.
- `aidd-sensor.cjs` (PostToolUse) — appends to `VERIFICATION_REPORT.md` when Edit/Write/Bash returns an error (mechanizes the two-attempt evidence trail).
- `aidd-contract-guard.cjs` (PreToolUse) — blocks edits to immutable core files (AIDD.md, CONTEXT_INDEX.md, bootloaders, steering, accepted ADRs).
- `aidd-stop-rules-preserver.cjs` (PreCompact) — preserves the stop rules across context compaction.
- `aidd-tdd-guard.cjs` (PreToolUse) — RED-gate: blocks production code before its test exists, with coverage inference.
- `aidd-tdd-guard-v2.cjs` — implementation behind the `aidd-tdd-guard.cjs` alias (full RED-gate algorithm; test runner is config-driven via `aidd-tdd-config.json`).
- `aidd-phase-guard.cjs` (PreToolUse) — validates edits against the current phase and blocks out-of-root writes (path-traversal defense).
- `aidd-adversarial-read-guard.cjs` (PreToolUse) — context isolation for adversarial subagents (restricts Read/Grep/Glob to allowed files).

Optional / configurable (genericized — adapt to your stack via config, or remove if not applicable):

- `aidd-secrets-guard.cjs` (+ `aidd-secrets-patterns.json`) — blocks committing secrets across common families.
- `aidd-rls-guard.cjs` — blocks SQL migrations that create tables without row-level-security enablement. Opt-in via config (disabled unless your project uses RLS).
- `aidd-domain-guard.cjs` — blocks cross-layer imports per `.aidd/domain-map.json`. Layers and rules are fully configurable; delete the map to disable.
- `aidd-frontend-business-guard.cjs` — warns on business logic in frontend paths. Watched globs are configurable.

The number of stop rules in this file (prose) must equal the number in `.claude/aidd-stop-rules.json` (machine-readable). The hook list here must equal `ls .claude/hooks/aidd-*.cjs`.

## Batched Phase 9 + Adversarial Trio

Phase 9 (Implementation) executes in **adaptive batches** with an adversarial checkpoint between batches, rather than as one monolithic pass. Refining AI-generated code through repeated adversarial rounds materially reduces vulnerability accumulation. Native skills:

- `/aidd-impl-batch` — per-batch lifecycle: micro-gate spec coverage → TDD RED → implement → TDD GREEN → checkpoint → single adversarial pass (security | architecture | quality) → fix loop (max 3) → cleanup → batch-log append + confidence update.
- `/aidd-impl-finalize` — parallel adversarial trio (3 reviewers in one message) → 3 context files → atomic transition → cross-batch emergent check → consolidate REVIEW.md (Security, Architecture, Quality, Cross-batch) → final confidence → advance to Phase 10.

**Context isolation defense (2 layers):**

- **Prompt layer:** the adversarial prompt is synthesized WITHOUT references to CURRENT_TASK, design.md, requirements.md, the batch log, or ADRs — so the reviewer judges code on its own merits.
- **Hook layer:** `aidd-adversarial-read-guard.cjs` intercepts Read/Grep/Glob from adversarial subagents and restricts them to the `allowed_files` of the matching context file. Fail-closed.

**Confidence score:** `.aidd/current/CONFIDENCE.yaml` holds 6 dimensions (spec_clarity, design_coverage, tdd_adherence, adversarial_clean_rate, regression_health, cross_batch_emergent) with weighted-sum thresholds (PASS ≥ 0.75 / WARN [0.40, 0.75) / FAIL < 0.40). `/aidd-close` blocks closure on FAIL unless an explicit override is provided.

## Closing the loop

1. Confirm VERIFICATION_REPORT.md shows green.
2. Update PROJECT_BRIEF.md if stack/modules changed.
3. Update steering docs if vocabulary evolved.
4. Add an ADR if a significant decision was made.
5. Capture surprises and lessons.

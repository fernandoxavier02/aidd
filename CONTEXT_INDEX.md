---
title: CONTEXT_INDEX.md
description: Trigger map — which documents to read for each task type. Two reading lanes (project-level vs feature-spec-level). Explicit gap list for missing standard docs.
type: index
audience: any
scope: project-wide
globs: ["**/*"]
alwaysApply: true
tags: [aidd, context, index, navigation, triggers, on-demand-loading, gaps, reading-order]
related: [AIDD.md, PROJECT_BRIEF.md, AGENTS.md, CLAUDE.md]
---

# CONTEXT_INDEX.md

Map of *what to read for which task*. Do not load everything. Open only the documents matching the current task and record what you read in `.aidd/current/FILES_READ.md`.

> This is a template. Adjust the trigger table rows to the documents your project actually has. Rows pointing to files that do not exist yet are treated as gaps (see the bottom section), not invitations to invent them.

## Reading order

1. **Bootloader** — `AGENTS.md` (Codex) or `CLAUDE.md` (Claude Code). Tells your tool how to consume the rest.
2. **This index** (`CONTEXT_INDEX.md`) — decides what else to open.
3. **`PROJECT_BRIEF.md`** — project snapshot (goal, stack, modules, commands).
4. **`AIDD.md`** — methodology, mandatory practices (`## ⚠️ Stop Rules`), human gates.
5. **Docs on demand** — only the rows from the trigger table that match your task type.
6. **Auto-injected in Claude Code sessions:** the `SessionStart` hook injects a summary of `.aidd/current/*` + tail of the decision log. Do not bulk-read those files if they were already injected this session.

Stop when you have enough context to act. Do not pre-load.

## How to use the trigger table

The table below has **two lanes**:

- **Lane A — project-level tasks** (architecture changes, ADRs, cross-module concerns). Root docs (`ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DECISION_LOG.md`, etc.) are "Always read" when present; deeper docs under `docs/` are "Read if exists".
- **Lane B — feature-spec tasks** (specs under your spec folder, e.g. `specs/<feat>/` or `.kiro/specs/<feat>/`). Steering docs and the active feature's `requirements.md` / `design.md` / `tasks.md` are "Always read"; root docs become complementary references.

Identify your task type and apply the corresponding lane. If a referenced document is missing, **do not invent it** — record the gap in `.aidd/current/CURRENT_TASK.md` under "Open questions".

## Trigger table

| Task type | Lane | Always read | Read if exists |
|---|---|---|---|
| Architecture / module boundaries / new service | A | `ARCHITECTURE.md` | `docs/architecture/overview.md`, `docs/architecture/folder-structure.md` |
| Domain modeling / entities / aggregates | A | `DOMAIN_MODEL.md` | steering `product.md` (canonical vocabulary source) |
| Process / user journey / flow | A | `PROCESS_MAP.md` | `docs/product/` |
| Decisions (technical choices) | A | `DECISION_LOG.md` | `docs/adr/` (full ADR text) |
| Test strategy / coverage / TDD setup | A | `TEST_PLAN.md` | stack ADR (backend/test stack) |
| Risk / privacy / compliance | A | `RISK_REGISTER.md` | `docs/product/` (privacy section) |
| Requirements / specs (active feature) | B | `specs/<feat>/requirements.md`, steering docs | `DOMAIN_MODEL.md` (vocabulary mirror) |
| Design (technical) | B | `specs/<feat>/design.md`, steering docs | `ARCHITECTURE.md`, `DECISION_LOG.md` |
| Tasks / implementation plan | B | `specs/<feat>/tasks.md`, steering docs | external research/patterns artifacts when produced |
| Verification / acceptance check | B | `specs/<feat>/{requirements,tasks}.md` | `TEST_PLAN.md`, `.aidd/current/VERIFICATION_REPORT.md` |
| Code review / adversarial review | B | `specs/<feat>/{requirements,design}.md` | `RISK_REGISTER.md`, previous `REVIEW.md` if any |
| Build / test / lint commands | A | `PROJECT_BRIEF.md` | `BUILD.md`, `CONTRIBUTING.md` (do not invent) |
| Tooling / scripts | A | `scripts/README.md` (if present) | — |
| Module-specific work | A | `<module>/README.md` | `<module>/AGENTS.md`, `<module>/CLAUDE.md` |
| Security / consent / data handling | A or B | `RISK_REGISTER.md` | `SECURITY.md`, `THREAT_MODEL.md`, `PRIVACY.md` |
| Deployment / environments / IaC | A | — | `DEPLOYMENT.md`, `infra/README.md` |
| Claude Code automation / hooks / session bootstrap | A | `.claude/hooks/*.cjs`, `.claude/settings.json` | `INSTALL.md` |
| Batched Phase 9 / adversarial trio | A | `AIDD.md` "Batched Phase 9" section | `.claude/adversarial-checklists/` (if present) |
| Domain layer mapping / DDD boundary enforcement | A | `.aidd/domain-map.json` | — |

## Files documented as expected but not yet present

Standard AIDD docs are referenced above, but many will not exist in a fresh project. Treat them as gaps — do not synthesize without authorization. Common examples: `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DECISION_LOG.md`, `PROCESS_MAP.md`, `TEST_PLAN.md`, `RISK_REGISTER.md`, `DEPLOYMENT.md`, `infra/README.md`.

By design, root `REQUIREMENTS.md` / `SPEC.md` are NOT expected — requirements live per feature in `specs/<feat>/requirements.md`.

If a task needs one of these and it is missing, log it in `.aidd/current/CURRENT_TASK.md` and either ask the human or open an ADR/issue.

## Update protocol

Whenever a new top-level document is created (root `SECURITY.md`, `DEPLOYMENT.md`, etc.), add a row here pointing to it. The index must stay accurate — an outdated index is worse than no index.

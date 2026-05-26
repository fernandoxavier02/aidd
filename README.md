# AIDD Harness

Project-agnostic template that materializes **AIDD — AI-Driven Development** as a single context system + automation hooks + lifecycle skills + quality gates for **Claude Code** and **Codex**.

Clone it, fill the placeholders in `PROJECT_BRIEF.md`, and your repository starts every AI session already knowing the methodology, the stop rules, and where to read.

**Status:** v1.0.0 — agnostic port (6 core docs + 12 hooks + 8 skills + configs + hook tests).

## What AIDD gives you

- **Spec-as-contract discipline.** Nothing gets built unless it is written in an approved spec. Gaps are blockers, not invitations to guess.
- **Six stop rules** enforced by a mix of agent discipline and automated hooks: TDD, BDD, DDD, two-attempt, non-invention, spec-boundary.
- **Twelve-phase lifecycle** from intake to documentation, with five human approval gates.
- **Working memory** in `.aidd/current/` so any session can pick up exactly where the last left off.

## Quick start

```bash
git clone <this-template> my-project
cd my-project
npm install         # fetches js-yaml (used by the confidence-score feature)
npm test            # hook tests should pass — proves the harness is wired
```

Then:

1. Open `PROJECT_BRIEF.md` and replace every `<placeholder>` with your project's reality.
2. Read `AIDD.md` (the methodology) and `AIDD-RUNBOOK.md` (the operational recipe).
3. Adjust `.aidd/domain-map.json` to your folder layout (or delete it to disable the DDD layer guard).
4. See `INSTALL.md` for hook registration details and `PREREQUISITES.md` for optional external dependencies.

## Components

| Layer | Files |
|---|---|
| Bootloaders | `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex) |
| Methodology | `AIDD.md`, `AIDD-RUNBOOK.md` |
| Context routing | `CONTEXT_INDEX.md`, `PROJECT_BRIEF.md` (template) |
| Hooks (12) | `.claude/hooks/aidd-*.cjs` + `lib/` + `aidd-secrets-patterns.json` |
| Configs | `.claude/aidd-*.json`, `.claude/settings.json` |
| Skills (8) | `.claude/skills/aidd*/` |
| Working memory | `.aidd/current/` (templates) + `.aidd/domain-map.json` |
| Tests | `tests/hooks/*.test.cjs` |

## Prerequisites

The harness runs standalone for the core lifecycle. The guards need no external dependencies (the glob matcher is vendored). One small dependency — `js-yaml` — is pulled by `npm install` and used by the optional confidence-score feature. Some advanced skills delegate to external tooling (a Kiro spec workflow, GSD agents); see `PREREQUISITES.md` — these are optional and the harness degrades gracefully without them.

Cross-platform. Node >= 18.

## License

MIT.

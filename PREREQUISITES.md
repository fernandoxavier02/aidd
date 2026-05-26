# PREREQUISITES.md

What the AIDD harness needs to run, and what is optional. The harness is designed to **degrade gracefully**: the core lifecycle works with Node + one tiny dependency. Optional integrations unlock the spec phases and richer verification.

## Required

| Requirement | Why | Notes |
|---|---|---|
| **Node.js >= 18** | All hooks and the `parse-current-task.js` helper are Node `.cjs` scripts. | The guards have **no external dependencies** — the glob matcher used by the domain/frontend guards is vendored in `.claude/hooks/lib/aidd-glob.cjs`. |
| **`npm install`** | Pulls **`js-yaml`**, used by the confidence-score feature (`.claude/hooks/lib/aidd-confidence.cjs` and a few skills that read `CONFIDENCE.yaml`). | This is the only runtime dependency. If you do not use the confidence-score feature, the rest of the harness still works without it. |
| **Claude Code** (for hook automation) | The `.claude/hooks/` automation is wired through `.claude/settings.json`, which Claude Code reads. | Codex can use the methodology and skills manually but has no hook runtime — see `AGENTS.md`. |

Run `npm install && npm test` after cloning to confirm the hooks are wired and pass.

## Optional — spec-driven workflow (phases 5–8)

Several skills delegate the formal spec phases to an external spec workflow. The skills reference these commands:

- `kiro:spec-requirements`
- `kiro:spec-design`
- `kiro:spec-tasks`
- `kiro:validate-spec`

These come from the **Kiro spec-driven workflow** (cc-sdd). If it is **not installed**, AIDD still works:

- Produce `requirements.md`, `design.md`, and `tasks.md` **manually** under the same five human gates (see `AIDD.md` "Human gates").
- The lifecycle skills (`/aidd`, `/aidd-intake`, `/aidd-impl-start`, `/aidd-close`) do not require Kiro — they manage `.aidd/current/` state and the TDD guard regardless.

## Optional — GSD verification agents

Some skills reference GSD agents for goal-backward verification:

- `gsd-verifier` (phase 10 verification)
- `gsd-phases`

If **not installed**, perform verification manually: confirm every acceptance criterion in `CURRENT_TASK.md` is met and `VERIFICATION_REPORT.md` is green before closing. The `/aidd-close` skill enforces the green-report gate independently of GSD.

## Optional — external project tracker

The `/aidd` and `/aidd-intake` skills can integrate with an external roadmap/issue tracker if one exists (a `roadmap/` folder, a tracker id field in `CURRENT_TASK.md`). All such references are treated as **if present** — a project without them runs the lifecycle unchanged.

## Optional — per-project guards

These hooks ship but are tuned per project:

- **`aidd-rls-guard.cjs`** — Postgres row-level-security enforcement on SQL migrations / Prisma schema. **Disabled by default.** Enable by setting `{ "enabled": true }` in `.claude/aidd-rls-config.json` (only meaningful for Postgres/RLS projects).
- **`aidd-tdd-guard.cjs`** — RED-gate. The test runner is configurable via `testCommand` in `.claude/aidd-tdd-config.json` (defaults to vitest; set it to your stack's runner, e.g. jest, pytest, go test).
- **`aidd-domain-guard.cjs`** / **`aidd-frontend-business-guard.cjs`** — driven by `.aidd/domain-map.json`. They no-op (allow) when the map is absent. Run `/aidd-domain-init` or edit the map to fit your folder layout; delete the map to disable.
- **`aidd-secrets-guard.cjs`** — uses `.claude/hooks/aidd-secrets-patterns.json` (15 secret families). Add families for your stack; the hook fail-safe-denies if fewer than 12 patterns are present.

## Summary

- **Bare minimum:** Node >= 18 + `npm install` + Claude Code → full lifecycle, guards, working memory.
- **+ Kiro:** automated, gated spec phases 5–8.
- **+ GSD:** automated goal-backward verification.
- Everything optional degrades to a documented manual procedure — nothing silently breaks.

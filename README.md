# AIDD Harness

Project-agnostic product that materializes **AIDD — AI-Driven Development** as a single context system + automation hooks + lifecycle skills + quality gates for **Claude Code**, **Codex**, and **any git repository**.

"Agnostic" here is not a slogan — it is a machine-checked table. The seven fiscal guards run from a provider-neutral core with three enforcement layers (Claude Code edit-time, Codex edit-time best-effort, git pre-commit commit-time), and the exact guard × provider × moment coverage lives in the **Provider support matrix** in `AIDD.md`, kept truthful by an integrity test that fails whenever the docs promise more than the shipped adapters deliver.

Install it into any project with one command, fill the placeholders in `PROJECT_BRIEF.md`, and your repository starts every AI session already knowing the methodology, the stop rules, and where to read.

**Status:** v2.0.0 — npm product (`@fx-studio-ai/aidd`): installable, updatable, self-diagnosing. Same 6 core docs + 12 hooks + 8 skills + configs + tests as the v1 template, now with a CLI and a version manifest.

## What AIDD gives you

- **Spec-as-contract discipline.** Nothing gets built unless it is written in an approved spec. Gaps are blockers, not invitations to guess.
- **Six stop rules** enforced by a mix of agent discipline and automated hooks: TDD, BDD, DDD, two-attempt, non-invention, spec-boundary.
- **Twelve-phase lifecycle** from intake to documentation, with five human approval gates.
- **Working memory** in `.aidd/current/` so any session can pick up exactly where the last left off.

## Install (npm — recommended)

```bash
cd my-project
npm install --save-dev @fx-studio-ai/aidd
npx aidd init          # scaffold docs/configs/skills + wire the hooks
npx aidd doctor        # verify everything is green
```

Then fill the placeholders in `PROJECT_BRIEF.md`, read `AIDD.md` + `AIDD-RUNBOOK.md`, and restart your Claude Code session so the hooks load.

### How the install works (hybrid model)

- **Engine (the 12 hooks + the neutral guard core + git-net + Codex adapter)** stays inside `node_modules/@fx-studio-ai/aidd/` and is referenced from the generated `.claude/settings.json`, the git pre-commit wrapper, and `.codex/hooks.json`. Upgrading the package upgrades the guards on every layer — no file copying.
- **Editable content** (methodology docs, `PROJECT_BRIEF.md`, configs, skills, secrets catalog) is copied into your project once and tracked in `.aidd/harness.json` (version + content fingerprint per file).
- **`npx aidd update`** refreshes files you have **not** edited and never touches the ones you have. `--dry-run` previews; `--force` overrides.
- **`npx aidd doctor`** checks the wiring end to end (engine reachable, hooks resolve, configs parse, drift report). Exit code 1 on errors — CI-friendly.
- Existing `CLAUDE.md` / `AGENTS.md` / `.claude/settings.json` are **merged, never overwritten**: the bootloader lives in a marked block; hook registrations are added idempotently.

### Projects that do not keep `node_modules`

```bash
npx -p @fx-studio-ai/aidd aidd init --mode copy
```

Copy mode ships the engine into `.claude/hooks/` as well — everything is hash-tracked, `aidd update` still works.

### Via the unified FX Studio AI installer

The unified installer offers a product menu (Pipeline Orchestrator, AIDD, or both):

```bash
npx @fx-studio-ai/pipeline-orchestrator-install
```

## Install (template clone — legacy)

Cloning the repository and copying files by hand still works — see `INSTALL.md`. The npm route is preferred because it gives you versioned updates.

## CLI reference

```
aidd init    [--dir <path>] [--mode hybrid|copy] [--providers claude,codex,git]
             [--no-git-hooks] [--force] [--dry-run]
aidd update  [--dir <path>] [--force] [--dry-run]
aidd doctor  [--dir <path>] [--json]
aidd version
```

`init` detects the tools present (`.claude/`, `.codex/` or `AGENTS.md`, `.git/`) and installs the matching enforcement layers; `--providers` forces the list, `--no-git-hooks` vetoes the pre-commit net. Installed layers are recorded in `.aidd/harness.json`; `update` refreshes them (the git hook is regenerated only while its AIDD marker is intact — hand-edited hooks are never touched); `doctor` health-checks each layer, including `core.hooksPath` divergence and Codex `"type":"command"` correctness.

## Components

| Layer | Files |
|---|---|
| CLI | `bin/aidd.cjs`, `lib/cli/` (init/update/doctor, manifest, settings merge) |
| Bootloaders | `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex) — managed block in consumers |
| Methodology | `AIDD.md`, `AIDD-RUNBOOK.md` |
| Context routing | `CONTEXT_INDEX.md`, `PROJECT_BRIEF.md` (template) |
| Hooks (12) | `.claude/hooks/aidd-*.cjs` (thin shells) + `lib/` + `aidd-secrets-patterns.json` |
| Neutral guard core | `.claude/hooks/lib/guards/` — one rule module per fiscal guard, provider-blind |
| Git pre-commit net | `.claude/hooks/lib/git-net.cjs` (engine) + `lib/cli/git-hooks.cjs` (installer) |
| Codex adapter | `.claude/hooks/lib/adapters/codex.cjs` + `lib/cli/codex-settings.cjs` (generates consumer `.codex/hooks.json`) |
| Configs | `.claude/aidd-*.json`, `.claude/settings.json` |
| Skills (8) | `.claude/skills/aidd*/` |
| Working memory | `.aidd/current/` (templates) + `.aidd/domain-map.json` + `.aidd/harness.json` (manifest, consumers only) |
| Tests | `tests/hooks/*.test.cjs`, `tests/cli/*.test.cjs` |

## Prerequisites

The harness runs standalone for the core lifecycle. The guards need no external dependencies (the glob matcher is vendored). One small dependency — `js-yaml` — is used by the optional confidence-score feature. Some advanced skills delegate to external tooling (a Kiro spec workflow, GSD agents); see `PREREQUISITES.md` — these are optional and the harness degrades gracefully without them.

Cross-platform. Node >= 18.

## License

MIT.

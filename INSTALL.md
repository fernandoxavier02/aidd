# INSTALL.md

How to install the AIDD harness into a project and wire the Claude Code hooks.

## Option A — npm (recommended)

```bash
cd my-project
npm install --save-dev @fx-studio-ai/aidd
npx aidd init
npx aidd doctor
```

What `aidd init` does:

1. **Detects the enforcement layers** for your project: `.claude/` (Claude Code), `.codex/` or a pre-existing `AGENTS.md` (Codex), `.git/` (any committer). Force or veto with `--providers claude,codex,git` / `--no-git-hooks`.
2. Copies the editable content into your project: methodology docs (`AIDD.md`, `AIDD-RUNBOOK.md`, `CONTEXT_INDEX.md`, `PROJECT_BRIEF.md`, `PREREQUISITES.md`), configs (`.claude/aidd-*.json`), the 8 lifecycle skills (`.claude/skills/aidd*/`), the secrets catalog (`.claude/aidd-secrets-patterns.json`), and the `.aidd/` working-memory templates.
3. **Claude layer:** generates/merges `.claude/settings.json` with the hook registrations pointing at the engine inside `node_modules/@fx-studio-ai/aidd/.claude/hooks/` (hybrid model — `npm update` upgrades the guards).
4. **Codex layer:** generates/merges `.codex/hooks.json` registering the warn-tier adapter (`"type": "command"`, matcher `apply_patch`). Best-effort — Codex asks you to trust the hook before it runs.
5. **Git layer:** installs the pre-commit net into the *effective* hooks dir (`git rev-parse --git-path hooks`, honoring `core.hooksPath`). A pre-existing pre-commit hook is renamed to `pre-commit.local` and chained, never overwritten. Per-clone: every fresh clone needs `aidd init`/`update` to re-arm the net.
6. Adds the bootloader as a **marked block** inside `CLAUDE.md` and `AGENTS.md` (created if absent, appended if present — your content is never touched).
7. Writes the install manifest `.aidd/harness.json` (package version + installed layers + sha256 per installed file).

The full guard × provider × moment coverage is the **Provider support matrix** in `AIDD.md`.

Rules it follows:

- A file that already exists and **differs** from what the package ships is **left alone and unmanaged** (reported as skipped).
- A file that already exists and is **identical** is adopted into the manifest.
- `aidd update` overwrites only files whose content still matches what the harness installed; your edits always win. `--dry-run` previews, `--force` overrides.
- `aidd doctor` verifies: Node version, manifest, engine reachability, every registered hook script resolves, configs parse, working memory exists, bootloader blocks present, and reports drift (managed files you edited). Exit code 1 on errors.

For projects that do not keep `node_modules` around (non-npm stacks):

```bash
npx -p @fx-studio-ai/aidd aidd init --mode copy
```

Copy mode also copies the engine into `.claude/hooks/` (hash-tracked; `aidd update` refreshes unmodified hooks).

## Option B — start a new project from the template

```bash
git clone <this-template> my-project
cd my-project
rm -rf .git && git init        # start your own history
npm test                       # the hook test suite should pass — proves the harness is wired
```

Then fill `PROJECT_BRIEF.md` and read `AIDD.md` + `AIDD-RUNBOOK.md`.

## Option C — add the harness to an existing project by hand (legacy)

Copy these into your repo root:

- `AIDD.md`, `AIDD-RUNBOOK.md`, `CONTEXT_INDEX.md`, `PROJECT_BRIEF.md`, `PREREQUISITES.md`
- `CLAUDE.md` and/or `AGENTS.md` (bootloaders — Claude Code / Codex)
- `.claude/` (hooks, skills, configs, settings.json)
- `.aidd/` (domain-map + working-memory templates)
- `tests/hooks/` (optional, but recommended — proves the hooks run)

If you already have a `CLAUDE.md` or `.claude/settings.json`, **merge** rather than overwrite (see hook registration below). Note: manual copies have no manifest, so `aidd update`/`aidd doctor` will not manage them — prefer Option A.

## Hook registration

Hooks are registered in `.claude/settings.json`. Each entry runs a Node script via the `${CLAUDE_PROJECT_DIR}` variable, so the paths are portable across machines:

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/node_modules/@fx-studio-ai/aidd/.claude/hooks/aidd-session-bootstrap.cjs\"", "timeout": 5 }] }],
    "PreCompact":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/node_modules/@fx-studio-ai/aidd/.claude/hooks/aidd-stop-rules-preserver.cjs\"", "timeout": 3 }] }],
    "PostToolUse":  [{ "matcher": "Edit|Write|Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/node_modules/@fx-studio-ai/aidd/.claude/hooks/aidd-sensor.cjs\"", "timeout": 8 }] }],
    "PreToolUse":   [{ "matcher": "Edit|Write|MultiEdit", "hooks": [ /* contract-guard, secrets-guard, rls-guard, domain-guard, frontend-business-guard, tdd-guard, phase-guard */ ] },
                     { "matcher": "Read|Grep|Glob", "hooks": [ /* adversarial-read-guard */ ] }]
  }
}
```

`aidd init` generates exactly this (hybrid paths) or the project-local variant (`--mode copy`, paths under `${CLAUDE_PROJECT_DIR}/.claude/hooks/`). The repository's own `settings.json` uses the project-local form — it doubles as the copy-mode source of truth.

> **Note on `aidd-rls-guard`:** it IS registered in the default `PreToolUse` chain but **disabled by config** — it no-ops until you set `{ "enabled": true }` in `.claude/aidd-rls-config.json` (only meaningful for Postgres/RLS projects).

After editing `settings.json`, restart Claude Code (or start a new session) so the hooks load.

## Configuration files

| File | Controls | Default |
|---|---|---|
| `.claude/aidd-tdd-config.json` | TDD RED-gate on/off | `enabled: false` — set true in Phase 9 (or via `/aidd-impl-start`) |
| `.claude/aidd-phase-guard-config.json` | phase guard mode | `enabled: true`, `mode: "warn"` |
| `.claude/aidd-rls-config.json` | RLS guard opt-in | `enabled: false` |
| `.aidd/domain-map.json` | DDD layer boundaries | generic example — edit or run `/aidd-domain-init` |
| `.claude/aidd-secrets-patterns.json` | secret families to block (project override; falls back to the catalog bundled with the engine) | 15 families |
| `.aidd/harness.json` | install manifest (written by `aidd init`) | version + per-file sha256 |

## Session-scoped overrides

| Variable | Effect |
|---|---|
| `AIDD_TDD_OVERRIDE=1` | bypass the TDD guard for this session (post-green refactor, scaffolding) |
| `AIDD_PHASE_OVERRIDE=1` | bypass the phase guard for this session |
| `AIDD_OVERRIDE_SECRETS=<reason ≥ 20 chars>` | allow a flagged secret write with an audited reason |
| `AIDD_OVERRIDE_DOMAIN=ADR-NNNN` | allow a cross-layer import justified by an ADR |
| `AIDD_OVERRIDE_RLS=ADR-NNNN` | allow an RLS-affecting migration justified by an ADR |
| `AIDD_SECRETS_CATALOG=<path>` | point the secrets guard at a custom catalog |

> Session overrides are **edit-time affordances** for supervised Claude Code sessions. The git pre-commit net deliberately ignores all of them at commit time.

## Verify

```bash
npx aidd doctor   # consumer projects (manifest, wiring, drift)
npm test          # this repository (hook + CLI test suites)
```

All green = hooks load and run, configs parse, methodology SSOT is consistent. See `PREREQUISITES.md` for optional integrations (Kiro spec workflow, GSD verification).

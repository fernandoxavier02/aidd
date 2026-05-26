# INSTALL.md

How to install the AIDD harness into a project and wire the Claude Code hooks.

## Option A — start a new project from the template

```bash
git clone <this-template> my-project
cd my-project
rm -rf .git && git init        # start your own history
npm test                       # the hook test suite should pass — proves the harness is wired
```

Then fill `PROJECT_BRIEF.md` and read `AIDD.md` + `AIDD-RUNBOOK.md`.

## Option B — add the harness to an existing project

Copy these into your repo root:

- `AIDD.md`, `AIDD-RUNBOOK.md`, `CONTEXT_INDEX.md`, `PROJECT_BRIEF.md`, `PREREQUISITES.md`
- `CLAUDE.md` and/or `AGENTS.md` (bootloaders — Claude Code / Codex)
- `.claude/` (hooks, skills, configs, settings.json)
- `.aidd/` (domain-map + working-memory templates)
- `tests/hooks/` (optional, but recommended — proves the hooks run)

If you already have a `CLAUDE.md` or `.claude/settings.json`, **merge** rather than overwrite (see hook registration below).

## Hook registration

Hooks are registered in `.claude/settings.json`. Each entry runs a Node script via the `${CLAUDE_PROJECT_DIR}` variable, so the paths are portable across machines:

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/aidd-session-bootstrap.cjs\"", "timeout": 5 }] }],
    "PreCompact":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/aidd-stop-rules-preserver.cjs\"", "timeout": 3 }] }],
    "PostToolUse":  [{ "matcher": "Edit|Write|Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/aidd-sensor.cjs\"", "timeout": 8 }] }],
    "PreToolUse":   [{ "matcher": "Edit|Write|MultiEdit", "hooks": [ /* contract-guard, secrets-guard, domain-guard, frontend-business-guard, tdd-guard, phase-guard */ ] },
                     { "matcher": "Read|Grep|Glob", "hooks": [ /* adversarial-read-guard */ ] }]
  }
}
```

The shipped `settings.json` already contains the full, working registration — use it as-is for a fresh project.

> **Note on `aidd-rls-guard`:** it IS registered in the default `PreToolUse` chain but **disabled by config** — it no-ops until you set `{ "enabled": true }` in `.claude/aidd-rls-config.json` (only meaningful for Postgres/RLS projects).

After editing `settings.json`, restart Claude Code (or start a new session) so the hooks load.

## Configuration files

| File | Controls | Default |
|---|---|---|
| `.claude/aidd-tdd-config.json` | TDD RED-gate on/off | `enabled: false` — set true in Phase 9 (or via `/aidd-impl-start`) |
| `.claude/aidd-phase-guard-config.json` | phase guard mode | `enabled: true`, `mode: "warn"` |
| `.claude/aidd-rls-config.json` | RLS guard opt-in | `enabled: false` |
| `.aidd/domain-map.json` | DDD layer boundaries | generic example — edit or run `/aidd-domain-init` |
| `.claude/hooks/aidd-secrets-patterns.json` | secret families to block | 15 families |

## Session-scoped overrides

| Variable | Effect |
|---|---|
| `AIDD_TDD_OVERRIDE=1` | bypass the TDD guard for this session (post-green refactor, scaffolding) |
| `AIDD_PHASE_OVERRIDE=1` | bypass the phase guard for this session |
| `AIDD_OVERRIDE_SECRETS=<reason ≥ 20 chars>` | allow a flagged secret write with an audited reason |
| `AIDD_OVERRIDE_DOMAIN=ADR-NNNN` | allow a cross-layer import justified by an ADR |
| `AIDD_OVERRIDE_RLS=ADR-NNNN` | allow an RLS-affecting migration justified by an ADR |

## Verify

```bash
npm test
```

All tests green = hooks load and run, configs parse, methodology SSOT is consistent. See `PREREQUISITES.md` for optional integrations (Kiro spec workflow, GSD verification).

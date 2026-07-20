---
name: Provider-Agnostic Guards
description: How to design and port AIDD's fiscal guards (contract, phase, tdd, secrets, domain, rls, frontend-business) to run across multiple AI-harness providers (Claude Code, Codex, plain git) using a neutral core + thin adapters, plus the verified 2026 Codex hooks schema and a zero-dependency git pre-commit chaining pattern.
topics: hooks, guards, ports-and-adapters, hexagonal-architecture, codex, claude-code, git-pre-commit, provider-agnostic, hook-schema
created: 2026-07-20
updated: 2026-07-20
scratchpad: .specs/scratchpad/b5f2fe43.md
---

# Provider-Agnostic Guards

## Overview

AIDD's 7 fiscal guards (contract, phase, tdd, secrets, domain, rls, frontend-business) currently exist only as Claude Code `PreToolUse` hooks in `.claude/hooks/*.cjs`. Making them provider-agnostic means extracting each guard's *rule* into a neutral core that knows nothing about Claude Code, Codex, or git — then writing one thin adapter per provider that translates that provider's native event into the neutral shape and back. This skill captures the verified 2026 hook contracts for both providers, the architecture pattern that formalizes "neutral core + adapters" (Ports & Adapters / Hexagonal), and the git pre-commit chaining mechanics needed for the commit-time safety net.

---

## Key Concepts

- **Port**: the technology-agnostic contract the core exposes — here, `evaluate(event, config) -> verdict` where `event = {action: write|edit|exec, path, content, projectRoot, config}` and `verdict = {allow|warn|deny, message, evidence}`.
- **Adapter**: a thin translation layer around one provider (Claude Code hook script, Codex hook script, git pre-commit script) that converts native input → neutral event, calls the port, converts neutral verdict → native output. Adapters carry zero business rules.
- **Leaky port**: the #1 failure mode of this pattern — designing the neutral event shape too close to one adapter's native shape (e.g. mirroring Claude Code's `tool_input.new_string`), which then forces awkward reverse-translation in the other adapters. Design the neutral contract from all providers' native shapes at once, not by refactoring one adapter first.
- **Two different fail-safe directions**: the neutral **core** fails *closed* (deny) when it cannot evaluate an event (unknown rule state = risk). Each **adapter** fails *open* (warn + pass through) when it cannot parse the provider's payload (protocol drift ≠ a rule violation — don't block the user's tool because a hook script's assumptions about JSON shape are stale).
- **Edit-time vs. commit-time enforcement**: edit-time hooks (Claude Code `PreToolUse`, Codex `PreToolUse`) are provider-mediated and provider-trust-dependent. The git pre-commit net is the only layer that is unconditionally enforced by git itself, regardless of which tool (or no tool) produced the change — treat it as the actual guarantee, not "defense in depth."

---

## Documentation & References

| Resource | Description | Link |
|----------|-------------|------|
| Codex Hooks (official, current 2026 host) | Full hooks.json schema: events, matchers, types, input/output contracts, trust model | https://learn.chatgpt.com/docs/hooks.md |
| Codex Hooks (legacy host, 308-redirects) | Same content, old URL — update bookmarks | https://developers.openai.com/codex/hooks.md |
| Codex docs coverage map | Full list of Codex doc pages, useful to re-check for drift | https://learn.chatgpt.com/docs/llms.txt |
| Codex AGENTS.md guide | Discovery/precedence rules for bootloader files | https://learn.chatgpt.com/docs/agent-configuration/agents-md.md |
| Claude Code Hooks (current host) | PreToolUse/PostToolUse contract, exit codes, matcher `if` field | https://code.claude.com/docs/en/hooks |
| git githooks(5) | Official semantics: single pre-commit file, exit-code abort, `core.hooksPath` | https://git-scm.com/docs/githooks |
| pre-commit framework docs | Precedent for "migration mode" (chain existing hooks, error instead of silent overwrite) | https://pre-commit.com/ |
| Hexagonal Architecture (Wikipedia) | Canonical definition of Ports & Adapters, driving vs. driven adapters | https://en.wikipedia.org/wiki/Hexagonal_architecture_(software) |
| AWS Prescriptive Guidance — Hexagonal architecture pattern | Independent confirmation + enterprise framing | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html |
| User-level `codex-plugin-builder` skill (this machine) | Task-mandated local reference for Codex plugin/hook authoring, templates, build checklist | `C:\Users\win\.claude\skills\codex-plugin-builder\SKILL.md` |
| AIDD's own coherence-test precedent | Working example of "prose claims == filesystem reality" test to model the new guard×provider×moment matrix test on | `tests/hooks/config-integrity.test.cjs` (this repo) |

**Freshness warning found during this research (2026-07-20)**: both providers' documentation hosts moved in 2026 — `developers.openai.com/codex/*.md` now 308-redirects to `learn.chatgpt.com/docs/*.md`, and `docs.claude.com/en/docs/claude-code/hooks` now 301-redirects to `code.claude.com/docs/en/hooks`. Any locally cached reference (including the `codex-plugin-builder` skill's `references/sources.md`, dated 2026-05-19) should be re-verified against the live URL, not trusted on domain alone — the *content* was still materially accurate, but the *host* had already moved.

---

## Recommended Libraries & Tools

| Name | Purpose | Maturity | Notes |
|------|---------|----------|-------|
| Node.js `node:fs`/`node:path` (built-in) | All guard I/O, path safety, safe append/write | Stable | Already the only runtime dependency style used in `.claude/hooks/lib/aidd-paths.cjs` — keep the neutral core on stdlib-only, zero npm deps, matching the project's existing zero-dependency posture (only `js-yaml` is a real dependency, for YAML config, not hooks) |
| `node --test` (built-in test runner) | Unit tests for the neutral core, adapter translation tests with golden fixtures, E2E temp-repo tests | Stable | Already used project-wide (`npm test` → `node --test`); no new test framework needed |
| git plumbing (`git diff --cached --name-only --diff-filter=ACM`, `git rev-parse --show-toplevel`) | Staged-file enumeration and repo-root resolution for the pre-commit net | Stable, decades-old | No library needed — this is the zero-dependency approach the task requires |

### Recommended Stack

Keep the neutral core and all three adapters as plain Node.js CommonJS (`.cjs`) with zero new npm dependencies — this matches the existing hook style exactly and keeps `aidd init --mode copy` (no `node_modules`) viable. Do not introduce a schema-validation library (e.g. zod/ajv) for the neutral event/verdict shape unless a concrete bug demonstrates the plain-object contract is insufficient — YAGNI applies, and the existing guards already validate ad hoc (`typeof`, `Array.isArray`) without one.

---

## Patterns & Best Practices

### Ports & Adapters (Hexagonal Architecture) for guard rules

**When to use**: any time the same business rule (a "guard": deny/warn/allow a change based on policy) must be enforced by more than one calling context (here: 3 different AI-harness hook systems + a plain git commit path).

**Trade-offs**: pays off immediately once there are 2+ adapters (which AIDD now has); the discipline cost is keeping the port's data shape generic — pulled from ALL adapters' native shapes, not derived by refactoring the first (Claude Code) adapter in place and calling what's left "neutral."

**Example** (generic shape, not task-specific code):
```
core/guards/secrets-guard.cjs
  exports.evaluate = (event, config) => {
    // event = { action, path, content, projectRoot, config }
    // returns { verdict: "allow"|"warn"|"deny", message, evidence }
  }

adapters/claude-code/secrets-guard.cjs   // parses payload.tool_input.{content,new_string,edits[]}
adapters/codex/secrets-guard.cjs         // parses payload.tool_input for apply_patch-shaped edits
adapters/git-pre-commit/scan.cjs         // parses `git diff --cached` staged file list + content
```

### Fail-safe direction depends on WHERE the failure happens

**When to use**: every guard, every adapter, without exception — this is a correctness-critical distinction, not a style preference.

**Trade-offs**: getting this backwards in either direction is a real security bug: a core that fails *open* on an unevaluable rule silently disables protection; an adapter that fails *closed* on a parse error blocks the user's tool for a reason unrelated to their actual change (a provider protocol update, not a policy violation).

**Example**:
```
// CORE: cannot classify the event -> deny (closed)
if (!isKnownAction(event.action)) return { verdict: "deny", message: "unclassified event" };

// ADAPTER: cannot parse the provider's raw payload -> warn and pass through (open)
try { event = translate(rawPayload); }
catch { return nativeAllowWithWarning("adapter could not parse payload; rule not evaluated"); }
```

### Git pre-commit: chain, never overwrite

**When to use**: any installer (`aidd init`, `aidd update`) that writes to `.git/hooks/pre-commit`.

**Trade-offs**: slightly more code than a raw `fs.writeFileSync`, but the alternative silently destroys a pre-existing user or CI gate — an unacceptable regression, and one that established tooling (the `pre-commit` framework's own "migration mode") already treats as a hard requirement, not a nice-to-have.

**Example** (synthesized pattern, not copy-pasted from any tool):
```
1. No .git/hooks/pre-commit exists           -> write AIDD's script directly.
2. Exists AND contains AIDD's marker comment -> safe to overwrite (idempotent update).
3. Exists AND is a real user hook (no marker) -> rename aside (pre-commit.local),
   install a small dispatcher that execs the renamed hook AND AIDD's checks,
   propagating the first non-zero exit code so either one can still block the commit.
```

---

## Codex Hooks — verified 2026 schema (cross-checked live 2026-07-20)

| Aspect | Value |
|---|---|
| Only enforcing hook type | `"type": "command"` — `"prompt"` and `"agent"` are **parsed but silently skipped**. This is the highest-likelihood silent-failure mode: a hook that looks configured but never fires. |
| Events relevant to guard parity | `PreToolUse` (edit-time block/warn — the only one AIDD needs). Also exist but out of scope for guards: `SessionStart`, `SubagentStart/Stop`, `PermissionRequest`, `PostToolUse`, `PreCompact`/`PostCompact`, `UserPromptSubmit`, `Stop`. |
| Matcher | Regex on tool name, `PreToolUse`/`PostToolUse`/`PermissionRequest` only; `"*"`/`""`/omitted = match all. |
| File-edit tool name | Typically `apply_patch` (patch-based), **not** `Edit`/`Write`/`MultiEdit` like Claude Code. Do not copy Claude Code's matcher string — build an explicit Codex tool-name → neutral `action` mapping. |
| Input (stdin JSON) | Common: `session_id, transcript_path, cwd, hook_event_name, model, permission_mode`. Tool hooks add: `turn_id, tool_name, tool_use_id, tool_input` (+ `tool_response` on PostToolUse). |
| Deny output | `{ hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason } }`, OR legacy `{ decision: "block", reason }`, OR exit code `2` + stderr (works identically on Claude Code — use this as the adapter's lowest-common-denominator fallback). |
| Env vars | Canonical `PLUGIN_ROOT`/`PLUGIN_DATA`; legacy-compat `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` still work. No Codex-native "project root" var — resolve root the same way existing guards already do (`process.env.CLAUDE_PROJECT_DIR \|\| process.cwd()` pattern), don't assume a Codex-specific var exists. |
| Windows support | `commandWindows`/`command_windows` field for a Windows-specific command variant — relevant since this repo runs on Windows; mirror the existing `.claude/settings.json` path-quoting style. |
| **Trust model (critical)** | **"Non-managed command hooks require review and trust before execution."** A freshly-registered Codex hook is not guaranteed to run silently after `aidd init --providers codex` — the user may need to explicitly trust it first. AIDD must never invoke `--dangerously-bypass-hook-trust` on the user's behalf. This is why the support matrix should mark Codex edit-time guards as best-effort/`warn`, not `deny`/guaranteed — and why the git pre-commit net is the real backstop, not optional defense-in-depth. |
| Merge/precedence | `~/.codex/hooks.json` → `~/.codex/config.toml` → `<repo>/.codex/hooks.json` → `<repo>/.codex/config.toml` → plugin-bundled `hooks.json` — **all layers execute and merge**, none replace another. AIDD's project-level `hooks.json` cannot assume it is the only guard running. |
| Output size cap | ~2500 tokens visible to the model; longer output spills to a temp file. Keep `permissionDecisionReason` short (AIDD's existing guards already do this). |

## Claude Code Hooks — verified 2026 contract (for comparison)

| Aspect | Value |
|---|---|
| `permissionDecision` values | `allow \| deny \| ask \| defer` (Codex only documents `allow \| deny`) — AIDD's own neutral `{allow, warn, deny}` enum is a deliberate subset both providers can represent (`ask`/non-blocking paths both collapse into AIDD's `warn`). |
| Input adds | `prompt_id` (UUID), `agent_id`/`agent_type` (subagent context), `effort.level` — not used by current guards; leave room in the neutral event's passthrough for provider metadata the core doesn't need to understand. |
| Exit codes | 0 = success/parse stdout; 2 = blocking error/stderr-is-reason; other = non-blocking warning — **matches Codex almost exactly**, making exit-code + stderr the best shared fallback across both providers. |
| Matcher | Regex on `tool_name`, plus a per-handler `if` field for finer filtering (e.g. `"if": "Bash(git *)"`) — not present in Codex's documented matcher. |

## Support-matrix honesty rule (mechanized, not just prose)

Whatever guard × provider × moment matrix goes into `AIDD.md`, add a coherence test modeled directly on this repo's own `tests/hooks/config-integrity.test.cjs` pattern (assert doc text mentions every file on disk / every registered hook) — extend it to assert every cell the matrix claims (e.g. "contract-guard: Codex, edit-time, warn") actually has a corresponding registration in that provider's adapter file (`.claude/settings.json`, `.codex/hooks.json`, the pre-commit script). This is the same "prose can't promise what code doesn't deliver" invariant the repo already enforces for the plain hook list — apply it to the new matrix, don't invent a different verification style.

---

## Common Pitfalls & Solutions

| Issue | Impact | Solution |
|-------|--------|----------|
| Codex hook written with `type: "prompt"` or `"agent"` | Silently does nothing; false sense of coverage | Always use `"type": "command"`; add a doctor/CI check that fails if any Codex hook entry has a non-`command` type |
| Assuming Codex hooks fire unconditionally like Claude Code's | Edit-time layer silently absent for any user who hasn't trusted the hook | Document Codex edit-time as best-effort/`warn` in the matrix; never claim `deny`-level guarantee for it |
| Copying Claude Code's `Edit\|Write\|MultiEdit` matcher into Codex's `hooks.json` | Matcher never fires (Codex has no tool by that name) | Build a Codex-specific tool-name → neutral action table (`apply_patch` etc.), verify against real Codex tool names, not assumed ones |
| Deriving the neutral event schema only from Claude Code's existing `tool_input` shape | "Leaky port" — Codex/git adapters need awkward reverse-translation | Design the neutral contract from golden fixtures of all 3 providers up front |
| Installer overwrites an existing `.git/hooks/pre-commit` | Destroys a real user/CI gate, high-impact regression | Marker-comment detection + rename-aside + dispatcher (see Patterns section); add an E2E test asserting a pre-existing hook still runs after `aidd init` |
| Core fails open on unevaluable events, or an adapter fails closed on payload-parse errors | Either silently disables a rule, or blocks unrelated tool calls on protocol drift | Keep the two fail-safe directions separate and tested independently (see Key Concepts) |
| Trusting a locally cached doc/skill snapshot without re-checking the live URL | Silent staleness — this research found BOTH providers' doc hosts had migrated since the last local snapshot | Re-fetch the live URL before any Codex/Claude-Code schema-affecting change, even if a recent-looking local reference exists |

---

## Recommendations

1. **Build the neutral event/verdict contract from golden fixtures of all three providers before touching any existing Claude Code guard code** — avoids the leaky-port failure mode documented above.
2. **Use `"type": "command"` exclusively in any Codex `hooks.json`** — `"prompt"`/`"agent"` are confirmed no-ops in the 2026 schema.
3. **Mark the Codex edit-time layer as best-effort/`warn` in the support matrix, and the git pre-commit net as the real guaranteed layer** — this is what the documented Codex hook-trust model actually implies, not an overly cautious choice.
4. **Implement pre-commit installation as chain-never-overwrite** (marker detection + rename-aside + dispatcher), matching the `pre-commit` framework's own precedent.
5. **Extend the existing `config-integrity.test.cjs` pattern** to cover the new guard×provider×moment matrix, rather than inventing a new coherence-check style.

---

## Implementation Guidance

### Installation

No new package installation needed — this is an internal refactor + new adapter code within the existing `@fx-studio-ai/aidd` package (Node.js `>=18`, CommonJS, zero new runtime deps). Verify with the existing commands:

```bash
node --version   # >= 18 required (package.json engines)
npm test         # node --test — must stay green through the refactor
npm run test:hooks
```

### Configuration

New provider layers should follow the existing config file convention (`.claude/aidd-*-config.json` style) — e.g. a `.aidd/harness.json` manifest entry per installed layer (claude/codex/git), consumed by `aidd doctor` for per-layer health checks, matching the pattern already established by `.claude/aidd-tdd-config.json`, `.claude/aidd-rls-config.json`, etc.

### Integration Points

- Neutral core: new `lib/guards/*.cjs` (per task brief's own suggested path) — pure functions, unit-testable without any provider payload.
- Claude Code adapter: thin wrapper around existing `.claude/hooks/*.cjs`, reusing `.claude/hooks/lib/aidd-paths.cjs` helpers for payload parsing.
- Codex adapter: new `.codex/hooks.json` (or `.codex/hooks/*.cjs`) using `"type": "command"`, mapping Codex's `PreToolUse` payload (`apply_patch`-shaped) to the neutral event.
- Git pre-commit adapter: single zero-dependency script scanning `git diff --cached --name-only --diff-filter=ACM`, chain-installed per the pattern above.
- CLI: extend `lib/cli/init.cjs` (provider detection: `.claude/`, `.codex/`, `.git/`), `lib/cli/manifest.cjs` (`.aidd/harness.json` per-layer registration), `lib/cli/doctor.cjs` (per-layer health check) — these mechanisms already exist for the Claude Code layer; this task generalizes them, it doesn't invent them.

---

## Code Examples

### Example 1: Neutral core contract (illustrative shape only, not task-specific implementation)

```js
// lib/guards/example-guard.cjs — provider-blind
/**
 * @param {{action: "write"|"edit"|"exec", path: string, content: string, projectRoot: string, config: object}} event
 * @returns {{verdict: "allow"|"warn"|"deny", message?: string, evidence?: object}}
 */
function evaluate(event) {
  if (!event || !["write", "edit", "exec"].includes(event.action)) {
    return { verdict: "deny", message: "unclassified event — fail-closed" };
  }
  // ... pure rule logic, no knowledge of Claude Code / Codex / git ...
  return { verdict: "allow" };
}
module.exports = { evaluate };
```

### Example 2: Codex `hooks.json` PreToolUse entry (schema-correct skeleton)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "apply_patch|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/hooks/codex-guard-adapter.cjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Example 3: Pre-commit chain-detection sketch (generic, illustrative)

```js
const marker = "# AIDD-managed pre-commit net";
const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : null;
if (existing && !existing.includes(marker)) {
  fs.renameSync(hookPath, hookPath + ".local");
  // new script execs both hookPath + ".local" and AIDD's own checks,
  // propagating the first non-zero exit code
}
```

---

## Sources & Verification

| Source | Type | Last Verified |
|--------|------|---------------|
| https://learn.chatgpt.com/docs/hooks.md | Official (OpenAI Codex) | 2026-07-20 (live fetch, this research) |
| https://learn.chatgpt.com/docs/agent-configuration/agents-md.md | Official (OpenAI Codex) | 2026-07-20 (live fetch) |
| https://code.claude.com/docs/en/hooks | Official (Anthropic Claude Code) | 2026-07-20 (live fetch) |
| https://git-scm.com/docs/githooks | Official (git project) | 2026-07-20 (live fetch) |
| https://pre-commit.com/ + github.com/pre-commit/pre-commit/issues/3450 | Community / semi-official precedent | 2026-07-20 (WebSearch) |
| https://en.wikipedia.org/wiki/Hexagonal_architecture_(software) | Reference / canonical pattern definition | 2026-07-20 (WebSearch) |
| https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html | Official (AWS) | 2026-07-20 (WebSearch) |
| `C:\Users\win\.claude\skills\codex-plugin-builder\` | Local skill, dated 2026-05-19 | Cross-verified against live sources above; content accurate, doc host had moved |
| This repo's `.claude/hooks/*.cjs`, `tests/hooks/config-integrity.test.cjs`, `lib/cli/*.cjs` | Primary/codebase evidence | 2026-07-20 (direct read) |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-07-20 | Initial creation for task: Make AIDD guard enforcement provider-agnostic (neutral core + Codex adapter + git pre-commit net). Verified live 2026 Codex hooks schema (with domain-migration finding), live Claude Code hooks contract, git pre-commit chaining mechanics, and the Ports & Adapters architecture framing. |

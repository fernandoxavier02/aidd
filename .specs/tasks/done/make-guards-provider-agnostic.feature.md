---
title: Make AIDD guard enforcement provider-agnostic (neutral core + Codex adapter + git pre-commit net)
---

## Initial User Prompt

Vamos continuar com o Brainstorm porque eu quero torná-la de fato agnóstica para que ela funcione tanto no Claude Code quanto Em outros provedores de Harness

### Requirements

Decisões aprovadas no brainstorm (2026-07-20):

1. **Alcance (defesa em camadas):** adaptador nativo para o **Codex** (edit-time) + **rede universal via git pre-commit** (commit-time, funciona com qualquer ferramenta, até sem IA).
2. **Motor:** refatorar os guardas em **núcleo neutro + adaptadores finos**. Cada guarda fiscal vira um módulo provider-neutral (sugestão: `lib/guards/*.cjs`) com contrato único — entrada: evento neutro `{action: write|edit|exec, path, content, projectRoot, config}`; saída: veredicto `{allow|warn|deny, message, evidence}`. O núcleo não conhece nenhum provedor.
3. **Paridade:** portar os **7 guardas fiscais** — contract, phase, tdd (v2), secrets, domain, rls, frontend-business. A maquinaria de sessão (session-bootstrap, sensor, stop-rules-preserver, adversarial-read-guard) permanece **exclusiva do Claude Code**, declarada honestamente na documentação.
4. **Instalação:** `aidd init` **detecta** as ferramentas presentes (`.claude/`, `.codex/`, `.git/`) e instala os encaixes correspondentes; flag de veto/força (ex.: `--providers claude,codex,git` / `--no-git-hooks`). Manifesto `.aidd/harness.json` registra as camadas instaladas; `update` as atualiza; `doctor` checa camada por camada.

Arquitetura:

- **Núcleo neutro:** regra pura de cada guarda extraída para módulos testáveis isoladamente. Fail-safe do núcleo: evento que não consegue avaliar → `deny` (fechado por padrão, princípio já usado no kit).
- **Adaptador Claude Code:** os hooks atuais em `.claude/hooks/*.cjs` viram cascas finas (traduzem JSON do Claude ↔ evento/veredicto neutro). Testes atuais de hooks continuam passando sem mudança (passam a exercitar a casca); testes novos de unidade atacam o núcleo direto.
- **Adaptador Codex:** registra os 7 guardas no sistema de hooks do Codex (edit-time). Onde o Codex não oferecer bloqueio real para um evento → modo `warn` ali, e a rede do git segura no commit. `AGENTS.md` passa a listar os guardas ativos. **Pesquisa obrigatória na fase de planejamento:** verificar o formato real de hooks do Codex 2026 (hooks.json, eventos, semântica de bloqueio) — consultar a referência local `codex-plugin-builder`; NÃO presumir formato.
- **Rede git:** um único script de pre-commit, **zero dependências**, fiscalizando apenas os arquivos staged: secrets scan, contract (arquivos imutáveis), domain (imports entre camadas), rls (migrações sem RLS), frontend-business, e checagem de evidência TDD (heartbeat cobrindo prod files alterados). Se já existir pre-commit do usuário → **encadear, nunca sobrescrever**. Pré-commit que quebra bloqueia o commit com mensagem clara (comportamento padrão git — aceitável na última linha de defesa). `--no-verify` existe e continua proibido pela metodologia (rede é rede, não prisão).
- **Fail-safe dos adaptadores:** evento em formato irreconhecível (provedor atualizou o protocolo) → avisar alto e deixar passar (não travar a ferramenta do usuário); `doctor` ganha checagem de compatibilidade de adaptador.

Documentação honesta (coração da crítica):

- `AIDD.md` ganha **matriz de suporte**: guarda × provedor × momento (edit-time / commit-time / não suportado), com a maquinaria de sessão declarada Claude-only.
- **Coerência mecanizada:** teste de integridade quebra se a matriz em prosa prometer o que os adaptadores entregues não cumprem (mesmo molde de `tests/hooks/config-integrity.test.cjs`).
- README atualizado: "agnóstico" deixa de ser vago e aponta para a matriz.

Testes exigidos (três andares):

- Unidade do núcleo: cada guarda com eventos neutros, sem simular provedor.
- Tradução por adaptador: eventos gravados reais (golden files) de cada ferramenta.
- E2E: (a) repo temporário — `init` instala rede git → staged com segredo → commit bloqueado; (b) fluxo E2E existente do CLI estendido às camadas novas (`init` detecta, manifesto registra, `doctor` verde por camada).

Interação com outras tarefas: a tarefa `add-proportional-rigor` (tabela de rigor por complexity) modula o comportamento dos guardas; o contrato do evento neutro deve carregar `config` de forma que a tabela de rigor seja consumível pelo núcleo independentemente do provedor. Sem dependência dura de ordem, mas planejar os dois contratos juntos evita retrabalho.

## Description

> **Required Skill**: You MUST use and analyse `provider-agnostic-guards` skill before doing any modification to task file or starting implementation of it!
>
> Skill location: `.claude/skills/provider-agnostic-guards/SKILL.md`

**What this is.** The AIDD harness advertises itself as provider-agnostic and sells mechanized methodology enforcement, but today every guard runs only inside Claude Code (as `.claude/hooks/*.cjs`). Anyone using another harness (Codex) or committing without any AI gets AIDD's *documentation* and none of its *guardrails*, and the word "agnostic" is unbacked. This task re-architects guard enforcement so the same rules travel across tools: the seven fiscal guards are extracted into a **provider-neutral core** (one guard = one module, judged against a single event→verdict contract), fronted by **thin per-provider adapters** (Claude Code + Codex) and backstopped by a **universal git pre-commit net** that fires for any committer. The CLI (`init`/`update`/`doctor`, already shipped in v2.0.0 with a manifest) is extended to detect installed tools and install/track/verify each enforcement layer, and the documentation gains an **honest support matrix** that a mechanized integrity test keeps truthful.

**Why it is needed (business value).** This is an npm product whose differentiator is real, mechanized enforcement. Making "agnostic" true and honest (a) protects credibility — the claim now points to a concrete, testable matrix instead of a marketing word; (b) widens reach — Codex users and mixed/AI-less toolchains gain real guardrails; (c) guarantees defense-in-depth safety for the user's repository even with no AI in the loop (the git net catches secrets, immutable-file edits, cross-layer imports, RLS-less migrations, frontend business logic, and missing TDD evidence at commit-time); and (d) improves maintainability — each guard rule is authored and tested once in the core, then reused per provider instead of re-implemented per tool.

**Who benefits.** Codex (and future other-harness) users gain edit-time guardrails they lack today; any committer — including a human with no AI — gains the commit-time net; existing Claude Code users must see zero regression (their hooks keep working, now as shells); harness maintainers maintain one rule per guard; and adopters evaluating the product get expectations that match reality.

**Key constraints.** (1) Fail-safe asymmetry is a hard invariant — the *core* fails safe per guard contract (malformed envelope → `deny` for deny-capable guards, `warn` for the WARN-only guard; absent optional config → documented opt-in behavior), while *adapters* fail open (an unrecognized provider protocol → warn loudly and let the action through, so a protocol change never bricks the user's tool). (2) Backward compatibility — the existing Claude Code hook tests must pass unchanged, now exercising the shells. (3) Non-invention — the real 2026 Codex hook format must be confirmed by planning-phase research (via the local `codex-plugin-builder` reference), never assumed. (4) The git net has zero third-party dependencies, inspects only staged files, and chains any pre-existing pre-commit hook rather than overwriting it. (5) Honesty is mechanized — no documented enforcement without a delivering adapter, enforced by an integrity test on the same pattern as `tests/hooks/config-integrity.test.cjs`. (6) The neutral event's `config` field must be able to carry the proportional-rigor table (sibling task `add-proportional-rigor`) so per-level guard behavior is consumable by the core regardless of provider — no hard ordering dependency, but the two contracts are planned together.

**Complexity note (validation, not a frontmatter change).** The frontmatter carries only `title`; no `complexity` is declared. By the rigor scale defined in the sibling `add-proportional-rigor` task, this work — a multi-file re-architecture of seven enforcement guards, two adapters, a new git net, extended CLI detection/manifest/diagnostics, honest docs, and a three-tier test strategy, touching logic that is hard to undo — classifies as **COMPLEXA**. Downstream planning should treat it as such (full spec + tasks + hard TDD + adversarial trio). This note does not modify the frontmatter.

**Scope**:

- **Included**:
  - Provider-neutral core for the 7 fiscal guards (contract, phase, tdd, secrets, domain, rls, frontend-business), each judged against the single event→verdict contract.
  - Claude Code adapter: existing hooks become thin shells over the core, with the current hook test suite passing unchanged.
  - Codex edit-time adapter registering the 7 guards using the researched real format, degrading to `warn` where Codex cannot truly block; `AGENTS.md` lists the active guards.
  - Universal git pre-commit net (zero-dependency, staged-files-only, six checks) that chains existing hooks and blocks with a clear message.
  - CLI extension: `init` detects `.claude/`/`.codex/`/`.git/` and installs matching layers (with a force/veto flag); `.aidd/harness.json` records installed layers; `update` refreshes them; `doctor` verifies each layer, including adapter compatibility.
  - Honest support matrix in `AIDD.md` and `README`, kept truthful by a mechanized coherence test.
  - Three-tier tests: core unit tests, adapter-translation tests (golden files), and e2e (git-net blocking + extended CLI layer flow).
- **Excluded**:
  - Porting the session machinery (session-bootstrap, sensor, stop-rules-preserver, adversarial-read-guard) to any non-Claude provider — it stays Claude-only and is declared so in the matrix.
  - Adapters for harnesses beyond Codex (Cursor, Windsurf, etc.).
  - Changing the *substance* of what any guard checks — this is a portability + parity re-architecture, not a re-specification of the rules.
  - Implementing the proportional-rigor table itself (that is the sibling `add-proportional-rigor` task) — this task only reserves the `config` carrier in the contract.
  - Enforcement layers beyond git pre-commit (pre-push, CI) — not in this task.
  - Assuming the Codex hook format without the mandatory research.

**User Scenarios**:

1. **Primary Flow**: A maintainer runs `init` in a consumer repo containing `.claude/`, `.codex/`, and `.git/`; `init` detects all three, installs the Claude shells, the Codex adapter, and the git pre-commit net, and records the three layers in `.aidd/harness.json`. A subsequent guarded action (via Codex, Claude, or a plain commit) is translated to a neutral event, judged by the shared core, and enforced; `doctor` later reports every layer healthy and adapter-compatible.
2. **Alternative Flow**: In a git-only repo (no AI harness), `init` installs just the pre-commit net and commits remain guarded; a force/veto flag can select a provider subset or disable the git hooks; an existing user pre-commit hook is chained rather than overwritten.
3. **Error Handling**: An unassessable event → the core returns `deny` (fail closed) and the action is blocked; an unrecognized provider payload → the adapter warns loudly and lets the action through (fail open) while `doctor` flags the incompatibility; a Codex edit event that cannot be blocked → the adapter warns at edit-time and the git net blocks the same violation at commit-time; prose claiming enforcement the delivered adapters do not provide → the integrity test fails and blocks the build; a missing or corrupt manifest/config → the documented fail-safe applies and `doctor` reports the problem.

---

## Acceptance Criteria

### Functional Requirements

- [ ] **Neutral core produces a single verdict**: A guard evaluates a neutral event and returns exactly one decision without any provider context.
  - Given: a guard module and a neutral event `{action, path, content, projectRoot, config}`
  - When: the event is evaluated with no provider information present
  - Then: the module returns exactly one verdict — `allow`, `warn`, or `deny` — accompanied by a message and evidence

- [ ] **Fail-safe per guard (core)**: An event the core cannot assess fails safe according to each guard's own contract — never a silent pass, never an uncaught error.
  - Given: a neutral event with a malformed envelope (missing/invalid `action` or `path`)
  - When: a deny-capable guard (contract, phase, tdd, secrets, domain, rls) processes it
  - Then: the verdict is `deny`; for the WARN-only guard (frontend-business, "NUNCA DENY") the verdict is `warn`
  - And: an absent *optional* config (rls opt-in off, missing domain-map, tdd disabled) preserves each guard's documented opt-in behavior (`allow`) — porting does not change guard substance (R1 finding 4)

- [ ] **All seven fiscal guards ported**: Every fiscal guard exists as a provider-neutral module with its own direct unit tests.
  - Given: the seven guards (contract, phase, tdd, secrets, domain, rls, frontend-business)
  - When: the core is exercised
  - Then: each guard is a neutral module covered by unit tests that feed neutral events with no provider simulation

- [ ] **Violation parity per support matrix**: The same violation produces the declared outcome on every layer that runs that guard — parity of violations caught, not of raw function calls (R1 finding 5).
  - Given: a violation of a guard the support matrix declares enforced on two or more layers
  - When: it is delivered edit-time (Claude shell; Codex where trusted) and commit-time (git net)
  - Then: each declared layer catches it at least at its matrix-declared tier (deny or warn); disk-state-dependent rules (e.g. contract-guard's "ADR does not exist yet" allowance) receive the file-existence state inside the neutral event, so edit-time and commit-time judge the same facts and a legitimately-created ADR is not denied at commit

- [ ] **No Claude Code regression**: The existing Claude hook test suite passes unchanged after the refactor.
  - Given: the current `.claude/hooks` test suite
  - When: the guards are refactored into thin shells plus the neutral core
  - Then: the suite passes with zero tests modified, now exercising the shells

- [ ] **Codex adapter is warn-tier and fans out patches**: Codex hook execution depends on per-user trust, so ALL Codex edit-time enforcement is best-effort warn-tier — the adapter never claims guaranteed blocking (R1 finding 6).
  - Given: the adapter built on the researched real 2026 hook format, and a recorded `apply_patch` payload touching N files
  - When: the payload is delivered to the adapter
  - Then: the adapter fans out one neutral event per touched file (content derived from the patch applied to its base, not from raw patch text), aggregates verdicts (any-deny → the strongest signal Codex permits, otherwise warn), `AGENTS.md` lists the active guards, and the git net remains the guaranteed layer for the same violations

- [ ] **Adapters fail open**: An unrecognized provider payload never hard-blocks the user's tool.
  - Given: a payload whose format the adapter does not recognize (provider changed its protocol)
  - When: the adapter receives it
  - Then: the adapter emits a loud warning and lets the action through (no hard block)

- [ ] **Git net blocks a staged secret**: In a fresh repo, a committed secret is stopped by the installed net.
  - Given: a temporary repository where `init` has installed the git pre-commit net
  - When: a file containing a secret is staged and a commit is attempted
  - Then: the commit is blocked with a clear message identifying the violation

- [ ] **Git net chains, never overwrites**: A pre-existing pre-commit hook keeps working alongside the AIDD net.
  - Given: a repository that already has a user pre-commit hook
  - When: `init` installs the git net
  - Then: both the pre-existing hook and the AIDD net run on commit

- [ ] **Git net reads staged blobs, not the worktree**: Content comes from the index, so staging games cannot smuggle violations (R1 finding 2 — CRITICAL).
  - Given: a file staged containing a secret, then the secret removed from the worktree copy before committing
  - When: the commit is attempted
  - Then: the net scans the staged blob (`git show :0:<path>`), blocks the commit, and runs with zero third-party dependencies; conversely, a secret present only in the unstaged worktree copy does not block

- [ ] **Net maps verdicts to git semantics**: `deny` → exit 1 (commit blocked, violation named); `warn` → message on stderr + exit 0 (commit proceeds) — the WARN-only guard surfaces but never blocks at commit (R1 finding 12).

- [ ] **Copy mode delivers the engine**: In copy mode (no node_modules), the neutral core, the git-net engine, and the Codex adapter are copied into the harness-owned tree (e.g. `.claude/hooks/lib/guards/` or `.aidd/engine/` — decided at design time, never the consumer's own top-level `lib/`), and every thin shell resolves its `require` in BOTH modes (R1 finding 1 — CRITICAL).
  - Given: a consumer initialized with `--mode copy` and no node_modules
  - When: a guarded edit and a guarded commit occur
  - Then: shells and net find the core and enforce normally (copy-mode e2e)

- [ ] **Hooks-path aware install**: The installer resolves the real hooks dir via `git rev-parse --git-path hooks` and honors `core.hooksPath` (husky et al.) — installing/chaining there; `doctor` errors when the effective hooks path bypasses the installed net; docs state the per-clone requirement (fresh clone → run init again) (R1 finding 7).

- [ ] **Hook script is portable**: The installed hook is a `#!/bin/sh` wrapper (LF-only, mode 0755) that invokes the Node engine; if `node` is absent at commit time the wrapper warns and exits 0 (environment fail-open, distinct from rule fail-close); `doctor` checks executability and line endings (R1 finding 8).

- [ ] **Commit-time TDD policy is its own rule**: The net does NOT reuse the edit-time RED/30-minute-TTL semantics (R1 finding 3 — CRITICAL).
  - Given: changed production files at commit time
  - When: the net evaluates TDD evidence
  - Then: a config-gated commit-time policy applies — default: any heartbeat entry (RED or GREEN) covering the changed prod files, regardless of TTL → pass; absent heartbeat → warn, never deny (committers without edit-time tooling — humans, Codex — must not be hard-blocked)

- [ ] **Update regenerates the net from its marker**: `aidd update` regenerates the dispatcher when the AIDD marker is intact (re-deriving repo-specific chaining) and refuses with a loud warning when the marker was hand-edited — no silent staleness (R1 finding 14).

- [ ] **Tool detection drives layered install and manifest**: `init` installs only the layers for tools that are present and records them.
  - Given: a repo containing a known subset of `.claude/`, `.codex/`, and `.git/`
  - When: `init` runs
  - Then: only the matching layers are installed and `.aidd/harness.json` lists exactly those layers (absent tools are skipped, not errors)

- [ ] **Force/veto flag honored**: A flag can exclude a layer from installation.
  - Given: a repo with git present
  - When: `init` runs with the git-hooks-disabled flag (e.g. veto of the git layer)
  - Then: the git net is not installed and the manifest omits it

- [ ] **Doctor verifies each layer**: Diagnostics report health per installed layer, including adapter compatibility.
  - Given: an installed harness with recorded layers
  - When: `doctor` runs
  - Then: it reports a per-layer health result and flags any adapter that is incompatible with its provider's current protocol

- [ ] **Support matrix coherence is mechanized**: Documentation cannot promise more than the adapters deliver.
  - Given: the support matrix prose in `AIDD.md`/`README` and the delivered adapters
  - When: the integrity test runs
  - Then: it passes when prose and adapters agree and fails when the prose claims enforcement the delivered adapters do not provide

- [ ] **Session machinery declared Claude-only**: The matrix states honestly which machinery is not portable.
  - Given: the support matrix
  - When: it is read
  - Then: session-bootstrap, sensor, stop-rules-preserver, and adversarial-read-guard are marked Claude-only at their real moments (SessionStart, PostToolUse, PreCompact — not portable), distinct from the seven portable fiscal guards (R1 finding 15)

- [ ] **Contract carries rigor config (pass-through only)**: The event schema accepts `config.rigor` and delivers it to guards untouched — interpreting levels (`block`/`warn`/`off`) is the sibling task's scope, not this one's (R1 finding 9).
  - Given: a neutral event whose `config.rigor` holds an arbitrary table
  - When: any guard evaluates it via any adapter
  - Then: the guard receives the value byte-identical (pass-through unit test); no rigor semantics are implemented in this task

### Non-Functional Requirements

- [ ] **Compatibility**: 100% of the existing Claude Code hook tests pass without modification.
- [ ] **Portability**: The git pre-commit net runs with zero third-party dependencies.
- [ ] **Safety**: No unassessable, security-relevant event ever passes the core silently (fail closed), and no provider protocol change ever hard-blocks the user's tool (fail open).
- [ ] **Maintainability**: Each guard rule exists once in the neutral core (single source of truth) and is reused by every adapter — no rule duplicated per provider.
- [ ] **Verifiability**: Every documented enforcement claim is machine-checked by the integrity test; no unbacked "agnostic" claim survives the build.
- [ ] **Non-invention**: The Codex adapter is built from a confirmed 2026-format research artifact, not an assumed format.

### Definition of Done

- [ ] All functional and non-functional acceptance criteria pass.
- [ ] Core unit tests, adapter-translation tests (golden files), and e2e tests (git-net blocking + extended CLI layer flow) are written and passing.
- [ ] The existing Claude Code hook test suite passes unchanged.
- [ ] The mechanized support-matrix integrity test is in place and green (and demonstrably fails on a seeded divergence).
- [ ] `AIDD.md` (support matrix), `README` ("agnostic" pointing to the matrix), and `AGENTS.md` (active Codex guards) are updated.
- [ ] The Codex hook-format research artifact is recorded during planning before the Codex adapter is built.
- [ ] Every test named in the Test Strategy below exists and passes; the R1 must-change set (findings 1-8) is each covered by at least one mapped test.

---

## Test Strategy

Three tiers, per the architecture. Every case below maps to an AC; RED phase writes these before implementation (AIDD Test Contract Gate).

### Tier 1 — Core unit tests (`tests/guards/*.test.cjs`, neutral events, zero provider simulation)

| Test file | Cases |
|---|---|
| `verdict.test.cjs` | constructors produce exactly `{verdict, message, evidence}`; only 3 verdict values possible |
| `contract.test.cjs` | deny on core-file edit; allow on normal file; ADR-not-yet-exists allowance driven by the event's file-existence field (not `fs` reads) — same event judged identically regardless of caller |
| `phase.test.cjs` | phase-fit allow/deny per config; malformed envelope → deny |
| `tdd.test.cjs` | RED-evidence inference (edit-time semantics); commit-time policy: entry regardless of TTL → pass, absent heartbeat → warn (never deny); expired heartbeat ≠ crash |
| `secrets.test.cjs` | catalog hit → deny; <12 patterns in catalog → deny (fail-safe preserved); clean content → allow |
| `domain.test.cjs` | cross-layer import → deny; missing domain-map → allow (opt-in preserved) |
| `rls.test.cjs` | table without RLS → deny when enabled; disabled → allow (opt-in preserved) |
| `frontend-business.test.cjs` | violation → `warn`, NEVER `deny` (hard contract); malformed envelope → `warn` not deny |
| all of the above | `config.rigor` pass-through: guard receives the value byte-identical (AC 16) |

### Tier 2 — Adapter translation tests (golden files, recorded real payloads)

| Test file | Cases |
|---|---|
| `tests/adapters/claude-shell.test.cjs` (or preserved via existing suite) | existing `hooks-smoke` + `hooks-behavior` + `hooks-adversarial` + `config-integrity` + `aidd-glob` pass UNMODIFIED (full preserve set — R1 finding 15) |
| `tests/adapters/codex-adapter.test.cjs` | recorded `apply_patch` (N files) → N neutral events, content = patch applied to base; any-deny aggregation; unrecognized payload → loud warn + pass through (fail-open), never deny; `Bash`/exec payloads NOT matched (exec dropped — R1 finding 11) |

### Tier 3 — E2E (temp repos, real git)

| Test file | Cases |
|---|---|
| `tests/git-hooks/pre-commit.test.cjs` | init → stage secret → commit blocked; **staged-blob bypass**: stage secret, clean worktree, commit still blocked (R1 finding 2); secret only in worktree, not staged → commit passes; pre-existing user hook still runs after install (chain); `warn` verdict → stderr message + exit 0; `core.hooksPath` set → net installed/chained there, naive `.git/hooks` skipped (R1 finding 7); wrapper is `#!/bin/sh`, LF, 0755; `node` absent → warn + exit 0 (R1 finding 8); marker intact → `update` regenerates; marker hand-edited → refuse + warn (R1 finding 14) |
| `tests/cli/cli.test.cjs` (extended) | detection installs only present layers; manifest records layers; `--no-git-hooks` veto honored; **copy-mode e2e**: `--mode copy`, no node_modules → guard fires and commit blocked (R1 finding 1); `doctor` green per layer, errors on hooksPath divergence and non-`command` Codex entries |
| `tests/hooks/support-matrix-integrity.test.cjs` | prose matrix ↔ delivered adapters agree → pass; **seeded divergence** (matrix promises Codex deny) → test FAILS (proves the test can fail — DoD requirement) |

---

## Adversarial Review Record — R1 (2026-07-20)

Independent zero-context review: 16 findings (3 CRITICAL, 5 HIGH, 6 MEDIUM, 2 LOW). All CRITICAL/HIGH findings are folded into the ACs above (tagged "R1 finding N"). Design decisions fixed by this record:

1. **Env bypasses do not ride the git net** (finding 10): `AIDD_V2_INSTALL` and `AIDD_TDD_OVERRIDE` are edit-time affordances for supervised sessions; the git-net delivery path honors NEITHER. Prose stops calling the net "guaranteed" — it is the strongest layer, subvertible only by `--no-verify` (already forbidden by methodology).
2. **`exec` dropped from the event contract** (finding 11): actions are `write|edit` only; the Codex matcher is `apply_patch` (no `Bash`). Reintroduce `exec` only when a guard defines exec semantics.
3. **`.codex/hooks.json` is generate-only** (finding 16): produced at consumer init by `buildConsumerCodexHooks`; NEVER added to `package.json` `files[]` (avoids the `2cc383d` leak class).
4. **Codex detection widened** (finding 13): the Codex layer triggers on `.codex/` presence OR `AGENTS.md` presence OR explicit `--providers codex`; absence skips silently with an informative note.
5. **Engine placement per mode** (finding 1): hybrid resolves from node_modules; copy mode copies core+adapters into the harness-owned tree — exact directory decided at design phase; consumer top-level `lib/` is never squatted.
6. **Findings 15-16 doc fixes applied**: full five-file test preserve set enumerated; session-machinery moment labels corrected.

---

## Implementation Record (2026-07-20)

Implemented step-by-step (no pipeline orchestrator), TDD RED→GREEN per batch. Final: **148/148 tests green** (52 originals unmodified + 96 new), tarball E2E (hybrid consumer: init → doctor 0/0 → clean commit passes → staged secret blocked), copy-mode E2E (no node_modules), seeded-divergence proof for the support-matrix integrity test. Evidence: `.aidd/current/VERIFICATION_REPORT.md`. Deviations from spec (declared): Codex Update-File content = introduced (+) lines (not patch-applied-to-base) — proportional to the warn-tier layer, ceiling documented in code; Codex golden payloads are schema-derived (synthetic), real-session capture recommended; protected-file CREATION allowed (fresh-install bootstrap) while modification stays denied.

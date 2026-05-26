---
title: PROJECT_BRIEF.md
description: Project snapshot template. Goal, principles, current phase, tech stack, modules, install/test/build commands, integrations, observations.
type: brief
audience: any
scope: project-wide
globs: ["**/*"]
alwaysApply: true
tags: [aidd, project, snapshot, stack, modules, template]
related: [AIDD.md, CONTEXT_INDEX.md]
---

# PROJECT_BRIEF.md

> **This is a template.** Replace every `<placeholder>` with your project's reality. If a section is unknown, mark it `TBD` — do not invent. Keep this file short and factual; update it whenever reality changes. It is auto-injected context for every AI session, so accuracy here pays off everywhere.

## Project goal

**<Project name>** — <one-paragraph description of what the product is and who it serves>.

Core product principles (replace with your own; these shape every scope decision):

1. **<Principle 1>** — <operational meaning>.
2. **<Principle 2>** — <operational meaning>.
3. **<Principle 3>** — <operational meaning>.

## Current phase

<Where the project is right now: what is implemented, what is scaffolded, what has no code yet. Reference your decision log for the canonical pending list.>

## Tech stack

| Layer | Status | Choice |
|---|---|---|
| Backend service | <Decided/Partial/TBD> | <e.g. TypeScript + Fastify + PostgreSQL> |
| Auth strategy | <status> | <e.g. magic link + JWT> |
| Database engine | <status> | <e.g. PostgreSQL> |
| Frontend / mobile | <status> | <e.g. React Native, Swift, Next.js> |
| Dashboard (web) | <status> | <choice or TBD> |
| API style | <status> | <e.g. REST + JSON, GraphQL, gRPC> |
| Cloud provider | <status> | <choice or TBD> |
| Workspace tooling | <status> | <e.g. npm workspaces, pnpm, Turborepo> |
| Diagrams | <status> | <e.g. Mermaid> |

## Main modules

<Describe your module/monorepo boundaries. Example layout below — replace with yours.>

- `apps/<app>/` — <purpose>.
- `services/<service>/` — <purpose>.
- `packages/<shared>/` — shared kernel: types, constants, validation, pure utilities.
- `docs/adr/` — Architecture Decision Records.
- `docs/architecture/` — diagrams and technical overview.
- `scripts/` — idempotent dev automation. No business logic.
- `infra/` — IaC (Dockerfiles, cloud config, environments).
- `tests/` — cross-module integration and end-to-end tests. Unit tests live inside each module.

## Install commands

<e.g. `npm install` at root. Note workspace setup if monorepo.>

## Test commands

<e.g.>
- `npm test` — unit/route/contract tests.
- `npm run test:e2e` — end-to-end tests.

## Build commands

<e.g. `npm run build`>

## Lint / format commands

<e.g. `npm run lint`, `npm run lint:md`. Note CI workflows if present.>

## Integrations

<List external services, auth providers, data stores, third-party APIs. Mark TBD where undecided.>

## Observations

- <Any project-specific tracking reference (issue tracker, project board).>
- <Whether a spec workflow (e.g. Kiro) is installed — see `PREREQUISITES.md`.>
- <Non-negotiable constraints: privacy, compliance, performance budgets, etc.>

## Documentation entry points

- AIDD lifecycle runbook: `AIDD-RUNBOOK.md`
- Methodology: `AIDD.md`
- Context routing: `CONTEXT_INDEX.md`
- Decision log: `DECISION_LOG.md` (create when you record your first ADR)
- Prerequisites / optional integrations: `PREREQUISITES.md`
- Install & hook registration: `INSTALL.md`

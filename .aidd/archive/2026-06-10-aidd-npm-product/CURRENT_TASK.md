---
title: CURRENT_TASK.md
description: Active task working memory.
type: working
scope: task-active
phase: 12
status: done
task_type: Feature
complexity: COMPLEXA
iteration: null
tracker_id: null
slug: aidd-npm-product
globs: [".aidd/current/CURRENT_TASK.md"]
alwaysApply: false
tags: [aidd, working, task]
related: [AIDD.md, .aidd/current/FILES_READ.md, .aidd/current/FILES_CHANGED.md, .aidd/current/VERIFICATION_REPORT.md]
---

# CURRENT_TASK.md

Working memory for the active task.

## Original request

> "Na verdade isso deveria ser um produto, um produto que pode ser utilizado em qualquer projeto. A minha intenção é estabelecer um fluxo de AIDD para coordenar os projetos através de etapas estabelecidas. [...] como que nós podemos através de um npm, por exemplo, fazer com que ele possa ser instalado localmente nos projetos. [...] Via NPM, verifique se é possível incluir no npm que já existe do pipeline orchestrator. Tipo ao instalar dar ao usuário a possibilidade de escolher o que ele quer instalar, que no caso será pipeline orchestrator e AIDD."

## Problem

O harness AIDD hoje é um template de copiar/clonar: sem instalação por comando, sem caminho de atualização (cópias congelam em cada projeto), sem registro de versão instalada, e com `private: true` no package.json (não publicável). O ecossistema FX Studio AI já tem um instalador unificado (`@fx-studio-ai/pipeline-orchestrator-install`, v0.1.0, roteador fino Claude Code/OpenCode) que ainda não oferece o AIDD como produto e não está publicado no registro público do npm.

## Goal

Transformar o harness AIDD em produto npm instalável (`@fx-studio-ai/aidd`) com CLI `init`/`update`/`doctor`, modelo híbrido (código referenciado de node_modules + docs copiados com manifesto de versão), e estender o instalador unificado com menu de produtos (Pipeline Orchestrator, AIDD ou ambos).

## Decisões já tomadas pelo usuário (gates desta conversa)

1. Distribuição via npm — modelo híbrido (código referenciado, docs copiados, manifesto de versão). [2026-06-10]
2. Pacote próprio `@fx-studio-ai/aidd` separado do pacote do orchestrator + menu de produtos no instalador unificado existente. [2026-06-10]

## Scope

(a preencher após context discovery — rascunho preliminar:)
- Reestruturar este repositório como pacote npm publicável: `bin/` (CLI), código dos hooks referenciável, `templates/` (docs e configs copiados no init).
- CLI: `init` (scaffold + merge de `.claude/settings.json`), `update` (manifesto de versão + hash, não tocar arquivos editados), `doctor` (verificação de wiring).
- Manifesto `.aidd/harness.json` no projeto consumidor (versão + hashes).
- Integração: nova rota "aidd" no instalador unificado (repo separado: `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator-Install`).

## Out of scope

(a preencher após context discovery — rascunho preliminar:)
- Publicação efetiva no registro npm (decisão/credenciais do usuário; plano documenta o passo).
- Mudanças no pacote `@fx-studio-ai/pipeline-orchestrator` em si.
- Suporte a runtimes além de Claude Code e Codex/OpenCode.

## Open questions / gaps

- Nenhum pacote FX Studio AI está no registro público do npm (404). Publicação foi privada ou pendente? Definir registro alvo.
- Nome final do pacote: `@fx-studio-ai/aidd` vs `@fx-studio-ai/aidd-harness`.
- O instalador unificado vive em outro repositório — como versionar/commitar a mudança lá (tarefa irmã ou mesmo PR-plano)?
- Hooks referenciados de `node_modules` exigem `npm install` no consumidor — fallback quando node_modules ausente?
- Codex/AGENTS.md: hooks não rodam no Codex; o que o init instala num projeto só-Codex?

## Identified requirements

(a preencher na fase 5 — requirements)

## Acceptance criteria

(a preencher na fase 5 — requirements)

## Files I plan to change

(a preencher após design)

## Status

Current: `done` — produto publicado no registro público do npm e verificado de ponta a ponta a partir do registro (install → init → doctor 0/0). Pendência do usuário: revogar o token granular usado na publicação (transitou pelo chat).

## Log

- *2026-06-10* — Tarefa iniciada via `/aidd-intake`. Tipo: Feature. Complexidade: COMPLEXA. Iteração: null (sem roadmap/ no repositório). Análise prévia da sessão: formato atual avaliado, ecossistema do orchestrator mapeado (plugin marketplace FX-Studio-AI v7.10.1 + instalador unificado v0.1.0 não publicado), arquitetura aprovada pelo usuário (pacote próprio + menu no instalador).
- *2026-06-10* — Usuário dispensou o ritual completo do método para ESTE repo (é a fábrica do produto, não um consumidor). Implementação direta autorizada.
- *2026-06-10* — Implementado: package.json publicável v2.0.0 + LICENSE; CLI completo (bin/aidd.cjs + lib/cli/: files-map, manifest, settings, bootloader, init, update, doctor); patch no secrets-guard (catálogo por projeto); 19 testes novos; README/INSTALL atualizados.
- *2026-06-10* — E2E real: npm pack → install em projeto temporário → init → doctor 0/0 → update idempotente → guardas funcionando de node_modules (allow/deny corretos).
- *2026-06-10* — Repo do instalador (fora desta raiz, escrita via terminal por bloqueio correto do phase-guard): menu de produtos (PO/AIDD/ambos), flag --product, rota aidd, requires como array, testes estendidos, v0.2.0 + CHANGELOG + README. Suite verde.
- *2026-06-10* — Commits nos dois repos (incl. fix do files[] que excluiu settings.local.json/scheduled_tasks.lock do tarball — vazamento de arquivos locais pego antes da publicação; e npm pkg fix nos dois bin paths).
- *2026-06-10* — Saga da publicação: login clássico não publica mais (política npm pós-ataques de supply chain; servidor retorna 403 duro antes do desafio OTP em ambiente sem TTY). Resolvido com granular access token fornecido pelo usuário, usado via NPM_CONFIG_USERCONFIG temporário e apagado em seguida. Publicados: @fx-studio-ai/aidd@2.0.0 e @fx-studio-ai/pipeline-orchestrator-install@0.2.0.
- *2026-06-10* — Verificação final a partir do REGISTRO PÚBLICO: npm i -D + npx aidd init + npx aidd doctor = 0 errors / 0 warnings em projeto limpo. Tarefa concluída. AÇÃO PENDENTE DO USUÁRIO: revogar o token granular.

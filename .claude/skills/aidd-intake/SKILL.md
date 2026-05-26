---
name: aidd-intake
description: Inicializa uma nova tarefa AIDD. Detecta se há tarefa em estado done/done-local empilhada em CURRENT_TASK.md, oferece archivar em .aidd/archive/, gera CURRENT_TASK.md fresh do template (com campo phase=1 e iteration no frontmatter), pede goal e tipo via AskUserQuestion, popula scope/out-of-scope/ACs vazios, registra a tarefa na iteração ativa do roadmap (opcional, se houver roadmap/), e sugere a próxima fase. Use no início de TODA tarefa AIDD nova — esta é a porta de entrada do ciclo.
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash(mv:*), Bash(date:*), Bash(ls:*)
---

# /aidd-intake — Phase 1 (Intake) do ciclo AIDD

Você é o agente de **kickoff** de tarefas AIDD. Função: garantir que toda nova tarefa começa com `.aidd/current/CURRENT_TASK.md` limpo, com goal explícito, tipo classificado e `phase: 1` no frontmatter.

## Passos obrigatórios (em ordem)

### Passo 1 — Detectar estado atual

Leia `.aidd/current/CURRENT_TASK.md`. Identifique:

- Se existe ou não.
- Quantas seções `## Tarefa atual:` ou `## Original request` existem (sinal de empilhamento).
- O `status:` da tarefa mais recente (`done`, `done-local`, `installed-not-live-dispatch`, `implementing`, etc.).

### Passo 2 — Decidir destino

Use AskUserQuestion (header: "Tarefa anterior", 3 opções):

- **Archivar e começar fresh (Recomendado se status==done)** — move conteúdo atual para `.aidd/archive/<YYYY-MM-DD>-<slug>.md`, recria CURRENT_TASK.md vazio.
- **Anexar nova seção (Recomendado se status==active e tarefa anterior é PR pendente)** — adiciona `---` + nova seção sem mover histórico.
- **Cancelar** — não muda nada, sai.

### Passo 3 — Pedir goal e tipo

Via AskUserQuestion sequencial:

3a. **Goal** (1 pergunta com opção "Other" para texto livre): escolher tipo predefinido ou descrever.

3b. **Tipo** (header: "Tipo", 4 opções):
- Bug Fix
- Feature
- Refactor / Tech debt
- Audit / Análise sem código

3c. **Complexidade** (header: "Complex", 3 opções):
- SIMPLES (1-2h, mudança local)
- MEDIA (1 dia, escopo bounded)
- COMPLEXA (>1 dia, multi-fase, exige todos os 5 gates)

### Passo 3.5 — Detectar iteração ativa do roadmap (methodology-aware)

Antes de popular CURRENT_TASK.md:

**3.5.a — Carregar config da metodologia:**

Ler `roadmap/METHODOLOGY.md` (Read tool, frontmatter YAML — bloco delimitado por `---` no início). Extrair:
- `unit_dir` (default se ausente: `iterations`)
- `methodology` (informativo)

Se `METHODOLOGY.md` ausente: usar default `aidd-vanilla` (`unit_dir: iterations`).

**3.5.b — Ler iteração ativa:**

Ler `roadmap/STATUS.md` (Read tool) e extrair `current_iteration` do frontmatter. Esse campo entra em `CURRENT_TASK.iteration` para amarrar a tarefa à iteração.

Se `roadmap/STATUS.md` não existir OU `current_iteration` for `null`: deixar `iteration: null` na frontmatter da CURRENT_TASK e PULAR Passo 4.5. Avisar no Passo 5 final que a tarefa não foi registrada em nenhuma iteração.

**3.5.c — Verificar pastas ativas (apenas se vai perguntar):**

Listar pastas em `roadmap/<unit_dir>/active/` (com `unit_dir` do 3.5.a). Se a lista estiver vazia E `current_iteration` for `null`: pular a pergunta opcional abaixo.

**3.5.d — Pergunta opcional via AskUserQuestion** (apenas se há ≥2 pastas em active/ e o usuário pode querer escopar a tarefa para uma iteração futura):

```
Header: "Iteração"
Pergunta: "Esta tarefa pertence à iteração ativa <current_iteration> ou a outra?"
Opções:
- Iteração ativa <current_iteration> (Recomendado)
- Iteração futura: <listar slugs das pastas em roadmap/<unit_dir>/active/ ordenadas por iteration_number, exceto a atual>
- Sem iteração definida (raro — tarefa cross-iteração ou interna)
```

A escolha do usuário define `iteration` na frontmatter de CURRENT_TASK.md. **Persistir tanto `iteration` quanto `unit_dir` na sessão** — Passo 4.5 vai usar ambos.

### Passo 4 — Popular template

Escreva (Write tool) em CURRENT_TASK.md (ou append se opção foi "anexar"):

```markdown
---
title: CURRENT_TASK.md
description: Active task working memory.
type: working
scope: task-active
phase: 1
status: intake
task_type: <tipo do passo 3b>
complexity: <do passo 3c>
iteration: <current_iteration do passo 3.5, ou null>
tracker_id: <ID do rastreador externo (ex PROJ-N) se houver, senão null>
slug: <slug derivado do goal, normalizado via NFD>
globs: [".aidd/current/CURRENT_TASK.md"]
alwaysApply: false
tags: [aidd, working, task]
related: [AIDD.md, .aidd/current/FILES_READ.md, .aidd/current/FILES_CHANGED.md, .aidd/current/VERIFICATION_REPORT.md]
---

# CURRENT_TASK.md

Working memory for the active task.

## Original request

> "<goal do passo 3a>"

## Problem

(a preencher na fase 2 — context discovery)

## Goal

<formular em 1 frase do goal do passo 3a>

## Scope

(a preencher após context discovery)

## Out of scope

(a preencher após context discovery)

## Open questions / gaps

- <listar lacunas detectadas no goal, se houver>

## Identified requirements

(a preencher na fase 5 — requirements)

## Acceptance criteria

(a preencher na fase 5 — requirements)

## Files I plan to change

(a preencher após design)

## Status

Current: `intake` — phase 1 iniciada.

## Log

- *<data>* — Tarefa iniciada via `/aidd-intake`. Tipo: <tipo>. Complexidade: <complexidade>.
```

Se opção foi "Archivar e começar fresh", **antes de zerar** os 3 arquivos (FILES_READ.md, FILES_CHANGED.md, VERIFICATION_REPORT.md), copie o conteúdo atual para `.aidd/archive/<YYYY-MM-DD>-<slug>-files-read.md`, `-files-changed.md`, `-verification-report.md`. Só após archive bem-sucedido, zere o conteúdo (mantendo frontmatter) dos originais. Cite os paths de archive no Log.

### Passo 4.5 — Registrar a tarefa em `02-tasks.md` da iteração (methodology-aware)

Se `iteration` for `null` (Passo 3.5.b decidiu pular): **NÃO executar este passo**. Avisar no Passo 5 final.

Caso contrário, montar o path **usando `unit_dir` carregado no Passo 3.5.a** (NÃO usar string literal `roadmap/iterations/`):

```
TARGET = "roadmap/<unit_dir>/active/<iteration>/02-tasks.md"
```

Validar que o arquivo existe. Se não: PARE e reporte ao usuário (estado inconsistente — `iteration` aponta para pasta sem `02-tasks.md`).

**Determinar identificador (regra inequívoca):**
- Se `tracker_id` ≠ null e ≠ `"null"`: usar `tracker_id` (ex: `PROJ-9`).
- Senão: usar `slug` (do Passo 4 frontmatter).

**Anti-duplicação:** antes de adicionar, grep por `**<identificador>**` no arquivo. Se já existir como `[ ]`: atualizar título e timestamp da linha existente. Se já existir como `[x]`: PARE com WARN (tentativa de re-abrir tarefa fechada — usuário decide).

**Adicionar linha na seção `## Em ordem de execução`:**

```markdown
- [ ] **<identificador>** — <título curto da tarefa> — ⏳ adicionada via /aidd-intake em <YYYY-MM-DD>
  - <1-2 linhas resumindo Goal>
  - Como começar: ler `.aidd/current/CURRENT_TASK.md`
```

**Por que `unit_dir` e não path hardcoded:** se a metodologia adotada for `gsd-phases`, `unit_dir` vira `.planning/phases/` — registrar em `roadmap/iterations/...` quebraria o sync com `/aidd-close` que também usa `unit_dir` da METHODOLOGY.

### Passo 5 — Sugerir próxima ação

Imprima:

```
┌─ AIDD INTAKE COMPLETO ───────────────────────────────────┐
│ Tarefa: <slug>                                           │
│ Tipo: <tipo>  Complexidade: <complexidade>               │
│ Phase atual: 1 (intake)                                  │
│ Iteração: <current_iteration ou "(sem iteração)">        │
│ Registrada em: roadmap/.../02-tasks.md ou "(skipped)"    │
│                                                           │
│ Próxima fase: 2 (context discovery)                      │
│ Próxima ação: leia CONTEXT_INDEX.md trigger table       │
│ para sua tarefa. Ou invoque /aidd para confirmar.       │
└──────────────────────────────────────────────────────────┘
```

## Stop Rules aplicáveis

- **Non-inventive**: NUNCA preencha goal/scope com sua suposição. Pergunte.
- **Two-attempt**: se Write em CURRENT_TASK.md falhar 2x, pare e explique.
- **Phase-guard hook** vai validar que tarefas começam corretamente; respeite suas mensagens.

## O que NÃO fazer

- Não pule diretamente para implementação.
- Não invente ACs ou requisitos.
- Não execute `/aidd-impl-start` ou `/pipeline-orchestrator:pipeline` automaticamente — usuário decide quando chegar a fase 9.

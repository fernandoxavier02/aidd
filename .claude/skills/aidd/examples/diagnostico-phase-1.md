# Exemplo de Diagnostico — Phase 1 (Intake)

Exemplo realista de saida da skill `/aidd` quando a tarefa atual esta na fase de recepcao. O exemplo usa uma feature neutra (export de dados em CSV) — adapte ao seu projeto.

---

## Entrada (CURRENT_TASK.md)

```yaml
---
title: CURRENT_TASK.md
description: Active task working memory.
type: working
scope: task-active
phase: 1
status: intake
task_type: Feature
complexity: MEDIA
slug: export-csv
globs: [".aidd/current/CURRENT_TASK.md"]
alwaysApply: false
tags: [aidd, working, task]
---

# CURRENT_TASK.md

## Original request

> "Quero um endpoint que exporte a lista de pedidos em CSV."

## Problem

Hoje so existe a listagem em tela; nao da para extrair os dados para análise externa.

## Goal

Adicionar um endpoint que devolve os pedidos em formato CSV.

## Scope

(a preencher após context discovery)

## Out of scope

Filtros avançados, agendamento de exportação.

## Status

Current: `intake` — phase 1 iniciada.

## Log

- 2026-01-10 — Tarefa iniciada via `/aidd-intake`. Tipo: Feature. Complexidade: MEDIA.
```

---

## Saida do /aidd

```
┌─ AIDD — Estado atual ─────────────────────────────────────┐
│ Tarefa: export-csv                                       │
│ Phase: 1 (intake)                                        │
│ Status: intake                                            │
│                                                           │
│ Próxima ação: Ler CONTEXT_INDEX.md trigger table         │
│ para sua tarefa (Feature = Lane B).                      │
│ Skill recomendada: Manual (context discovery)            │
│                                                           │
│ Observação: Scope e ACs ainda vazios.                   │
│ Serão preenchidos nas fases 2-5.                        │
└────────────────────────────────────────────────────────────┘

Guia completo do ciclo AIDD: AIDD-RUNBOOK.md
Comandos da Camada 1: /aidd-intake, /aidd-impl-start, /aidd-close
Hooks ativos: ver .claude/settings.json
```

---

## Interpretacao

A tarefa acabou de comecar. O usuario fez o pedido (intake), a IA classificou como Feature de complexidade MEDIA. O proximo passo e a fase 2 (context discovery), onde a IA le os documentos necessarios para entender o que ja existe. Nenhuma skill especifica e recomendada nesta fase — o trabalho e manual.

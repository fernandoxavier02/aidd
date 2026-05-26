# Exemplo de Diagnostico — Phase 9 (Implementation)

Exemplo realista de saida da skill `/aidd` quando a tarefa esta em implementacao. Feature neutra (export de dados em CSV) — adapte ao seu projeto.

---

## Entrada (CURRENT_TASK.md)

```yaml
---
title: CURRENT_TASK.md
description: Active task working memory.
type: working
scope: task-active
phase: 9
status: implementing
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

## Goal

Adicionar um endpoint que devolve os pedidos em formato CSV.

## Scope

Rota GET /orders/export, serializador CSV, cabeçalho Content-Type correto.

## Out of scope

Filtros avançados, agendamento de exportação.

## Acceptance criteria

- [x] Rota responde 200 com Content-Type text/csv
- [x] Cabeçalho do CSV lista as colunas
- [ ] Linhas refletem os pedidos do usuário autenticado
- [ ] Caso sem pedidos retorna CSV só com cabeçalho
- [ ] Testes cobrem todos os cenarios dos requisitos

## Status

Current: `implementing` — phase 9 em andamento. Tarefa 2 de 4.

## Log

- 2026-01-10 — /aidd-intake. Tipo: Feature. Complexidade: MEDIA.
- 2026-01-10 — Phase 5: requirements.md aprovado (gate #1).
- 2026-01-10 — Phase 7: design.md aprovado (gate #2).
- 2026-01-10 — Phase 8: tasks.md aprovado (gate #3).
- 2026-01-10 — /aidd-impl-start invocado. TDD-guard armado. Phase=9.
- 2026-01-10 — T1 completa (rota + Content-Type). Testes passando.
- 2026-01-11 — T2 em andamento (serializador de linhas).
```

---

## Saida do /aidd

```
┌─ AIDD — Estado atual ─────────────────────────────────────┐
│ Tarefa: export-csv                                       │
│ Phase: 9 (Implementation)                                │
│ Status: implementing                                      │
│                                                           │
│ Progresso: Tarefa 2 de 4 em andamento                   │
│ ACs: 2 de 5 concluidos                                   │
│                                                           │
│ Próxima ação: Continuar T2 (serializador de linhas)     │
│   1. Abrir tasks.md, verificar T2                       │
│   2. Escrever/ajustar TESTE primeiro (*.test.*)         │
│   3. Implementar codigo minimo (GREEN)                  │
│   4. Rodar testes                                        │
│                                                           │
│ TDD-guard: enabled                                        │
│ Heartbeat: ativo (ultimo teste: 12 min atras)           │
│                                                           │
│ Skill recomendada: /aidd-impl-start (ja armado)         │
│ Ou: seguir manualmente com TDD red→green→refactor       │
└────────────────────────────────────────────────────────────┘

Guia completo do ciclo AIDD: AIDD-RUNBOOK.md
Comandos da Camada 1: /aidd-intake, /aidd-impl-start, /aidd-close
Hooks ativos: ver .claude/settings.json
```

---

## Interpretacao

A tarefa esta na metade da implementacao. T1 (rota) esta pronta, T2 (serializador) em andamento. O TDD-guard esta ativo, entao a IA deve continuar escrevendo testes antes de codigo. A saida mostra o progresso e da instrucoes claras do proximo passo.

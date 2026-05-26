# Phase Guide — Ciclo AIDD de 12 Fases

> Referencia rapida para diagnostico e roteamento. Carregue quando a skill `/aidd` precisar de detalhes sobre uma phase especifica.

---

## Visao Geral

| # | Phase | Nome em Portugues | Proposito | Skill Recomendada |
|---|---|---|---|---|
| 1 | Intake | Recepcao | Capturar o pedido em linguagem natural | `/aidd-intake` |
| 2 | Context Discovery | Descoberta de Contexto | Ler apenas documentos necessarios | Manual |
| 3 | Domain Understanding | Entendimento do Dominio | Confirmar vocabulario e bounded contexts | Manual |
| 4 | Process Mapping | Mapeamento de Processo | Tracar fluxo usuario-sistema | Manual |
| 5 | Requirements | Requisitos | Escrever BDD/Gherkin | `/kiro:spec-requirements` |
| 6 | Spec Validate | Validacao da Especificacao | Rejeitar specs sem cenarios testaveis | `/kiro:validate-spec` |
| 7 | Design | Arquitetura e Design | Decidir camadas, arquivos, contratos | `/kiro:spec-design` |
| 8 | Tasks | Tarefas | Quebrar design em passos ordenados | `/kiro:spec-tasks` |
| 9 | Implementation | Implementacao | Programar TDD red→green→refactor | `/aidd-impl-start` |
| 10 | Verification | Verificacao | Confirmar que cada AC tem teste verde | `/gsd-verifier` |
| 11 | Review | Revisao | Code review + adversarial review | `/pipeline-orchestrator:pipeline review-only` |
| 12 | Doc & Learning | Documentacao e Aprendizado | Atualizar docs e arquivar | `/aidd-close` |

---

## Detalhes por Phase

### Phase 1 — Intake

**Artefato principal:** `.aidd/current/CURRENT_TASK.md`

**O que acontece:**
- Usuario descreve o problema/ideia.
- IA classifica tipo (Bug, Feature, Refactor, Audit) e complexidade (SIMPLES, MEDIA, COMPLEXA).
- IA popula CURRENT_TASK.md com goal, scope, out-of-scope vazios (a preencher nas proximas phases).

**Gate humano:** Nenhum. Apenas o pedido.

**Proxima acao:** Phase 2 — leitura seletiva via CONTEXT_INDEX.md.

**Sinais de que esta pronta:** CURRENT_TASK.md tem `phase: 1`, `status: intake`, e campos goal/task_type preenchidos.

---

### Phase 2 — Context Discovery

**Artefato principal:** `.aidd/current/FILES_READ.md`

**O que acontece:**
- IA le apenas os documentos que CONTEXT_INDEX.md indica para o tipo de tarefa.
- IA anota motivo da leitura e conclusao em FILES_READ.md.

**Gate humano:** Nenhum.

**Proxima acao:** Phase 3 — confirmar vocabulario.

**Sinais de que esta pronta:** FILES_READ.md tem pelo menos uma entrada com motivo e conclusao.

---

### Phase 3 — Domain Understanding

**Artefato principal:** Notas em CURRENT_TASK.md ou atualizacao em `.kiro/steering/product.md`

**O que acontece:**
- IA confirma que palavras do pedido batem com o glossario (ubiquitous language).
- Se houver termo novo, propoe adicao ao steering/product.md.

**Gate humano:** Se novo termo for proposto, usuario decide se aceita.

**Proxima acao:** Phase 4 — mapear fluxo.

**Sinais de que esta pronta:** Nenhuma ambiguidade de vocabulario pendente.

---

### Phase 4 — Process Mapping

**Artefato principal:** Diagrama (Mermaid) inline na spec ou nota ad-hoc.

**O que acontece:**
- IA desenha fluxo passo a passo: usuario faz X, sistema responde Y.

**Gate humano:** Nenhum formal, mas usuario pode corrigir fluxo.

**Proxima acao:** Phase 5 — escrever requisitos.

**Sinais de que esta pronta:** Fluxo end-to-end desenhado e coerente.

---

### Phase 5 — Requirements

**Artefato principal:** `.kiro/specs/<feat>/requirements.md`

**O que acontece:**
- IA escreve requisitos em formato BDD (Dado/Quando/Entao).
- Cada cenario mapeia para um teste de aceitacao futuro.

**Gate humano #1:** Usuario aprova requirements.md antes de virar design.

**Proxima acao:** Phase 6 — validar especificacao.

**Sinais de que esta pronta:** Requisitos aprovados pelo humano.

---

### Phase 6 — Spec Validate

**Artefato principal:** Pass/fail do validador externo.

**O que acontece:**
- Validador automatico rejeita specs sem cenarios testaveis ou com linguagem vaga.

**Gate humano:** Nenhum (gate automatico).

**Proxima acao:** Phase 7 — arquitetura.

**Sinais de que esta pronta:** Validador aprova (pass).

---

### Phase 7 — Design

**Artefato principal:** `.kiro/specs/<feat>/design.md` + ADRs novos.

**O que acontece:**
- IA desenha solucao tecnica (camadas, arquivos, contratos).
- Decisoes significativas viram ADRs em `docs/adr/`.

**Gate humano #2:** Usuario aprova design.md antes de virar tarefas.

**Proxima acao:** Phase 8 — quebrar em tarefas.

**Sinais de que esta pronta:** Design aprovado e ADRs criados (se necessario).

---

### Phase 8 — Tasks

**Artefato principal:** `.kiro/specs/<feat>/tasks.md`

**O que acontece:**
- IA quebra design em tarefas ordenadas, com dependencias e criterios de sucesso.

**Gate humano #3:** Usuario aprova tasks.md antes da implementacao.

**Proxima acao:** Phase 9 — programar.

**Sinais de que esta pronta:** Tasks aprovadas e gate #3 documentado no Log.

---

### Phase 9 — Implementation

**Artefato principal:** Codigo + testes + `.aidd/current/FILES_CHANGED.md`.

**O que acontece:**
- IA programa seguindo TDD: teste (RED) → codigo minimo (GREEN) → refatora.
- TDD-guard ativo (bloqueia edits em producao sem teste).

**Gate humano:** Nenhum durante a execucao.

**Proxima acao:** Phase 10 — verificar.

**Sinais de que esta pronta:** Todas as tarefas concluidas e testes passando.

---

### Phase 10 — Verification

**Artefato principal:** `.aidd/current/VERIFICATION_REPORT.md`

**O que acontece:**
- IA verifica se cada cenario de requisito tem teste verde.
- Verificacao goal-backward: do requisito ao teste, nao do teste ao requisito.

**Gate humano:** Nenhum formal, mas relatorio deve estar verde.

**Proxima acao:** Phase 11 — revisar.

**Sinais de que esta pronta:** Todos os ACs verificados e VERIFICATION_REPORT.md atualizado.

---

### Phase 11 — Review

**Artefato principal:** `REVIEW.md`

**O que acontece:**
- Revisao de codigo normal (qualidade, padroes).
- Revisao adversarial (seguranca, edge cases, falhas de logica).

**Gate humano #4:** Usuario resolve achados criticos (aceita fix ou rejeita).

**Proxima acao:** Phase 12 — documentar.

**Sinais de que esta pronta:** Achados criticos resolvidos ou justificados.

---

### Phase 12 — Doc & Learning

**Artefato principal:** Documentos atualizados + arquivo em `.aidd/archive/`.

**O que acontece:**
- IA atualiza PROJECT_BRIEF.md, steering, ADR cross-refs.
- Arquiva os 4 arquivos de `.aidd/current/` em `.aidd/archive/`.

**Gate humano #5:** Usuario autoriza merge.

**Proxima acao:** Nova tarefa via `/aidd-intake`.

**Sinais de que esta pronta:** CURRENT_TASK.md arquivado e pasta `current/` limpa.

---

## Tabela de Transicao Rapida

```
Phase atual → Proxima skill
1  (intake)              → /aidd-intake (se ainda nao fez) ou manual
2-4 (context/domain)     → manual, depois /kiro:spec-requirements
5  (requirements)        → /kiro:spec-requirements
6  (spec-validate)       → /kiro:validate-spec
7  (design)              → /kiro:spec-design
8  (tasks)               → /kiro:spec-tasks
9  (implementation)      → /aidd-impl-start
10 (verification)        → /gsd-verifier ou manual
11 (review)              → /pipeline-orchestrator:pipeline review-only
12 (doc)                 → /aidd-close
```

---

*Este arquivo e referencia da skill `/aidd`. Mantenha atualizado quando novas fases ou skills forem adicionadas ao ecossistema.*

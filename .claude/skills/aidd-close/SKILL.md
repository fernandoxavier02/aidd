---
name: aidd-close
description: Fecha tarefa AIDD na Phase 12. Verifica que ACs estão [x], REVIEW.md (se existir) sem críticos, atualiza CURRENT_TASK.md status=done + phase=12, desabilita TDD-guard, oferece archivar em .aidd/archive/<data>-<slug>.md, propõe atualizar PROJECT_BRIEF.md se stack/módulos mudaram, atualiza roadmap/STATUS.md + cria entry em roadmap/iterations/<active>/completed-tasks/<NNN>-<slug>.md, marca [x] na lista de tarefas da iteração, oferece arquivar a iteração se for a última tarefa, e propõe commit. Use APÓS gate humano #5 (autorização de merge) ou APÓS implementação local concluída sem PR pendente.
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash(mv:*), Bash(git status:*), Bash(git diff:*), Bash(date:*)
---

# /aidd-close — Phase 12 (Documentation & learning) + archive

Você é o agente que **fecha** uma tarefa AIDD. Sua função é garantir que o ciclo termina com tudo arquivado, brief atualizado e CURRENT_TASK pronto pra próxima `/aidd-intake`.

## Pré-condições obrigatórias

1. `.aidd/current/CURRENT_TASK.md` tem tarefa ativa (phase 9-11 esperado, mas aceita 12 também).
2. Todos os Acceptance Criteria da tarefa ativa estão `[x]` ou justificados.
3. Se `.aidd/current/REVIEW.md` existe, não tem críticos pendentes (ou todos têm aceite documentado).

Se qualquer pré-condição falhar: **PARE** e mostre o que falta. Sugira `/aidd` para diagnóstico ou correção manual.

## Passos obrigatórios

### Passo 1.5 — Ler CONFIDENCE.yaml e avaliar verdict (v2 — NFR-4 backward compat)

Antes da auditoria de ACs, verificar se `.aidd/current/CONFIDENCE.yaml` existe:

**Se NAO existe:** log "legacy task — CONFIDENCE.yaml ausente, prosseguindo em modo v1" e continuar nos passos seguintes sem bloqueio. (NFR-4: backward compat com tarefas pre-AIDD-v2.)

**Se existe:** ler o arquivo e:

1. Calcular verdict usando o helper:
   ```bash
   node -e "
   const conf = require('.claude/hooks/lib/aidd-confidence.cjs');
   const jsyaml = require('js-yaml');
   const fs = require('fs');
   const doc = jsyaml.load(fs.readFileSync('.aidd/current/CONFIDENCE.yaml', 'utf-8'));
   const result = conf.computeFinalScore(doc);
   console.log(JSON.stringify(result));
   "
   ```

2. Mostrar dimensoes + verdict em bloco visual:

   ```
   ┌─ CONFIDENCE SCORE ──────────────────────────────────────────┐
   │ spec_clarity:          <valor>                               │
   │ design_coverage:       <valor>                               │
   │ tdd_adherence:         <valor>                               │
   │ adversarial_clean_rate:<valor>                               │
   │ regression_health:     <valor>                               │
   │ cross_batch_emergent:  <valor>                               │
   │                                                              │
   │ gate_penalty: <valor>  (cap 0.30)                            │
   │ weighted:     <valor>                                        │
   │ final_score:  <valor>                                        │
   │ VERDICT: <PASS | WARN | FAIL>                                │
   └─────────────────────────────────────────────────────────────┘
   ```

### Passo 1.6 — Gate de closure por verdict FAIL (v2)

**Apenas se CONFIDENCE.yaml existe E verdict == "FAIL":**

Verificar se a variavel de ambiente `AIDD_CLOSE_OVERRIDE` esta definida com ao menos 20 caracteres de justificativa:

```bash
node -e "const v = process.env.AIDD_CLOSE_OVERRIDE || ''; console.log(v.length >= 20 ? 'OVERRIDE_OK' : 'OVERRIDE_MISSING');"
```

- **Se OVERRIDE_MISSING:** **DENY closure**. Imprimir:
  ```
  CLOSURE DENIED — CONFIDENCE verdict = FAIL (final_score < 0.40)
  Para forcar o fechamento, defina:
    AIDD_CLOSE_OVERRIDE="<justificativa com >= 20 chars>"
  Recomendado: corrigir as dimensoes com score baixo antes de fechar.
  ```
  E PARAR (nao continuar nos passos seguintes).

- **Se OVERRIDE_OK:** log o override em `.aidd/telemetry/close-overrides.jsonl` (append JSON: `{task, verdict, final_score, override_reason: AIDD_CLOSE_OVERRIDE, ts}`) e continuar o fechamento com WARN visivel no Passo 11.

### Passo 1 — Auditoria final

Leia CURRENT_TASK.md. Verifique:

- ACs em `## Acceptance criteria`: todos `[x]`?
- `## Status` da tarefa ativa diz `done`, `done-local`, ou similar?
- `VERIFICATION_REPORT.md` tem entrada final tipo "smoke test passou" ou "pipeline complete"?

Se algo estiver pendente, listar e perguntar via AskUserQuestion (header: "Pendências", opções):
- Continuar mesmo assim (justifica em log)
- Pausar — preciso resolver antes
- Cancelar

### Passo 2 — Decidir destino do CURRENT_TASK

Via AskUserQuestion (header: "Archive", 3 opções):

- **Archivar agora (Recomendado se PR já foi mergeado)** — move conteúdo para `.aidd/archive/<YYYY-MM-DD>-<slug>.md`, gera CURRENT_TASK.md template vazio.
- **Manter empilhado por ora** — só atualiza status para `done`; deixa empilhado para archivar junto com próxima tarefa.
- **Cancelar fechamento**

### Passo 3 — Atualizar phase + status

Edite frontmatter de CURRENT_TASK.md:
- `phase: 12`
- `status: done`

### Passo 4 — Desabilitar TDD-guard

Se `.claude/aidd-tdd-config.json` está `enabled: true`, mude para `enabled: false`. Mantenha comentário.

### Passo 5 — Limpar heartbeat

Remova `.aidd/.tdd-heartbeat.json` se existir. Mais limpo do que deixar stale.

### Passo 6 — Verificar se PROJECT_BRIEF precisa atualizar

Compare a tarefa fechada contra `PROJECT_BRIEF.md`:

- Stack mudou? (nova tecnologia adotada via ADR)
- Módulos novos? (ex: um novo módulo em `apps/` ou `services/`)
- Comandos de build/test/lint definidos? (campos hoje TBD)

Se sim, perguntar via AskUserQuestion:
- **Atualizar PROJECT_BRIEF agora** (Recomendado se mudança não-trivial)
- **Adiar para próximo PR** (registra TODO)

PROJECT_BRIEF.md NÃO está protegido pelo contract-guard, então edits são permitidos.

### Passo 7 — Verificar se .kiro/steering precisa atualizar

Se ubiquitous language mudou ou estrutura nova foi adicionada, perguntar se quer atualizar `.kiro/steering/{product,structure,tech}.md`.

ATENÇÃO: `.kiro/steering/*.md` ESTÁ protegido pelo contract-guard por design — alterar steering exige um **novo ADR** documentando a mudança de vocabulário/arquitetura. **Não instrua o usuário a desabilitar o hook**. Se a mudança for legítima, abra um novo ADR em `docs/adr/00NN-update-steering-X.md` (Write em ADR novo é permitido pelo contract-guard) e o ADR justifica a edição posterior do steering pelo usuário num PR formal — o agente não bypassa.

### Passo 8 — Capturar lições

Se a tarefa teve surpresas, falhas, ou achados, perguntar se quer adicionar entrada em `docs/findings.md` (quando ele existir — PR-1 da auditoria). Se não existe ainda, sugerir criar agora ou adiar.

### Passo 9 — Atualizar `roadmap/` (estrutura por iterações)

A pasta `roadmap/` é o snapshot vivo do projeto, organizada por iterações (sprints/phases/cycles — termo definido em `roadmap/METHODOLOGY.md`). Atualizá-la a cada fechamento mantém ela honesta. **Nunca edite um arquivo monolítico que cresce sem fim — sempre crie arquivo novo em `completed-tasks/`**.

**9.0 — Load methodology config:**

Leia `roadmap/METHODOLOGY.md` (Read tool). Extraia o **frontmatter YAML** (bloco delimitado por `---` no INÍCIO do arquivo, NÃO um fence ```yaml```). Os campos relevantes:
- `methodology` (string)
- `unit_dir` (default se ausente: `iterations`)
- `iteration_pattern` (default: `NN-slug`)
- `per_iteration_files` (default: `[00-overview.md, 01-decisions.md, 02-tasks.md, completed-tasks/]`)
- `archive_marker` (default: `99-retrospective.md`)

**Validar:** se a pasta `roadmap/<unit_dir>/active/<current_iteration>/` (lendo `current_iteration` de `STATUS.md` no Passo 9.1) NÃO existir, **PARE e reporte ao usuário** — estado inconsistente entre STATUS.md e estrutura. Não invente o path; o usuário precisa decidir se cria a pasta ou corrige `STATUS.md`.

Se o arquivo `METHODOLOGY.md` não existir ou estiver malformado, use o default `aidd-vanilla` (valores acima). Avise o usuário no Passo 11 final signal.

**9.1 — Atualizar `roadmap/STATUS.md` (AUTOMÁTICO, sem perguntar):**

Editar diretamente:
- Frontmatter `last_updated` → data de hoje (`Bash: date +%Y-%m-%d`)
- Frontmatter `last_updated_by` → `"aidd-close (Passo 9)"`
- Frontmatter `last_task_closed` → slug da tarefa que acabou de fechar
- Frontmatter `current_iteration` → permanece igual a menos que Passo 9.6 dispare arquivamento
- Seção `## 🟢 Tarefa ativa agora`:
  - Se Passo 2 escolheu **archivar**: aponta para `CURRENT_TASK.md → vazio` e atualiza "Última tarefa fechada" com link para o archive recém-criado E para o novo arquivo em `completed-tasks/`.
  - Se Passo 2 escolheu **manter empilhado**: marca a tarefa atual como `status=done` mas mantém o link para `CURRENT_TASK.md` (não vazio ainda).

**9.2 — Atualizar overview da iteração ativa (perguntar se mudou algo macro):**

Apenas se houver indício real de mudança no `00-overview.md` da iteração ativa:

| Indício | Pergunta |
|---|---|
| Tarefa fechada criou novo critério de sucesso ou removeu um existente | "Atualizar `## Critérios de sucesso` da iteração?" |
| Tarefa fechada mudou dependências (destravou/bloqueou outra iteração) | "Atualizar `## Dependências` da iteração?" |

Se nenhum indício: **skip silently**.

**9.3 — Inserir TODOs quando faltar info:**

Quando o usuário não souber responder ou faltar dado deterministico, inserir comment HTML inline na seção em questão: `<!-- TODO roadmap: atualizar — fechamento de <slug> em YYYY-MM-DD não conseguiu reconciliar -->`. Próxima `/aidd-close` (ou edição manual) resolve. NÃO deixar a seção mentindo silenciosamente.

**9.4 — Criar entry em `roadmap/<unit_dir>/active/<current_iteration>/completed-tasks/<NNN>-<slug>.md` (AUTOMÁTICO, sem perguntar):**

Algoritmo determinístico:

1. **Determinar iteração ativa:** ler `current_iteration` do frontmatter de `roadmap/STATUS.md`. Validar que `roadmap/<unit_dir>/active/<current_iteration>/` existe (verificação já feita no 9.0). Se não existir: PARE.
2. **Garantir pasta `completed-tasks/` existe:**
   ```bash
   mkdir -p roadmap/<unit_dir>/active/<current_iteration>/completed-tasks
   ```
3. **Calcular próximo número sequencial:**
   ```bash
   N=$(ls roadmap/<unit_dir>/active/<current_iteration>/completed-tasks/[0-9][0-9][0-9]-*.md 2>/dev/null | wc -l)
   NEXT=$(printf "%03d" $((N + 1)))
   ```
   O glob `[0-9][0-9][0-9]-*.md` ignora `.gitkeep` e arquivos sem prefixo numérico — mais robusto que `*.md | grep -v`.
4. **Slug:** ler `slugFrontmatter` do parser (`node .claude/skills/aidd/scripts/parse-current-task.js`). Se ausente, derivar deterministicamente da primeira linha de `## Original request` aplicando o algoritmo `normalizeSlug`:
   - `String.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40)`
   - Mesmo algoritmo que `parse-current-task.js:normalizeSlug` para garantir consistência cross-skill.
5. **Tracker ID:** ler `trackerId` do parser. Se não-null e não-vazio: nome do arquivo é `<NNN>-<trackerId>-<slug>.md`. Se null: `<NNN>-<slug>.md`.
6. **Path final:** `roadmap/<unit_dir>/active/<current_iteration>/completed-tasks/<NEXT>-<filename>.md`.

**Conteúdo do arquivo (template):**

```markdown
---
title: <NNN>-<slug>
description: <one-liner do que foi entregue>
type: completed-task
sequence: <NNN>
slug: <slug>
tracker_id: <PROJ-N | null>
tracker_title: <título da issue ou "interno">
task_type: <do frontmatter de CURRENT_TASK>
closed_at: <YYYY-MM-DD>
iteration: <current_iteration>
adrs_accepted: [<lista>]
findings_logged: [<lista>]
related_archive: .aidd/archive/<YYYY-MM-DD>-<slug>-current-task.md
---

# <NNN> — <tracker_id ou slug> — <título curto>

## O que foi entregue

<3-6 bullets dos entregáveis principais. Fonte: tabela em FILES_CHANGED.md, agrupada por escopo.>

- X/Y ACs atendidos. <N batches de revisão adversarial se houve>

## Decisões tomadas

<Lista de ADRs novos com link relativo, OU "— (sem ADR)" se nenhum>

## Arquivos alterados

<Contagem + sumário>. Detalhes em [`.aidd/archive/<YYYY-MM-DD>-<slug>-files-changed.md`](../../../../.aidd/archive/<...>).

## Findings registrados

<Lista F-<TASK>-N em docs/findings.md, com 1-line summary cada. Ou "—" se nenhum.>

## Archive completo

[`.aidd/archive/<YYYY-MM-DD>-<slug>-current-task.md`](../../../../.aidd/archive/<...>) e companheiros.

## Resultado

<1-3 frases sobre o impacto da tarefa no projeto. O que foi destravado, mudou, virou possível.>
```

**Como popular cada campo deterministicamente:**

| Campo | Fonte |
|---|---|
| `<slug>`, `task_type`, `tracker_id` | Frontmatter de `.aidd/current/CURRENT_TASK.md` |
| `closed_at` | Data de hoje |
| `adrs_accepted` | grep `docs/adr/00NN-*.md` em `FILES_CHANGED.md` (lines com tipo "Criacao") |
| `findings_logged` | grep `F-<TASK>-` em `docs/findings.md` da seção da tarefa atual |
| **O que foi entregue** | Primeiras 4-6 linhas da tabela de FILES_CHANGED.md, agrupadas |
| **Decisões tomadas** | Para cada ADR em `adrs_accepted`, ler H1 do arquivo ADR e listar como "0NNN — <título>" |
| **Findings** | Para cada finding em `findings_logged`, copiar 1-line "lição" da seção respectiva em `docs/findings.md` |
| **Resultado** | 1-3 frases derivadas do `## Status` final de CURRENT_TASK.md |

**Esta sub-etapa NÃO pergunta ao usuário** — é determinística. Se algum dado faltar (ex: archive não criado porque usuário escolheu "Manter empilhado" no Passo 2), substitua o link por `(empilhado — sem archive ainda)`.

**9.5 — Marcar [x] em `02-tasks.md` + atualizar `01-decisions.md` da iteração ativa:**

**Parte A: `02-tasks.md`**

Edit no arquivo `roadmap/<unit_dir>/active/<current_iteration>/02-tasks.md`:

**Determinar identificador de busca (regra inequívoca):**
- Se `trackerId` é não-null e não é a string `"null"`: usar `trackerId` (ex: `PROJ-9`).
- Senão: usar `slug` (do `slugFrontmatter` ou fallback determinístico do Passo 9.4).

**Procurar linha `- [ ] **<identificador>**` no arquivo:**
- Se ENCONTROU: trocar `[ ]` por `[x]` e anexar ` ✅ <YYYY-MM-DD>` + link para o `<NNN>-<slug>.md`.
- Se NÃO encontrou: adicionar linha nova em `## Tarefas concluídas nesta iteração` (não em "Em ordem de execução"). Formato: `- [x] **<identificador>** — <título curto> ✅ <YYYY-MM-DD> ([detalhe](completed-tasks/<NNN>-<filename>.md))`.

NÃO adicione linha duplicada se o identificador já aparece como `[x]`.

**Parte B: `01-decisions.md` (movimentar ADRs aceitos)**

Se `adrs_accepted` (do Passo 9.4) é não-vazio, abrir `roadmap/<unit_dir>/active/<current_iteration>/01-decisions.md`:

Para cada ADR em `adrs_accepted`:
1. Procurar a linha do ADR na seção `### ⏳ Pendentes (esperados nesta iteração)` (formato: `| 00NN | <tema> | ...`).
2. Se encontrou: **deletar a linha** da seção Pendentes E **adicionar linha** em `### ✅ Aceitas durante esta iteração`. Formato: `| [00NN](../../../docs/adr/00NN-<slug>.md) | <YYYY-MM-DD> | <título do ADR> | <task slug> |`.
3. Se NÃO encontrou em Pendentes (ADR não estava previsto na iteração): apenas adicionar em "Aceitas" com nota `(fora do escopo previsto)`.

Esse passo elimina o anti-pattern "lie file" — `01-decisions.md` afirma esse comportamento e agora o skill cumpre.

**9.6 — Detectar fim de iteração e arquivar (perguntar):**

Após 9.5, ler `02-tasks.md` da iteração ativa:

```bash
unchecked=$(grep -c "^- \[ \]" roadmap/<unit_dir>/active/<current_iteration>/02-tasks.md)
```

Se `unchecked == 0` (todas as tarefas estão `[x]`), perguntar via AskUserQuestion:

```
Pergunta: "Todas as tarefas da iteração `<current>` estão fechadas. Encerrar a iteração agora?"
Header: "Encerrar iter"
Opções:
- Encerrar e arquivar (Recomendado se não há retomada planejada)
  → Gera `99-retrospective.md` (template), move pasta active/<current> → archive/<current>, atualiza STATUS.md current_iteration para a próxima em active/.
- Manter aberta — pode haver retomada
  → Não move; usuário decide depois.
- Pular pergunta — ainda não decidi
  → Não move; insere TODO em STATUS.md para lembrar.
```

**Detector — apenas itens de primeiro nível contam:** o grep `^- \[ \]` (sem espaços iniciais) garante que sub-tarefas indentadas (`  - [ ]`) NÃO bloqueiam o encerramento. Esta é decisão de design — sub-items são notas, não trabalho independente.

**Se "Encerrar e arquivar":**

ORDEM CRÍTICA — atualizar `STATUS.md` ANTES de mover a pasta. Se invertesse, falha entre `mv` e Edit deixaria `current_iteration` apontando para pasta inexistente em `active/`.

1. **Gerar `99-retrospective.md`** (template enxuto) em `roadmap/<unit_dir>/active/<current>/`:

   ```markdown
   ---
   title: <current> / retrospective
   iteration: <current>
   generated_by: aidd-close (Passo 9.6)
   generated_at: <YYYY-MM-DD>
   ---

   # Retrospecto — <current>

   ## Sumário

   | Métrica | Valor |
   |---|---|
   | Início | <started_at do overview> |
   | Fim | <YYYY-MM-DD> |
   | Tarefas concluídas | <contagem de arquivos em completed-tasks/> |
   | ADRs aceitos | <contagem de adrs em 01-decisions.md "Aceitas"> |
   | Findings registrados | <contagem em docs/findings.md desta iteração> |

   ## O que funcionou
   _(a preencher pelo usuário — ou perguntar via AskUserQuestion)_

   ## O que NÃO funcionou
   _(a preencher pelo usuário — ou perguntar via AskUserQuestion)_

   ## Lições reusáveis
   <Listar findings desta iteração>

   ## Carry-forward para próxima iteração
   _(a preencher pelo usuário — ou inferir das tasks suspensas/movidas)_

   ## Encerramento
   <Resumo de 1 frase do que esta iteração serviu.>
   ```

   Se o usuário não souber preencher "O que funcionou" / "O que NÃO funcionou" via pergunta, deixe `_(a preencher)_` — não invente conteúdo.

2. **Determinar próxima iteração:** ler todas as pastas em `roadmap/<unit_dir>/active/`. A próxima é a com menor `iteration_number` (ler do frontmatter de cada `00-overview.md`) que ainda tenha `- [ ]` em `02-tasks.md`. Se nenhuma: `null` (milestone completo).

3. **Atualizar `STATUS.md` PRIMEIRO** (antes do `mv`):
   - `current_iteration` → valor da próxima iteração calculado no passo 2 (ou `null`).
   - Atualizar tabela de iterações para refletir que `<current>` agora está em archive.
   - Se `null`: marcar STATUS.md com aviso `🎉 Milestone completo!` na seção de status geral.
   - Salvar via Edit/Write.

4. **Mover pasta com Bash (DEPOIS do STATUS.md atualizado):**
   ```bash
   mkdir -p roadmap/<unit_dir>/archive
   mv roadmap/<unit_dir>/active/<current> roadmap/<unit_dir>/archive/<current>
   ```

5. **Validação pós-mv:** verificar que `roadmap/<unit_dir>/archive/<current>/` existe e que `roadmap/<unit_dir>/active/<current>/` NÃO existe mais. Se inconsistente: PARE e reporte (estado misto requer intervenção manual).

**9.7 — Detector de adoção de plugins/workflows externos (avisos, não auto-update):**

A seção `## Sistemas e estado atual` em `roadmap/plugins-and-workflows.md` NÃO é auto-atualizada (adoção de plugin é decisão de produto). Mas detecte e avise:

| Indício | O que checar | Ação sugerida |
|---|---|---|
| `.planning/` existe na raiz | GSD foi adotado? | Ler `.planning/PROJECT.md`. Sugerir abrir ADR `00NN-adopt-gsd.md` + atualizar `roadmap/METHODOLOGY.md` (`methodology: gsd-phases`) + mover status do GSD para "🟢 ativo" em `plugins-and-workflows.md`. |
| `.specs/tasks/` existe | CEK SDD adotado? | Sugerir abrir ADR + atualizar METHODOLOGY.md (`methodology: cek-sdd`) + atualizar status. |
| `.fpf/knowledge/` existe | CEK FPF adotado? | Idem. |
| `docs/solutions/` ou `docs/plans/` existem | Compound em uso? | Idem. |
| `.aidd/current/FILES_CHANGED.md` da tarefa fechada cita comando `/ce-*`, `/gsd-*`, `/sdd:*`, `/bmad-*`, `/reflexion:*`, `/kaizen:*`, `/fpf:*`, `/tdd:*`, `/sadd:*` que NÃO consta na tabela "Mapa: qual comando para qual phase" em `roadmap/plugins-and-workflows.md` | Workflow novo descoberto | Sugerir adicionar linha à tabela. |

**Não force atualização** desta seção específica — apenas reporte ao usuário no Passo 11 final signal. Decisão é humana.

**Diferenças entre os sub-passos:**

| Sub-passo | Tipo | Pergunta? | Toca arquivo |
|---|---|---|---|
| 9.0 | load config | não | nenhum (read-only) |
| 9.1 | auto-update | não | `roadmap/STATUS.md` |
| 9.2 | curado | sim (se indício) | `roadmap/<unit_dir>/active/<current>/00-overview.md` |
| 9.3 | TODO inline | não | inline em STATUS.md |
| 9.4 | criar entry | não | `roadmap/<unit_dir>/active/<current>/completed-tasks/<NNN>-<slug>.md` (NOVO) |
| 9.5 | mark [x] | não | `roadmap/<unit_dir>/active/<current>/02-tasks.md` |
| 9.6 | end iteration | sim (se 0 unchecked) | `mv active → archive` + `99-retrospective.md` + STATUS.md |
| 9.7 | detector plugins | não (warning only) | nenhum (reporte no Passo 11) |

**Princípio:** crie arquivo novo, **nunca cresça arquivo existente**. Se faltar info determinística, insira `<!-- TODO -->` em vez de inventar. Iterações encerradas saem de `active/` para `archive/` — não ficam misturadas.

**Nenhum dos arquivos de `roadmap/` está protegido pelo contract-guard.** Edits manuais posteriores são permitidos.

### Passo 10 — Propor commit

Se há mudanças não-commitadas, propor mensagem de commit estruturada:

```
<type>(<scope>): <descrição curta da tarefa>

<corpo opcional>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Onde `<type>` é inferido do `task_type` no frontmatter (`feat`, `fix`, `refactor`, `docs`, etc.).

NÃO commitar automaticamente — apenas mostrar a mensagem proposta e o `git status`. Usuário decide se commita aqui ou depois.

### Passo 11 — Sinalizar fechamento

```
┌─ AIDD CLOSE COMPLETO ────────────────────────────────────────┐
│ Tarefa: <slug>                                               │
│ Phase final: 12  Status: done                                 │
│ Archived em: <.aidd/archive path ou "(empilhado)">           │
│ TDD-guard: disabled                                           │
│ PROJECT_BRIEF atualizado: <sim/não/adiado>                   │
│ Findings registradas: <N entradas ou "—">                    │
│                                                               │
│ Roadmap:                                                      │
│   Iteração ativa: <current_iteration>                         │
│   Entry criada: roadmap/.../<NNN>-<slug>.md                  │
│   STATUS.md atualizado: sim                                   │
│   02-tasks.md marcada [x]: sim                                │
│   Iteração encerrada nesta close: <sim → archive/ / não>     │
│                                                               │
│ Plugin adoption detectado: <—  / GSD / CEK / Compound / ...>  │
│                                                               │
│ Próxima tarefa: /aidd-intake quando estiver pronto           │
└──────────────────────────────────────────────────────────────┘
```

## Stop Rules aplicáveis

- **Non-inventive**: NÃO archive sem confirmar com usuário; NÃO atualize PROJECT_BRIEF sem confirmar.
- **Spec é contrato**: se a implementação divergiu da spec, recuse fechamento até a spec ser corrigida primeiro.

## O que NÃO fazer

- NÃO commit + push automaticamente.
- NÃO edite arquivos protegidos sem confirmação explícita.
- NÃO archive se há pendências de gate humano #4 ou #5 não resolvidas.

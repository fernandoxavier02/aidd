---
name: aidd
description: This skill should be used when the user asks "aidd", "where are we", "what phase", "diagnose AIDD", "what's the next step", "current status", "qual a iteração ativa", "em qual sprint estamos", or wants to know the current AIDD cycle status. Reads .aidd/current/CURRENT_TASK.md frontmatter and roadmap/STATUS.md, identifies the current phase (1-12) and active iteration, detects inconsistencies (missing artifacts, skipped gates, stale TDD-guard, task iteration ≠ active iteration), and recommends the next skill (/aidd-intake, /aidd-impl-start, /kiro:spec-requirements, etc.) or recovery path. Points to AIDD-RUNBOOK.md for full documentation.
version: 0.2.0
---

# /aidd — Diagnostico de Phase + Roteamento + Troubleshooting

Ao ser invocado, executar estritamente estes passos:

## 1. Ler estado atual

Usar `Read` em `.aidd/current/CURRENT_TASK.md`. Se nao existir: imprimir "Nenhuma tarefa AIDD ativa. Comece com `/aidd-intake`." e parar.

Usar `scripts/parse-current-task.js` para extracao deterministic:
```bash
node .claude/skills/aidd/scripts/parse-current-task.js
```
O script retorna JSON com `phase`, `status`, `slug`, `taskType`, `complexity`, `iteration`, `trackerId`, `slugFrontmatter`, `error`.

Se `slugFrontmatter` e `slug` divergirem, o slug do frontmatter e autoritativo (campo declarado pelo /aidd-intake). O `slug` derivado e fallback histórico para tarefas pre-refactor.

## 2. Extrair do frontmatter

Procurar `phase:` e `status:` na primeira fence YAML (`---...---`). Se ausentes: imprimir "Frontmatter sem phase/status — consulte `references/troubleshooting.md` cenario T1." e parar.

## 3. Identificar ultima tarefa ativa

Procurar a ultima secao `## Tarefa atual:` no corpo do arquivo. Extrair o titulo (slug).

Se houver multiplas secoes `## Tarefa atual:` empilhadas, consultar `references/troubleshooting.md` cenario T2 antes de continuar.

## 4. Verificar consistencia (diagnostico de erro)

Antes de recomendar a proxima acao, verificar estas condicoes de erro:

| Condicao de erro | Check | Se falhar |
|---|---|---|
| Phase=5+ mas requirements.md ausente | Existe `.kiro/specs/<feat>/requirements.md`? | WARN + recovery para phase 4 |
| Phase=7+ mas design.md ausente | Existe `.kiro/specs/<feat>/design.md`? | WARN + recovery para phase 7 |
| Phase=8+ mas tasks.md ausente | Existe `.kiro/specs/<feat>/tasks.md`? | WARN + recovery para phase 7 |
| Phase=9 mas TDD-guard disabled | `.claude/aidd-tdd-config.json` esta `enabled: true`? | WARN + oferecer rearmar |
| Gate humano nao documentado | Log registra aprovacao da phase anterior? | WARN + pedir confirmacao |
| Phase=10+ mas VERIFICATION_REPORT.md ausente | Existe `.aidd/current/VERIFICATION_REPORT.md`? | WARN + recovery para phase 10 |
| Phase=11 mas REVIEW.md ausente | Existe `.aidd/current/REVIEW.md`? | WARN + executar review |
| iteration da tarefa ≠ current_iteration do projeto | `iteration` (CURRENT_TASK) == `current_iteration` (roadmap/STATUS.md)? | WARN — consultar troubleshooting T10 |
| roadmap/ ausente mas tarefa tem `iteration:` no frontmatter | `roadmap/STATUS.md` existe? | WARN — consultar troubleshooting T11 |
| METHODOLOGY.md ausente quando outras skills referenciam | `roadmap/METHODOLOGY.md` existe? | WARN — consultar troubleshooting T12 |
| iteração da tarefa esta em archive/ em vez de active/ | Pasta da iteration esta em `roadmap/iterations/active/`? | WARN — consultar troubleshooting T13 |

Para detalhes de cada cenario, consultar `references/troubleshooting.md`.

> **Nota:** O placeholder `<feat>` refere-se ao slug da tarefa atual, extraido do titulo em `## Tarefa atual:`. Para localizar a spec, usar: `.kiro/specs/${slug}/`.

## 4.5 Diagnostico AIDD v2 — state files

Executar apenas se a tarefa esta em phase 9 (implementing). Ler arquivos de estado v2 se existirem:

**4.5.1 — CONFIDENCE.yaml:**

```bash
node -e "
const fs = require('fs');
const path = '.aidd/current/CONFIDENCE.yaml';
if (fs.existsSync(path)) {
  const jsyaml = require('js-yaml');
  const conf = require('.claude/hooks/lib/aidd-confidence.cjs');
  const doc = jsyaml.load(fs.readFileSync(path, 'utf-8'));
  const r = conf.computeFinalScore(doc);
  const dims = doc.dimensions || {};
  console.log('CONFIDENCE_EXISTS');
  console.log('dimensions=' + JSON.stringify(dims));
  console.log('final_score=' + r.final_score.toFixed(3));
  console.log('verdict=' + r.verdict);
} else {
  console.log('CONFIDENCE_ABSENT');
}
"
```

- Se `CONFIDENCE_EXISTS`: mostrar dimensions + score atual no diagnostico (ver bloco de renderizacao abaixo).
- Se `CONFIDENCE_ABSENT`: mostrar "(CONFIDENCE.yaml ausente — tarefa pre-v2 ou impl-start nao executado)" como nota.

**4.5.2 — Override fatigue scan (NFR-3):**

```bash
node -e "
const fs = require('fs');
const path = '.aidd/telemetry';
const task = process.env.AIDD_TASK_SLUG || '';
let count = 0;
const files = fs.existsSync(path) ? fs.readdirSync(path).filter(f => f.endsWith('-overrides.jsonl')) : [];
for (const f of files) {
  const lines = fs.readFileSync(path + '/' + f, 'utf-8').trim().split('\n').filter(Boolean);
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (!task || (e.task && e.task.includes(task))) count++;
    } catch(_) {}
  }
}
console.log('override_count=' + count);
if (count >= 5) console.log('OVERRIDE_FATIGUE_WARN');
"
```

- Se `OVERRIDE_FATIGUE_WARN`: exibir `WARN: >= 5 overrides registrados nesta tarefa. Revisar uso de overrides antes de fechar.` no diagnostico.

**4.5.3 — Batch em progresso:**

```bash
node -e "
const fs = require('fs');
const p = '.aidd/current/BATCHES.jsonl';
if (!fs.existsSync(p)) { console.log('BATCHES_ABSENT'); process.exit(0); }
const lines = fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean);
const last = lines.length ? JSON.parse(lines[lines.length-1]) : null;
if (last && !last.completed_at) {
  console.log('BATCH_IN_PROGRESS=' + (last.batch_id || '?'));
} else {
  console.log('BATCH_IDLE last=' + (last ? last.batch_id : 'none'));
}
"
```

- Se `BATCH_IN_PROGRESS`: mostrar `WARN: Batch <N> em progresso (sem completed_at). Completar antes de /aidd-close.`

## 5. Renderizar diagnostico

Antes de imprimir:
- Ler `roadmap/STATUS.md` (se existir) e extrair `current_iteration` do frontmatter. Se ausente: usar `—`.
- Se a CURRENT_TASK.md tiver `iteration:` no frontmatter, comparar com `current_iteration`. Se forem diferentes: WARN T10 (iteração divergente).
- Se a tarefa tem `iteration:` mas `roadmap/STATUS.md` nao existe: WARN T11 (roadmap ausente).

Imprimir EXATAMENTE este bloco (substituir TODOS os campos `<...>` pelos valores reais; nao deixar literais):

```
┌─ AIDD — Estado atual ──────────────────────────────────────────┐
│ Tarefa: <slug>                                                  │
│ Phase: <N> (<nome>)                                             │
│ Status: <status>                                                │
│ Iteração da tarefa: <iteration ou "—">                          │
│ Iteração ativa do projeto: <current_iteration ou "—">           │
│                                                                 │
│ Confidence Score (v2):                                          │
│   dimensions: <spec_clarity=X.X, tdd_adherence=X.X, ...>       │
│   final_score: <X.XXX>  verdict: <PASS|WARN|FAIL|"—(pre-v2)"> │
│   overrides: <N overrides registrados [WARN se >= 5]>           │
│   batch: <IDLE|"em progresso (batch N)">                        │
│                                                                 │
│ Próxima ação: <da tabela de roteamento>                         │
│ Skill recomendada: <comando>                                    │
│                                                                 │
│ Consistência: <OK ou "WARN: <T-N>: <descricao curta>">         │
└────────────────────────────────────────────────────────────────┘
```

Se CONFIDENCE.yaml ausente: mostrar `"—(pre-v2)"` para verdict e omitir linha de dimensions.

## 6. Tabela de phases e roteamento

Ver tabela completa em `references/phase-guide.md`.

Resumo de recovery paths por phase:

| Phase | Se falhar | Recovery |
|---|---|---|
| 5+ | requirements.md ausente | Voltar para phase 4 |
| 7+ | design.md ausente | Voltar para phase 5-6 |
| 8+ | tasks.md ausente | Voltar para phase 7 |
| 9 | TDD-guard disabled | WARN + oferecer rearmar |
| 9+ | Gate humano nao documentado | WARN + pedir confirmacao |
| 10+ | VERIFICATION_REPORT.md ausente | Recovery para phase 10 |
| 11 | REVIEW.md ausente | Executar review |

Status `done`/`done-local` em qualquer phase → recomendar `/aidd-close`.

## 7. Apontar guia completo

No final, imprimir:

```
Guia completo do ciclo AIDD: AIDD-RUNBOOK.md
Phase guide detalhado: references/phase-guide.md
Troubleshooting: references/troubleshooting.md
Exemplos de diagnostico: examples/
Script de parsing: scripts/parse-current-task.js
Comandos da Camada 1: /aidd-intake, /aidd-impl-start, /aidd-close
Hooks ativos: ver .claude/settings.json
Roadmap do projeto (opcional, se houver): roadmap/README.md
Iteração ativa: roadmap/iterations/active/<VALOR REAL>/00-overview.md  (substituir <VALOR REAL> pelo current_iteration lido)
```

## Regras

- Nao modificar arquivos. Esta skill e apenas leitura e diagnostico.
- Nao invocar outras skills automaticamente. Apenas recomendar.
- Nao imprimir tabelas/diagramas decorativos — quem quer detalhes le os arquivos de referencia.
- Se houver ambiguidade (multiplas tarefas empilhadas), usar a ultima secao `## Tarefa atual:` como ativa, mas alertar o usuario.

## Recursos Adicionais

### Arquivos de Referencia

Carregados sob demanda quando o diagnostico encontrar problemas:

- **`references/phase-guide.md`** — Descricao detalhada das 12 fases, artefatos, gates e sinais de prontidao.
- **`references/troubleshooting.md`** — 8 cenarios de erro comuns (T1-T8) com recovery paths especificos.

### Exemplos

- **`examples/diagnostico-phase-1.md`** — Saida completa de `/aidd` para tarefa recem-criada (intake).
- **`examples/diagnostico-phase-9.md`** — Saida completa de `/aidd` para tarefa em implementacao.

### Scripts

- **`scripts/parse-current-task.js`** — Utilitario Node.js puro para extrair phase, status, slug, taskType e complexity de CURRENT_TASK.md deterministicamente. Retorna JSON com tratamento de erro.

  Uso (da raiz do projeto):
  ```bash
  node .claude/skills/aidd/scripts/parse-current-task.js [.aidd/current/CURRENT_TASK.md]
  ```

  Saida exemplo (sucesso):
  ```json
  {
    "error": null,
    "phase": 5,
    "status": "requirements",
    "slug": "minha-tarefa",
    "taskType": "Feature",
    "complexity": "MEDIA",
    "iteration": "02-mvp-backend",
    "trackerId": "PROJ-9",
    "slugFrontmatter": "minha-tarefa",
    "filePath": "/abs/path/.aidd/current/CURRENT_TASK.md",
    "frontmatterValid": true
  }
  ```

  Saida exemplo (erro):
  ```json
  {
    "error": "Frontmatter YAML nao encontrado",
    "phase": null,
    "status": null,
    "slug": null,
    "taskType": null,
    "complexity": null,
    "iteration": null,
    "trackerId": null,
    "slugFrontmatter": null
  }
  ```

  Statuses validos: `empty`, `intake`, `requirements`, `design`, `implementing`, `verification`, `review`, `done`, `done-local`. Phase aceita `0-12` (0 = template pos-close).

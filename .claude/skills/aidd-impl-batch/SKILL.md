---
name: aidd-impl-batch
description: Loop principal do Phase 9 AIDD v2 — executa 1 batch de tasks com TDD RED→GREEN→checkpoint→adversarial (Lifecycle A) → fix loop → BATCHES append → CONFIDENCE update. Repete ate todas as tasks estarem [x] em tasks.md.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion, Agent, Skill
---

# aidd-impl-batch

> Design: `design.md §3.1` | Requirement: Req 1 (ACs 1.1-1.7)
> Pre-requisito: `/aidd-impl-start` executado (BATCHES.jsonl + CONFIDENCE.yaml existem)
> Executa: 1 batch por invocacao (loop externo gerenciado pelo usuario ou skill wrapper)

## Pre-checks

1. Ler `.aidd/current/CURRENT_TASK.md` — verificar `phase: 9` e `status: implementing`.
2. Ler `.kiro/specs/{feature}/tasks.md` — identificar proxima task `[ ]` nao iniciada.
3. Se nenhuma task pendente: invocar `/aidd-impl-finalize` e encerrar.

## Step 1: Select next batch

**Sizing por complexity + Domains_Sensitive override (AC 1.2)**

```
Domains_Sensitive = ["auth", "crypto", "rls", "secrets", "privacy", "payment"]

function batch_size(complexity, next_tasks_domains, remaining):
  if any domain in next_tasks_domains contains Domains_Sensitive: return 1
  if complexity == "SIMPLES": return min(remaining, 5)
  if complexity == "MEDIA":   return min(remaining, 3)
  if complexity == "COMPLEXA": return 1
```

Determinar `complexity` da tarefa ativa via `CURRENT_TASK.md` frontmatter (`complexity:` field).
Determinar `next_tasks_domains` via `tasks.md` campos `Domain` ou inferidos dos arquivos afetados.

Selecionar as proximas N tasks `[ ]` do `tasks.md` conforme sizing.
Registrar: `batch_id = (last batch_id em BATCHES.jsonl) + 1`.

## Step 2: Micro-gate spec coverage (AC 1.3)

Para cada task no batch:
1. **AC check**: verificar que a task em `tasks.md` tem Acceptance Criteria explicitamente listados.
2. **Requirement ID**: verificar que cada AC referencia um Requirement ID (ex: `Req 1 AC 1.3`).
3. **Design coverage**: verificar que os arquivos da task aparecem em `design.md` (grep por filename).

Se qualquer gap:
```
STOP — Micro-gate falhou.
Gaps encontrados: [lista]
Opcoes: (a) atualizar tasks.md com ACs/requirement IDs faltantes antes de continuar; (b) abrir issue no backlog e pular task; (c) revisar design.md cobertura.
```

**Invocar AskUserQuestion** com 3 opcoes se gap detectado (nao prosseguir silenciosamente).

## Step 3: TDD RED

Para cada arquivo de teste da batch:
1. Se arquivo de teste ainda nao existe: criar o arquivo de teste com pelo menos os cenarios basicos (nao implementados).
2. Executar os testes: `npm run test:aidd -- <test-file>`.
3. **Verificar que TODOS os novos testes FALHAM (RED gate)**.
4. Se algum teste passar antes da implementacao: STOP — investigate.

```
two_attempt_rule: se RED gate falhar 2x pelo mesmo motivo → STOP + diagnostico em VERIFICATION_REPORT.md
```

Registrar em heartbeat: `upsert_entry(test_path, { result: "RED", ... })` (TDD_Guard_V2 faz isso automaticamente via hook).

## Step 4: Implementation (sob PreToolUse chain v2 — 5 hooks de defesa ativos)

Implementar as tasks do batch. Durante implementacao, o hook chain esta ativo:
- `aidd-secrets-guard` — bloqueia secrets/API keys
- `aidd-rls-guard` — bloqueia migrations sem RLS
- `aidd-domain-guard` — bloqueia imports cross-camada
- `aidd-frontend-business-guard` — WARN para logica de negocio em frontend
- `aidd-tdd-guard-v2` — exige RED gate antes de editar producao

Se qualquer hook retornar DENY: corrigir o problema antes de continuar. Nao bypassar sem reason de >=20 chars + env var de override.

## Step 5: TDD GREEN

Executar suite completa + suite focada no batch:
```bash
npm run test:aidd -- <test-files-do-batch>
npm run test:aidd
```

**Todos os testes devem passar (GREEN gate)**.

```
two_attempt_rule: se GREEN gate falhar 2x pelo mesmo motivo → STOP + diagnostico em VERIFICATION_REPORT.md
```

## Step 6: Checkpoint (build + scoped test)

```bash
npm run build 2>&1 | tail -5  # adapte ao comando de build do seu projeto
npm run lint:md 2>&1 | tail -5
npm run test:aidd 2>&1 | tail -10
```

**Todos devem passar** antes de avancar para adversarial.

```
two_attempt_rule: checkpoint falhou 2x → STOP
```

## Step 7: Adversarial Single (Lifecycle A — Context_Isolation)

Escolher dimensao adversarial baseada em `domains_touched` do batch:
- Dominios `auth|crypto|rls|secrets|privacy` → agent `security`
- Dominios `architecture|domain|ddd|layer` → agent `architecture`
- Default / dominios `quality|test|refactor` → agent `quality`

**7.1: writeAdversarialLock**
```javascript
// Antes de spawnar: criar _ACTIVE.lock sinalizando sessao adversarial ativa
writeAdversarialLock(
  session=`batch-${batch_id}`,
  expected_spawns=1,
  allowed_files=batch.files,  // apenas arquivos do batch
  ttl=600
)
// Usando: .claude/hooks/lib/aidd-adversarial-context.cjs
```

**7.2: Spawn Agent adversarial**
```javascript
// Spawn com synthesize_prompt (Context_Isolation camada A)
const prompt = synthesize_prompt(dimension, batch.files, stack)
// subagent_type: "general-purpose" (empiricamente validado — nao custom)
spawn Agent(subagent_type: "general-purpose", prompt: prompt)
```

`synthesize_prompt(dim, files, stack)`:
```
Voce e um revisor adversarial independente de {dim}.
CONTEXT MINIMO:
- Stack: {stack}
- Arquivos para revisar (somente estes): {files}
- Checklist: .claude/adversarial-checklists/{dim}.md
- Output path: .aidd/current/REVIEW-batch-{batch_id}-{dim}.md

REGRAS (strict):
1. Voce NAO tem acesso a chat history, design.md, requirements.md, CURRENT_TASK.md, BATCHES.jsonl ou ADRs aceitos.
2. Sua unica fonte sao os arquivos listados acima.
3. Reporte findings com severity CRITICAL | HIGH | MEDIUM | LOW.
4. Para cada: <arquivo>:<linha> + descricao (2-3 linhas) + recomendacao (1-2 linhas).
5. NAO invente requirements — se algo parece estranho mas pode ser intencional, marque MEDIUM "needs context".
6. Use a checklist como unico roteiro.

OUTPUT FORMAT (YAML, strict):
---
agent: aidd-adversarial-{dim}
files_reviewed: N
findings:
  - severity: CRITICAL|HIGH|MEDIUM|LOW
    category: <da checklist>
    file: <path>
    line: N
    description: <2-3 linhas>
    recommendation: <1-2 linhas>
---
```

**7.3: Capturar agent_id + writeAdversarialContext**
```javascript
// Apos spawn retornar: capturar agent_id e criar context file
const agent_id = adversarial_result.agent_id
writeAdversarialContext(
  id=`batch-${batch_id}`,
  agent_id=agent_id,
  allowed_files=batch.files,
  ttl=600
)
```

**7.4: Await findings**
Aguardar retorno do agente adversarial. Verificar que output e YAML valido com schema P1 (agent, files_reviewed, findings[]).

## Step 8: Fix loop (se CRITICAL ou HIGH encontrados, max 3 tentativas)

Se adversarial retornou findings CRITICAL ou HIGH:

**8.1: cleanupAdversarialContext — OBRIGATORIO antes de spawnar Executor_Fix**
```javascript
// Remove _ACTIVE.lock + batch-N.json
// Libera REGRA 4 do hook (subagent normal = allow)
cleanupAdversarialContext()
```

**8.2: Spawn Executor_Fix**
```
Invocar skill ou agent Executor_Fix com os findings como contexto.
subagent_type: "general-purpose"  (nao adversarial — sem lock ativo)
Descrever findings CRITICAL/HIGH e solicitar correcao minima.
```

**8.3: Re-run TDD GREEN + checkpoint**
Apos Executor_Fix: executar Step 5 + Step 6 novamente.

**8.4: Re-run adversarial — volta para 7.1**
Criar novo lock + spawnar adversarial novamente para verificar que findings foram corrigidos.

**8.5: Se exhaust 3 attempts sem resolver CRITICALs/HIGHs:**
```
STOP — Fix_Loop esgotado (3 tentativas, findings persistem).

Invocar AskUserQuestion com:
- Opcao A: "Revisar manualmente os findings e aplicar fix adicional" (continua apos fix humano)
- Opcao B: "Aceitar findings como tecnical debt documentado e continuar" (registra em BATCHES.jsonl.notes)
- Opcao C: "Descartar o batch e redefinir escopo" (descarta arquivos do batch, volta para Step 1)
```

**Limite hard: max 3 iteracoes do fix loop. Nao bypassar.**

## Step 9: Cleanup final + BATCHES append + CONFIDENCE update

**9.1: Cleanup**
```javascript
cleanupAdversarialContext()  // se nao foi feito no Step 8
```

**9.2: Append BATCHES.jsonl (AC 1.5, CI-3 — 13 campos obrigatorios)**
```json
{
  "batch_id": N,
  "tasks": ["T01", "T02"],
  "started_at": "<ISO8601>",
  "completed_at": "<ISO8601>",
  "domains_touched": ["auth", "tooling"],
  "files_changed": ["path/to/file.ts"],
  "files_created": ["path/to/new.ts"],
  "tdd_red": "verified|skipped|failed",
  "tdd_green": "pass|fail|n/a",
  "checkpoint": "pass|fail|n/a",
  "adversarial_agent": "security|architecture|quality",
  "adversarial": "clean|fixed|skipped|failed",
  "fix_loops": 0,
  "adversarial_findings_summary": { "critical": 0, "high": 0, "medium": 1, "low": 2 }
}
```

**9.3: Update CONFIDENCE.yaml (AC 1.6)**
Usar `aidd-confidence.cjs` helper:
```javascript
// tdd_adherence = verified_red_batches / total_batches_so_far
// adversarial_clean_rate = clean_batches / total_batches_so_far
updateDimension("tdd_adherence", new_value)
updateDimension("adversarial_clean_rate", new_value)
```

**9.4: Marcar tasks [x] em tasks.md**
Para cada task do batch que passou: atualizar `tasks.md` marcando `[x]`.

**9.5: Log de progresso**
```
Batch N concluido:
- Tasks: [lista]
- TDD: RED verified, GREEN pass
- Adversarial: clean (0 CRITICAL, 0 HIGH) / fixed (N findings resolvidos em M loops)
- CONFIDENCE: tdd_adherence=X.XX, adversarial_clean_rate=X.XX
- Proximo: invocar /aidd-impl-batch para continuar OU /aidd-impl-finalize se todas as tasks [x]
```

## Stop Conditions

- **two_attempt_rule**: 2 falhas consecutivas no mesmo root cause → STOP + diagnostico em `VERIFICATION_REPORT.md`
- **exhaust fix_loop**: 3 tentativas adversariais sem resolver CRITICAL/HIGH → AskUserQuestion obrigatorio
- **micro-gate gap**: task sem AC ou requirement ID → STOP + AskUserQuestion
- **Hook DENY nao resolvido**: nao bypassar — corrigir o problema ou usar override com razao documentada

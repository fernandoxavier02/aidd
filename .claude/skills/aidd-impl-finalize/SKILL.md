---
name: aidd-impl-finalize
description: Phase_9_Finalize AIDD v2 — trio adversarial paralelo (security + architecture + quality) com Context_Isolation, transicao atomica para CBD, Cross_Batch_Detector, consolidacao REVIEW.md e atualizacao final do CONFIDENCE.yaml. Lifecycle B.
allowed-tools: Read, Write, Bash, Agent, Skill
---

# aidd-impl-finalize

> Design: `design.md §3.2` | Requirement: Req 2 (ACs 2.1-2.6)
> Pre-requisito: todas as tasks em `tasks.md` marcadas `[x]`
> Lifecycle B (trio paralelo com transicao atomica — design §3.8.B)

## Step 1: Verify all tasks marked [x] in tasks.md (AC 2.1)

```bash
# Verificar que nao ha tasks pendentes [ ]
grep -c "\[ \]" .kiro/specs/{feature}/tasks.md
```

Se houver tasks pendentes (grep retorna > 0):
```
STOP — Finalize so pode ser invocado quando TODAS as tasks estao [x].
Tasks pendentes encontradas: {lista}
Volte para /aidd-impl-batch para completar as tasks restantes.
```

## Step 2: writeAdversarialLock para trio (Lifecycle B — PRE-SPAWN)

```javascript
// Escrever _ACTIVE.lock antes de spawnar os 3 agentes
// TTL maior (1200s = 20min) para acomodar trio paralelo
writeAdversarialLock(
  session="finalize-trio",
  expected_spawns=3,
  allowed_files=union(all files_changed across all BATCHES.jsonl entries),
  ttl=1200
)
// Usando: .claude/hooks/lib/aidd-adversarial-context.cjs
```

Coletar `allowed_files`: ler cada linha de `BATCHES.jsonl`, agregar `files_changed` + `files_created` de todos os batches.

## Step 3: Spawn trio paralelo — SINGLE MESSAGE com 3 Agent calls (AC 2.3)

**IMPORTANTE: as 3 chamadas devem ser feitas EM UMA UNICA MENSAGEM para execucao paralela.**
Nao chamar sequencialmente — invocar os 3 Agent calls juntos.

```
// Spawn 3: security + architecture + quality (paralelo — single message)
Agent(
  subagent_type: "general-purpose",
  prompt: synthesize_prompt("security", all_files, stack)
)
Agent(
  subagent_type: "general-purpose",
  prompt: synthesize_prompt("architecture", all_files, stack)
)
Agent(
  subagent_type: "general-purpose",
  prompt: synthesize_prompt("quality", all_files, stack)
)
```

`synthesize_prompt(dimension, files, stack)` — Context_Isolation camada A (design §3.2):
```
Voce e um revisor adversarial INDEPENDENTE de {dimension}.
Voce tem ZERO contexto da implementacao — nao ha chat history disponivel para voce.

CONTEXT MINIMO:
- Stack: {stack}
- Arquivos para revisar (SOMENTE estes): {files}
- Sua checklist: .claude/adversarial-checklists/{dimension}.md
- Output path: .aidd/current/REVIEW-{dimension}.md

REGRAS (strict — Context_Isolation):
1. Voce NAO tem acesso a: design.md, requirements.md, CURRENT_TASK.md, BATCHES.jsonl, ADRs aceitos ou qualquer artefato de planejamento.
2. Sua UNICA fonte sao os arquivos listados acima.
3. Reporte findings com severity CRITICAL | HIGH | MEDIUM | LOW.
4. Para cada finding: <arquivo>:<linha> + descricao (2-3 linhas) + recomendacao (1-2 linhas).
5. Se algo parece estranho mas pode ser intencional: marque MEDIUM "needs context" — NAO auto-escalate para CRITICAL.
6. Use a checklist como unico roteiro — nao invente requirements fora dela.
7. Se nao encontrar issues: escreva "Nenhum finding em {dimension}." com fundamentacao.

OUTPUT FORMAT (YAML, strict — schema P1):
---
agent: aidd-adversarial-{dimension}
files_reviewed: N
findings:
  - severity: CRITICAL|HIGH|MEDIUM|LOW
    category: <categoria da checklist>
    file: <path>
    line: N
    description: <2-3 linhas>
    recommendation: <1-2 linhas>
---
```

Os 3 agentes operam com Context_Isolation de 2 camadas:
- **Camada A (prompt)**: `synthesize_prompt` nao referencia design.md, requirements.md, CURRENT_TASK.md, BATCHES.jsonl ou ADRs
- **Camada B (hook)**: `aidd-adversarial-read-guard.cjs` intercepta Read/Grep/Glob e enforca `allowed_files` do lock

## Step 4: Await 3 retornos + writeAdversarialContext para cada

Para cada agente que retornar (3 retornos esperados):
1. Capturar `agent_id` do retorno.
2. Escrever context file:

```javascript
writeAdversarialContext(
  id=`finalize-${dimension}`,    // ex: "finalize-security"
  agent_id=agent_id_capturado,
  allowed_files=union(all_files),
  ttl=1200
)
```

3. Salvar output YAML do agente em `.aidd/current/REVIEW-{dimension}.md`.
4. Se output nao e YAML valido: marcar dimensao como `incomplete` em REVIEW.md + penalizar CONFIDENCE -0.2 nessa dimensao.

Aguardar os 3 retornos antes de avancar.

## Step 5: Transicao atomica para CBD (ISSUE-R4-3 mitigation, design §3.8.B.5)

**NUNCA remover lock + criar novo lock sequencialmente** — isso deixaria janela sem protecao (~5-10ms).
Em vez disso, usar `atomicTransitionLock` que faz:

**5.a**: Escrever `_ACTIVE.lock.new` com dados do CBD session:
```javascript
const cbdLockData = {
  session: "cbd",
  expected_spawns: 1,
  allowed_files: [
    "BATCHES.jsonl",
    ".aidd/current/REVIEW-security.md",
    ".aidd/current/REVIEW-architecture.md",
    ".aidd/current/REVIEW-quality.md"
  ],
  ts: new Date().toISOString(),
  ttl_seconds: 600
}
```

**5.b**: `fs.renameSync(_ACTIVE.lock.new, _ACTIVE.lock)` — substituicao atomica (ext4/NTFS garantem atomicidade).
A partir deste instante: hook le LOCK NOVO (CBD), nunca ha momento sem lock ativo.

**5.c**: Remover os 3 `finalize-{dim}.json` antigos (agora redundantes — lock CBD cobre allowed_files).

```javascript
atomicTransitionLock(cbdLockData, { projectRoot: process.cwd() })
// atomicTransitionLock = faz 5.a + 5.b + 5.c atomicamente
```

## Step 6: Spawn Cross_Batch_Detector

```javascript
// CBD e spawnado como subagent normal (lock CBD ja ativo)
Skill("/aidd-cross-batch-emergent")
// OU se invocar via Agent:
// Agent(subagent_type: "general-purpose", prompt: invoke_cbd_prompt)
```

Aguardar CBD completar. Resultado: `findings_count`, `cross_batch_emergent_score`, `triggered_heuristics`.

Se CBD falhar (error): marcar `cross_batch_emergent` score = 0.5 (neutral) e registrar em REVIEW.md.

## Step 7: Consolidar REVIEW.md (4 secoes obrigatorias — AC 2.6)

Criar/atualizar `.aidd/current/REVIEW.md` com 4 secoes:

```markdown
# REVIEW.md — AIDD v2 Final Adversarial Review

> Gerado por: aidd-impl-finalize em {ISO8601}
> Batches revisados: N
> Trio adversarial: {security, architecture, quality}

## Security

{conteudo de REVIEW-security.md ou "Nenhum finding." se clean}

## Architecture

{conteudo de REVIEW-architecture.md ou "Nenhum finding." se clean}

## Quality

{conteudo de REVIEW-quality.md ou "Nenhum finding." se clean}

## Cross-batch

{conteudo gerado pelo aidd-cross-batch-emergent, includindo lista de heuristicas e findings MEDIUM}

---
**CONFIDENCE final**: score={final_score} | verdict={PASS|WARN|FAIL}
```

## Step 8: Cleanup + update CONFIDENCE final

**8.1: cleanupAdversarialContext** — remover CBD context file + lock:
```javascript
cleanupAdversarialContext()  // remove _ACTIVE.lock + cbd.json
```

**8.2: Atualizar CONFIDENCE.yaml** — dimensoes finais:
```javascript
// regression_health: baseado no ultimo checkpoint de todos os batches
//   1.0 se todos checkpoints "pass"; 0.5 se algum "fail"; 0.0 se ultimo "fail"
updateDimension("regression_health", regression_health_value)

// cross_batch_emergent: score do CBD
//   1.0 se zero findings; decresce 0.2 por finding (floor 0.0)
updateDimension("cross_batch_emergent", cbd_result.cross_batch_emergent_score)

// Computar score final
computeFinalScore()  // atualiza final_score + verdict em CONFIDENCE.yaml
```

## Step 9: Update CURRENT_TASK frontmatter — phase 10, status: verification

Editar `.aidd/current/CURRENT_TASK.md` frontmatter:
```yaml
---
phase: 10
status: verification
---
```

Registrar em log do CURRENT_TASK.md:
```
- *{date}* — aidd-impl-finalize concluido. Trio adversarial executado. REVIEW.md consolidado com 4 secoes.
  CONFIDENCE: final_score={X.XX}, verdict={PASS|WARN|FAIL}.
  Proximo passo: /aidd-close {feature} para closure formal.
```

## Tratamento de erros

| Erro | Acao |
|---|---|
| Agente adversarial timeout / YAML invalido | Penalizar CONFIDENCE -0.2; marcar dimensao `incomplete` em REVIEW.md; continuar |
| CBD falha | Marcar `cross_batch_emergent=0.5`; registrar em REVIEW.md; continuar |
| renameSync falha (Windows lock) | Retry com backoff 100ms / 200ms / 400ms; fallback: copyFile + unlink |
| Tasks pendentes ao invocar | STOP com mensagem clara — nao prosseguir ate [x] |
| CONFIDENCE verdict = FAIL | Relatar ao usuario — opcoes: rework (mini-batch fixes) ou override com `AIDD_CLOSE_OVERRIDE=1` |

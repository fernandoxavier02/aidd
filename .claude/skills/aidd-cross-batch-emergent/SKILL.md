---
name: aidd-cross-batch-emergent
description: Cross-Batch Detector — detecta padroes emergentes entre batches no Phase_9_Finalize. Aplicar 5 heuristicas e emitir findings MEDIUM "needs context" em REVIEW.md.
allowed-tools: Read, Write, Bash
---

# aidd-cross-batch-emergent

> Design: `design.md §3.9` | Requirement: Req 9 (ACs 9.1-9.5)
> Invocado por: `/aidd-impl-finalize` (Step 6 do Lifecycle B)

## Input expected (via prompt ou context)

- 3 trio reports: `.aidd/current/REVIEW-security.md`, `.aidd/current/REVIEW-architecture.md`, `.aidd/current/REVIEW-quality.md`
- Filtered BATCHES.jsonl summary: `.aidd/current/BATCHES.jsonl` (parse linha a linha)
- Telemetry counts per batch: `.aidd/telemetry/secrets-block.jsonl`, `.aidd/telemetry/secrets-warn.jsonl`, `.aidd/telemetry/domain-block.jsonl`

## Step 1: Parse inputs

```bash
# Ler BATCHES.jsonl (1 JSON por linha)
cat .aidd/current/BATCHES.jsonl | while IFS= read -r line; do echo "$line"; done

# Ler trio reports
cat .aidd/current/REVIEW-security.md
cat .aidd/current/REVIEW-architecture.md
cat .aidd/current/REVIEW-quality.md

# Contar entries de telemetria por batch
wc -l .aidd/telemetry/secrets-block.jsonl .aidd/telemetry/secrets-warn.jsonl .aidd/telemetry/domain-block.jsonl
```

Parse BATCHES.jsonl: para cada linha valida, extrair `batch_id`, `domains_touched`, `files_changed`, `adversarial_findings_summary`.
Se linha invalida: skip + registrar em `VERIFICATION_REPORT.md` (CI-3).

## Step 2: Apply 5 heuristics

Avaliar cada heuristica em ordem. Cada uma pode disparar independentemente.

**Severity de TODOS os findings: MEDIUM "needs context"** (AC 9.3 — NUNCA auto-CRITICAL).
A severidade reflete que o padrao PODE ser um problema — humano decide se e critico.

### H1: gradual-auth-weakening

**Logica**: contagem de batches em que `domains_touched` ou `files_changed` matcham `/middleware\/auth|auth\.|authn|authz/i` **>=  2**.

```
auth_batches = count(batches where any(domains_touched + files_changed) matches /middleware\/auth|auth\.|authn|authz/i)
if auth_batches >= 2: TRIGGERED
```

**Finding** (se triggered):
```yaml
heuristic: gradual-auth-weakening
severity: MEDIUM
description: |
  Detectado: {auth_batches} batches modificando componentes de autenticacao/autorizacao.
  Padrao emergente pode indicar weakening progressivo da camada auth. needs context.
recommendation: Revisar diff acumulado de auth/* e middleware/auth — verificar se as mudancas sao aditivas (hardening) ou regressivas (weakening).
```

### H2: partial-rls-removal

**Logica**: contagem de batches em que `files_changed` matcham `/DISABLE|DROP\s+POLICY|RLS/i` **>= 2**.

```
rls_batches = count(batches where any(files_changed) matches /DISABLE|DROP\s+POLICY|RLS/i)
if rls_batches >= 2: TRIGGERED
```

**Finding** (se triggered):
```yaml
heuristic: partial-rls-removal
severity: MEDIUM
description: |
  Detectado: {rls_batches} batches com arquivos contendo DISABLE/DROP POLICY/RLS.
  Remocao parcial de RLS em multiplos batches pode indicar degradacao de seguranca de dados. needs context.
recommendation: Confirmar que cada modificacao RLS foi acompanhada de ADR ou justificativa explicitamente registrada em BATCHES.jsonl.notes.
```

### H3: secrets-surface-growing

**Logica**: verificar crescimento monotonic de `secrets-block.jsonl` + `secrets-warn.jsonl` counts por batch.
Monotonic = cada batch N+1 tem count >= batch N. Dois ou mais batches com dados suficientes para comparar.

```
telemetry_per_batch = group telemetry entries by batch_id
secrets_counts = [block_count + warn_count for each batch in order]
if len(secrets_counts) >= 2 AND is_monotonic_increasing(secrets_counts): TRIGGERED
```

**Finding** (se triggered):
```yaml
heuristic: secrets-surface-growing
severity: MEDIUM
description: |
  Detectado: superficie de secrets blocked/warned crescendo monotonicamente entre batches.
  Aumento progressivo pode indicar novos padroes de segredo sendo introduzidos. needs context.
recommendation: Inspecionar BATCHES que tiveram aumento de secrets-warn — verificar se secrets estao sendo removidos ou mitigados apos o warn.
```

### H4: domain-bleeding-cumulative

**Logica**: verificar crescimento monotonic de `domain-block.jsonl` counts por batch.

```
domain_counts = [domain_block_count for each batch in order]
if len(domain_counts) >= 2 AND is_monotonic_increasing(domain_counts): TRIGGERED
```

**Finding** (se triggered):
```yaml
heuristic: domain-bleeding-cumulative
severity: MEDIUM
description: |
  Detectado: domain violations blocked crescendo monotonicamente entre batches.
  Aumento cumulativo pode indicar pressao crescente para cruzar boundaries DDD. needs context.
recommendation: Revisar domain-map.json — verificar se regras estao adequadas OU se o codigo precisa ser refatorado para respeitar as camadas.
```

### H5: validation-removed-across-batches

**Logica**: contar findings nos trio reports que matcham `/no validation|missing input sanitization|unvalidated/i` **>= 2**.

```
validation_findings = count(findings in all trio reports where description matches /no validation|missing input sanitization|unvalidated/i)
if validation_findings >= 2: TRIGGERED
```

**Finding** (se triggered):
```yaml
heuristic: validation-removed-across-batches
severity: MEDIUM
description: |
  Detectado: {validation_findings} findings citando ausencia de validacao de input nos trio reports.
  Padrao recorrente pode indicar regressao sistematica de input validation. needs context.
recommendation: Localizar todos os endpoints/funcoes citados — adicionar validacao de input (Zod/class-validator) antes de fechar a tarefa.
```

## Step 3: Emit findings

Coletar todos os heuristicas triggered. Para cada:
- severity: **MEDIUM** (nunca CRITICAL — AC 9.3 — nao auto-CRITICAL por padrao emergente)
- a secao chama-se "Cross-batch findings"

Se nenhuma heuristica triggerar: escrever mensagem `"Nenhum padrao emergente detectado entre batches."` — `cross_batch_emergent` score permanece 1.0.

## Step 4: Append section `## Cross-batch findings` em `.aidd/current/REVIEW.md`

Formato da secao:

```markdown
## Cross-batch findings

> Gerado por: aidd-cross-batch-emergent em {ISO8601}
> Batches analisados: {N}
> Heuristicas verificadas: H1 gradual-auth-weakening, H2 partial-rls-removal, H3 secrets-surface-growing, H4 domain-bleeding-cumulative, H5 validation-removed-across-batches

{se nenhum finding}
Nenhum padrao emergente detectado. cross_batch_emergent score = 1.0.

{se findings presentes}
### Findings emergentes

| Heuristica | Severity | Description |
|---|---|---|
| {heuristic_id} | MEDIUM | {description_linha_1} — needs context |
...

**Nota**: todos os findings CROSS-BATCH tem severity MEDIUM "needs context". Nao sao auto-CRITICAL.
Humano deve avaliar se o padrao representa degradacao real ou mudancas intencionais documentadas.
```

## Step 5: Output para aidd-impl-finalize

Retornar para o chamador:
```
findings_count: N (numero de heuristicas triggered)
cross_batch_emergent_score: 1.0 if N==0 else max(0, 1.0 - N * 0.2)
triggered_heuristics: [lista de ids]
```

O chamador usa `cross_batch_emergent_score` para atualizar `CONFIDENCE.yaml`.

## Notas de implementacao

- **Fail graceful**: se BATCHES.jsonl ausente ou vazio, retornar `findings_count=0, score=1.0` e logar no REVIEW.md.
- **Linhas invalidas BATCHES.jsonl**: skip + log (CI-3 enforcement — linhas invalidas nao quebram o CBD).
- **Telemetria ausente**: se `.aidd/telemetry/secrets-block.jsonl` nao existe, H3 retorna false (sem dados = nao detectado).
- **Trio reports ausentes**: se qualquer REVIEW-{dim}.md ausente, H5 aplica somente sobre os disponiveis; logar aviso.

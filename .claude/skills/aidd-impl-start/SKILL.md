---
name: aidd-impl-start
description: Arma TDD-guard e marca CURRENT_TASK como phase 9 (Implementation). Verifica que tasks.md existe e foi aprovado (gate humano #3), atualiza .claude/aidd-tdd-config.json para enabled=true, atualiza phase no frontmatter de CURRENT_TASK, e dá o sinal verde para o agente começar TDD red→green→refactor. Use APÓS gate #3 aprovar tasks.md, ANTES de escrever qualquer código de produção.
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash(node:*)
---

# /aidd-impl-start — Transição para Phase 9 (Implementation, TDD)

Você é o agente que **arma a infraestrutura de TDD** para uma feature. Esta skill é o gate operacional entre Phase 8 (tasks aprovadas) e Phase 9 (implementação real).

## Pré-condições obrigatórias (verificar antes de agir)

1. `.aidd/current/CURRENT_TASK.md` existe e tem campo `phase` no frontmatter.
2. CURRENT_TASK.md menciona uma spec ativa em `.kiro/specs/<feat>/`.
3. `.kiro/specs/<feat>/tasks.md` existe e contém tarefas numeradas.
4. CURRENT_TASK.md tem nota explícita do gate humano #3 (algo como "tasks.md aprovado em <data>" no Log).

Se qualquer pré-condição falhar: **PARE** e reporte ao usuário a pré-condição faltando. Sugira retornar para `/kiro:spec-tasks` ou `/aidd` para diagnóstico.

## Passos obrigatórios

### Passo 1 — Confirmar com o usuário via AskUserQuestion

Antes de perguntar, ler `.aidd/current/CURRENT_TASK.md` e extrair `iteration` do frontmatter (campo opcional pos-refactor roadmap). Tratamento por valor:
- Campo ausente (CURRENT_TASK.md antigo, pre-refactor): exibir `—` na pergunta.
- Campo presente mas valor `null`, `~`, ou string vazia: exibir `—` na pergunta.
- Campo presente com slug válido: exibir o slug.

Header: "Iniciar impl", pergunta: "Confirma armar TDD-guard e mover phase=9 para a feature `<nome>` (iteração `<iteration ou —>`)? (TDD-guard vai bloquear edits em production sem teste tocado nos últimos 30 min.)". Opções:

- **Sim, armar TDD-guard e iniciar** (Recomendado)
- **Aguardar** — não estou pronto, falta algum check.
- **Cancelar**

### Passo 2 — Habilitar TDD-guard

Edite `.claude/aidd-tdd-config.json` para `{"enabled": true, "_comment": "..."}`. Mantenha o comentário existente.

### Passo 3 — Atualizar phase em CURRENT_TASK.md

Edite o frontmatter de CURRENT_TASK.md:

- `phase: 9`
- `status: implementing`

### Passo 4.5 — Inicializar BATCHES.jsonl (se ainda nao existe)

Crie `.aidd/current/BATCHES.jsonl` vazio (sem conteudo) se ainda nao existir. Este arquivo armazena entries JSON-Lines de cada batch executado na tarefa.

```bash
node -e "const fs=require('fs'); const p='.aidd/current/BATCHES.jsonl'; if(!fs.existsSync(p)){fs.writeFileSync(p,'');}"
```

Se ja existir, nao modificar (preservar historico de batches anteriores).

### Passo 4.6 — Inicializar CONFIDENCE.yaml (se ainda nao existe)

Crie `.aidd/current/CONFIDENCE.yaml` com valores iniciais baseados nas open questions da tarefa se ainda nao existir.

**Como calcular N_open_questions:** contar linhas na secao `## Open questions` de CURRENT_TASK.md que contenham `- ` (sem o `[x]` de resolucao). Se nao conseguir contar: usar `N = 0`.

**Formula de inicializacao (AC 10.1):**
- `spec_clarity = max(0.5, 1.0 - 0.1 * N_open_questions)`
- `design_coverage = max(0.5, 1.0 - 0.1 * N_open_questions)`
- `tdd_adherence = 1.0` (comeca otimista)
- `adversarial_clean_rate = 1.0` (comeca otimista)
- `regression_health = 1.0` (comeca otimista)
- `cross_batch_emergent = 1.0` (comeca otimista)

Criar via Bash:

```bash
node -e "
const fs = require('fs');
const path = '.aidd/current/CONFIDENCE.yaml';
if (!fs.existsSync(path)) {
  const task = require('js-yaml');
  const N = 0; // ajustar se open_questions detectadas
  const sc = Math.max(0.5, 1.0 - 0.1 * N);
  const content = [
    'version: 1',
    'task: \"<slug-da-tarefa>\"',
    'dimensions:',
    '  spec_clarity: ' + sc,
    '  design_coverage: ' + sc,
    '  tdd_adherence: 1.0',
    '  adversarial_clean_rate: 1.0',
    '  regression_health: 1.0',
    '  cross_batch_emergent: 1.0',
    'gate_penalty: 0',
    'thresholds:',
    '  pass: 0.75',
    '  warn: 0.60',
    '  fail: 0.40',
    'created_at: \"' + new Date().toISOString() + '\"',
  ].join('\n') + '\n';
  fs.writeFileSync(path, content);
  console.log('CONFIDENCE.yaml criado em', path);
} else {
  console.log('CONFIDENCE.yaml ja existe — preservado');
}
"
```

Se ja existir, nao modificar (pode ja ter historico de dimensoes atualizadas).

### Passo 4 — Inicializar heartbeat com buffer

Para evitar que o primeiro Edit do agente seja imediatamente denied, crie `.aidd/.tdd-heartbeat.json` com `lastTestEditTs` igual a `Date.now() - 25 * 60 * 1000` (25 min de buffer; expira em 5 min). Isso dá tempo do agente abrir um teste primeiro sem erro acidental.

**Como criar:** use `Write` no path `.aidd/.tdd-heartbeat.json` com conteúdo JSON. O timestamp deve ser calculado em momento de execução. **Não inclua código JavaScript no body desta skill — o agente que invocou é responsável por calcular `now - 25min` e escrever**. Se preferir Bash, rode:

```bash
node -e "require('fs').writeFileSync('.aidd/.tdd-heartbeat.json', JSON.stringify({lastTestEditTs: Date.now() - 25*60*1000, recentTestPaths: [], bufferReason: 'aidd-impl-start initial buffer (25 min)'}, null, 2))"
```

Conteúdo final do arquivo (exemplo, com timestamp ilustrativo — substitua pelo valor real calculado):

```json
{
  "lastTestEditTs": 1730000000000,
  "recentTestPaths": [],
  "bufferReason": "aidd-impl-start initial buffer (25 min)"
}
```

### Passo 5 — Anotar no Log

Append no Log de CURRENT_TASK.md:
- `*<data>* — /aidd-impl-start invocado. TDD-guard armado. Phase=9. Heartbeat com buffer de 25 min.`

### Passo 6 — Sinalizar próximo passo

Imprima:

```
┌─ TDD-GUARD ARMADO ───────────────────────────────────────┐
│ Phase: 9 (Implementation)                                │
│ Iteração: <iteration ou "(sem iteração)">                │
│ TDD-guard: enabled                                       │
│ Heartbeat: 25 min de buffer                              │
│ BATCHES.jsonl: <.aidd/current/BATCHES.jsonl>             │
│ CONFIDENCE.yaml: <.aidd/current/CONFIDENCE.yaml>         │
│                                                           │
│ Próximo passo OBRIGATÓRIO:                                │
│   1. Abrir tasks.md, escolher T1                          │
│   2. Escrever o TESTE de T1 PRIMEIRO (Edit em *.test.*)  │
│   3. Rodar — deve falhar (RED)                            │
│   4. Escrever código mínimo que faz passar (GREEN)       │
│   5. Ao fechar batch: append em BATCHES.jsonl            │
│   6. Repetir para T2, T3, ...                             │
│                                                           │
│ Override emergencial: AIDD_TDD_OVERRIDE=1                 │
│ Para fechar: /aidd-close ao terminar todas as tarefas    │
└──────────────────────────────────────────────────────────┘
```

## Stop Rules aplicáveis

- **TDD (Stop Rule #1)**: a partir desta skill, edits em production exigem teste tocado. Esta é a regra que esta skill mecaniza.
- **Two-attempt**: se Edit em config falhar 2x, pare e diagnostique.
- **Non-inventive**: nunca arme TDD-guard sem confirmar gate #3 explicitamente.

## O que NÃO fazer

- NÃO arme TDD-guard sem confirmar tasks.md aprovado pelo humano.
- NÃO execute código de implementação você mesmo aqui — esta skill apenas configura o ambiente.
- NÃO pule a confirmação via AskUserQuestion.

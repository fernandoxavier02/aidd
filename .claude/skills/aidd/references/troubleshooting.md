# Troubleshooting — Problemas Comuns no Ciclo AIDD

> Consulte este arquivo quando `/aidd` encontrar estado inconsistente, ambiguo ou de erro. Cada cenario tem sintoma, causa provavel e recovery path.

---

## Cenario T1 — CURRENT_TASK.md sem frontmatter

**Sintoma:**
Arquivo existe, mas nao comeca com `---`. Ou comeca com `---` mas nao tem campos `phase:` ou `status:`.

**Causa provavel:**
- Arquivo criado manualmente sem template.
- Frontmatter corrompido durante edicao.
- Tarefa de projeto anterior ao AIDD (legado).

**Recovery path:**
1. Verificar se existe `.aidd/archive/` com tarefa recente — pode indicar que o arquivo deveria ter sido recriado.
2. Se a intencao e continuar uma tarefa existente: usar `Read` para extrair informacoes manualmente e propor recriar o frontmatter.
3. Se a intencao e comecar nova tarefa: recomendar `/aidd-intake` para gerar arquivo fresh com template correto.
4. NUNCA adivinhar phase/status — perguntar ao usuario.

---

## Cenario T2 — Multiplas tarefas empilhadas

**Sintoma:**
CURRENT_TASK.md contem multiplas secoes `## Tarefa atual:` ou `## Original request`. O frontmatter pode refletir a tarefa mais antiga.

**Causa provavel:**
- Tarefa anterior nao foi arquivada (falha no `/aidd-close`).
- Usuario anexou nova secao sem arquivar a anterior.
- Hook de archive falhou silenciosamente.

**Recovery path:**
1. Identificar a ultima secao `## Tarefa atual:` — esta e a ativa por convencao.
2. Verificar o `status:` da penultima tarefa:
   - Se `done` ou `done-local`: oferecer arquivar a secao antiga automaticamente.
   - Se `active` ou `implementing`: alertar usuario que ha tarefa anterior nao fechada.
3. Nunca descartar conteudo sem confirmar — usar AskUserQuestion:
   - "Archivar secao antiga e focar na nova (Recomendado)"
   - "Fechar tarefa anterior primeiro"
   - "Manter empilhado (avancado)"

---

## Cenario T3 — Phase inconsistente com artefatos

**Sintoma:**
Frontmatter diz `phase: 9` (implementation), mas nao existe `.kiro/specs/<feat>/tasks.md`. Ou `phase: 5` mas nao ha `requirements.md`.

> O `<feat>` e o slug da tarefa atual, extraido do titulo em `## Tarefa atual:`. Se o slug nao estiver claro, listar pastas em `.kiro/specs/` para inferir.

**Causa provavel:**
- Phase foi alterada manualmente sem completar a fase anterior.
- Tarefa foi abortada no meio e reiniciada incorretamente.
- Merge de branch trouxe CURRENT_TASK.md com phase avancada mas sem artefatos.

**Recovery path:**
1. Detectar qual artefato da phase atual esta faltando.
2. Recomendar recovery para a phase anterior que tem artefato completo:
   - Se tasks.md falta → voltar para phase 7 ou 8.
   - Se design.md falta → voltar para phase 5 ou 6.
   - Se requirements.md falta → voltar para phase 4.
3. Logar a inconsistencia no diagnostico:
   ```
   ⚠️  Phase=9 mas tasks.md nao encontrado em .kiro/specs/X/
   Recovery: retornar para /kiro:spec-tasks (phase 8)
   ```
4. Perguntar ao usuario antes de qualquer alteracao de phase.

---

## Cenario T4 — Gate humano pulado

**Sintoma:**
CURRENT_TASK.md tem `phase: 9` mas o Log nao registra aprovacao do gate #3 (tasks.md aprovado). Ou phase=12 sem registro de gate #5.

> O `<feat>` e o slug da tarefa atual, extraido do titulo em `## Tarefa atual:`. Se o slug nao estiver claro, listar pastas em `.kiro/specs/` para inferir.

**Causa provavel:**
- Usuario ou agente alterou phase manualmente sem passar pelo gate.
- Tarefa de complexidade SIMPLES foi tratada como implicita.
- Log nao foi atualizado corretamente.

**Recovery path:**
1. Nao bloquear automaticamente — pode ser falso positivo (log nao atualizado).
2. No diagnostico, adicionar WARN:
   ```
   ⚠️  Phase=9 mas gate #3 nao detectado no Log.
   Verificar: .kiro/specs/<feat>/tasks.md foi aprovado?
   ```
3. Se tasks.md existe e parece completo: oferecer registrar gate retroativamente no Log.
4. Se tasks.md nao existe: recomendar voltar para `/kiro:spec-tasks`.

---

## Cenario T5 — TDD-guard desincronizado

**Sintoma:**
`phase: 9` mas `.claude/aidd-tdd-config.json` esta `enabled: false`. Ou heartbeat `.aidd/.tdd-heartbeat.json` esta stale (mais de 30 min sem atualizacao).

**Causa provavel:**
- `/aidd-close` nao desabilitou TDD-guard (falha no passo 4).
- `/aidd-impl-start` nao foi usado — phase foi alterada manualmente.
- Sessao foi interrompida e TDD-guard expirou.

**Recovery path:**
1. Se phase=9 e TDD-guard=false: perguntar se quer rearmar:
   - "Rearmar TDD-guard e continuar (Recomendado)"
   - "Continuar sem TDD-guard (avancado)"
2. Se heartbeat expirou: explicar que o proximo Edit em producao sera bloqueado ate que um teste seja tocado.
3. Oferecer criar novo heartbeat com buffer de 25 min via `/aidd-impl-start`.

---

## Cenario T6 — Spec orphan (tasks.md sem requirements.md)

**Sintoma:**
Existe `.kiro/specs/<feat>/tasks.md` mas nao ha `requirements.md` na mesma pasta. Ou existe `design.md` mas nao ha `requirements.md`.

> O `<feat>` e o slug da tarefa atual, extraido do titulo em `## Tarefa atual:`. Se o slug nao estiver claro, listar pastas em `.kiro/specs/` para inferir.

**Causa provavel:**
- Arquivo foi movido ou deletado acidentalmente.
- Tarefa foi criada fora do ciclo AIDD (bypass).
- requirements.md foi renomeado mas tasks.md nao foi atualizado.

**Recovery path:**
1. Nao recomendar `/aidd-impl-start` — prerequisite faltando.
2. No diagnostico, indicar:
   ```
   ❌ tasks.md existe mas requirements.md ausente em .kiro/specs/X/
   Recovery: recriar requirements.md via /kiro:spec-requirements
   ```
3. Se o usuario confirmar que requirements existem em outro lugar, atualizar o path na tarefa.

---

## Cenario T7 — CURRENT_TASK.md nao existe

**Sintoma:**
Arquivo `.aidd/current/CURRENT_TASK.md` nao existe. A pasta `.aidd/current/` pode ou nao existir.

**Causa provavel:**
- Projeto novo, nunca teve tarefa AIDD.
- Pasta `.aidd/` foi deletada ou movida.
- Usuario esta em diretorio errado.

**Recovery path:**
1. Verificar se `PROJECT_BRIEF.md` existe na raiz — confirma que estamos no projeto certo.
2. Se projeto existe mas CURRENT_TASK.md nao:
   - Imprimir: "Nenhuma tarefa AIDD ativa."
   - Recomendar: `/aidd-intake` para iniciar.
3. Se projeto nao existe (sem PROJECT_BRIEF.md):
   - Imprimir: "Diretorio atual nao parece ser um projeto AIDD."
   - Recomendar: verificar diretorio ou iniciar projeto novo.

---

## Cenario T8 — Phase 10+ sem VERIFICATION_REPORT.md

**Sintoma:**
Phase 10, 11 ou 12 mas `.aidd/current/VERIFICATION_REPORT.md` nao existe ou esta vazio.

> O `<feat>` e o slug da tarefa atual, extraido do titulo em `## Tarefa atual:`. Se o slug nao estiver claro, listar pastas em `.kiro/specs/` para inferir.

**Causa provavel:**
- Fase de verificacao foi pulada.
- Arquivo nao foi criado (agente esqueceu).
- VERIFICATION_REPORT.md foi deletado.

**Recovery path:**
1. Se phase=10/11/12 e VERIFICATION_REPORT.md ausente:
   - Adicionar WARN no diagnostico.
   - Recomendar retornar para phase 10 (`/gsd-verifier`) para gerar o relatorio.
2. Se o usuario confirmar que verificacao foi feita informalmente:
   - Oferecer criar VERIFICATION_REPORT.md retroativo com nota "verificacao informal".

---

## Cenario T9 — CURRENT_TASK.md vazio ou corrompido

**Sintoma:**
Arquivo `.aidd/current/CURRENT_TASK.md` tem 0 bytes, ou contem apenas whitespace, ou nao e valido markdown.

**Causa provavel:**
- Hook ou script falhou e esvaziou o arquivo.
- Edicao manual foi interrompida.
- Problema de encoding ou line endings.

**Recovery path:**
1. Verificar `.aidd/archive/` — pode haver backup recente.
2. Se houver backup: restaurar do archive mais recente.
3. Se nao houver: tratar como T7 (arquivo nao existe) — recomendar `/aidd-intake`.
4. Nunca tentar reconstruir frontmatter de arquivo vazio sem confirmar com usuario.

---

## Cenario T10 — Iteracao da tarefa difere da iteracao ativa do projeto

**Sintoma:** O frontmatter de `CURRENT_TASK.md` tem `iteration: 03-mvp-mobile`, mas `roadmap/STATUS.md` tem `current_iteration: 02-mvp-backend`. `/aidd` exibe WARN T10.

**Causa provavel:**
- Tarefa foi criada apontando para iteracao futura (ex: planejamento de iteracao posterior durante a ativa).
- Iteracao ativa foi avancada (`/aidd-close` Passo 9.6 arquivou a anterior) mas a CURRENT_TASK ainda referencia a antiga.
- Edicao manual divergente em um dos dois arquivos.

**Recovery:**
1. Decidir qual e a fonte autoritativa: a tarefa esta sendo executada agora (atualizar CURRENT_TASK.iteration) ou a iteração ativa e outra (atualizar STATUS.current_iteration)?
2. Se tarefa estiver alinhada com a iteracao real ativa, editar `STATUS.md` para refletir.
3. Se tarefa pertence a iteracao futura, editar `CURRENT_TASK.iteration` para a iteracao correta — mas considerar se a tarefa nao deveria ser pausada ate a iteracao certa entrar em escopo.

## Cenario T11 — `roadmap/STATUS.md` ausente mas tarefa tem `iteration:`

**Sintoma:** `CURRENT_TASK.md` tem `iteration: 02-mvp-backend` mas `roadmap/STATUS.md` nao existe.

**Causa provavel:**
- Projeto antes do bootstrap do roadmap.
- Pasta `roadmap/` deletada acidentalmente ou nao versionada.
- Tarefa migrada de outro projeto.

**Recovery:**
1. Se o projeto adotou roadmap mas `STATUS.md` foi perdido: regenerar manualmente a partir do `iteration` da tarefa atual.
2. Se o projeto nao usa roadmap: remover o campo `iteration` do frontmatter de `CURRENT_TASK.md` (set para `null`).
3. Se desconhecido: invocar `/aidd` novamente, ele vai exibir WARN T11. Decidir se vale criar a estrutura `roadmap/` agora ou desativar a referencia.

## Cenario T12 — `roadmap/METHODOLOGY.md` ausente

**Sintoma:** `/aidd-close` (ou outras skills roadmap-aware) nao consegue ler `methodology`, `unit_dir`, `iteration_pattern`. Cai no default `aidd-vanilla` silenciosamente.

**Causa provavel:**
- Bootstrap incompleto da pasta `roadmap/`.
- Arquivo deletado.
- Migracao de outro projeto.

**Recovery:**
1. Se a estrutura `roadmap/` existe mas `METHODOLOGY.md` nao: regenerar a partir do template de bootstrap (default: `aidd-vanilla`, `unit_dir: iterations`, `iteration_pattern: NN-slug`).
2. Confirmar com o usuario se a metodologia e mesmo `aidd-vanilla` ou se outra deveria estar registrada.
3. Apos regenerar, executar `/aidd` novamente para confirmar que o WARN T12 sumiu.

## Cenario T13 — Iteracao da tarefa esta em `archive/` em vez de `active/`

**Sintoma:** `CURRENT_TASK.md` aponta para `iteration: 01-mvp-foundation`, mas a pasta esta em `roadmap/iterations/archive/` (nao `active/`). Tentativa de marcar [x] em `02-tasks.md` falha porque `/aidd-close` Passo 9.5 procura em `active/`.

**Causa provavel:**
- Tarefa foi movida entre iteracoes mas `iteration` no frontmatter nao foi atualizado.
- Iteracao foi arquivada mas a tarefa estava em andamento (incoerencia no arquivamento).

**Recovery:**
1. Identificar a iteracao ativa correta: `cat roadmap/STATUS.md | grep current_iteration`.
2. Atualizar `CURRENT_TASK.iteration` para a iteracao correta.
3. Mover a referencia da tarefa de `archive/01-.../02-tasks.md` (se foi acidentalmente registrada la) para `active/<current>/02-tasks.md`.
4. Se a iteracao foi arquivada erroneamente: mover de volta de `archive/` para `active/` (Bash `mv`) e atualizar `STATUS.md`.

## Checklist de Diagnostico Rapido

Quando `/aidd` encontrar problema, percorrer nesta ordem:

1. [ ] CURRENT_TASK.md existe?
2. [ ] Tem frontmatter YAML valido?
3. [ ] Tem campos `phase:` e `status:`?
4. [ ] Ha secao `## Tarefa atual:`?
5. [ ] O status da tarefa anterior e `done`?
6. [ ] O artefato da phase atual existe (requirements/design/tasks)?
7. [ ] O gate humano da phase anterior esta documentado no Log?
8. [ ] TDD-guard esta sincronizado (se phase=9)?
9. [ ] VERIFICATION_REPORT.md existe (se phase >= 10)?
10. [ ] Se a tarefa tem `iteration:`, `roadmap/STATUS.md` existe e o `current_iteration` bate?
11. [ ] `roadmap/METHODOLOGY.md` existe se outras skills referenciam?
12. [ ] A pasta da iteracao da tarefa esta em `active/` (nao em `archive/`)?

Se qualquer item falhar: consultar este troubleshooting.md para recovery path.

---

*Mantenha este arquivo atualizado. Novos cenarios de erro descobertos durante operacao devem ser adicionados aqui.*

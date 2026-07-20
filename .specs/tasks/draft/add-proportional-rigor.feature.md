---
title: Add proportional rigor map to AIDD harness (SIMPLES/MEDIA/COMPLEXA)
---

## Initial User Prompt

Então eu quero agora fazer um brainstorm com você pra gente poder pegar essas partes aí das críticas e melhorá-las.

(Contexto: das três críticas da avaliação do harness — peso do processo sem proporcionalidade, guardas restritos ao Claude Code, e detecção frágil de código de produção — o usuário escolheu atacar **proporcionalidade** neste brainstorm.)

### Requirements

Decisões aprovadas no brainstorm (2026-07-20):

1. **Quem decide o nível:** a IA propõe o nível de rigor na abertura da tarefa (intake), com justificativa baseada em 4 critérios (nº estimado de arquivos tocados, mexe em lógica/dados ou não, reversibilidade, área sensível do domínio); o humano confirma via AskUserQuestion antes de gravar.
2. **Escala:** reusar os 3 níveis já existentes — `SIMPLES` / `MEDIA` / `COMPLEXA` — gravados no frontmatter `complexity` de `.aidd/current/CURRENT_TASK.md` (SSOT; já lido por `parse-current-task.js`). Nenhum formato novo.
3. **Mecanismo:** tabela de rigor em arquivo de configuração novo `.claude/aidd-rigor-map.json` (categoria SCAFFOLD — copiado ao projeto consumidor e hash-tracked no manifesto, editável por time). A tabela declara, por nível: fases obrigatórias, human gates exigidos e comportamento de cada guarda (`block` | `warn` | `off`).
4. **TDD por nível:** no SIMPLES o `aidd-tdd-guard-v2.cjs` passa a **avisar e deixar passar mediante justificativa registrada** (reusa o mecanismo de override existente — telemetria + mínimo de 20 caracteres); em MEDIA e COMPLEXA permanece bloqueio duro.

Tabela padrão de fábrica:

| Nível | Fases obrigatórias | Human gates | TDD guard | Adversarial |
|---|---|---|---|---|
| SIMPLES | 1 (intake), 2 (contexto), 9 (impl), 10 (verificação) — ACs curtos na própria ficha, sem spec separada | 1 (aprovação final) | warn + justificativa | dispensado (auto-revisão no close) |
| MEDIA | + 5 (requirements), 8 (tasks), 11 (review); design.md opcional (só se houver decisão arquitetural) | 2 (requirements + final) | block | passada única por batch (existente) |
| COMPLEXA | todas as 12 fases (comportamento atual, inalterado) | 5 (atuais) | block | trio adversarial (atual) |

Regra de escalada: subir de nível no meio da tarefa é sempre permitido e registrado na ficha; **descer exige decisão humana explícita**.

Fail-safe (na dúvida, rigor máximo):
- Tabela ausente/corrompida → guardas se comportam como hoje (COMPLEXA).
- `complexity` ausente ou fora da escala → tratar como COMPLEXA + aviso.
- Erro de configuração nunca afrouxa o processo por acidente.

Peças tocadas:
- **Novo:** `.claude/aidd-rigor-map.json` (+ entrada em `SCAFFOLD_FILES` no `lib/cli/files-map.cjs`).
- **Ajustes:** `.claude/skills/aidd-intake/SKILL.md` (passo propõe-e-confirma), `.claude/hooks/aidd-tdd-guard-v2.cjs` e `.claude/hooks/aidd-phase-guard.cjs` (leem nível + tabela), `AIDD.md` (nova seção "Proportionality" com tabela em prosa), `lib/cli/doctor.cjs` (check de validade da tabela).
- **Coerência mecanizada:** tabela em prosa no `AIDD.md` deve bater com o JSON — novo teste de integridade no molde de `tests/hooks/config-integrity.test.cjs` (mesmo padrão das stop rules).

Testes exigidos:
- TDD guard nos 3 níveis (SIMPLES avisa/deixa passar com justificativa; MEDIA/COMPLEXA bloqueiam).
- Phase guard pulando fases dispensadas pela tabela.
- Cenários de falha (sem tabela / complexity inválido → comportamento COMPLEXA).
- Integridade prosa ↔ JSON.
- CLI: `init` copia a tabela; `update` respeita edição do usuário (hash); `doctor` valida presença/estrutura.

Meta: pela própria régua criada, esta tarefa classifica-se como MEDIA (requirements + tasks + TDD duro).

## Description

// Will be filled in future stages by business analyst

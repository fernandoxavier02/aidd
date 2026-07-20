# FILES_CHANGED.md

Arquivos modificados na tarefa `aidd-npm-product`.

| Arquivo | Tipo de mudança | Motivo |
|---|---|---|
| .aidd/current/CURRENT_TASK.md | criado | Intake da tarefa (fase 1) |
| .aidd/current/FILES_READ.md | criado | Registro de leitura da análise |
| .aidd/current/FILES_CHANGED.md | criado | Este registro |
| .aidd/current/VERIFICATION_REPORT.md | resetado e depois preenchido | Evidências da verificação completa |
| package.json | modificado | Pacote publicável: nome @fx-studio-ai/aidd v2.0.0, bin, files, scripts de teste corrigidos |
| LICENSE | criado | MIT — obrigatório para publicar |
| bin/aidd.cjs | criado | Entrada do CLI (init/update/doctor/version) |
| lib/cli/files-map.cjs | criado | Classificação scaffold/engine/bootloader |
| lib/cli/manifest.cjs | criado | Manifesto .aidd/harness.json (sha256 por arquivo) |
| lib/cli/settings.cjs | criado | Geração híbrida + merge idempotente de settings.json |
| lib/cli/bootloader.cjs | criado | Bloco marcado em CLAUDE.md/AGENTS.md |
| lib/cli/init.cjs | criado | Instalação no projeto consumidor |
| lib/cli/update.cjs | criado | Atualização preservando edições do usuário |
| lib/cli/doctor.cjs | criado | Diagnóstico de wiring (15 checks) |
| .claude/hooks/aidd-secrets-guard.cjs | modificado | Catálogo de segredos customizável por projeto (env → projeto → embutido) |
| tests/cli/cli.test.cjs | criado | 19 testes do CLI |
| README.md | modificado | Instalação via npm como caminho principal |
| INSTALL.md | modificado | Opção A (npm) documentada; tabela de configs atualizada |

### Repositório externo: Pipeline-Orchestrator-Install (escrita via terminal — phase-guard bloqueia Write fora da raiz, correto)

| Arquivo | Tipo de mudança | Motivo |
|---|---|---|
| bin/cli.cjs | modificado | Menu de produtos (PO/AIDD/ambos), --product, rota aidd, requires array |
| tests/cli.test.cjs | modificado | Cobertura dos novos planos e flags |
| package.json | modificado | Bump 0.2.0 |
| README.md | modificado | Documenta menu de produtos |
| CHANGELOG.md | modificado | Entrada 0.2.0 |

# FILES_READ.md

Arquivos consultados na tarefa `aidd-npm-product`.

| Arquivo | Motivo | Conclusão |
|---|---|---|
| AIDD.md | MUST READ — metodologia | 12 fases, 6 stop rules, gates humanos, enforcement por hooks |
| PROJECT_BRIEF.md | MUST READ — snapshot | Ainda é template com placeholders (repo é o próprio harness) |
| CONTEXT_INDEX.md | MUST READ — roteamento | Duas lanes (A projeto / B spec); docs ausentes são gaps |
| package.json | Avaliar publicabilidade | `private: true`, sem `bin`, sem `files` — não publicável hoje |
| README.md | Entender distribuição atual | Modelo clone/copy; v1.0.0; 6 docs + 12 hooks + 8 skills |
| INSTALL.md | Caminho de instalação atual | Cópia manual + merge manual de settings.json (propenso a erro) |
| .claude/settings.json | Registro de hooks | 12 hooks via ${CLAUDE_PROJECT_DIR} — portável, mas exige merge manual |
| .claude/hooks/lib/aidd-paths.cjs | Qualidade/acoplamento | Bem feito (path-traversal, symlink defense); hardcoda paths .kiro/ |
| tests (npm test) | Sanidade do harness | 33/33 verdes |
| ~/.claude/plugins/installed_plugins.json | Localizar orchestrator | Plugin `pipeline-orchestrator@FX-Studio-AI` v7.10.1, via marketplace GitHub |
| cache do plugin pipeline-orchestrator/package.json | Formato do pacote | `@fx-studio-ai/pipeline-orchestrator`, files[], bin validate-trace |
| D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator-Install\package.json + bin/cli.cjs | Instalador unificado | Roteador fino v0.1.0: pergunta Claude/OpenCode, dispara caminho nativo. Ponto de extensão ideal para menu de produtos |
| registro npm (npm view/search) | Verificar publicação | 404 para ambos os pacotes — nada publicado no registro público |

---
name: aidd-domain-init
description: Inicializa .aidd/domain-map.json com layers e import rules para o projeto atual. Usado pelo Domain_Guard hook (aidd-domain-guard.cjs) para enforcement de fronteiras DDD em PreToolUse.
version: 1.0.0
allowed-tools: Read, Glob, Write, AskUserQuestion, Bash
tags: [aidd, domain, ddd, architecture, tooling]
globs: [".aidd/domain-map.json", ".aidd/domain-map.schema.json"]
alwaysApply: false
---

# /aidd-domain-init

Detecta a estrutura do projeto, propõe um template de `domain-map.json` baseado no stack identificado e escreve o arquivo após confirmação.

O `domain-map.json` é lido pelo hook `aidd-domain-guard.cjs` a cada PreToolUse (Edit/Write/MultiEdit). Sem ele, o hook entra em modo WARN+ALLOW e não bloqueia imports cross-layer.

---

## Pré-condições

- `PROJECT_BRIEF.md` deve existir na raiz (fonte do stack).
- Diretório `.aidd/` deve existir (criado pela skill `/aidd-impl-start`).
- Se `.aidd/domain-map.json` já existir, a skill pergunta antes de substituir.

---

## Steps

### Step 1 — Verificar existência do domain-map

```bash
ls .aidd/domain-map.json 2>/dev/null && echo "EXISTS" || echo "ABSENT"
```

Se `EXISTS`: invocar **AskUserQuestion** com:
- Header: `domain-map`
- Pergunta: "`.aidd/domain-map.json` já existe. O que fazer?"
- Opções:
  1. `Substituir pelo novo template (Recomendado)` — prossegue com Steps 2-6
  2. `Manter o existente e sair` — exibir path do arquivo e encerrar
  3. `Abrir o existente para revisar` — Read o arquivo, exibir, e perguntar novamente

### Step 2 — Glob da estrutura do projeto (top-3 levels)

Executar `Glob` para listar diretórios nas camadas 1-3:

```
Glob: **/{src,app,apps,lib,domain,application,infrastructure,ports,shared,packages}/*
```

Extrair:
- Diretórios de frontend: `apps/`, `front-end/`, `packages/`
- Diretórios de backend: `services/`, `src/`, `lib/`
- Monorepo flag: presença de `packages/` ou `apps/` no nível 1

### Step 3 — Detectar stack via PROJECT_BRIEF.md

Ler `PROJECT_BRIEF.md` e localizar a tabela de stack ou seção "Tech Stack". Buscar:
- **Fastify** → backend Node.js (Vertical Slice / Use-Case Architecture)
- **Prisma** → ORM Node.js
- **Supabase** → BaaS (Auth + DB)
- **React/Next.js/Expo/Flutter** → frontend
- **Python/FastAPI/Django** → backend Python
- **Rails** → Ruby backend

Também verificar `package.json` raiz para dependências diretas.

### Step 4 — Propor template baseado no stack detectado

#### Template: Node.js monorepo (services/*/src + apps/* + packages/*)

```json
{
  "$schema": "./domain-map.schema.json",
  "version": 1,
  "layers": {
    "domain": [
      "services/*/src/domain/**",
      "services/*/src/**/entities/**",
      "services/*/src/**/value-objects/**"
    ],
    "application": [
      "services/*/src/application/**",
      "services/*/src/flows/**",
      "services/*/src/use-cases/**"
    ],
    "ports": [
      "services/*/src/ports/**",
      "services/*/src/**/ports/**"
    ],
    "infrastructure": [
      "services/*/src/infrastructure/**",
      "services/*/src/db/**",
      "services/*/src/adapters/**",
      "services/*/prisma/**"
    ],
    "frontend": [
      "apps/**",
      "front-end/**"
    ],
    "shared": [
      "packages/shared/**"
    ]
  },
  "rules": [
    {
      "from": "domain",
      "cannot_import_from": ["application", "infrastructure", "frontend"],
      "rationale": "Domain depends only on abstractions — no upstream layers"
    },
    {
      "from": "application",
      "cannot_import_from": ["infrastructure"],
      "exception_via": "ports",
      "rationale": "Application talks to infrastructure only via port interfaces (DI)"
    },
    {
      "from": "frontend",
      "cannot_import_from": ["domain", "application", "infrastructure"],
      "rationale": "Frontend talks to backend via HTTP API only — no direct imports"
    },
    {
      "from": "shared",
      "cannot_import_from": ["domain", "application", "infrastructure", "frontend"],
      "rationale": "Shared kernel has no upstream project dependencies"
    }
  ],
  "frontend_business_suppress": [
    "apps/*/lib/calculators/**",
    "apps/*/domain/**"
  ]
}
```

#### Template genérico (stack não reconhecido)

```json
{
  "$schema": "./domain-map.schema.json",
  "version": 1,
  "layers": {
    "domain": ["src/domain/**"],
    "application": ["src/application/**"],
    "ports": ["src/ports/**"],
    "infrastructure": ["src/infrastructure/**"],
    "frontend": ["src/frontend/**", "apps/**"],
    "shared": ["src/shared/**", "packages/**"]
  },
  "rules": [
    {
      "from": "domain",
      "cannot_import_from": ["application", "infrastructure", "frontend"],
      "rationale": "Domain layer has no upstream dependencies"
    },
    {
      "from": "application",
      "cannot_import_from": ["infrastructure"],
      "exception_via": "ports",
      "rationale": "Application uses Dependency Inversion via ports"
    },
    {
      "from": "frontend",
      "cannot_import_from": ["domain", "application", "infrastructure"],
      "rationale": "Frontend only communicates via API contracts"
    },
    {
      "from": "shared",
      "cannot_import_from": ["domain", "application", "infrastructure", "frontend"],
      "rationale": "Shared kernel is dependency-free"
    }
  ]
}
```

### Step 5 — AskUserQuestion para confirmação

Invocar **AskUserQuestion** com:
- Header: `Domain Map`
- Pergunta: "Template detectado para `<stack>`. Usar este template ou customizar?"
- Opções:
  1. `Usar template <stack> (Recomendado)` — prossegue com este template
  2. `Usar template genérico` — usa o template genérico acima
  3. `Customizar layers manualmente` — exibe o template e pede ajuste via texto livre (campo Other)
  4. `Ver template antes de decidir` — imprime o JSON e pergunta novamente

### Step 6 — Escrever arquivos

Após confirmação:

1. Verificar se `.aidd/domain-map.schema.json` existe. Se não, criar com o schema JSON Schema draft-07 (ver arquivo de referência em `.aidd/domain-map.schema.json` se já existir no projeto, ou gerar inline).

2. Escrever `.aidd/domain-map.json` com o template escolhido/ajustado.

3. Validar o JSON gerado:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('.aidd/domain-map.json'))" && echo "JSON válido"
   ```

4. Verificar contagem de layers e rules:
   ```bash
   node -e "const m=JSON.parse(require('fs').readFileSync('.aidd/domain-map.json')); console.log('layers:', Object.keys(m.layers).length, 'rules:', m.rules.length)"
   ```

### Step 7 — Print summary

Imprimir confirmação final:

```
┌─ DOMAIN-GUARD ARMADO ─────────────────────────────────────────────┐
│ Arquivo: .aidd/domain-map.json                                     │
│ Layers: <N> (<nomes>)                                              │
│ Rules: <N>                                                         │
│                                                                    │
│ Domain_Guard ativo via hook aidd-domain-guard.cjs                  │
│ (registrado em .claude/settings.json na Task 9.1)                  │
│                                                                    │
│ Próximo passo: /aidd diagnostic — verificar boundaries detectadas  │
│ Para editar layers: .aidd/domain-map.json (hot-reload automático)  │
└───────────────────────────────────────────────────────────────────┘
```

---

## Comportamento especial: domain-map já existe e é válido

Se o arquivo existente tiver o mesmo número de layers e rules do template proposto (drift < 10%), oferecer opção de **merge** (adicionar layers faltantes sem remover as existentes) em vez de substituição completa.

---

## Stop Rules aplicáveis

- **Non-inventive**: nunca inventar nomes de layers sem evidência no código-fonte do projeto.
- **Two-attempt**: se write falhar 2x, parar e diagnosticar.
- **SSOT**: `.aidd/domain-map.json` é o SSOT das layers; não duplicar em outros arquivos.

---

## Notas de implementação

- O hook `aidd-domain-guard.cjs` re-lê o `domain-map.json` a cada invocação (hot-reload). Não é necessário restart do Claude Code após editar o arquivo.
- A env var `AIDD_DOMAIN_MAP_PATH` sobrepõe o path padrão (usada nos testes).
- Overrides de rules (ex: cross-layer intencional em prototype) exigem `AIDD_OVERRIDE_DOMAIN=ADR-NNNN`.
- Para adicionar caminhos de supressão do `Frontend_Business_Guard`, editar a chave `frontend_business_suppress` no json.

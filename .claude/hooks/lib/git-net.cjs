#!/usr/bin/env node
"use strict";
// Universal git pre-commit net — the guaranteed enforcement layer.
// Runs the fiscal guards over STAGED content (index blobs via `git show :0:`,
// never the worktree — spec R1 finding 2) and maps verdicts to git semantics:
// deny → exit 1 (commit blocked), warn → stderr + exit 0 (R1 finding 12).
//
// Session env bypasses (AIDD_V2_INSTALL, AIDD_TDD_OVERRIDE, AIDD_OVERRIDE_*)
// are edit-time affordances and are deliberately NOT honored here (R1 f10);
// config paths are resolved directly, ignoring env redirections.
//
// TDD check uses the DISTINCT commit-time policy (any heartbeat entry, no TTL;
// absent evidence → warn, never deny — R1 finding 3).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { guards } = require("./guards/index.cjs");
const secretsCore = require("./guards/secrets.cjs");
const rlsCore = require("./guards/rls.cjs");
const tddCore = require("./guards/tdd.cjs");

function gitOut(root, args, opts = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
  return r.status === 0 ? r.stdout : null;
}

/** Staged files with status: A(dded)/C(opied)/M(odified)/R(enamed). */
function stagedFiles(root) {
  const out = gitOut(root, ["diff", "--cached", "--name-status", "--diff-filter=ACMR", "-z"]);
  if (!out) return [];
  // -z format: STATUS\0path\0 (renames/copies: STATUS\0old\0new\0)
  const parts = out.split("\0").filter((p) => p.length > 0);
  const files = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i][0];
    if (status === "R" || status === "C") {
      files.push({ status, rel: (parts[i + 2] || "").replace(/\\/g, "/") });
      i += 3;
    } else {
      files.push({ status, rel: (parts[i + 1] || "").replace(/\\/g, "/") });
      i += 2;
    }
  }
  return files.filter((f) => f.rel);
}

/** Content of the INDEX blob (what will actually be committed). */
function stagedContent(root, rel) {
  const out = gitOut(root, ["show", `:0:${rel}`]);
  return out === null ? "" : out;
}

/** Catálogo de secrets SEM honrar env (a rede não aceita redirecionamento). */
function loadCatalogStrict(root) {
  const projectCatalog = path.join(root, ".claude", "aidd-secrets-patterns.json");
  const bundled = path.join(__dirname, "..", "aidd-secrets-patterns.json");
  const p = fs.existsSync(projectCatalog) ? projectCatalog : bundled;
  try {
    return secretsCore.compileCatalog(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch (e) {
    return { ok: false, reason: `catalogo ilegivel: ${e.message}` };
  }
}

/** Domain map validado, lido do path canônico (sem env). */
function loadValidatedDomainMap(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, ".aidd", "domain-map.json"), "utf8"));
    if (!parsed || typeof parsed.layers !== "object" || !Array.isArray(parsed.rules)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Domain map permissivo (frontend-business), path canônico (sem env). */
function loadPermissiveDomainMap(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".aidd", "domain-map.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Manifesto do harness (hashes do que a própria ferramenta instalou). */
function loadHarnestManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".aidd", "harness.json"), "utf8"));
  } catch {
    return null;
  }
}

function run(root) {
  const files = stagedFiles(root);
  if (files.length === 0) return 0;

  const manifest = loadHarnestManifest(root);
  const catalog = loadCatalogStrict(root);
  const domainMap = loadValidatedDomainMap(root);
  const permissiveMap = loadPermissiveDomainMap(root);
  const rlsEnabled = rlsCore.loadRlsConfig(root).enabled;
  const tddEnabled = tddCore.loadTddConfig(root).enabled;
  const heartbeat = tddCore.readHeartbeat(root);

  let denies = 0;
  const warned = new Set();

  for (const f of files) {
    const content = stagedContent(root, f.rel);

    // Conteúdo gerido pela própria ferramenta: se o blob staged é byte-idêntico
    // ao hash que o `aidd init/update` gravou no manifesto, isto é o instalador
    // atualizando um arquivo gerido (ex.: AIDD.md numa atualização de versão) —
    // não uma edição humana. Pula os guardas para este arquivo.
    if (manifest && manifest.files && manifest.files[f.rel]) {
      const sha = crypto.createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
      if (sha === manifest.files[f.rel]) continue;
    }

    const base = {
      action: f.status === "M" ? "edit" : "write",
      path: f.rel,
      content,
      projectRoot: root,
      fileExists: f.status === "M",
    };

    const checks = [
      ["contract", {}],
      ["secrets", { secrets: { catalog } }],
    ];
    if (rlsEnabled) {
      const abs = path.join(root, ...f.rel.split("/"));
      const siblings = rlsCore.SQL_MIGRATION_RE.test(f.rel) ? rlsCore.readSiblings(abs, { honorEnv: false }) : [];
      checks.push(["rls", { rls: { enabled: true, siblings } }]);
    }
    // Mapa ausente = guarda opt-in inerte; pular evita um warn por arquivo (ruído).
    if (domainMap) checks.push(["domain", { domain: { map: domainMap } }]);
    if (permissiveMap) checks.push(["frontend-business", { frontendBusiness: { map: permissiveMap } }]);
    if (tddEnabled) checks.push(["tdd", { tdd: { enabled: true, policy: "commit", heartbeat } }]);

    for (const [name, config] of checks) {
      const v = guards[name].evaluate({ ...base, config });
      if (v.verdict === "deny") {
        denies += 1;
        process.stderr.write(`[aidd-git-net] BLOQUEADO ${name}: ${v.message}\n`);
      } else if (v.verdict === "warn") {
        const key = `${name}:${v.message}`;
        if (!warned.has(key)) {
          warned.add(key);
          process.stderr.write(`[aidd-git-net] AVISO ${name}: ${v.message}\n`);
        }
      }
    }
  }

  if (denies > 0) {
    process.stderr.write(
      `[aidd-git-net] commit bloqueado: ${denies} violacao(oes). ` +
      `Corrija acima ou consulte AIDD.md (matriz de suporte).\n`
    );
    return 1;
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(run(process.cwd()));
  } catch (e) {
    // Falha interna do motor bloqueia o commit com mensagem clara (última linha
    // de defesa — comportamento padrão git para hook que quebra).
    process.stderr.write(`[aidd-git-net] erro interno: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run, stagedFiles, stagedContent };

"use strict";
// Neutral core: TDD guard — RED-gate decision logic.
// Two DISTINCT policies (spec R1 finding 3):
//   "edit"   — the shipped edit-time rule: recent RED entry (TTL 30 min),
//              pending_green blocks a second prod edit, wildcard limited to the
//              test file's subtree. Verdict deny on missing evidence.
//   "commit" — the git-net rule: ANY heartbeat entry (RED or GREEN, no TTL)
//              covering the file counts; absent evidence → warn, NEVER deny
//              (committers without the edit-time tooling must not be blocked).
// Test execution (spawnSync) and heartbeat writes stay adapter-side.

const fs = require("node:fs");
const path = require("node:path");
const { allow, warn, deny } = require("./verdict.cjs");

const HEARTBEAT_TTL_MS = 30 * 60 * 1000; // 30 minutos (edit policy only)
const OVERRIDE_MIN_LENGTH = 20;

const TEST_PATTERNS = [
  /\.(test|spec)\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /^test_.*\.py$/,
  /_test\.py$/,
];

const PRODUCTION_PATTERNS = [
  /^apps\/[^/]+\/(src|app)\//,
  /^services\/[^/]+\/(src|app)\//,
  /^packages\/[^/]+\/src\//,
];

const IGNORE_PATTERNS = [
  /\.md$/,
  /\.json$/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.lock$/,
  /^docs\//,
  /^scripts\//,
  /^infra\//,
  /^\.aidd\//,
  /^\.kiro\//,
  /^\.claude\//,
  /^\.pipeline\//,
  /^\.gitignore$/,
  /package(-lock)?\.json$/,
];

function matchesAny(rel, patterns) {
  return patterns.some((p) => p.test(rel));
}

function classifyTddPath(rel) {
  if (matchesAny(rel, IGNORE_PATTERNS)) return "ignore";
  if (matchesAny(rel, TEST_PATTERNS)) return "test";
  if (matchesAny(rel, PRODUCTION_PATTERNS)) return "production";
  return "other";
}

/** Wildcard Rule 5 — "*" só cobre a subtree do arquivo de teste. */
function wildcardCoversSubtree(entry, prodPath, root) {
  const testDir = path.dirname(entry.test_path);
  const absTestDir = path.isAbsolute(testDir) ? testDir : path.join(root, testDir);
  const absProd = path.isAbsolute(prodPath) ? prodPath : path.join(root, prodPath);
  const normalTestDir = path.normalize(absTestDir);
  const normalProd = path.normalize(absProd);
  return normalProd === normalTestDir || normalProd.startsWith(normalTestDir + path.sep);
}

function entryCovers(entry, prodPath, root) {
  const paths = entry.coverage_paths ?? [];
  if (paths.includes(prodPath)) return true;
  if (paths.includes(prodPath.replace(/\\/g, "/"))) return true;
  if (paths.length === 1 && paths[0] === "*") return wildcardCoversSubtree(entry, prodPath, root);
  return false;
}

/**
 * Edit policy: busca entry RED recente (TTL) que cobre o prod file.
 * Retorna { entry, wildcardOutsideSubtree } (formato do hook shipped).
 */
function findRedEntryCovering(heartbeat, prodPath, root) {
  const now = Date.now();
  let wildcardOutsideSubtree = null;
  for (const entry of heartbeat.entries) {
    if (entry.result !== "RED") continue;
    const age = now - (entry.ts ?? 0);
    if (age > HEARTBEAT_TTL_MS) continue;
    const paths = entry.coverage_paths ?? [];
    if (paths.includes(prodPath) || paths.includes(prodPath.replace(/\\/g, "/"))) {
      return { entry, wildcardOutsideSubtree: null };
    }
    if (paths.length === 1 && paths[0] === "*") {
      if (!wildcardCoversSubtree(entry, prodPath, root)) {
        wildcardOutsideSubtree = entry;
        continue;
      }
      return { entry, wildcardOutsideSubtree: null };
    }
  }
  return { entry: null, wildcardOutsideSubtree };
}

/** Commit policy: qualquer entry (RED ou GREEN, sem TTL) que cobre o arquivo. */
function findAnyEntryCovering(heartbeat, prodPath, root) {
  for (const entry of heartbeat.entries) {
    if (entry.result !== "RED" && entry.result !== "GREEN") continue;
    if (entryCovers(entry, prodPath, root)) return entry;
  }
  return null;
}

/** fs helper for adapters: heartbeat file (schema v1/v2 tolerant). */
function readHeartbeat(projectRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectRoot, ".aidd", ".tdd-heartbeat.json"), "utf8"));
    if (!Array.isArray(raw.entries)) raw.entries = [];
    return raw;
  } catch {
    return { entries: [] };
  }
}

/** fs helper for adapters: {enabled} from .claude/aidd-tdd-config.json. */
function loadTddConfig(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "aidd-tdd-config.json"), "utf8"));
    return { enabled: cfg.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

function evaluate(event) {
  const cfg = (event && event.config && event.config.tdd) || {};
  if (cfg.enabled === false) return allow();
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("tdd-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  const rel = event.path.replace(/\\/g, "/");
  const kind = classifyTddPath(rel);
  if (kind !== "production") return allow();

  const heartbeat = cfg.heartbeat && Array.isArray(cfg.heartbeat.entries) ? cfg.heartbeat : { entries: [] };
  const root = event.projectRoot || "";
  const policy = cfg.policy === "commit" ? "commit" : "edit";

  if (policy === "commit") {
    const entry = findAnyEntryCovering(heartbeat, rel, root);
    if (entry) return allow("", { test_path: entry.test_path, result: entry.result });
    return warn(
      `${rel}: sem evidência TDD no heartbeat cobrindo este arquivo de produção. ` +
      `O commit prossegue (a política de commit nunca bloqueia quem não tem o tooling de edição), ` +
      `mas escreva o teste correspondente.`,
      { rel, rule: "commit-tdd-evidence" }
    );
  }

  // edit policy — semântica shipped do RED-gate
  const { entry: candidate, wildcardOutsideSubtree } = findRedEntryCovering(heartbeat, rel, root);

  if (!candidate && wildcardOutsideSubtree) {
    const testDir = path.dirname(wildcardOutsideSubtree.test_path);
    return deny(
      `Rule 5 wildcard só cobre subtree de ${testDir}; ${rel} está fora da subtree. ` +
      `Adicione // covers: ${rel} no arquivo de teste ${wildcardOutsideSubtree.test_path} ou escreva um teste específico.`,
      { rel, rule: "wildcard-outside-subtree" }
    );
  }
  if (!candidate) {
    return deny(
      `${rel} é production code mas nenhum teste RED recente cobre este arquivo nos últimos 30 min. ` +
      `TDD_Guard_V2 (AIDD Req 3): escreva o teste primeiro (RED), depois implemente (GREEN). ` +
      `Override legítimo: defina AIDD_TDD_OVERRIDE=<reason ≥ ${OVERRIDE_MIN_LENGTH} chars> nesta sessão.`,
      { rel, rule: "no-red-evidence" }
    );
  }
  if (candidate.pending_green) {
    return deny(
      `${rel}: o teste ${candidate.test_path} está pendente de GREEN. ` +
      `Re-execute o teste (edite-o novamente ou rode os testes) antes de continuar com prod edits.`,
      { rel, rule: "pending-green" }
    );
  }
  return allow("", { test_path: candidate.test_path });
}

module.exports = {
  evaluate,
  classifyTddPath,
  findRedEntryCovering,
  findAnyEntryCovering,
  readHeartbeat,
  loadTddConfig,
  matchesAny,
  TEST_PATTERNS,
  PRODUCTION_PATTERNS,
  IGNORE_PATTERNS,
  HEARTBEAT_TTL_MS,
  OVERRIDE_MIN_LENGTH,
};

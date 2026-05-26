/**
 * aidd-confidence.cjs — Helper compartilhado para Confidence_Score
 *
 * Exporta:
 *  - computeFinalScore(conf): calcula final_score + verdict 3-estado
 *  - updateDimension(name, value, confPath): atualiza dimensao com clamp [0,1] + atomic write
 *
 * Design: design.md §3.10 | Tasks: tasks.md 6.1
 * Requirements: Req 10 (ACs 10.1–10.5)
 * ADR: docs/adr/0034-aidd-confidence-score.md
 *
 * Dependencias: js-yaml (disponivel via node_modules na raiz do projeto)
 * Compatibilidade: Node.js >= 16 (CommonJS)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Cap maximo de gate_penalty (design §3.10 — evita colapso total do score) */
const GATE_PENALTY_CAP = 0.30;

/** Pesos default (mirror do schema — fallback quando conf.weights ausente) */
const DEFAULT_WEIGHTS = {
  spec_clarity: 0.15,
  design_coverage: 0.15,
  tdd_adherence: 0.20,
  adversarial_clean_rate: 0.25,
  regression_health: 0.15,
  cross_batch_emergent: 0.10,
};

/** Thresholds default (mirror do schema) */
const DEFAULT_THRESHOLDS = {
  pass: 0.75,
  warn: 0.60,
  fail: 0.40,
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Clamp um valor para o intervalo [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Carrega js-yaml de forma robusta.
 * Tenta paths relativos ao modulo e ao cwd para suportar invocacao via hook ou teste.
 * @returns {object} modulo js-yaml
 */
function loadJsYaml() {
  // Tentativas em ordem de preferencia
  const candidates = [
    // Relativo ao projeto (cwd)
    () => require(path.join(process.cwd(), "node_modules/js-yaml")),
    // Resolucao padrao Node (PATH)
    () => require("js-yaml"),
    // Relativo a este arquivo (no caso de node_modules aninhados)
    () => require(path.resolve(__dirname, "../../../node_modules/js-yaml")),
  ];

  for (const attempt of candidates) {
    try {
      return attempt();
    } catch (_) {
      // proximo candidato
    }
  }

  throw new Error(
    "aidd-confidence: js-yaml nao encontrado. Execute npm install na raiz do projeto."
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computa o final_score e verdict 3-estado do CONFIDENCE.yaml.
 *
 * Formula (design §3.10, corrigida pos-coherence-reviewer):
 *   weighted = sum(dim[k] * weight[k]) para cada dimensao k
 *   penalized = weighted - cap(gate_penalty, GATE_PENALTY_CAP)
 *   final_score = clamp(penalized, 0, 1)
 *   verdict:
 *     PASS  se final_score >= thresholds.pass
 *     WARN  se final_score >= thresholds.fail  (e < thresholds.pass)
 *     FAIL  se final_score <  thresholds.fail
 *
 * @param {object} conf - objeto CONFIDENCE (pode ser lido via js-yaml.load())
 * @param {object} conf.dimensions - {spec_clarity, design_coverage, ...}
 * @param {object} [conf.weights]  - override de pesos (usa DEFAULT_WEIGHTS se ausente)
 * @param {number} [conf.gate_penalty=0] - penalidade bruta (sera capada em 0.30)
 * @param {object} [conf.thresholds] - override de thresholds
 * @returns {{ final_score: number, verdict: "PASS"|"WARN"|"FAIL", weighted: number, penalized: number }}
 */
function computeFinalScore(conf) {
  const dimensions = conf.dimensions || {};
  const weights = conf.weights || DEFAULT_WEIGHTS;
  const thresholds = conf.thresholds || DEFAULT_THRESHOLDS;
  const rawPenalty = typeof conf.gate_penalty === "number" ? conf.gate_penalty : 0;

  // Calcular score ponderado
  let weighted = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    const dimValue = typeof dimensions[dim] === "number" ? dimensions[dim] : 0;
    weighted += clamp(dimValue, 0, 1) * weight;
  }

  // Aplicar cap na penalidade e subtrair
  const cappedPenalty = clamp(rawPenalty, 0, GATE_PENALTY_CAP);
  const penalized = weighted - cappedPenalty;

  // Clamp final
  const final_score = clamp(penalized, 0, 1);

  // Verdict 3-estado (formula corrigida — thresholds.warn e informativo apenas)
  let verdict;
  if (final_score >= thresholds.pass) {
    verdict = "PASS";
  } else if (final_score >= thresholds.fail) {
    verdict = "WARN";
  } else {
    verdict = "FAIL";
  }

  return { final_score, verdict, weighted, penalized };
}

/**
 * Atualiza uma dimensao no CONFIDENCE.yaml com clamp [0,1] e escrita atomica.
 *
 * Escrita atomica via renameSync (write temp -> rename) para evitar
 * corrupcao em caso de falha entre write e close.
 *
 * @param {string} name - nome da dimensao (ex: "tdd_adherence")
 * @param {number} value - novo valor (sera clampado para [0,1])
 * @param {string} confPath - path absoluto do CONFIDENCE.yaml
 * @returns {void}
 */
function updateDimension(name, value, confPath) {
  const jsyaml = loadJsYaml();

  // Ler arquivo atual
  const rawContent = fs.readFileSync(confPath, "utf-8");
  const doc = jsyaml.load(rawContent);

  if (!doc || typeof doc !== "object") {
    throw new Error(`aidd-confidence: CONFIDENCE.yaml invalido em: ${confPath}`);
  }

  // Garantir que dimensions existe
  if (!doc.dimensions || typeof doc.dimensions !== "object") {
    doc.dimensions = {};
  }

  // Atualizar dimensao com clamp
  doc.dimensions[name] = clamp(value, 0, 1);
  doc.updated_at = new Date().toISOString();

  // Escrita atomica: write para temp file, depois rename
  const dir = path.dirname(confPath);
  const tmpPath = path.join(dir, `.confidence-tmp-${Date.now()}-${process.pid}.yaml`);

  try {
    const updatedContent = jsyaml.dump(doc, { lineWidth: 120 });
    fs.writeFileSync(tmpPath, updatedContent, "utf-8");
    fs.renameSync(tmpPath, confPath);
  } catch (err) {
    // Limpar temp em caso de erro
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { computeFinalScore, updateDimension, GATE_PENALTY_CAP, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS };

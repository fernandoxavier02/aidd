#!/usr/bin/env node
/**
 * parse-current-task.js
 *
 * Extrai metadados e informacoes da tarefa ativa a partir de
 * .aidd/current/CURRENT_TASK.md de forma deterministic.
 *
 * Uso:
 *   node parse-current-task.js [caminho]
 *
 * Se nenhum caminho for fornecido, usa .aidd/current/CURRENT_TASK.md
 *
 * Saida: JSON com {
 *   phase, status, slug, taskType, complexity,
 *   iteration, trackerId, slugFrontmatter,  // novos pos-refactor roadmap
 *   error
 * }
 *
 * Campo "slug" preserva semantica antiga (derivado de "## Tarefa atual:" ou fallbacks).
 * Campo "slugFrontmatter" e o slug declarado explicitamente no frontmatter (autoritativo).
 * Quando os dois divergem, o consumidor pode comparar para detectar inconsistencia.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = '.aidd/current/CURRENT_TASK.md';

function normalizeSlug(text) {
  if (!text || !text.trim()) return 'tarefa-sem-nome';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // Unicode combining diacriticals (range explicito)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

function emptyResult(errorMsg, partial = {}) {
  return {
    error: errorMsg,
    phase: partial.phase || null,
    status: partial.status || null,
    slug: null,
    taskType: partial.taskType || null,
    complexity: partial.complexity || null,
    iteration: partial.iteration || null,
    trackerId: partial.trackerId || null,
    slugFrontmatter: partial.slugFrontmatter || null
  };
}

function parseCurrentTask(filePath) {
  const resolvedPath = path.resolve(filePath || DEFAULT_PATH);

  // Verificar se arquivo existe
  if (!fs.existsSync(resolvedPath)) {
    return emptyResult(`Arquivo nao encontrado: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');

  // Extrair frontmatter YAML (entre --- ... --- no inicio do arquivo)
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!frontmatterMatch) {
    return emptyResult('Frontmatter YAML nao encontrado. Arquivo deve comecar com ---');
  }

  const frontmatter = frontmatterMatch[1];

  // Extrair campos do frontmatter
  function extractField(yaml, fieldName) {
    const regex = new RegExp(`^${fieldName}:[ \t]*([^\n]*)$`, 'm');
    const match = yaml.match(regex);
    if (!match) return null;
    let raw = match[1].trim();
    // Strip aspas YAML (double ou single) — ex: task_type: "" vira ''
    if (raw.length >= 2) {
      const first = raw[0];
      const last = raw[raw.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        raw = raw.slice(1, -1);
      }
    }
    // Tratamento de null literal, string vazia ou tilde como JS null
    if (raw === '' || raw === 'null' || raw === '~') return null;
    return raw;
  }

  const phase = extractField(frontmatter, 'phase');
  const status = extractField(frontmatter, 'status');
  const taskType = extractField(frontmatter, 'task_type');
  const complexity = extractField(frontmatter, 'complexity');
  const iteration = extractField(frontmatter, 'iteration');
  const trackerId = extractField(frontmatter, 'tracker_id');
  const slugFrontmatter = extractField(frontmatter, 'slug');

  // Validar phase como numero (0-12; 0 = template vazio pos-close)
  const phaseNum = phase ? parseInt(phase, 10) : null;
  if (phase && (isNaN(phaseNum) || phaseNum < 0 || phaseNum > 12)) {
    return emptyResult(
      `Phase invalida: ${phase}. Deve ser numero entre 0 e 12 (0 = template vazio).`,
      { phase, status, taskType, complexity, iteration, trackerId, slugFrontmatter }
    );
  }

  // Validar status contra enum conhecido
  // 'empty' = template pos-close (frontmatter regenerado pela /aidd-close arquivamento)
  const VALID_STATUSES = [
    'empty',
    'intake',
    'requirements',
    'design',
    'implementing',
    'verification',
    'review',
    'done',
    'done-local'
  ];
  if (status && !VALID_STATUSES.includes(status)) {
    return emptyResult(
      `Status desconhecido: ${status}. Esperado um de: ${VALID_STATUSES.join(', ')}`,
      { phase: phaseNum, status, taskType, complexity, iteration, trackerId, slugFrontmatter }
    );
  }

  // Extrair slug derivado da ultima secao "## Tarefa atual:" (slug "vivo")
  let slug = null;

  // Procurar ultima ocorrencia de ## Tarefa atual: linha a linha
  // Suporta titulo na mesma linha ("## Tarefa atual: Nome") ou na seguinte
  const lines = content.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith('## Tarefa atual:')) {
      const sameLine = line.substring('## Tarefa atual:'.length).trim();
      if (sameLine) {
        slug = normalizeSlug(sameLine);
      } else if (i + 1 < lines.length) {
        // Titulo na linha seguinte (pular linhas vazias)
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          slug = normalizeSlug(lines[j].trim());
        }
      }
      break;
    }
  }

  // Fallback: extrair do primeiro heading # apos frontmatter
  if (!slug) {
    const afterFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
    const headingMatch = afterFrontmatter.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      slug = normalizeSlug(headingMatch[1].trim());
    }
  }

  // Fallback: extrair das primeiras palavras do Original request
  if (!slug) {
    const requestMatch = content.match(/>\s*"([^"]{5,80})"/);
    if (requestMatch) {
      slug = normalizeSlug(requestMatch[1].trim());
    }
  }

  return {
    error: null,
    phase: phaseNum,
    status: status,
    slug: slug || slugFrontmatter || 'tarefa-sem-nome',
    taskType: taskType,
    complexity: complexity,
    iteration: iteration,
    trackerId: trackerId,
    slugFrontmatter: slugFrontmatter,
    filePath: resolvedPath,
    frontmatterValid: true
  };
}

// Execucao principal
const inputPath = process.argv[2];
const result = parseCurrentTask(inputPath);

// Saida JSON
console.log(JSON.stringify(result, null, 2));

// Exit code nao-zero em caso de erro
if (result.error) {
  process.exit(1);
}

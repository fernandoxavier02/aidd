const path = require("node:path");
const fs = require("node:fs");

function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function aiddCurrentDir() { return path.join(getProjectRoot(), ".aidd", "current"); }
function currentTaskFile() { return path.join(aiddCurrentDir(), "CURRENT_TASK.md"); }
function verificationFile() { return path.join(aiddCurrentDir(), "VERIFICATION_REPORT.md"); }
function filesReadFile() { return path.join(aiddCurrentDir(), "FILES_READ.md"); }
function filesChangedFile() { return path.join(aiddCurrentDir(), "FILES_CHANGED.md"); }
function decisionLogFile() { return path.join(getProjectRoot(), "DECISION_LOG.md"); }
function steeringDir() { return path.join(getProjectRoot(), ".kiro", "steering"); }
function specsDir() { return path.join(getProjectRoot(), ".kiro", "specs"); }
function adrDir() { return path.join(getProjectRoot(), "docs", "adr"); }

/**
 * Valida que `filePath` está dentro do project root e não é tentativa de path-traversal.
 * Retorna { ok, rel?, reason? }. Use em todo hook PreToolUse antes de classificar.
 */
function validateSafePath(filePath, root) {
  if (typeof filePath !== "string" || !filePath) {
    return { ok: false, reason: "file_path vazio ou tipo inválido" };
  }
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const normalized = path.normalize(abs);
  const rootNormalized = path.normalize(root);
  const inside = normalized === rootNormalized ||
                 normalized.startsWith(rootNormalized + path.sep);
  if (!inside) {
    return { ok: false, reason: `path fora do project root: ${normalized}` };
  }
  const rel = path.relative(rootNormalized, normalized).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.includes("/../")) {
    return { ok: false, reason: `path-traversal detectado: ${rel}` };
  }
  return { ok: true, rel };
}

/**
 * Extrai o conteúdo que está sendo escrito por uma ferramenta de edição,
 * cobrindo as TRÊS formas de payload do Claude Code:
 *   - Write     → tool_input.content
 *   - Edit      → tool_input.new_string
 *   - MultiEdit → tool_input.edits[].new_string  (concatenados)
 *
 * Sem isto, um guard que só lê content/new_string vê string vazia para
 * MultiEdit e libera a escrita sem inspecionar (bypass). Sempre retorna string.
 */
function extractWriteContent(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (Array.isArray(toolInput.edits) && toolInput.edits.length > 0) {
    return toolInput.edits
      .map((e) => (e && typeof e.new_string === "string" ? e.new_string : ""))
      .join("\n");
  }
  if (typeof toolInput.new_string === "string") return toolInput.new_string;
  if (typeof toolInput.content === "string") return toolInput.content;
  return "";
}

/**
 * Verifica se um ADR referenciado existe em docs/adr/NNNN-*.md.
 * Usado para endurecer overrides (AIDD_OVERRIDE_RLS / AIDD_OVERRIDE_DOMAIN):
 * uma referência de ADR só vale se o arquivo existir.
 * Se a pasta docs/adr/ não existe (projeto não usa a convenção), retorna true
 * para não bloquear o escape hatch — não há como verificar.
 */
function adrExists(adrRef) {
  const m = String(adrRef || "").match(/(\d{3,4})/);
  if (!m) return false;
  const num = m[1];
  const dir = adrDir();
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((f) => f.startsWith(num + "-") && f.endsWith(".md"));
  } catch {
    return true;
  }
}

/**
 * Append seguro a arquivo: rejeita se o destino for symlink (defesa contra symlink-attack).
 */
function safeAppend(filePath, content) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through symlink: ${filePath}`);
    }
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
  }
  fs.appendFileSync(filePath, content);
}

/**
 * Write seguro: cria diretório pai, rejeita se destino for symlink.
 */
function safeWrite(filePath, content) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through symlink: ${filePath}`);
    }
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

module.exports = {
  getProjectRoot,
  aiddCurrentDir,
  currentTaskFile,
  verificationFile,
  filesReadFile,
  filesChangedFile,
  decisionLogFile,
  steeringDir,
  specsDir,
  adrDir,
  validateSafePath,
  extractWriteContent,
  adrExists,
  safeAppend,
  safeWrite,
};

"use strict";
// Neutral core: contract guard — immutable methodology files, Kiro steering,
// accepted ADRs. Disk state arrives via event.fileExists (never fs here), so
// edit-time and commit-time judge the same facts (spec R1 finding 5).
// The audited install-bypass (AIDD_V2_INSTALL) is an edit-time affordance and
// lives in the Claude shell only — the git net does not honor env bypasses.

const { allow, deny } = require("./verdict.cjs");

const PROTECTED_FILES = [
  /^AIDD\.md$/,
  /^CONTEXT_INDEX\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
];

const PROTECTED_DIRS = [
  /^\.kiro\/steering\/[^/]+\.md$/,
];

const ADR_PATTERN = /^docs\/adr\/(\d+)-[^/]+\.md$/;

function evaluate(event) {
  if (!event || typeof event.path !== "string" || !event.path) {
    return deny("contract-guard: evento malformado (path ausente) — fail-safe deny.");
  }
  const rel = event.path.replace(/\\/g, "/");

  // Criação não é modificação: instalar a metodologia num projeto fresh
  // (write + arquivo ausente) é o cenário legítimo de bootstrap — o guarda
  // protege contra ALTERAR o que existe, não contra instalar (parity R1 f5).
  const isCreation = event.action === "write" && event.fileExists === false;

  for (const pat of PROTECTED_FILES) {
    if (pat.test(rel)) {
      if (isCreation) return allow();
      return deny(
        `${rel} e parte do nucleo AIDD (metodologia/bootloader/index). ` +
        `Mudancas exigem ADR + atualizacao de CURRENT_TASK.md. ` +
        `Se for intencional, registre o plano em .aidd/current/CURRENT_TASK.md primeiro e desabilite este gate temporariamente em .claude/settings.json.`,
        { rel, rule: "protected-core-file" }
      );
    }
  }

  for (const pat of PROTECTED_DIRS) {
    if (pat.test(rel)) {
      if (isCreation) return allow();
      return deny(
        `${rel} e canonical steering Kiro v3. Mudar product/structure/tech requer ADR. ` +
        `Se for intencional, abra ADR em docs/adr/ primeiro.`,
        { rel, rule: "protected-steering" }
      );
    }
  }

  if (ADR_PATTERN.test(rel)) {
    if (event.action === "write" && event.fileExists === false) {
      return allow(); // creating a brand-new ADR is the sanctioned path
    }
    return deny(
      `${rel} e um ADR. ADRs aceitos sao imutaveis - mudancas exigem novo ADR (superseding). ` +
      `Para criar novo ADR: use proximo numero sequencial em docs/adr/.`,
      { rel, rule: "adr-immutable" }
    );
  }

  return allow();
}

module.exports = { evaluate, PROTECTED_FILES, PROTECTED_DIRS, ADR_PATTERN };

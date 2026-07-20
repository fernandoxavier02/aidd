"use strict";
// Shared verdict shape for every neutral guard: {verdict, message, evidence}.
// Exactly three verdict values exist; adapters translate them to each
// provider's protocol (Claude JSON, git exit codes, Codex hook output).

const VERDICTS = ["allow", "warn", "deny"];

function allow(message = "", evidence = null) {
  return { verdict: "allow", message, evidence };
}

function warn(message, evidence = null) {
  return { verdict: "warn", message, evidence };
}

function deny(message, evidence = null) {
  return { verdict: "deny", message, evidence };
}

module.exports = { allow, warn, deny, VERDICTS };

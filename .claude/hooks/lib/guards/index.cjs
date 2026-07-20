"use strict";
// Registry of the 7 fiscal guards. Adapters (Claude shells, git net, Codex)
// iterate this uniformly instead of hand-listing requires — the single call
// point that keeps rule logic authored once (verdict-parity defense).

const guards = {
  "contract": require("./contract.cjs"),
  "phase": require("./phase.cjs"),
  "tdd": require("./tdd.cjs"),
  "secrets": require("./secrets.cjs"),
  "domain": require("./domain.cjs"),
  "rls": require("./rls.cjs"),
  "frontend-business": require("./frontend-business.cjs"),
};

const GUARD_NAMES = Object.keys(guards);

module.exports = { guards, GUARD_NAMES };

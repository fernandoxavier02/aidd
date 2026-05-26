#!/usr/bin/env node
// aidd-tdd-guard.cjs — alias that redirects to the v2 implementation.
// The full RED-gate algorithm (coverage inference, heartbeat, override) lives in
// aidd-tdd-guard-v2.cjs. settings.json registers this path for stability; the v2
// file can be swapped without touching the hook registration.
require("./aidd-tdd-guard-v2.cjs");

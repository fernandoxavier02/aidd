"use strict";
// Neutral core: RLS guard — opt-in (off by default). SQL migration checks with
// companion (sibling) contents supplied by the adapter, not read from fs here.
const test = require("node:test");
const assert = require("node:assert");

const { evaluate } = require("../../.claude/hooks/lib/guards/rls.cjs");

const base = { action: "write", projectRoot: "/proj", fileExists: false };
const cfg = (over = {}) => ({ rls: { enabled: true, siblings: [], ...over } });

test("disabled (default) → allow even for naked CREATE TABLE", () => {
  const v = evaluate({ ...base, path: "migrations/001_users.sql", content: "CREATE TABLE users (id int);", config: cfg({ enabled: false }) });
  assert.strictEqual(v.verdict, "allow");
});

test("CREATE TABLE without ENABLE RLS → deny", () => {
  const v = evaluate({ ...base, path: "migrations/001_users.sql", content: "CREATE TABLE users (id int);", config: cfg() });
  assert.strictEqual(v.verdict, "deny");
});

test("CREATE TABLE with ENABLE RLS in the same file → allow", () => {
  const sql = "CREATE TABLE users (id int);\nALTER TABLE users ENABLE ROW LEVEL SECURITY;";
  const v = evaluate({ ...base, path: "migrations/001_users.sql", content: sql, config: cfg() });
  assert.strictEqual(v.verdict, "allow");
});

test("CREATE TABLE covered by a companion sibling → allow", () => {
  const v = evaluate({
    ...base,
    path: "migrations/001_users.sql",
    content: "CREATE TABLE users (id int);",
    config: cfg({ siblings: ["ALTER TABLE users ENABLE ROW LEVEL SECURITY;"] }),
  });
  assert.strictEqual(v.verdict, "allow");
});

test("ENABLE RLS mentioned only in a comment does NOT count", () => {
  const sql = "CREATE TABLE users (id int);\n-- sem ENABLE ROW LEVEL SECURITY aqui";
  const v = evaluate({ ...base, path: "migrations/001_users.sql", content: sql, config: cfg() });
  assert.strictEqual(v.verdict, "deny");
});

test("DROP POLICY without ADR comment → deny; with ADR comment → not blocked", () => {
  const naked = evaluate({ ...base, path: "migrations/002_x.sql", content: "DROP POLICY p ON users;", config: cfg() });
  assert.strictEqual(naked.verdict, "deny");
  const justified = evaluate({
    ...base,
    path: "migrations/002_x.sql",
    content: "-- ADR-0007: policy substituida pela v2 completa\nDROP POLICY p ON users;",
    config: cfg(),
  });
  assert.strictEqual(justified.verdict, "allow");
});

test("non-migration path → allow (not this guard's domain)", () => {
  const v = evaluate({ ...base, path: "src/app.ts", content: "CREATE TABLE x (id int);", config: cfg() });
  assert.strictEqual(v.verdict, "allow");
});

test("prisma model without @rls-policy → warn (never deny)", () => {
  const v = evaluate({ ...base, path: "schema.prisma", content: "model User {\n id Int @id\n}", config: cfg() });
  assert.strictEqual(v.verdict, "warn");
});

test("fail-safe: enabled + malformed envelope → deny", () => {
  const v = evaluate({ ...base, path: "", content: "x", config: cfg() });
  assert.strictEqual(v.verdict, "deny");
});

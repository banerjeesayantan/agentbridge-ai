import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../convex/lib/contactSessionPolicy.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const { normalizeContactDetails, isContactSessionActive } = exports;

test("contact details are trimmed and email addresses normalized", () => {
  assert.deepEqual(
    { ...normalizeContactDetails("  Alex Morgan  ", "  ALEX@Example.com ") },
    { name: "Alex Morgan", email: "alex@example.com" },
  );
});

test("contact details reject blank or excessively long names", () => {
  assert.throws(() => normalizeContactDetails("   ", "alex@example.com"));
  assert.throws(() => normalizeContactDetails("a".repeat(121), "alex@example.com"));
});

test("contact details reject malformed or excessively long email addresses", () => {
  assert.throws(() => normalizeContactDetails("Alex", "not-an-email"));
  assert.throws(() => normalizeContactDetails("Alex", "a".repeat(250) + "@example.com"));
});

test("session expiry is exclusive at the exact expiry timestamp", () => {
  assert.equal(isContactSessionActive(1001, 1000), true);
  assert.equal(isContactSessionActive(1000, 1000), false);
  assert.equal(isContactSessionActive(999, 1000), false);
});

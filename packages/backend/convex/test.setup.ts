
// Single source of truth for convex-test. It must live at the root of the
// convex/ directory so every key shares one base ("./_generated/...",
// "./system/subscriptions.ts", ...), which is what convex-test expects.
// Test files, this setup file and type declarations are not Convex modules.
export const modules = import.meta.glob([
  "./**/*.*s",
  "!./**/*.test.*s",
  "!./**/*.setup.*s",
  "!./**/*.d.ts",
]);
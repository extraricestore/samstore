// Sequential test runner — runs every Node test FILE one at a time.
// Why: the remote Postgres (Supabase pooler) allows only 15 sessions; the node
// `--test` CLI runs each file in its own process CONCURRENTLY, which saturates
// the pool with `FATAL: max clients reached in session mode`. Running each file
// alone keeps every PrismaClient within the pool and gives deterministic gates.
// Output: each child's TAP output streams through; a final aggregate line is
// printed, and the exit code is non-zero if any file failed.

import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PATTERNS = [
  "apps/api/src/domain/*.test.ts",
  "apps/api/src/checkout/*.test.ts",
  "apps/api/src/cart/*.test.ts",
  "apps/api/src/auth/*.test.ts",
  "apps/api/src/messenger/*.test.ts",
  "apps/api/src/notifications/*.test.ts",
  "apps/api/src/admin/*.test.ts",
  "apps/api/src/pos/*.test.ts",
  "apps/api/src/payments/*.test.ts",
  "apps/api/src/credit/*.test.ts",
  "apps/api/src/expenses/*.test.ts",
  "apps/api/src/purchases/*.test.ts",
  "apps/api/src/inventory/*.test.ts",
  "apps/api/src/reports/*.test.ts",
  "apps/api/src/delivery/*.test.ts",
];

const files = PATTERNS.flatMap((p) => globSync(p)).filter((f) => f.endsWith(".test.ts")).sort();
console.log(`# running ${files.length} test files sequentially\n`);

const failedFiles = [];
for (const file of files) {
  const res = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
    stdout: "pipe",
    stderr: "inherit",
    cwd: ROOT,
  });
  if (res.stdout) process.stdout.write(String(res.stdout));
  if (res.status !== 0) failedFiles.push(file);
}

console.log(`\n# files ${files.length}${failedFiles.length ? `  FAILED: ${failedFiles.join(", ")}` : "  all ok"}`);
process.exit(failedFiles.length > 0 ? 1 : 0);
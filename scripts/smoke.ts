import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural smoke test: every route file, page and adapter is present, every
 * adapter satisfies the SocialAdapter contract, and the DB schema matches the
 * client. It does NOT hit any network - run it before `pnpm dev` to catch a
 * missing file or a broken export without waiting on a build.
 *
 *   pnpm smoke
 */

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];
const root = process.cwd();

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

function expectFile(label: string, relative: string) {
  const exists = fs.existsSync(path.join(root, relative));
  record(label, exists, exists ? relative : `missing: ${relative}`);
}

const ROUTES = [
  "src/app/api/auth/register/route.ts",
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/logout/route.ts",
  "src/app/api/media/route.ts",
  "src/app/api/media/[id]/route.ts",
  "src/app/api/media/[id]/file/route.ts",
  "src/app/api/public/media/[id]/route.ts",
  "src/app/api/oauth/[provider]/start/route.ts",
  "src/app/api/oauth/[provider]/callback/route.ts",
  "src/app/api/connections/route.ts",
  "src/app/api/connections/[id]/route.ts",
  "src/app/api/connections/[id]/test/route.ts",
  "src/app/api/compose/route.ts",
  "src/app/api/posts/route.ts",
  "src/app/api/jobs/[id]/cancel/route.ts",
  "src/app/api/jobs/[id]/retry/route.ts",
];

const PAGES = [
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/register/page.tsx",
  "src/app/(app)/compose/page.tsx",
  "src/app/(app)/posts/page.tsx",
  "src/app/(app)/calendar/page.tsx",
  "src/app/(app)/media/page.tsx",
  "src/app/(app)/settings/connections/page.tsx",
  "src/app/(app)/settings/setup/page.tsx",
];

const ADAPTER_METHODS = [
  "getAuthUrl",
  "exchangeCode",
  "refresh",
  "getMe",
  "publish",
] as const;

async function main() {
  console.log("Ruyah smoke test\n");

  for (const route of ROUTES) expectFile(`route ${route.replace("src/app", "")}`, route);
  for (const page of PAGES) expectFile(`page  ${page.replace("src/app", "")}`, page);

  expectFile("worker entrypoint", "worker.ts");
  expectFile("prisma schema", "prisma/schema.prisma");
  expectFile("env example", ".env.example");

  // Adapters: import for real so a syntax error or bad export fails here.
  const { adapters } = await import("../src/lib/social/index.js").catch(
    () => import("../src/lib/social/index"),
  );

  for (const [id, adapter] of Object.entries(adapters)) {
    const shape = adapter as unknown as Record<string, unknown>;
    const missing = ADAPTER_METHODS.filter((method) => typeof shape[method] !== "function");
    record(
      `adapter ${id}`,
      missing.length === 0 && adapter.id === id,
      missing.length === 0
        ? `implements ${ADAPTER_METHODS.join(", ")}`
        : `missing: ${missing.join(", ")}`,
    );
  }

  // Env: report, never fail. An empty .env is a valid starting state.
  const { getSetupChecks } = await import("../src/lib/env");
  const setup = getSetupChecks();
  for (const check of setup.filter((entry) => entry.required)) {
    record(`env ${check.label}`, check.ok, check.detail);
  }

  // DB: confirms the migration ran and the client matches the schema.
  const { prisma } = await import("../src/lib/db");
  try {
    const [users, jobs] = await Promise.all([prisma.user.count(), prisma.postJob.count()]);
    record("database", true, `reachable - ${users} user(s), ${jobs} job(s)`);
  } catch (error) {
    record(
      "database",
      false,
      `${error instanceof Error ? error.message.split("\n")[0] : String(error)} - run: pnpm prisma migrate dev`,
    );
  } finally {
    await prisma.$disconnect();
  }

  const optional = setup.filter((entry) => !entry.required && !entry.ok);

  for (const check of checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.ok ? "" : ` - ${check.detail}`}`);
  }

  const failures = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failures.length}/${checks.length} checks passed.`);

  if (optional.length > 0) {
    console.log("\nOptional, each gates one feature:");
    for (const check of optional) console.log(`  - ${check.label}: ${check.detail}`);
  }

  if (failures.length > 0) {
    console.log("\nFix the failures above, then re-run pnpm smoke.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("smoke test crashed:", error);
  process.exitCode = 1;
});

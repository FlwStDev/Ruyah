import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Creates the local admin user. Safe to re-run: an existing user keeps its
 * password, so seeding never locks you out of an account you already use.
 *
 *   pnpm db:seed
 */

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_EMAIL ?? "admin@postforge.local").toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "postforge-dev";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed user already exists: ${email} (password unchanged)`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name: "PostForge Admin",
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
    },
  });

  console.log(`Created seed user ${email}`);
  console.log(`Password: ${password}`);
  console.log("Change SEED_PASSWORD in .env before using this anywhere real.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma instance. Next dev reloads modules on every edit, so the client
 * is cached on globalThis to avoid exhausting SQLite connections.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

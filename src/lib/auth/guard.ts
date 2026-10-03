import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/auth/session";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    // Session points at a user that no longer exists (e.g. db reset).
    session.destroy();
    return null;
  }
  return user;
}

/** For route handlers: throws an AppError the API wrapper turns into a 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw AppError.unauthorized();
  return user;
}

/** For server components: bounces to /login instead of throwing. */
export async function requireUserPage(redirectTo = "/login"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(redirectTo);
  return user;
}

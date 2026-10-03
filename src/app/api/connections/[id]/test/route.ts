import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { isSocialProvider } from "@/lib/constants";
import { getAdapter } from "@/lib/social";
import { getPublishableAccount, markAccountStatus } from "@/lib/accounts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * "Test connection" - refreshes the token if needed and calls the provider's
 * identity endpoint (/2/users/me, /api/v1/me, /me). Read-only: it never posts.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;

    const row = await prisma.connectedAccount.findFirst({ where: { id, userId: user.id } });
    if (!row) throw AppError.notFound("That account is not connected.");
    if (!isSocialProvider(row.provider)) {
      throw AppError.badRequest(`Unknown network "${row.provider}".`);
    }

    try {
      const account = await getPublishableAccount(user.id, row.id);
      const me = await getAdapter(row.provider).getMe(account);
      await markAccountStatus(row.id, "active", null);
      return jsonOk({ ok: true, username: me.username, providerUserId: me.id });
    } catch (error) {
      const appError = toAppError(error);
      await markAccountStatus(
        row.id,
        appError.code === "needs_reauth" || appError.status === 401 ? "needs_reauth" : "error",
        appError.message,
      );
      throw appError;
    }
  });
}

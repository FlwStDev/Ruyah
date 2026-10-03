import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;

    const account = await prisma.connectedAccount.findFirst({
      where: { id, userId: user.id },
    });
    if (!account) throw AppError.notFound("That account is not connected.");

    // Deleting the row is the disconnect: tokens are gone with it. Revoking on
    // the provider's side is done from the network's own app settings.
    await prisma.connectedAccount.delete({ where: { id: account.id } });

    return jsonOk({ id: account.id, provider: account.provider });
  });
}

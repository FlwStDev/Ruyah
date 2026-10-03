import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { runFolderDripNow, toPublicDrip } from "@/lib/folder-drip";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const result = await runFolderDripNow(user.id, id);
    const drip = await prisma.folderDrip.findFirst({ where: { id, userId: user.id } });
    if (!drip) throw AppError.notFound("That folder drip does not exist.");
    return jsonOk({
      drip: await toPublicDrip(drip),
      queued: result.queued,
      fileName: result.fileName,
    });
  });
}

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;

    const asset = await prisma.mediaAsset.findFirst({ where: { id, userId: user.id } });
    if (!asset) throw AppError.notFound("That file is not in your library.");

    // Keep anything a queued or published post still points at.
    const inUse = await prisma.postMedia.count({
      where: {
        mediaAssetId: asset.id,
        post: { status: { in: ["queued", "uploading", "publishing", "published"] } },
      },
    });
    if (inUse > 0) {
      throw AppError.conflict(
        "That file is attached to a scheduled or published post. Cancel the post first.",
      );
    }

    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    await storage.delete(asset.storageKey);

    return jsonOk({ id: asset.id });
  });
}

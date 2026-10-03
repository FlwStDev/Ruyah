import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth/guard";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Authenticated preview used by the app's own UI. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const asset = await prisma.mediaAsset.findFirst({ where: { id, userId: user.id } });
    if (!asset) throw AppError.notFound("That file is not in your library.");

    const bytes = await storage.get(asset.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.originalName)}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

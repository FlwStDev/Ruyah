import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { safeEqual } from "@/lib/crypto";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Unauthenticated media route. Instagram (and Reddit, for some flows) download
 * media themselves and cannot present a session cookie, so this is the one
 * endpoint without auth.
 *
 * It is protected by an unguessable 128-bit publicId plus a 192-bit token that
 * must match in constant time. Nothing is enumerable, and the route only ever
 * serves media rows - never anything else.
 *
 * Reachable from the internet only when PUBLIC_BASE_URL points a tunnel here.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const token = new URL(request.url).searchParams.get("t");
    if (!token) throw AppError.notFound("Not found.");

    const asset = await prisma.mediaAsset.findUnique({ where: { publicId: id } });
    // Same error for "no such asset" and "wrong token": nothing to probe for.
    if (!asset || !safeEqual(asset.publicToken, token)) {
      throw AppError.notFound("Not found.");
    }

    const bytes = await storage.get(asset.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.byteLength),
        // Instagram re-fetches during processing; let the tunnel cache briefly.
        "Cache-Control": "public, max-age=600",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

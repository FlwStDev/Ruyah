import type { MediaAsset } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { buildStorageKey, storage } from "@/lib/storage";
import { probeAndNormalize } from "@/lib/media";

/** Shared path for browser uploads and folder-drip imports. */
export async function importMediaForUser(
  userId: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<MediaAsset> {
  const probed = await probeAndNormalize(buffer, mimeType, originalName);

  const asset = await prisma.mediaAsset.create({
    data: {
      userId,
      kind: probed.kind,
      mimeType: probed.mimeType,
      originalName,
      storageKey: "",
      size: probed.buffer.byteLength,
      width: probed.width,
      height: probed.height,
      durationMs: probed.durationMs,
      checksum: sha256Hex(probed.buffer),
      publicId: randomToken(16),
      publicToken: randomToken(24),
    },
  });

  const storageKey = buildStorageKey(userId, asset.id, probed.extension);
  await storage.put(storageKey, probed.buffer, probed.mimeType);
  return prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { storageKey },
  });
}

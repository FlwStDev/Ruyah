import sharp from "sharp";
import { AppError } from "@/lib/errors";
import {
  ACCEPTED_IMAGE_MIME,
  ACCEPTED_MIME,
  ACCEPTED_VIDEO_MIME,
  MAX_UPLOAD_BYTES,
  type MediaKind,
} from "@/lib/constants";
import { env } from "@/lib/env";

export type ProbedMedia = {
  kind: MediaKind;
  mimeType: string;
  buffer: Buffer;
  extension: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
};

export function kindForMime(mimeType: string): MediaKind {
  if ((ACCEPTED_IMAGE_MIME as readonly string[]).includes(mimeType)) return "image";
  if ((ACCEPTED_VIDEO_MIME as readonly string[]).includes(mimeType)) return "video";
  throw AppError.badRequest(
    `Unsupported file type "${mimeType}". Allowed: ${ACCEPTED_MIME.join(", ")}.`,
  );
}

/**
 * Normalizes an upload. Images get read (and auto-rotated) by sharp so we know
 * the real dimensions; video is stored as-is because probing mp4 would mean
 * requiring a system ffmpeg, which the app must boot without.
 */
export async function probeAndNormalize(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<ProbedMedia> {
  if (buffer.byteLength === 0) {
    throw AppError.badRequest(`"${originalName}" is empty.`);
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(
      `"${originalName}" is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }

  const kind = kindForMime(mimeType);
  const extension = EXTENSIONS[mimeType] ?? "";

  if (kind === "video") {
    // See README: ffprobe is optional and deliberately not required to boot.
    return {
      kind,
      mimeType,
      buffer,
      extension,
      width: null,
      height: null,
      durationMs: null,
    };
  }

  try {
    // GIFs and animated webp lose their animation if re-encoded, so only
    // static images are rewritten; the rest are stored byte-for-byte.
    const image = sharp(buffer, { animated: false });
    const metadata = await image.metadata();
    const isAnimated = (metadata.pages ?? 1) > 1;

    if (isAnimated || mimeType === "image/gif") {
      return {
        kind,
        mimeType,
        buffer,
        extension,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        durationMs: null,
      };
    }

    // rotate() with no argument applies the EXIF orientation and drops it, so
    // what every network receives matches what the user saw in the picker.
    const normalized = await image.rotate().toBuffer({ resolveWithObject: true });
    return {
      kind,
      mimeType,
      buffer: normalized.data,
      extension,
      width: normalized.info.width,
      height: normalized.info.height,
      durationMs: null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest(`"${originalName}" could not be read as an image.`);
  }
}

/**
 * The URL a social network should fetch media from. Networks cannot reach
 * localhost, so this is only valid once PUBLIC_BASE_URL points at a tunnel.
 */
export function publicMediaUrl(publicId: string, publicToken: string): string | null {
  const base = env.publicBaseUrl;
  if (!base) return null;
  return `${base}/api/public/media/${publicId}?t=${encodeURIComponent(publicToken)}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

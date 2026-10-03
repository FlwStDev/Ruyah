import path from "node:path";
import type { ZodType } from "zod";
import type { MediaAsset } from "@prisma/client";
import { storage } from "@/lib/storage";
import { publicMediaUrl } from "@/lib/media";
import { parseWith } from "@/lib/api";
import type { SocialProvider, MediaKind } from "@/lib/constants";
import { optionsSchemaByProvider } from "@/lib/social/types";
import type { ProviderOptions, PublishMedia } from "@/lib/social/types";

/** Wraps a stored asset in the lazy-reading shape adapters consume. */
export function toPublishMedia(asset: MediaAsset): PublishMedia {
  return {
    id: asset.id,
    kind: asset.kind as MediaKind,
    mimeType: asset.mimeType,
    fileName: asset.originalName || `${asset.id}${path.extname(asset.storageKey)}`,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    read: () => storage.get(asset.storageKey),
    publicUrl: publicMediaUrl(asset.publicId, asset.publicToken),
  };
}

/**
 * Parses the options blob stored on a post. Defaults are applied by the zod
 * schemas, so an older row missing a newer field still runs.
 */
export function parsePostOptions<P extends SocialProvider>(
  provider: P,
  optionsJson: string,
): ProviderOptions[P] {
  let raw: unknown = {};
  try {
    raw = JSON.parse(optionsJson) as unknown;
  } catch {
    raw = {};
  }
  // JSON boundary: the schema union cannot be narrowed by the generic alone.
  const schema = optionsSchemaByProvider[provider] as unknown as ZodType<ProviderOptions[P]>;
  return parseWith(schema, raw ?? {});
}

/** Infers the Instagram container type from what the user attached. */
export function inferInstagramKind(
  media: Array<{ kind: string }>,
): "FEED" | "CAROUSEL" | "REELS" {
  if (media.length > 1) return "CAROUSEL";
  if (media.length === 1 && media[0].kind === "video") return "REELS";
  return "FEED";
}

/** Infers the Reddit post kind from what the user attached. */
export function inferRedditKind(media: Array<{ kind: string }>): "self" | "image" | "video" {
  if (media.length === 0) return "self";
  return media[0].kind === "video" ? "video" : "image";
}

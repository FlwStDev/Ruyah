/**
 * String unions used in place of DB enums (the SQLite connector has no enum
 * support, and keeping them as strings makes the schema portable to Postgres).
 */

export const SOCIAL_PROVIDERS = ["x", "reddit", "instagram"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** Networks with adapter stubs only - intentionally out of scope for the MVP. */
export const STUB_PROVIDERS = ["linkedin", "tiktok", "youtube", "facebook", "threads"] as const;
export type StubProvider = (typeof STUB_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  x: "X",
  reddit: "Reddit",
  instagram: "Instagram",
};

export const JOB_STATUSES = [
  "queued",
  "uploading",
  "publishing",
  "published",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["published", "canceled"];

export const ACCOUNT_STATUSES = ["active", "needs_reauth", "revoked", "error"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const COMPOSE_MODES = ["now", "schedule"] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const REDDIT_POST_KINDS = ["self", "image", "video", "link"] as const;
export type RedditPostKind = (typeof REDDIT_POST_KINDS)[number];

export const INSTAGRAM_PUBLISH_KINDS = ["FEED", "CAROUSEL", "REELS"] as const;
export type InstagramPublishKind = (typeof INSTAGRAM_PUBLISH_KINDS)[number];

export const X_REPLY_SETTINGS = ["everyone", "mentionedUsers", "following"] as const;
export type XReplySetting = (typeof X_REPLY_SETTINGS)[number];

/** Soft warning threshold. X Premium can exceed it, so never hard-block. */
export const X_SOFT_CHAR_LIMIT = 280;
export const REDDIT_TITLE_LIMIT = 300;
export const REDDIT_SELF_TEXT_LIMIT = 40000;
export const INSTAGRAM_CAPTION_LIMIT = 2200;

export const MAX_IMAGES_PER_POST = 4;
export const MAX_VIDEOS_PER_POST = 1;

export const ACCEPTED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const ACCEPTED_VIDEO_MIME = ["video/mp4"] as const;
export const ACCEPTED_MIME = [...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME];

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export const DRIP_CAPTION_MODES = ["filename", "empty", "fixed"] as const;
export type DripCaptionMode = (typeof DRIP_CAPTION_MODES)[number];

export const DRIP_AFTER_POST = ["move", "keep"] as const;
export type DripAfterPost = (typeof DRIP_AFTER_POST)[number];

export const DRIP_INTERVAL_PRESETS = [15, 30, 60, 120, 360, 720, 1440] as const;
export const DRIP_MIN_INTERVAL_MINUTES = 5;
export const DRIP_POSTED_DIR = "_posted";

export function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

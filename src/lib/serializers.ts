import type { MediaAsset, Post, PostJob } from "@prisma/client";
import { env } from "@/lib/env";
import type { JobStatus, MediaKind, SocialProvider } from "@/lib/constants";

/**
 * DB rows -> plain JSON for client components. Dates become ISO strings and
 * anything sensitive (tokens, storage paths) is left behind.
 */

export type SerializedMedia = {
  id: string;
  kind: MediaKind;
  mimeType: string;
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  /** Authenticated preview URL used inside the app. */
  url: string;
  /** Public tunnel URL, or null when PUBLIC_BASE_URL is unset. */
  publicUrl: string | null;
};

export function serializeMedia(asset: MediaAsset): SerializedMedia {
  return {
    id: asset.id,
    kind: asset.kind as MediaKind,
    mimeType: asset.mimeType,
    originalName: asset.originalName,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    createdAt: asset.createdAt.toISOString(),
    url: `/api/media/${asset.id}/file`,
    publicUrl: env.publicBaseUrl
      ? `${env.publicBaseUrl}/api/public/media/${asset.publicId}?t=${encodeURIComponent(asset.publicToken)}`
      : null,
  };
}

export type SerializedJob = {
  id: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string;
  nextAttemptAt: string | null;
  lastError: string | null;
  needsReview: boolean;
  permalink: string | null;
  platformPostId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export function serializeJob(job: PostJob): SerializedJob {
  return {
    id: job.id,
    status: job.status as JobStatus,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    scheduledFor: job.scheduledFor.toISOString(),
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    lastError: job.lastError,
    needsReview: job.needsReview,
    permalink: job.permalink,
    platformPostId: job.platformPostId,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export type SerializedPost = {
  id: string;
  provider: SocialProvider;
  title: string | null;
  body: string;
  status: JobStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  permalink: string | null;
  createdAt: string;
  accountUsername: string | null;
  options: Record<string, unknown>;
  media: SerializedMedia[];
  jobs: SerializedJob[];
};

type PostWithRelations = Post & {
  account?: { username: string } | null;
  media?: Array<{ media: MediaAsset }>;
  jobs?: PostJob[];
};

export function serializePost(post: PostWithRelations): SerializedPost {
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(post.optionsJson);
    if (parsed && typeof parsed === "object") options = parsed as Record<string, unknown>;
  } catch {
    options = {};
  }

  return {
    id: post.id,
    provider: post.provider as SocialProvider,
    title: post.title,
    body: post.body,
    status: post.status as JobStatus,
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    permalink: post.permalink,
    createdAt: post.createdAt.toISOString(),
    accountUsername: post.account?.username ?? null,
    options,
    media: (post.media ?? []).map((entry) => serializeMedia(entry.media)),
    jobs: (post.jobs ?? []).map(serializeJob),
  };
}

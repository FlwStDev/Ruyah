import type { MediaAsset } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import {
  MAX_IMAGES_PER_POST,
  MAX_VIDEOS_PER_POST,
  PROVIDER_LABELS,
  type SocialProvider,
} from "@/lib/constants";
import { getAdapter } from "@/lib/social";
import { getAccountForProvider } from "@/lib/accounts";
import { inferInstagramKind, inferRedditKind, toPublishMedia } from "@/lib/publish";
import type { ProviderOptions, PublishPayload } from "@/lib/social/types";
import type { ComposeInput } from "@/lib/validation";

export type CreatedJob = {
  jobId: string;
  postId: string;
  provider: SocialProvider;
  scheduledFor: string;
};

/** Order the media the way the user picked it, and reject impossible mixes. */
async function loadMedia(userId: string, mediaIds: string[]): Promise<MediaAsset[]> {
  if (mediaIds.length === 0) return [];
  const assets = await prisma.mediaAsset.findMany({
    where: { userId, id: { in: mediaIds } },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered: MediaAsset[] = [];
  for (const id of mediaIds) {
    const asset = byId.get(id);
    if (!asset) throw AppError.badRequest("One of the selected files is no longer in your library.");
    ordered.push(asset);
  }

  const videos = ordered.filter((asset) => asset.kind === "video");
  const images = ordered.filter((asset) => asset.kind === "image");
  if (videos.length > MAX_VIDEOS_PER_POST) {
    throw AppError.badRequest(`Attach at most ${MAX_VIDEOS_PER_POST} video.`);
  }
  if (images.length > MAX_IMAGES_PER_POST) {
    throw AppError.badRequest(`Attach at most ${MAX_IMAGES_PER_POST} images.`);
  }
  if (videos.length > 0 && images.length > 0) {
    throw AppError.badRequest("Attach either images or one video, not both.");
  }
  return ordered;
}

/**
 * Fills in the per-network options, inferring what the user did not set from
 * the attached media (Reddit post kind, Instagram container type).
 */
function resolveOptions<P extends SocialProvider>(
  provider: P,
  input: ComposeInput,
  media: MediaAsset[],
): ProviderOptions[P] {
  switch (provider) {
    case "x":
      return { replySettings: input.x?.replySettings ?? "everyone" } as ProviderOptions[P];
    case "reddit": {
      const reddit = input.reddit;
      if (!reddit?.subreddit) throw AppError.badRequest("Reddit needs a subreddit.");
      return {
        subreddit: reddit.subreddit,
        kind: reddit.kind ?? inferRedditKind(media),
        flairText: reddit.flairText ?? null,
        nsfw: reddit.nsfw ?? false,
        spoiler: reddit.spoiler ?? false,
        url: reddit.url ?? null,
      } as ProviderOptions[P];
    }
    case "instagram":
      return {
        publishKind: input.instagram?.publishKind ?? inferInstagramKind(media),
        shareToFeed: input.instagram?.shareToFeed ?? true,
      } as ProviderOptions[P];
    default:
      throw AppError.badRequest(`Unknown network "${provider}".`);
  }
}

function bodyFor(provider: SocialProvider, input: ComposeInput): string {
  const override = input.overrides?.[provider];
  return override && override.trim().length > 0 ? override : input.body;
}

/**
 * Validates one destination the same way the adapter will at publish time, so
 * the composer surfaces problems before anything is queued.
 */
function preflight(
  provider: SocialProvider,
  body: string,
  title: string | null,
  media: MediaAsset[],
  options: ProviderOptions[SocialProvider],
): void {
  const adapter = getAdapter(provider);
  const payload = {
    title,
    body,
    media: media.map(toPublishMedia),
    options,
    idempotencyKey: "preflight",
  } as PublishPayload;
  adapter.validate?.(payload as never);
}

export async function createComposeAndJobs(
  userId: string,
  input: ComposeInput,
): Promise<{ composeId: string; jobs: CreatedJob[] }> {
  const media = await loadMedia(userId, input.mediaIds);
  const scheduledFor =
    input.mode === "schedule" && input.scheduledFor ? new Date(input.scheduledFor) : new Date();

  if (input.mode === "schedule" && scheduledFor.getTime() <= Date.now()) {
    throw AppError.badRequest("Scheduled time must be in the future.");
  }

  // Resolve every destination up front: one unusable network fails the whole
  // compose rather than silently publishing to a subset.
  const plans = await Promise.all(
    input.destinations.map(async (provider) => {
      const account = await getAccountForProvider(userId, provider);
      if (!account) {
        throw AppError.badRequest(
          `${PROVIDER_LABELS[provider]} is not connected. Connect it in Settings -> Connections.`,
        );
      }
      if (account.status === "needs_reauth") {
        throw AppError.badRequest(
          `${PROVIDER_LABELS[provider]} needs to be reconnected before you can post to it.`,
        );
      }
      const body = bodyFor(provider, input);
      const title = input.title?.trim() || null;
      const options = resolveOptions(provider, input, media);
      preflight(provider, body, title, media, options);
      return { provider, account, body, title, options };
    }),
  );

  const compose = await prisma.compose.create({
    data: {
      userId,
      title: input.title?.trim() || null,
      body: input.body,
      mode: input.mode,
      scheduledFor: input.mode === "schedule" ? scheduledFor : null,
      mediaIds: JSON.stringify(input.mediaIds),
      optionsJson: JSON.stringify({
        overrides: input.overrides ?? {},
        x: input.x ?? null,
        reddit: input.reddit ?? null,
        instagram: input.instagram ?? null,
      }),
    },
  });

  const jobs: CreatedJob[] = [];

  for (const plan of plans) {
    const post = await prisma.post.create({
      data: {
        userId,
        composeId: compose.id,
        connectedAccountId: plan.account.id,
        provider: plan.provider,
        title: plan.title,
        body: plan.body,
        optionsJson: JSON.stringify(plan.options),
        status: "queued",
        scheduledFor,
        media: {
          create: media.map((asset, index) => ({ mediaAssetId: asset.id, order: index })),
        },
      },
    });

    const job = await prisma.postJob.create({
      data: {
        postId: post.id,
        userId,
        provider: plan.provider,
        status: "queued",
        scheduledFor,
        // Unique per job, so a replay of the same job can be recognised and a
        // deliberate re-run (retry) gets a fresh key.
        idempotencyKey: `${plan.provider}:${post.id}:${randomToken(12)}`,
      },
    });

    jobs.push({
      jobId: job.id,
      postId: post.id,
      provider: plan.provider,
      scheduledFor: scheduledFor.toISOString(),
    });
  }

  return { composeId: compose.id, jobs };
}

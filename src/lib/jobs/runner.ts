import type { PostJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { isSocialProvider, type JobStatus, type SocialProvider } from "@/lib/constants";
import { getAdapter } from "@/lib/social";
import { getPublishableAccount } from "@/lib/accounts";
import { parsePostOptions, toPublishMedia } from "@/lib/publish";
import type { PublishPayload } from "@/lib/social/types";

/**
 * Job execution. The only writer of terminal job state.
 *
 * Double-post safety has three layers:
 *  1. Claiming is an atomic conditional update, so two workers cannot take the
 *     same job.
 *  2. A job that already has a platformPostId is never published again, by any
 *     path, including a manual retry.
 *  3. If a process dies between "request sent" and "result stored", the job is
 *     left mid-flight; recoverStaleJobs() parks it as failed + needsReview and
 *     refuses to auto-retry, because only a human can check the platform.
 */

/** Backoff per attempt number, for 429 / 5xx / network errors only. */
const RETRY_DELAYS_MS = [30_000, 120_000];

/** A job locked for longer than this had its worker die underneath it. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export type JobOutcome =
  | { status: "published"; permalink: string; platformPostId: string }
  | { status: "failed"; error: string; willRetry: boolean }
  | { status: "skipped"; reason: string };

export async function claimDueJobs(workerId: string, limit: number): Promise<string[]> {
  const now = new Date();
  const candidates = await prisma.postJob.findMany({
    where: {
      status: "queued",
      scheduledFor: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true },
  });

  const claimed: string[] = [];
  for (const candidate of candidates) {
    // Conditional on status still being "queued": whoever updates a row first
    // owns the job, and everyone else sees count 0.
    const result = await prisma.postJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "publishing",
        lockedAt: now,
        lockedBy: workerId,
        startedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (result.count === 1) {
      await syncPostStatus(candidate.id, "publishing");
      claimed.push(candidate.id);
    }
  }
  return claimed;
}

async function syncPostStatus(
  jobId: string,
  status: JobStatus,
  extra: { permalink?: string; platformPostId?: string; publishedAt?: Date } = {},
): Promise<void> {
  const job = await prisma.postJob.findUnique({ where: { id: jobId }, select: { postId: true } });
  if (!job) return;
  await prisma.post.update({
    where: { id: job.postId },
    data: { status, ...extra },
  });
}

export async function runJob(jobId: string): Promise<JobOutcome> {
  const job = await prisma.postJob.findUnique({
    where: { id: jobId },
    include: {
      post: {
        include: {
          media: { orderBy: { order: "asc" }, include: { media: true } },
        },
      },
    },
  });

  if (!job) return { status: "skipped", reason: "Job no longer exists." };

  // Layer 2: a job that already produced a post is finished, full stop.
  if (job.platformPostId) {
    await finishPublished(job.id, job.platformPostId, job.permalink ?? "");
    return {
      status: "skipped",
      reason: "Already published; refusing to post again.",
    };
  }

  const post = job.post;
  if (!post) {
    await failJob(job, "The post this job belongs to was deleted.", false);
    return { status: "failed", error: "The post this job belongs to was deleted.", willRetry: false };
  }

  try {
    if (!isSocialProvider(job.provider)) {
      throw AppError.badRequest(`Unknown network "${job.provider}".`);
    }
    if (!post.connectedAccountId) {
      throw new AppError(
        `No ${job.provider} account is connected. Connect it in Settings -> Connections, then retry.`,
        { status: 400, code: "not_connected" },
      );
    }

    const provider = job.provider as SocialProvider;
    const adapter = getAdapter(provider);
    const account = await getPublishableAccount(job.userId, post.connectedAccountId);
    const media = post.media.map((entry) => toPublishMedia(entry.media));

    const payload = {
      title: post.title,
      body: post.body,
      media,
      options: parsePostOptions(provider, post.optionsJson),
      idempotencyKey: job.idempotencyKey,
      onProgress: async (phase: "uploading" | "publishing") => {
        await prisma.postJob.update({ where: { id: job.id }, data: { status: phase } });
        await syncPostStatus(job.id, phase);
      },
    } as PublishPayload;

    const result = await adapter.publish(account, payload as never);

    await finishPublished(job.id, result.id, result.permalink);
    return { status: "published", permalink: result.permalink, platformPostId: result.id };
  } catch (error) {
    const appError = toAppError(error);
    const willRetry = appError.retryable && job.attempts < job.maxAttempts;
    await failJob(job, appError.message, willRetry);
    return { status: "failed", error: appError.message, willRetry };
  }
}

async function finishPublished(
  jobId: string,
  platformPostId: string,
  permalink: string,
): Promise<void> {
  const now = new Date();
  await prisma.postJob.update({
    where: { id: jobId },
    data: {
      status: "published",
      platformPostId,
      permalink,
      finishedAt: now,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      needsReview: false,
    },
  });
  await syncPostStatus(jobId, "published", { platformPostId, permalink, publishedAt: now });
}

async function failJob(job: PostJob, message: string, willRetry: boolean): Promise<void> {
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
  await prisma.postJob.update({
    where: { id: job.id },
    data: {
      status: willRetry ? "queued" : "failed",
      lastError: message,
      nextAttemptAt: willRetry ? new Date(Date.now() + delay) : null,
      finishedAt: willRetry ? null : new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
  await syncPostStatus(job.id, willRetry ? "queued" : "failed");
}

/**
 * Layer 3. Anything still locked after STALE_LOCK_MS belongs to a worker that
 * died. We cannot know whether the network call landed, so the job is parked
 * for a human instead of retried.
 */
export async function recoverStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const stale = await prisma.postJob.findMany({
    where: {
      status: { in: ["uploading", "publishing"] },
      lockedAt: { lt: cutoff },
      platformPostId: null,
    },
    select: { id: true, provider: true },
  });

  for (const job of stale) {
    await prisma.postJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        needsReview: true,
        lockedAt: null,
        lockedBy: null,
        finishedAt: new Date(),
        lastError:
          "The worker stopped while this was publishing, so PostForge cannot tell whether it went out. Check your profile on the network before retrying - retrying may double-post.",
      },
    });
    await syncPostStatus(job.id, "failed");
  }

  return stale.length;
}

export async function cancelJob(userId: string, jobId: string): Promise<void> {
  const job = await prisma.postJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw AppError.notFound("That job does not exist.");
  if (job.status === "published") {
    throw AppError.conflict("That post is already published, so it cannot be canceled.");
  }
  if (job.status !== "queued") {
    throw AppError.conflict(`A job that is ${job.status} cannot be canceled.`);
  }
  await prisma.postJob.update({
    where: { id: job.id },
    data: { status: "canceled", finishedAt: new Date(), nextAttemptAt: null },
  });
  await syncPostStatus(job.id, "canceled");
}

export async function retryJob(userId: string, jobId: string): Promise<void> {
  const job = await prisma.postJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw AppError.notFound("That job does not exist.");
  if (job.platformPostId) {
    throw AppError.conflict(
      "That job already published. Retrying would post a duplicate, so it is blocked.",
    );
  }
  if (job.status !== "failed" && job.status !== "canceled") {
    throw AppError.conflict(`A job that is ${job.status} cannot be retried.`);
  }

  await prisma.postJob.update({
    where: { id: job.id },
    data: {
      status: "queued",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      finishedAt: null,
      startedAt: null,
      needsReview: false,
      // Fresh key: this is a deliberate new attempt, not a replay of the old one.
      idempotencyKey: `${job.provider}:${job.postId}:retry:${Date.now()}`,
      scheduledFor: new Date(),
    },
  });
  await syncPostStatus(job.id, "queued");
}

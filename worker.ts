import "dotenv/config";
import { randomUUID } from "node:crypto";
import PQueue from "p-queue";
import { prisma } from "./src/lib/db";
import { env } from "./src/lib/env";
import { claimDueJobs, recoverStaleJobs, runJob } from "./src/lib/jobs/runner";
import { processDueFolderDrips } from "./src/lib/folder-drip";

/**
 * Ruyah worker.
 *
 * Polls for due jobs, runs them through p-queue with bounded concurrency, and
 * exits cleanly on Ctrl+C so in-flight publishes are not abandoned mid-call.
 *
 *   pnpm worker
 */

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = env.workerPollIntervalMs;
const CONCURRENCY = env.workerConcurrency;

const queue = new PQueue({ concurrency: CONCURRENCY });
let stopping = false;

function log(message: string, extra?: unknown) {
  const stamp = new Date().toISOString();
  if (extra === undefined) console.log(`[${stamp}] ${message}`);
  else console.log(`[${stamp}] ${message}`, extra);
}

async function tick(): Promise<void> {
  if (stopping) return;

  // Only claim what we have room for, so jobs stay visible to other workers.
  const capacity = Math.max(0, CONCURRENCY * 2 - queue.size - queue.pending);
  if (capacity === 0) return;

  const drips = await processDueFolderDrips();
  if (drips > 0) log(`folder drip queued ${drips} run(s)`);

  const jobIds = await claimDueJobs(WORKER_ID, capacity);
  if (jobIds.length === 0) return;

  log(`claimed ${jobIds.length} job(s)`);

  for (const jobId of jobIds) {
    void queue.add(async () => {
      try {
        const outcome = await runJob(jobId);
        switch (outcome.status) {
          case "published":
            log(`job ${jobId} published -> ${outcome.permalink}`);
            break;
          case "failed":
            log(
              `job ${jobId} failed${outcome.willRetry ? " (will retry)" : ""}: ${outcome.error}`,
            );
            break;
          case "skipped":
            log(`job ${jobId} skipped: ${outcome.reason}`);
            break;
        }
      } catch (error) {
        // runJob handles its own errors; anything here is a bug worth seeing.
        log(`job ${jobId} crashed`, error);
      }
    });
  }
}

async function main(): Promise<void> {
  log(`Ruyah worker ${WORKER_ID} starting`);
  log(`poll every ${POLL_INTERVAL_MS}ms, concurrency ${CONCURRENCY}`);

  if (!env.tokenEncryptionKey) {
    log("WARNING: TOKEN_ENCRYPTION_KEY is not set. Every job will fail until it is.");
  }

  const recovered = await recoverStaleJobs();
  if (recovered > 0) {
    log(`parked ${recovered} job(s) that were interrupted mid-publish - review them in /posts`);
  }

  const timer = setInterval(() => {
    void tick().catch((error) => log("poll failed", error));
  }, POLL_INTERVAL_MS);

  void tick().catch((error) => log("poll failed", error));

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, finishing ${queue.size + queue.pending} in-flight job(s)...`);
    clearInterval(timer);
    await queue.onIdle();
    await prisma.$disconnect();
    log("worker stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  console.error("[worker] fatal", error);
  await prisma.$disconnect();
  process.exit(1);
});

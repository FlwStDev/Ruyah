import fs from "node:fs/promises";
import path from "node:path";
import type { FolderDrip } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { createComposeAndJobs } from "@/lib/compose";
import type { ComposeInput } from "@/lib/validation";
import { importMediaForUser } from "@/lib/media-import";
import {
  DRIP_AFTER_POST,
  DRIP_CAPTION_MODES,
  DRIP_MIN_INTERVAL_MINUTES,
  DRIP_POSTED_DIR,
  isSocialProvider,
  type DripAfterPost,
  type DripCaptionMode,
  type SocialProvider,
} from "@/lib/constants";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

const ERROR_RETRY_MS = 5 * 60 * 1000;

export type DripFile = {
  fileName: string;
  sourcePath: string;
  size: number;
  mtimeMs: number;
};

export type DripInput = {
  name?: string;
  folderPath: string;
  intervalMinutes: number;
  destinations: SocialProvider[];
  captionMode: DripCaptionMode;
  captionText?: string;
  redditSubreddit?: string;
  afterPost: DripAfterPost;
  enabled?: boolean;
};

export function mimeFromExt(fileName: string): string | null {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? null;
}

export function isEligibleFileName(fileName: string): boolean {
  if (!fileName || fileName.startsWith(".")) return false;
  if (fileName === DRIP_POSTED_DIR) return false;
  return mimeFromExt(fileName) !== null;
}

export function captionFromFileName(fileName: string): string {
  const stem = fileName.replace(path.extname(fileName), "");
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseDestinations(raw: string): SocialProvider[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SocialProvider => typeof item === "string" && isSocialProvider(item));
  } catch {
    return [];
  }
}

export async function resolveFolder(folderPath: string): Promise<string> {
  const trimmed = folderPath.trim();
  if (!trimmed) throw AppError.badRequest("Pick a folder path.");
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) {
    throw AppError.badRequest("Folder path must be absolute, e.g. C:\\Users\\you\\queue.");
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw AppError.badRequest(`That folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw AppError.badRequest("That path is a file, not a folder.");
  }
  return resolved;
}

export async function listPendingFiles(dripId: string, folderPath: string): Promise<DripFile[]> {
  const resolved = await resolveFolder(folderPath);
  const used = await prisma.folderDripItem.findMany({
    where: { dripId, status: { in: ["queued", "posted"] } },
    select: { sourcePath: true },
  });
  const usedSet = new Set(used.map((row) => path.normalize(row.sourcePath)));

  const names = await fs.readdir(resolved);
  const pending: DripFile[] = [];
  for (const name of names) {
    if (!isEligibleFileName(name)) continue;
    const sourcePath = path.join(resolved, name);
    if (usedSet.has(path.normalize(sourcePath))) continue;
    let stat;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    pending.push({
      fileName: name,
      sourcePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  pending.sort((a, b) => a.mtimeMs - b.mtimeMs || a.fileName.localeCompare(b.fileName));
  return pending;
}

function captionFor(drip: FolderDrip, fileName: string): string {
  if (drip.captionMode === "empty") return "";
  if (drip.captionMode === "fixed") return drip.captionText;
  return captionFromFileName(fileName);
}

async function moveToPosted(sourcePath: string): Promise<void> {
  const dir = path.join(path.dirname(sourcePath), DRIP_POSTED_DIR);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(sourcePath);
  let dest = path.join(dir, base);
  let n = 1;
  while (true) {
    try {
      await fs.access(dest);
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      dest = path.join(dir, `${stem}-${n}${ext}`);
      n += 1;
    } catch {
      break;
    }
  }
  await fs.rename(sourcePath, dest);
}

function intervalMs(minutes: number): number {
  return Math.max(DRIP_MIN_INTERVAL_MINUTES, minutes) * 60 * 1000;
}

export function validateDripInput(input: DripInput): void {
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < DRIP_MIN_INTERVAL_MINUTES) {
    throw AppError.badRequest(`Interval must be at least ${DRIP_MIN_INTERVAL_MINUTES} minutes.`);
  }
  if (input.destinations.length === 0) {
    throw AppError.badRequest("Pick at least one destination.");
  }
  if (!DRIP_CAPTION_MODES.includes(input.captionMode)) {
    throw AppError.badRequest("Unknown caption mode.");
  }
  if (!DRIP_AFTER_POST.includes(input.afterPost)) {
    throw AppError.badRequest("Unknown after-post action.");
  }
  if (input.captionMode === "fixed" && !input.captionText?.trim()) {
    throw AppError.badRequest("Fixed caption is empty.");
  }
  if (input.destinations.includes("reddit") && !input.redditSubreddit?.trim()) {
    throw AppError.badRequest("Reddit needs a subreddit.");
  }
}

export async function createFolderDrip(userId: string, input: DripInput) {
  validateDripInput(input);
  const folderPath = await resolveFolder(input.folderPath);
  return prisma.folderDrip.create({
    data: {
      userId,
      name: input.name?.trim() || path.basename(folderPath) || "Folder drip",
      folderPath,
      intervalMinutes: input.intervalMinutes,
      destinationsJson: JSON.stringify(input.destinations),
      captionMode: input.captionMode,
      captionText: input.captionText?.trim() ?? "",
      redditSubreddit: input.redditSubreddit?.trim() ?? "",
      afterPost: input.afterPost,
      enabled: input.enabled ?? true,
      nextRunAt: new Date(),
    },
  });
}

export async function updateFolderDrip(userId: string, id: string, input: Partial<DripInput>) {
  const existing = await prisma.folderDrip.findFirst({ where: { id, userId } });
  if (!existing) throw AppError.notFound("That folder drip does not exist.");

  const merged: DripInput = {
    name: input.name ?? existing.name,
    folderPath: input.folderPath ?? existing.folderPath,
    intervalMinutes: input.intervalMinutes ?? existing.intervalMinutes,
    destinations: input.destinations ?? parseDestinations(existing.destinationsJson),
    captionMode: (input.captionMode ?? existing.captionMode) as DripCaptionMode,
    captionText: input.captionText ?? existing.captionText,
    redditSubreddit: input.redditSubreddit ?? existing.redditSubreddit,
    afterPost: (input.afterPost ?? existing.afterPost) as DripAfterPost,
    enabled: input.enabled ?? existing.enabled,
  };
  validateDripInput(merged);
  const folderPath = await resolveFolder(merged.folderPath);

  return prisma.folderDrip.update({
    where: { id },
    data: {
      name: merged.name?.trim() || existing.name,
      folderPath,
      intervalMinutes: merged.intervalMinutes,
      destinationsJson: JSON.stringify(merged.destinations),
      captionMode: merged.captionMode,
      captionText: merged.captionText?.trim() ?? "",
      redditSubreddit: merged.redditSubreddit?.trim() ?? "",
      afterPost: merged.afterPost,
      enabled: merged.enabled,
      nextRunAt:
        merged.enabled && !existing.enabled
          ? new Date()
          : !merged.enabled
            ? null
            : existing.nextRunAt,
      lastError: merged.enabled ? existing.lastError : existing.lastError,
    },
  });
}

export async function deleteFolderDrip(userId: string, id: string): Promise<void> {
  const existing = await prisma.folderDrip.findFirst({ where: { id, userId } });
  if (!existing) throw AppError.notFound("That folder drip does not exist.");
  await prisma.folderDrip.delete({ where: { id } });
}

export async function runFolderDripNow(userId: string, id: string) {
  const existing = await prisma.folderDrip.findFirst({ where: { id, userId } });
  if (!existing) throw AppError.notFound("That folder drip does not exist.");
  if (!existing.enabled) throw AppError.badRequest("Resume the drip before running it.");
  await prisma.folderDrip.update({
    where: { id },
    data: { nextRunAt: new Date(), lastError: null },
  });
  return runFolderDrip(id);
}

async function claimDueDrips(): Promise<string[]> {
  const now = new Date();
  const due = await prisma.folderDrip.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 10,
  });

  const claimed: string[] = [];
  for (const drip of due) {
    const next = new Date(Date.now() + intervalMs(drip.intervalMinutes));
    const result = await prisma.folderDrip.updateMany({
      where: { id: drip.id, enabled: true, nextRunAt: drip.nextRunAt },
      data: { nextRunAt: next },
    });
    if (result.count === 1) claimed.push(drip.id);
  }
  return claimed;
}

export async function runFolderDrip(dripId: string): Promise<{ fileName: string | null; queued: boolean }> {
  const drip = await prisma.folderDrip.findUnique({ where: { id: dripId } });
  if (!drip || !drip.enabled) return { fileName: null, queued: false };

  let pending: DripFile[];
  try {
    pending = await listPendingFiles(drip.id, drip.folderPath);
  } catch (error) {
    await prisma.folderDrip.update({
      where: { id: drip.id },
      data: {
        lastError: toAppError(error).message,
        nextRunAt: new Date(Date.now() + ERROR_RETRY_MS),
      },
    });
    return { fileName: null, queued: false };
  }

  const next = pending[0];
  if (!next) {
    await prisma.folderDrip.update({
      where: { id: drip.id },
      data: { lastError: null, lastFileName: null },
    });
    return { fileName: null, queued: false };
  }

  try {
    const item = await prisma.folderDripItem.create({
      data: {
        dripId: drip.id,
        sourcePath: path.normalize(next.sourcePath),
        fileName: next.fileName,
        status: "queued",
      },
    });

    const mime = mimeFromExt(next.fileName);
    if (!mime) throw AppError.badRequest(`Unsupported file "${next.fileName}".`);

    const buffer = await fs.readFile(next.sourcePath);
    const asset = await importMediaForUser(drip.userId, buffer, mime, next.fileName);
    const destinations = parseDestinations(drip.destinationsJson);
    const caption = captionFor(drip, next.fileName);

    const result = await createComposeAndJobs(drip.userId, {
      body: caption,
      title: destinations.includes("reddit") ? caption.slice(0, 300) || next.fileName : null,
      mediaIds: [asset.id],
      destinations,
      overrides: {},
      mode: "now",
      x: { replySettings: "everyone" },
      reddit: destinations.includes("reddit")
        ? ({ subreddit: drip.redditSubreddit } as ComposeInput["reddit"])
        : undefined,
    } as ComposeInput);

    if (drip.afterPost === "move") {
      await moveToPosted(next.sourcePath);
    }

    await prisma.folderDripItem.update({
      where: { id: item.id },
      data: { status: "posted", postId: result.jobs[0]?.postId ?? null },
    });
    await prisma.folderDrip.update({
      where: { id: drip.id },
      data: {
        lastRunAt: new Date(),
        lastFileName: next.fileName,
        lastError: null,
      },
    });
    return { fileName: next.fileName, queued: true };
  } catch (error) {
    const message = toAppError(error).message;
    await prisma.folderDripItem.updateMany({
      where: { dripId: drip.id, sourcePath: path.normalize(next.sourcePath) },
      data: { status: "failed", lastError: message },
    });
    await prisma.folderDrip.update({
      where: { id: drip.id },
      data: {
        lastError: message,
        nextRunAt: new Date(Date.now() + ERROR_RETRY_MS),
      },
    });
    throw error;
  }
}

export async function processDueFolderDrips(): Promise<number> {
  const ids = await claimDueDrips();
  for (const id of ids) {
    try {
      await runFolderDrip(id);
    } catch (error) {
      // lastError is already stored; keep the worker tick alive.
      void error;
    }
  }
  return ids.length;
}

export type PublicDrip = {
  id: string;
  name: string;
  folderPath: string;
  intervalMinutes: number;
  destinations: SocialProvider[];
  captionMode: DripCaptionMode;
  captionText: string;
  redditSubreddit: string;
  afterPost: DripAfterPost;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastFileName: string | null;
  pendingCount: number;
  pendingPreview: string[];
  createdAt: string;
};

export async function toPublicDrip(drip: FolderDrip): Promise<PublicDrip> {
  let pending: DripFile[] = [];
  try {
    pending = await listPendingFiles(drip.id, drip.folderPath);
  } catch {
    pending = [];
  }
  return {
    id: drip.id,
    name: drip.name,
    folderPath: drip.folderPath,
    intervalMinutes: drip.intervalMinutes,
    destinations: parseDestinations(drip.destinationsJson),
    captionMode: drip.captionMode as DripCaptionMode,
    captionText: drip.captionText,
    redditSubreddit: drip.redditSubreddit,
    afterPost: drip.afterPost as DripAfterPost,
    enabled: drip.enabled,
    nextRunAt: drip.nextRunAt?.toISOString() ?? null,
    lastRunAt: drip.lastRunAt?.toISOString() ?? null,
    lastError: drip.lastError,
    lastFileName: drip.lastFileName,
    pendingCount: pending.length,
    pendingPreview: pending.slice(0, 8).map((file) => file.fileName),
    createdAt: drip.createdAt.toISOString(),
  };
}

export async function listFolderDrips(userId: string): Promise<PublicDrip[]> {
  const rows = await prisma.folderDrip.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(rows.map(toPublicDrip));
}

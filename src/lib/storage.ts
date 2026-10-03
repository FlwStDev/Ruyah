import fs from "node:fs/promises";
import { createReadStream, type ReadStream } from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";

/**
 * Storage behind an interface so S3 can replace the local disk later without
 * touching the adapters: they only ever ask for bytes or a public URL.
 */
export interface StorageService {
  put(key: string, data: Buffer, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<ReadStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

/** Reject traversal and absolute keys before they touch the filesystem. */
function resolveKey(key: string): string {
  const normalized = path.normalize(key).replace(/^[/\\]+/, "");
  const full = path.resolve(UPLOAD_ROOT, normalized);
  if (full !== UPLOAD_ROOT && !full.startsWith(UPLOAD_ROOT + path.sep)) {
    throw AppError.badRequest("Invalid storage key.");
  }
  return full;
}

export class LocalStorageService implements StorageService {
  async put(key: string, data: Buffer, _contentType: string) {
    void _contentType; // local disk has no content-type metadata
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const full = resolveKey(key);
    try {
      return await fs.readFile(full);
    } catch {
      throw AppError.notFound("That file is no longer on disk.");
    }
  }

  async stream(key: string): Promise<ReadStream> {
    const full = resolveKey(key);
    if (!(await this.exists(key))) {
      throw AppError.notFound("That file is no longer on disk.");
    }
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    const full = resolveKey(key);
    await fs.rm(full, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageService = new LocalStorageService();

export function buildStorageKey(userId: string, assetId: string, extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return path.posix.join(userId, `${yyyy}-${mm}`, `${assetId}${extension}`);
}

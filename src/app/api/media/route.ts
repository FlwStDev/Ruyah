import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { importMediaForUser } from "@/lib/media-import";
import { serializeMedia } from "@/lib/serializers";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const assets = await prisma.mediaAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonOk({ media: assets.map(serializeMedia) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();

    const form = await request.formData().catch(() => {
      throw AppError.badRequest("Upload must be multipart/form-data.");
    });

    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) throw AppError.badRequest("No files were uploaded.");

    const created = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw AppError.badRequest(
          `"${file.name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const saved = await importMediaForUser(user.id, buffer, file.type, file.name);
      created.push(serializeMedia(saved));
    }

    return jsonOk({ media: created }, 201);
  });
}

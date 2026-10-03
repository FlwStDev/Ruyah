import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, jsonOk, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { postFilterSchema } from "@/lib/validation";
import { serializePost } from "@/lib/serializers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const filters = parseQuery(request, postFilterSchema);

    const where: Prisma.PostWhereInput = { userId: user.id };
    if (filters.provider) where.provider = filters.provider;
    if (filters.status) where.status = filters.status;

    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      include: {
        account: { select: { username: true } },
        media: { orderBy: { order: "asc" }, include: { media: true } },
        jobs: { orderBy: { createdAt: "desc" } },
      },
    });

    return jsonOk({ posts: posts.map(serializePost) });
  });
}

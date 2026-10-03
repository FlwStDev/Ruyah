import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requireUserPage } from "@/lib/auth/guard";
import { serializePost } from "@/lib/serializers";
import { isSocialProvider, JOB_STATUSES, type JobStatus } from "@/lib/constants";
import { PostsClient } from "@/components/posts-client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ provider?: string; status?: string }> };

export default async function PostsPage({ searchParams }: Props) {
  const user = await requireUserPage();
  const params = await searchParams;

  const provider =
    params.provider && isSocialProvider(params.provider) ? params.provider : undefined;
  const status =
    params.status && (JOB_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as JobStatus)
      : undefined;

  const where: Prisma.PostWhereInput = { userId: user.id };
  if (provider) where.provider = provider;
  if (status) where.status = status;

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      account: { select: { username: true } },
      media: { orderBy: { order: "asc" }, include: { media: true } },
      jobs: { orderBy: { createdAt: "desc" } },
    },
  });

  return (
    <PostsClient
      posts={posts.map(serializePost)}
      activeProvider={provider ?? null}
      activeStatus={status ?? null}
    />
  );
}

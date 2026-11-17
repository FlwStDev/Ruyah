import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { prisma } from "@/lib/db";
import { requireUserPage } from "@/lib/auth/guard";
import { serializePost } from "@/lib/serializers";
import { CalendarClient } from "@/components/calendar-client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ month?: string }> };

export default async function CalendarPage({ searchParams }: Props) {
  const user = await requireUserPage();
  const params = await searchParams;
  const offset = Number.parseInt(params.month ?? "0", 10);
  const monthOffset = Number.isFinite(offset) ? offset : 0;
  const monthStart = addMonths(startOfMonth(new Date()), monthOffset);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 });

  const posts = await prisma.post.findMany({
    where: {
      userId: user.id,
      scheduledFor: { gte: gridStart, lt: gridEnd },
    },
    orderBy: { scheduledFor: "asc" },
    include: {
      account: { select: { username: true } },
      media: { orderBy: { order: "asc" }, include: { media: true } },
      jobs: { orderBy: { createdAt: "desc" } },
    },
  });

  return (
    <CalendarClient
      monthStartIso={monthStart.toISOString()}
      monthOffset={monthOffset}
      posts={posts.map(serializePost)}
    />
  );
}

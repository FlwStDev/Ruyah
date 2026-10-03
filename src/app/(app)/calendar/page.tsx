import { addDays, startOfWeek } from "date-fns";
import { prisma } from "@/lib/db";
import { requireUserPage } from "@/lib/auth/guard";
import { serializePost } from "@/lib/serializers";
import { CalendarClient } from "@/components/calendar-client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ week?: string }> };

export default async function CalendarPage({ searchParams }: Props) {
  const user = await requireUserPage();
  const params = await searchParams;

  // ?week is an offset from the current week, so navigation stays stateless.
  const offset = Number.parseInt(params.week ?? "0", 10);
  const weekOffset = Number.isFinite(offset) ? offset : 0;
  const weekStart = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7);
  const weekEnd = addDays(weekStart, 7);

  const posts = await prisma.post.findMany({
    where: {
      userId: user.id,
      scheduledFor: { gte: weekStart, lt: weekEnd },
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
      weekStartIso={weekStart.toISOString()}
      weekOffset={weekOffset}
      posts={posts.map(serializePost)}
    />
  );
}

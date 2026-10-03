"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isSameDay } from "date-fns";
import { Ban, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { apiPost, errorText } from "@/lib/client/api";
import { PROVIDER_LABELS } from "@/lib/constants";
import type { SerializedPost } from "@/lib/serializers";

type Props = {
  weekStartIso: string;
  weekOffset: number;
  posts: SerializedPost[];
};

export function CalendarClient({ weekStartIso, weekOffset, posts }: Props) {
  const router = useRouter();
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const today = new Date();

  async function cancel(jobId: string) {
    setBusyJobId(jobId);
    try {
      await apiPost(`/api/jobs/${jobId}/cancel`);
      toast.success("Job canceled.");
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusyJobId(null);
    }
  }

  function goto(offset: number) {
    router.push(offset === 0 ? "/calendar" : `/calendar?week=${offset}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {format(weekStart, "d MMM")} - {format(addDays(weekStart, 6), "d MMM yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous week"
            onClick={() => goto(weekOffset - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => goto(0)} disabled={weekOffset === 0}>
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next week"
            onClick={() => goto(weekOffset + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const dayPosts = posts.filter(
            (post) => post.scheduledFor && isSameDay(new Date(post.scheduledFor), day),
          );
          const isToday = isSameDay(day, today);

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "border-border/60 bg-card/40 min-h-44 rounded-lg border p-2",
                isToday && "border-primary/50 bg-primary/5",
              )}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium">{format(day, "EEE")}</span>
                <span className={cn("text-xs", isToday ? "text-primary" : "text-muted-foreground")}>
                  {format(day, "d")}
                </span>
              </div>

              <div className="space-y-1.5">
                {dayPosts.length === 0 ? (
                  <p className="text-muted-foreground/60 text-[10px]">-</p>
                ) : (
                  dayPosts.map((post) => {
                    const job = post.jobs[0];
                    return (
                      <div
                        key={post.id}
                        className="border-border/60 bg-background/60 space-y-1 rounded-md border p-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium">
                            {post.scheduledFor
                              ? format(new Date(post.scheduledFor), "HH:mm")
                              : ""}
                          </span>
                          <StatusBadge status={post.status} className="px-1 py-0 text-[9px]" />
                        </div>
                        <p className="text-muted-foreground truncate text-[10px]">
                          {PROVIDER_LABELS[post.provider]}
                        </p>
                        <p className="line-clamp-2 text-[10px] leading-snug">
                          {post.title || post.body || "(media only)"}
                        </p>

                        <div className="flex gap-1">
                          {post.permalink ? (
                            <a
                              href={post.permalink}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[10px]"
                            >
                              <ExternalLink className="size-2.5" />
                              View
                            </a>
                          ) : null}
                          {job && post.status === "queued" ? (
                            <button
                              type="button"
                              disabled={busyJobId === job.id}
                              onClick={() => cancel(job.id)}
                              className="text-muted-foreground hover:text-destructive inline-flex items-center gap-0.5 text-[10px]"
                            >
                              {busyJobId === job.id ? (
                                <Loader2 className="size-2.5 animate-spin" />
                              ) : (
                                <Ban className="size-2.5" />
                              )}
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

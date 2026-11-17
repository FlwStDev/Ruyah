"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageBanner } from "@/components/page-banner";
import { StatusBadge } from "@/components/status-badge";
import { PROVIDER_LABELS } from "@/lib/constants";
import type { SerializedPost } from "@/lib/serializers";

type Props = {
  monthStartIso: string;
  monthOffset: number;
  posts: SerializedPost[];
};

const NOTES_KEY = "ruyah-day-notes";

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function CalendarClient({ monthStartIso, monthOffset, posts }: Props) {
  const router = useRouter();
  const monthStart = new Date(monthStartIso);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const today = new Date();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteDay, setNoteDay] = useState(dayKey(today));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (raw) setNotes(JSON.parse(raw) as Record<string, string>);
    } catch {
      setNotes({});
    }
  }, []);

  function saveNote(value: string) {
    const next = { ...notes, [noteDay]: value };
    setNotes(next);
    localStorage.setItem(NOTES_KEY, JSON.stringify(next));
  }

  function goto(offset: number) {
    router.push(offset === 0 ? "/calendar" : `/calendar?month=${offset}`);
  }

  const selected = posts.find((post) => post.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageBanner title="Calendar" lede="A month at a time. Open a post for its details, and keep a note on the day." />

      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-medium tracking-tight">{format(monthStart, "MMMM yyyy")}</p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => goto(monthOffset - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" onClick={() => goto(0)} disabled={monthOffset === 0}>
            This month
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Next month" onClick={() => goto(monthOffset + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="border">
          <div className="text-muted-foreground grid grid-cols-7 border-b text-[11px] tracking-[0.14em] uppercase">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div key={label} className="px-2 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const inMonth = isSameMonth(day, monthStart);
              const key = dayKey(day);
              const dayPosts = posts.filter(
                (post) => post.scheduledFor && isSameDay(new Date(post.scheduledFor), day),
              );
              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-24 border-r border-b p-1.5",
                    !inMonth && "bg-muted/30 text-muted-foreground",
                    isSameDay(day, today) && "outline outline-1 outline-primary",
                  )}
                >
                  <button
                    type="button"
                    className="text-xs font-medium"
                    onClick={() => setNoteDay(key)}
                  >
                    {format(day, "d")}
                  </button>
                  <div className="mt-1 space-y-1">
                    {dayPosts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => setSelectedId(post.id)}
                        className="bg-primary/15 hover:bg-primary/25 block w-full truncate px-1 py-0.5 text-left text-[10px]"
                      >
                        {format(new Date(post.scheduledFor!), "HH:mm")} {PROVIDER_LABELS[post.provider]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="border p-4">
            <p className="text-[11px] tracking-[0.14em] uppercase">Notes · {noteDay}</p>
            <textarea
              value={notes[noteDay] ?? ""}
              onChange={(event) => saveNote(event.target.value)}
              rows={6}
              placeholder="A reminder for this day."
              className="bg-background mt-3 w-full resize-y border px-3 py-2 text-sm"
            />
          </div>

          {selected ? (
            <div className="border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] tracking-[0.14em] uppercase">Post</p>
                <button type="button" aria-label="Close details" onClick={() => setSelectedId(null)}>
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-3 text-sm font-medium">{PROVIDER_LABELS[selected.provider]}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {selected.scheduledFor ? new Date(selected.scheduledFor).toLocaleString() : "Unscheduled"}
              </p>
              <div className="mt-2">
                <StatusBadge status={selected.status} />
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap">{selected.body || "No caption."}</p>
              {selected.accountUsername ? (
                <p className="text-muted-foreground mt-2 text-xs">@{selected.accountUsername}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Select a scheduled post to open its details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

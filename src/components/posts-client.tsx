"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ExternalLink, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { PageBanner } from "@/components/page-banner";
import { MediaThumb } from "@/components/media-library";
import { apiPost, errorText } from "@/lib/client/api";
import {
  JOB_STATUSES,
  PROVIDER_LABELS,
  SOCIAL_PROVIDERS,
  type JobStatus,
  type SocialProvider,
} from "@/lib/constants";
import type { SerializedPost } from "@/lib/serializers";

type Props = {
  posts: SerializedPost[];
  activeProvider: SocialProvider | null;
  activeStatus: JobStatus | null;
};

const IN_FLIGHT: JobStatus[] = ["queued", "uploading", "publishing"];

export function PostsClient({ posts, activeProvider, activeStatus }: Props) {
  const router = useRouter();
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  // Jobs move in the background; keep the list honest while any are in flight.
  const hasInFlight = posts.some((post) => IN_FLIGHT.includes(post.status));
  useEffect(() => {
    if (!hasInFlight) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [hasInFlight, router]);

  function setFilter(key: "provider" | "status", value: string | null) {
    const params = new URLSearchParams();
    if (key === "provider" ? value : activeProvider) {
      params.set("provider", key === "provider" ? value! : activeProvider!);
    }
    if (key === "status" ? value : activeStatus) {
      params.set("status", key === "status" ? value! : activeStatus!);
    }
    const query = params.toString();
    router.push(query ? `/posts?${query}` : "/posts");
  }

  async function act(jobId: string, action: "cancel" | "retry") {
    setBusyJobId(jobId);
    try {
      await apiPost(`/api/jobs/${jobId}/${action}`);
      toast.success(action === "cancel" ? "Job canceled." : "Job re-queued.");
      router.refresh();
    } catch (error) {
      toast.error(errorText(error), { duration: 8000 });
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageBanner
        title="Posts"
        lede={
          hasInFlight
            ? "One row for each network. Refreshing while jobs are in flight."
            : "One row for each network."
        }
      />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-4">
        <FilterRow
          label="Network"
          options={SOCIAL_PROVIDERS.map((provider) => ({
            value: provider,
            label: PROVIDER_LABELS[provider],
          }))}
          active={activeProvider}
          onChange={(value) => setFilter("provider", value)}
        />
        <FilterRow
          label="Status"
          options={JOB_STATUSES.map((status) => ({ value: status, label: status }))}
          active={activeStatus}
          onChange={(value) => setFilter("status", value)}
        />
      </div>

      {posts.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-14 text-center text-sm">
            No posts match. Write one in Compose.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {posts.map((post) => {
            const job = post.jobs[0];
            return (
              <Card key={post.id}>
                <CardContent className="flex gap-4 py-4">
                  {post.media.length > 0 ? (
                    <MediaThumb
                      media={post.media[0]}
                      className="size-14 shrink-0 rounded-md border"
                    />
                  ) : null}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {PROVIDER_LABELS[post.provider]}
                      </span>
                      {post.accountUsername ? (
                        <span className="text-muted-foreground text-xs">
                          @{post.accountUsername}
                        </span>
                      ) : null}
                      <StatusBadge status={post.status} />
                      {job && job.attempts > 1 ? (
                        <span className="text-muted-foreground text-[11px]">
                          attempt {job.attempts}/{job.maxAttempts}
                        </span>
                      ) : null}
                    </div>

                    {post.title ? (
                      <p className="truncate text-sm font-medium">{post.title}</p>
                    ) : null}
                    {post.body ? (
                      <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-wrap">
                        {post.body}
                      </p>
                    ) : null}

                    <p className="text-muted-foreground text-[11px]">
                      {post.publishedAt
                        ? `Published ${new Date(post.publishedAt).toLocaleString()}`
                        : post.scheduledFor
                          ? `${post.status === "queued" ? "Due" : "Scheduled"} ${new Date(post.scheduledFor).toLocaleString()}`
                          : `Created ${new Date(post.createdAt).toLocaleString()}`}
                      {job?.nextAttemptAt && post.status === "queued"
                        ? ` - next try ${new Date(job.nextAttemptAt).toLocaleTimeString()}`
                        : ""}
                    </p>

                    {job?.lastError ? (
                      <p
                        className={cn(
                          "rounded border px-2 py-1.5 text-[11px] break-words",
                          job.needsReview
                            ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
                            : "border-destructive/30 bg-destructive/5 text-destructive",
                        )}
                      >
                        {job.lastError}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {post.permalink ? (
                      <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
                        <a href={post.permalink} target="_blank" rel="noreferrer noopener">
                          <ExternalLink className="size-3" />
                          View
                        </a>
                      </Button>
                    ) : null}

                    {job && post.status === "queued" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyJobId === job.id}
                        onClick={() => act(job.id, "cancel")}
                      >
                        {busyJobId === job.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Ban className="size-3" />
                        )}
                        Cancel
                      </Button>
                    ) : null}

                    {job &&
                    (post.status === "failed" || post.status === "canceled") &&
                    !job.platformPostId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyJobId === job.id}
                        onClick={() => act(job.id, "retry")}
                      >
                        {busyJobId === job.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  active: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="text-muted-foreground grid gap-1 text-[11px] tracking-[0.14em] uppercase">
      {label}
      <select
        className="bg-background text-foreground h-10 min-w-48 border px-3 text-sm tracking-normal normal-case"
        value={active ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

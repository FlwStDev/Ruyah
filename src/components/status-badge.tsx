import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/constants";

const STYLES: Record<JobStatus, string> = {
  queued: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  uploading: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  publishing: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  published: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-300 border-red-500/30",
  canceled: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STYLES[status] ?? STYLES.queued,
        className,
      )}
    >
      {status}
    </span>
  );
}

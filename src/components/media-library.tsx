"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { apiDelete, errorText } from "@/lib/client/api";
import { ACCEPTED_MIME } from "@/lib/constants";
import type { SerializedMedia } from "@/lib/serializers";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaUploader({
  onUploaded,
  compact = false,
}: {
  onUploaded: (media: SerializedMedia[]) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setBusy(true);
      try {
        const form = new FormData();
        for (const file of list) form.append("files", file);
        const response = await fetch("/api/media", { method: "POST", body: form });
        const payload: unknown = await response.json();
        const envelope = payload as
          | { ok: true; data: { media: SerializedMedia[] } }
          | { ok: false; error: { message: string } };
        if (!envelope || envelope.ok !== true) {
          throw new Error(
            envelope && envelope.ok === false ? envelope.error.message : "Upload failed.",
          );
        }
        onUploaded(envelope.data.media);
        toast.success(
          `Uploaded ${envelope.data.media.length} file${envelope.data.media.length === 1 ? "" : "s"}`,
        );
      } catch (error) {
        toast.error(errorText(error));
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onUploaded],
  );

  // Native listeners (not React-delegated) so OS / Playwright drops actually
  // call preventDefault on the element itself. Delegated dragover is ignored
  // by the browser when deciding whether a drop is allowed.
  useEffect(() => {
    const node = dropRef.current;
    if (!node) return;
    const allow = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    node.addEventListener("dragenter", allow);
    node.addEventListener("dragover", allow);
    return () => {
      node.removeEventListener("dragenter", allow);
      node.removeEventListener("dragover", allow);
    };
  }, []);

  return (
    <div
      ref={dropRef}
      onDragEnter={() => setDragging(true)}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
      className={cn(
        "border-border/70 flex flex-col items-center justify-center rounded-lg border border-dashed transition-colors",
        compact ? "gap-1.5 p-4" : "gap-2 p-8",
        dragging && "border-primary bg-primary/5",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_MIME.join(",")}
        className="hidden"
        disabled={busy}
        onChange={(event) => event.target.files && void upload(event.target.files)}
      />
      {busy ? (
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      ) : (
        <Upload className="text-muted-foreground size-5" />
      )}
      <p className="text-muted-foreground text-xs">
        Drop files here, or{" "}
        <button
          type="button"
          className="text-foreground underline underline-offset-2"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          browse
        </button>
      </p>
      <p className="text-muted-foreground text-[10px]">jpg, png, webp, gif, mp4 - up to 100 MB</p>
    </div>
  );
}

export function MediaThumb({
  media,
  className,
}: {
  media: SerializedMedia;
  className?: string;
}) {
  if (media.kind === "video") {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex items-center justify-center",
          className,
        )}
      >
        <Film className="size-5" />
      </div>
    );
  }
  // Plain <img>: these are local API routes, so next/image optimization would
  // add a round trip for no benefit.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} alt={media.originalName} className={cn("object-cover", className)} />;
}

export function MediaLibrary({ initialMedia }: { initialMedia: SerializedMedia[] }) {
  const [media, setMedia] = useState(initialMedia);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function remove(asset: SerializedMedia) {
    setDeletingId(asset.id);
    try {
      await apiDelete(`/api/media/${asset.id}`);
      setMedia((current) => current.filter((item) => item.id !== asset.id));
      toast.success("Deleted.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <MediaUploader onUploaded={(uploaded) => setMedia((current) => [...uploaded, ...current])} />

      {media.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          Nothing uploaded yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {media.map((asset) => (
            <div
              key={asset.id}
              className="group border-border/60 bg-card relative overflow-hidden rounded-lg border"
            >
              <MediaThumb media={asset} className="aspect-square w-full" />
              <div className="space-y-0.5 p-2">
                <p className="truncate text-[11px] font-medium" title={asset.originalName}>
                  {asset.originalName}
                </p>
                <p className="text-muted-foreground text-[10px]">
                  {formatBytes(asset.size)}
                  {asset.width ? ` - ${asset.width}x${asset.height}` : ""}
                </p>
              </div>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1.5 right-1.5 size-6 opacity-0 transition-opacity group-hover:opacity-100"
                disabled={deletingId === asset.id}
                onClick={() => remove(asset)}
                aria-label={`Delete ${asset.originalName}`}
              >
                {deletingId === asset.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

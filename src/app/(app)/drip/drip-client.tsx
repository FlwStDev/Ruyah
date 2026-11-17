"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Pause, Play, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBanner } from "@/components/page-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROVIDER_LABELS, DRIP_INTERVAL_PRESETS, type SocialProvider } from "@/lib/constants";
import type { PublicDrip } from "@/lib/folder-drip";
import { apiDelete, apiPatch, apiPost, errorText } from "@/lib/client/api";

type Props = {
  drips: PublicDrip[];
  connected: SocialProvider[];
};

type Draft = {
  folderPath: string;
  intervalMinutes: number;
  destinations: SocialProvider[];
  captionMode: "filename" | "empty" | "fixed";
  captionText: string;
  redditSubreddit: string;
  afterPost: "move" | "keep";
};

const emptyDraft = (connected: SocialProvider[]): Draft => ({
  folderPath: "",
  intervalMinutes: 60,
  destinations: connected.includes("x") ? ["x"] : connected.slice(0, 1),
  captionMode: "filename",
  captionText: "",
  redditSubreddit: "",
  afterPost: "move",
});

function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function DripClient({ drips, connected }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(connected));
  const [busy, setBusy] = useState<string | null>(null);

  const canCreate = useMemo(
    () => draft.folderPath.trim().length > 0 && draft.destinations.length > 0,
    [draft],
  );

  function toggleDestination(provider: SocialProvider) {
    setDraft((current) => {
      const has = current.destinations.includes(provider);
      return {
        ...current,
        destinations: has
          ? current.destinations.filter((item) => item !== provider)
          : [...current.destinations, provider],
      };
    });
  }

  async function create() {
    setBusy("create");
    try {
      await apiPost("/api/drip", draft);
      toast.success("Folder drip saved. The worker will take the next file shortly.");
      setDraft(emptyDraft(connected));
      router.refresh();
    } catch (error) {
      toast.error(errorText(error), { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  }

  async function setEnabled(id: string, enabled: boolean) {
    setBusy(id);
    try {
      await apiPatch(`/api/drip/${id}`, { enabled });
      toast.success(enabled ? "Drip resumed." : "Drip paused.");
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function runNow(id: string) {
    setBusy(id);
    try {
      const result = await apiPost<{ queued: boolean; fileName: string | null }>(
        `/api/drip/${id}/run`,
      );
      toast.success(
        result.queued
          ? `Queued ${result.fileName}. Check Posts for status.`
          : "Folder is empty — nothing to queue.",
      );
      router.refresh();
    } catch (error) {
      toast.error(errorText(error), { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await apiDelete(`/api/drip/${id}`);
      toast.success("Drip removed. Files on disk were left alone.");
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageBanner
        title="Storage"
        lede="Point at a folder on this computer. The oldest unused file goes out on a cadence, then moves aside so it cannot post twice."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New drip</CardTitle>
          <CardDescription className="text-xs">
            Absolute path on this machine. First file goes out within a few seconds, then on the
            cadence.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="folder-path" className="text-xs">
              Folder path
            </Label>
            <Input
              id="folder-path"
              spellCheck={false}
              placeholder="C:\Users\you\Videos\queue"
              value={draft.folderPath}
              onChange={(event) => setDraft((current) => ({ ...current, folderPath: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Every</Label>
            <div className="flex flex-wrap gap-2">
              {DRIP_INTERVAL_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={draft.intervalMinutes === minutes ? "default" : "secondary"}
                  onClick={() => setDraft((current) => ({ ...current, intervalMinutes: minutes }))}
                >
                  {formatInterval(minutes)}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Post to</Label>
            {connected.length === 0 ? (
              <p className="text-amber-300 text-xs">Connect an account first (Settings → Connections).</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connected.map((provider) => (
                  <Button
                    key={provider}
                    type="button"
                    size="sm"
                    variant={draft.destinations.includes(provider) ? "default" : "secondary"}
                    onClick={() => toggleDestination(provider)}
                  >
                    {PROVIDER_LABELS[provider]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {draft.destinations.includes("reddit") ? (
            <div className="space-y-2">
              <Label htmlFor="reddit-sr" className="text-xs">
                Subreddit
              </Label>
              <Input
                id="reddit-sr"
                placeholder="pics"
                value={draft.redditSubreddit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, redditSubreddit: event.target.value }))
                }
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs">Caption</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["filename", "From filename"],
                  ["empty", "Media only"],
                  ["fixed", "Fixed text"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={draft.captionMode === value ? "default" : "secondary"}
                  onClick={() => setDraft((current) => ({ ...current, captionMode: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
            {draft.captionMode === "fixed" ? (
              <Input
                placeholder="Same caption on every post"
                value={draft.captionText}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, captionText: event.target.value }))
                }
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">After posting</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={draft.afterPost === "move" ? "default" : "secondary"}
                onClick={() => setDraft((current) => ({ ...current, afterPost: "move" }))}
              >
                Move to _posted
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draft.afterPost === "keep" ? "default" : "secondary"}
                onClick={() => setDraft((current) => ({ ...current, afterPost: "keep" }))}
              >
                Leave in place (remember it)
              </Button>
            </div>
          </div>

          <div>
            <Button type="button" disabled={!canCreate || busy === "create"} onClick={create}>
              {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
              Start drip
            </Button>
          </div>
        </CardContent>
      </Card>

      {drips.length === 0 ? (
        <p className="text-muted-foreground text-sm">No drips yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {drips.map((drip) => (
            <Card key={drip.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{drip.name}</CardTitle>
                  <Badge variant={drip.enabled ? "secondary" : "outline"}>
                    {drip.enabled ? `every ${formatInterval(drip.intervalMinutes)}` : "paused"}
                  </Badge>
                </div>
                <CardDescription className="text-xs break-all">{drip.folderPath}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Destinations: </span>
                  {drip.destinations.map((provider) => PROVIDER_LABELS[provider]).join(", ")}
                </p>
                <p>
                  <span className="text-muted-foreground">Waiting: </span>
                  {drip.pendingCount === 0
                    ? "folder is empty"
                    : `${drip.pendingCount} file${drip.pendingCount === 1 ? "" : "s"}`}
                </p>
                {drip.pendingPreview.length > 0 ? (
                  <p className="text-muted-foreground text-xs break-all">
                    Next: {drip.pendingPreview.join(", ")}
                    {drip.pendingCount > drip.pendingPreview.length ? "…" : ""}
                  </p>
                ) : null}
                <p>
                  <span className="text-muted-foreground">Next run: </span>
                  {drip.enabled ? formatWhen(drip.nextRunAt) : "paused"}
                </p>
                {drip.lastFileName ? (
                  <p>
                    <span className="text-muted-foreground">Last queued: </span>
                    {drip.lastFileName}
                  </p>
                ) : null}
                {drip.lastError ? <p className="text-amber-300 text-xs break-words">{drip.lastError}</p> : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === drip.id || !drip.enabled}
                    onClick={() => runNow(drip.id)}
                  >
                    {busy === drip.id ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                    Post next now
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === drip.id}
                    onClick={() => setEnabled(drip.id, !drip.enabled)}
                  >
                    {drip.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                    {drip.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy === drip.id}
                    onClick={() => remove(drip.id)}
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

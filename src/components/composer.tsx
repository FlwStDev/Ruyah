"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CircleAlert, Loader2, Send, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaThumb, MediaUploader } from "@/components/media-library";
import { apiPost, errorText } from "@/lib/client/api";
import {
  INSTAGRAM_CAPTION_LIMIT,
  MAX_IMAGES_PER_POST,
  PROVIDER_LABELS,
  REDDIT_TITLE_LIMIT,
  X_SOFT_CHAR_LIMIT,
  type SocialProvider,
} from "@/lib/constants";
import type { SerializedMedia } from "@/lib/serializers";

type ProviderState = {
  provider: SocialProvider;
  configured: boolean;
  connected: boolean;
  needsReauth: boolean;
  username: string | null;
};

type Props = {
  providers: ProviderState[];
  initialMedia: SerializedMedia[];
  publicBaseUrlSet: boolean;
};

/** datetime-local is wall-clock in the browser's zone; store UTC. */
function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

function defaultScheduleValue(): string {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
}

export function Composer({ providers, initialMedia, publicBaseUrlSet }: Props) {
  const router = useRouter();

  const [media, setMedia] = useState(initialMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<SocialProvider[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [overrides, setOverrides] = useState<Partial<Record<SocialProvider, string>>>({});
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
  const [busy, setBusy] = useState(false);

  const [subreddit, setSubreddit] = useState("");
  const [flairText, setFlairText] = useState("");
  const [nsfw, setNsfw] = useState(false);
  const [spoiler, setSpoiler] = useState(false);
  const [redditKind, setRedditKind] = useState<"auto" | "self" | "image" | "video" | "link">("auto");
  const [redditUrl, setRedditUrl] = useState("");
  const [replySettings, setReplySettings] = useState<"everyone" | "mentionedUsers" | "following">(
    "everyone",
  );
  const [igKind, setIgKind] = useState<"auto" | "FEED" | "CAROUSEL" | "REELS">("auto");
  const [shareToFeed, setShareToFeed] = useState(true);

  const selectedMedia = useMemo(
    () =>
      selectedMediaIds
        .map((id) => media.find((asset) => asset.id === id))
        .filter((asset): asset is SerializedMedia => Boolean(asset)),
    [selectedMediaIds, media],
  );

  const hasVideo = selectedMedia.some((asset) => asset.kind === "video");
  const imageCount = selectedMedia.filter((asset) => asset.kind === "image").length;

  const redditSelected = destinations.includes("reddit");
  const instagramSelected = destinations.includes("instagram");

  const inferredIgKind =
    selectedMedia.length > 1 ? "CAROUSEL" : hasVideo ? "REELS" : "FEED";
  const inferredRedditKind =
    selectedMedia.length === 0 ? "self" : hasVideo ? "video" : "image";

  function bodyFor(provider: SocialProvider): string {
    const override = overrides[provider];
    return override && override.trim().length > 0 ? override : body;
  }

  function toggleDestination(provider: SocialProvider) {
    setDestinations((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider],
    );
  }

  function toggleMedia(asset: SerializedMedia) {
    setSelectedMediaIds((current) => {
      if (current.includes(asset.id)) return current.filter((id) => id !== asset.id);

      const next = [...current, asset.id];
      const chosen = next
        .map((id) => media.find((item) => item.id === id))
        .filter((item): item is SerializedMedia => Boolean(item));
      const videos = chosen.filter((item) => item.kind === "video").length;
      const images = chosen.filter((item) => item.kind === "image").length;

      if (videos > 1) {
        toast.error("One video per post.");
        return current;
      }
      if (videos > 0 && images > 0) {
        toast.error("Attach either images or one video, not both.");
        return current;
      }
      if (images > MAX_IMAGES_PER_POST) {
        toast.error(`Up to ${MAX_IMAGES_PER_POST} images per post.`);
        return current;
      }
      return next;
    });
  }

  /** Mirrors the server's zod rules so problems surface before submitting. */
  const problems = useMemo(() => {
    const list: string[] = [];
    if (destinations.length === 0) list.push("Pick at least one destination.");
    if (redditSelected && !title.trim()) list.push("Reddit needs a title.");
    if (redditSelected && !subreddit.trim()) list.push("Reddit needs a subreddit.");
    if (redditSelected && redditKind === "link" && !redditUrl.trim()) {
      list.push("A Reddit link post needs a URL.");
    }
    if (instagramSelected && selectedMedia.length === 0) {
      list.push("Instagram needs at least one image or video.");
    }
    if (instagramSelected && !publicBaseUrlSet) {
      list.push("Set PUBLIC_BASE_URL to a public HTTPS tunnel before posting to Instagram.");
    }
    if (
      destinations.length > 0 &&
      !redditSelected &&
      body.trim().length === 0 &&
      selectedMedia.length === 0
    ) {
      list.push("Write something or attach media.");
    }
    if (mode === "schedule") {
      if (!scheduledAt) list.push("Pick a date and time.");
      else if (new Date(scheduledAt).getTime() <= Date.now()) {
        list.push("Scheduled time must be in the future.");
      }
    }
    return list;
  }, [
    destinations,
    redditSelected,
    instagramSelected,
    title,
    subreddit,
    redditKind,
    redditUrl,
    selectedMedia,
    publicBaseUrlSet,
    body,
    mode,
    scheduledAt,
  ]);

  async function submit() {
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim() || null,
        body,
        mediaIds: selectedMediaIds,
        destinations,
        overrides: Object.fromEntries(
          Object.entries(overrides).filter(([, value]) => value && value.trim().length > 0),
        ),
        mode,
        scheduledFor: mode === "schedule" ? localInputToIso(scheduledAt) : null,
        x: destinations.includes("x") ? { replySettings } : undefined,
        reddit: redditSelected
          ? {
              subreddit: subreddit.trim(),
              kind: redditKind === "auto" ? inferredRedditKind : redditKind,
              flairText: flairText.trim() || null,
              nsfw,
              spoiler,
              url: redditKind === "link" ? redditUrl.trim() : null,
            }
          : undefined,
        instagram: instagramSelected
          ? {
              publishKind: igKind === "auto" ? inferredIgKind : igKind,
              shareToFeed,
            }
          : undefined,
      };

      const result = await apiPost<{ jobs: Array<{ provider: string }> }>(
        "/api/compose",
        payload,
      );

      toast.success(
        mode === "now"
          ? `Queued ${result.jobs.length} post${result.jobs.length === 1 ? "" : "s"}. The worker picks them up within a few seconds.`
          : `Scheduled ${result.jobs.length} post${result.jobs.length === 1 ? "" : "s"} for ${new Date(scheduledAt).toLocaleString()}.`,
      );
      // push alone: /posts is force-dynamic, so it re-fetches on navigation.
      // Adding router.refresh() here would race the push and strand the user.
      router.push("/posts");
    } catch (error) {
      toast.error(errorText(error), { duration: 8000 });
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Compose</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            One draft, one job per destination.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            {redditSelected ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="title">Title</Label>
                  <span
                    className={cn(
                      "text-[11px]",
                      title.length > REDDIT_TITLE_LIMIT
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {title.length}/{REDDIT_TITLE_LIMIT}
                  </span>
                </div>
                <Input
                  id="title"
                  placeholder="Reddit post title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <p className="text-muted-foreground text-[11px]">Reddit only.</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="body">Caption</Label>
              <Textarea
                id="body"
                rows={7}
                placeholder="What are you posting?"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="resize-y"
              />
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {destinations.map((provider) => {
                  const text = bodyFor(provider);
                  const limit =
                    provider === "x"
                      ? X_SOFT_CHAR_LIMIT
                      : provider === "instagram"
                        ? INSTAGRAM_CAPTION_LIMIT
                        : null;
                  const over = limit !== null && text.length > limit;
                  return (
                    <span
                      key={provider}
                      className={cn(
                        over && provider === "x" && "text-amber-400",
                        over && provider !== "x" && "text-destructive",
                      )}
                    >
                      {PROVIDER_LABELS[provider]} {text.length}
                      {limit ? `/${limit}` : ""}
                      {over && provider === "x" ? " - needs Premium" : ""}
                    </span>
                  );
                })}
              </div>
            </div>

            {destinations.length > 0 ? (
              <Accordion type="multiple" className="border-border/60 rounded-md border">
                <AccordionItem value="overrides" className="border-none">
                  <AccordionTrigger className="px-4 text-sm">
                    Per-network caption overrides
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 px-4">
                    {destinations.map((provider) => (
                      <div key={provider} className="space-y-1.5">
                        <Label htmlFor={`override-${provider}`} className="text-xs">
                          {PROVIDER_LABELS[provider]}
                        </Label>
                        <Textarea
                          id={`override-${provider}`}
                          rows={3}
                          placeholder="Leave empty to use the shared caption"
                          value={overrides[provider] ?? ""}
                          onChange={(event) =>
                            setOverrides((current) => ({
                              ...current,
                              [provider]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Media</CardTitle>
            <CardDescription className="text-xs">
              Up to {MAX_IMAGES_PER_POST} images or 1 video.
              {imageCount > 0 ? ` ${imageCount} image${imageCount === 1 ? "" : "s"} selected.` : ""}
              {hasVideo ? " 1 video selected." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MediaUploader
              compact
              onUploaded={(uploaded) => {
                setMedia((current) => [...uploaded, ...current]);
                setSelectedMediaIds((current) => {
                  const room = MAX_IMAGES_PER_POST - current.length;
                  return [...current, ...uploaded.slice(0, Math.max(0, room)).map((a) => a.id)];
                });
              }}
            />

            {media.length === 0 ? (
              <p className="text-muted-foreground text-center text-xs">
                Your library is empty.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                {media.map((asset) => {
                  const index = selectedMediaIds.indexOf(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => toggleMedia(asset)}
                      className={cn(
                        "relative overflow-hidden rounded-md border-2 transition-colors",
                        index >= 0 ? "border-primary" : "border-transparent hover:border-border",
                      )}
                      title={asset.originalName}
                      aria-label={
                        index >= 0
                          ? `${asset.originalName}, selected ${index + 1}`
                          : `Select ${asset.originalName}`
                      }
                    >
                      <MediaThumb media={asset} className="aspect-square w-full" />
                      {index >= 0 ? (
                        <span className="bg-primary text-primary-foreground absolute top-1 left-1 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
                          {index + 1}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destinations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {providers.map((entry) => {
              const disabled = !entry.connected;
              const checked = destinations.includes(entry.provider);
              return (
                <div key={entry.provider} className="flex items-start gap-3">
                  <Checkbox
                    id={`dest-${entry.provider}`}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => toggleDestination(entry.provider)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <Label
                      htmlFor={`dest-${entry.provider}`}
                      className={cn("text-sm", disabled && "text-muted-foreground")}
                    >
                      {PROVIDER_LABELS[entry.provider]}
                      {entry.username ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          @{entry.username}
                        </span>
                      ) : null}
                    </Label>
                    {!entry.configured ? (
                      <p className="text-muted-foreground text-[11px]">
                        Not configured -{" "}
                        <Link href="/settings/setup" className="underline underline-offset-2">
                          setup
                        </Link>
                      </p>
                    ) : !entry.connected ? (
                      <p className="text-muted-foreground text-[11px]">
                        Not connected -{" "}
                        <Link
                          href="/settings/connections"
                          className="underline underline-offset-2"
                        >
                          connect
                        </Link>
                      </p>
                    ) : entry.needsReauth ? (
                      <p className="text-[11px] text-amber-400">Needs reconnecting</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {redditSelected ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reddit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="subreddit" className="text-xs">
                  Subreddit
                </Label>
                <Input
                  id="subreddit"
                  placeholder="test"
                  value={subreddit}
                  onChange={(event) => setSubreddit(event.target.value)}
                />
                <p className="text-muted-foreground text-[11px]">
                  Without r/. Try r/test for a first run.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Post kind</Label>
                <Select
                  value={redditKind}
                  onValueChange={(value) => setRedditKind(value as typeof redditKind)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto ({inferredRedditKind})</SelectItem>
                    <SelectItem value="self">Text</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="link">Link</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {redditKind === "link" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="reddit-url" className="text-xs">
                    Link URL
                  </Label>
                  <Input
                    id="reddit-url"
                    placeholder="https://example.com"
                    value={redditUrl}
                    onChange={(event) => setRedditUrl(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="flair" className="text-xs">
                  Flair text (optional)
                </Label>
                <Input
                  id="flair"
                  value={flairText}
                  onChange={(event) => setFlairText(event.target.value)}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="nsfw" className="text-xs">
                  NSFW
                </Label>
                <Switch id="nsfw" checked={nsfw} onCheckedChange={setNsfw} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="spoiler" className="text-xs">
                  Spoiler
                </Label>
                <Switch id="spoiler" checked={spoiler} onCheckedChange={setSpoiler} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {destinations.includes("x") ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">X</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Label className="text-xs">Who can reply</Label>
              <Select
                value={replySettings}
                onValueChange={(value) => setReplySettings(value as typeof replySettings)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="mentionedUsers">Only mentioned users</SelectItem>
                  <SelectItem value="following">Only people you follow</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        ) : null}

        {instagramSelected ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Instagram</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Publish as</Label>
                <Select value={igKind} onValueChange={(value) => setIgKind(value as typeof igKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto ({inferredIgKind})</SelectItem>
                    <SelectItem value="FEED">Feed image</SelectItem>
                    <SelectItem value="CAROUSEL">Carousel</SelectItem>
                    <SelectItem value="REELS">Reel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(igKind === "REELS" || (igKind === "auto" && inferredIgKind === "REELS")) ? (
                <div className="flex items-center justify-between">
                  <Label htmlFor="share-feed" className="text-xs">
                    Also show on profile grid
                  </Label>
                  <Switch
                    id="share-feed"
                    checked={shareToFeed}
                    onCheckedChange={setShareToFeed}
                  />
                </div>
              ) : null}
              {!publicBaseUrlSet ? (
                <p className="text-[11px] text-amber-400">
                  Set PUBLIC_BASE_URL to a public HTTPS tunnel. Instagram downloads your media
                  itself and cannot reach localhost.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">When</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === "now" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("now")}
              >
                <Send className="size-3.5" />
                Now
              </Button>
              <Button
                type="button"
                variant={mode === "schedule" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("schedule")}
              >
                <CalendarClock className="size-3.5" />
                Schedule
              </Button>
            </div>

            {mode === "schedule" ? (
              <div className="space-y-1.5">
                <Label htmlFor="scheduled-at" className="text-xs">
                  Publish at
                </Label>
                <Input
                  id="scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
                <p className="text-muted-foreground text-[11px]">
                  Your local time; stored as UTC. The worker must be running at that moment.
                </p>
              </div>
            ) : null}

            {problems.length > 0 ? (
              <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                {problems.map((problem) => (
                  <p
                    key={problem}
                    className="flex items-start gap-1.5 text-[11px] text-amber-300"
                  >
                    <CircleAlert className="mt-px size-3 shrink-0" />
                    {problem}
                  </p>
                ))}
              </div>
            ) : null}

            <Button
              className="w-full"
              disabled={busy || problems.length > 0}
              onClick={submit}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {mode === "now" ? "Publish now" : "Schedule"}
              {destinations.length > 0 ? ` (${destinations.length})` : ""}
            </Button>
          </CardContent>
        </Card>

        {selectedMedia.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attached</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedMedia.map((asset, index) => (
                <div key={asset.id} className="flex items-center gap-2">
                  <MediaThumb media={asset} className="size-8 shrink-0 rounded" />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {index + 1}. {asset.originalName}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    onClick={() => toggleMedia(asset)}
                    aria-label={`Remove ${asset.originalName}`}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

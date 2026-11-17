"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, ChevronUp, CircleAlert, Loader2, Send, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { PageBanner } from "@/components/page-banner";
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

const CAPTION_STARTERS = [
  "A quiet frame from today.",
  "Keeping this one.",
  "Same light, new picture.",
];

const SUGGESTED_TAGS = ["#photo", "#daily", "#studio", "#archive", "#now", "#behindthescenes"];

type BufferItem = {
  id: string;
  caption: string;
  when: string;
  immediate: boolean;
  destinations: string[];
};

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
  const [buffer, setBuffer] = useState<BufferItem[]>([]);

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

      setBuffer((current) => [
        {
          id: crypto.randomUUID(),
          caption: body.trim().slice(0, 90) || "Untitled",
          when: mode === "now" ? "Sending shortly" : new Date(scheduledAt).toLocaleString(),
          immediate: mode === "now",
          destinations: destinations.map((provider) => PROVIDER_LABELS[provider]),
        },
        ...current,
      ]);
      setBusy(false);
      toast.success(
        mode === "now"
          ? `Held ${result.jobs.length} post${result.jobs.length === 1 ? "" : "s"} in the queue. The worker sends them in a few seconds.`
          : `Held ${result.jobs.length} post${result.jobs.length === 1 ? "" : "s"} for ${new Date(scheduledAt).toLocaleString()}.`,
      );
      glide("queue-stage");
    } catch (error) {
      toast.error(errorText(error), { duration: 8000 });
      setBusy(false);
    }
  }

  function glide(id: string) {
    const node = document.getElementById(id);
    if (!node) return;
    node.classList.remove("glide-in");
    void node.offsetWidth;
    node.classList.add("glide-in");
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function moveSelected(id: string, direction: -1 | 1) {
    setSelectedMediaIds((current) => {
      const index = current.indexOf(id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  function addToCaption(text: string) {
    setBody((current) => (current.includes(text) ? current : `${current.trim()} ${text}`.trim()));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageBanner
        title="Content Creation"
        lede="Words first, then the picture. Networks and the clock come after you glide down."
      />
      <div className="space-y-8">

        <div className="space-y-4">
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

            <div className="bg-muted/40 space-y-4 rounded-3xl border p-5 md:p-8">
              <Label htmlFor="body" className="text-muted-foreground text-xs tracking-wide uppercase">
                Caption
              </Label>
              <Textarea
                id="body"
                rows={8}
                placeholder="Start with one sentence. Add a tag when it helps."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="bg-background min-h-56 w-full resize-y rounded-2xl border px-4 py-4 text-lg"
              />
              <div className="space-y-2">
                <p className="text-muted-foreground text-[11px] tracking-[0.14em] uppercase">Suggestions</p>
                <div className="flex flex-wrap gap-2">
                  {CAPTION_STARTERS.map((line) => (
                    <button
                      key={line}
                      type="button"
                      onClick={() => addToCaption(line)}
                      className="hover:border-primary rounded-full border px-3 py-1.5 text-left text-xs"
                    >
                      {line}
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground pt-2 text-[11px] tracking-[0.14em] uppercase">
                  Suggested tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addToCaption(tag)}
                      className="bg-background hover:border-primary rounded-full border px-3 py-1.5 text-xs"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
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
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold tracking-[0.16em] uppercase">Media</CardTitle>
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
                      <MediaThumb media={asset} fit="contain" className="aspect-4/3 w-full bg-muted" />
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
        <div className="flex justify-end">
          <Button type="button" className="h-12 px-8" onClick={() => glide("send-stage")}>
            Continue to networks
          </Button>
        </div>
      </div>

      <div id="send-stage" className="glide-in space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold tracking-[0.16em] uppercase">Send to</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {providers.map((entry) => {
              const disabled = !entry.connected;
              const checked = destinations.includes(entry.provider);
              return (
                <button
                  key={entry.provider}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => {
                    if (!entry.configured) {
                      router.push("/settings/setup");
                      return;
                    }
                    if (!entry.connected || entry.needsReauth) {
                      router.push("/settings/connections");
                      return;
                    }
                    toggleDestination(entry.provider);
                  }}
                  className={cn(
                    "flex min-h-14 items-center justify-between border px-3 text-left transition-colors",
                    checked ? "border-primary" : "border-border hover:border-foreground",
                    disabled && "opacity-80",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">{PROVIDER_LABELS[entry.provider]}</span>
                    <span className="text-muted-foreground block text-xs">
                      {entry.username
                        ? `@${entry.username}`
                        : !entry.configured
                          ? "Add the app in Setup"
                          : entry.needsReauth
                            ? "Reconnect this account"
                            : "Connect this network"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "size-5 rounded-full border",
                      checked ? "border-primary bg-primary" : "border-border",
                    )}
                  />
                </button>
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

        <div className="flex justify-end">
          <Button type="button" variant="outline" className="h-12 px-8" onClick={() => glide("schedule-stage")}>
            Continue to schedule
          </Button>
        </div>

        <Card id="schedule-stage">
          <CardHeader>
            <CardTitle className="text-xs font-semibold tracking-[0.16em] uppercase">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={mode === "now" ? "border-primary text-primary" : undefined}
                onClick={() => setMode("now")}
              >
                <Send className="size-3.5" />
                Now
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={mode === "schedule" ? "border-primary text-primary" : undefined}
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
              className="h-12 w-full text-base"
              disabled={busy || problems.length > 0}
              onClick={submit}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {mode === "now" ? "Publish now" : "Schedule"}
              {destinations.length > 0 ? ` (${destinations.length})` : ""}
            </Button>
          </CardContent>
        </Card>

        <div id="queue-stage" className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.16em] uppercase">Queue</h2>
          {buffer.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is waiting. A post you send now still stops here first, then the worker takes it.
            </p>
          ) : (
            <ul className="divide-border divide-y border">
              {buffer.map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate text-sm">{item.caption}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.destinations.join(", ")} · {item.when}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedMedia.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attached</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedMedia.map((asset, index) => (
                <div key={asset.id} className="flex items-center gap-2">
                  <MediaThumb media={asset} fit="contain" className="bg-muted h-10 w-14 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {index + 1}. {asset.originalName}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={index === 0}
                    onClick={() => moveSelected(asset.id, -1)}
                    aria-label={`Move ${asset.originalName} earlier`}
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={index === selectedMedia.length - 1}
                    onClick={() => moveSelected(asset.id, 1)}
                    aria-label={`Move ${asset.originalName} later`}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
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

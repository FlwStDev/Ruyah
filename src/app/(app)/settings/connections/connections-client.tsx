"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Link2, Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PROVIDER_LABELS, type SocialProvider } from "@/lib/constants";
import { PageBanner } from "@/components/page-banner";
import type { PublicAccount } from "@/lib/accounts";
import { apiDelete, apiPost, errorText } from "@/lib/client/api";

export type ProviderCard = {
  provider: SocialProvider;
  description: string;
  configured: boolean;
  clientId: string;
  hasSecret: boolean;
  redirectUri: string;
  scopes: string[];
  accounts: PublicAccount[];
};

const DEVELOPER_PAGES: Record<string, { href: string; label: string }> = {
  x: { href: "https://console.x.com", label: "Open the X developer console" },
  reddit: { href: "https://www.reddit.com/prefs/apps", label: "Open Reddit apps" },
  instagram: { href: "https://developers.facebook.com/apps", label: "Open the Meta developer apps" },
  linkedin: { href: "https://www.linkedin.com/developers/apps", label: "Open LinkedIn apps" },
  tiktok: { href: "https://developers.tiktok.com/", label: "Open TikTok for developers" },
  youtube: { href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", label: "Open YouTube Data API" },
  facebook: { href: "https://developers.facebook.com/apps", label: "Open the Meta developer apps" },
  threads: { href: "https://developers.facebook.com/docs/threads", label: "Open the Threads API docs" },
};

type Props = {
  cards: ProviderCard[];
  stubs: Array<{ id: string; label: string; note: string }>;
  redditUserAgent: string;
  publicBaseUrl: string;
  flash: { connected: string | null; username: string | null; error: string | null };
};

type Draft = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  redditUserAgent: string;
  publicBaseUrl: string;
  hasSecret: boolean;
  configured: boolean;
};

function xWebsiteFromRedirect(redirectUri: string): string {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return "https://<run pnpm tunnel>";
  }
}

function XConsoleUrls({ redirectUri }: { redirectUri: string }) {
  const website = xWebsiteFromRedirect(redirectUri);
  const https = redirectUri.startsWith("https://");
  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-[11px] leading-relaxed">
      <p className="text-foreground font-medium">
        {https
          ? "Paste these into console.x.com → User authentication settings:"
          : "X rejects localhost / http. Run pnpm tunnel, then paste the https URLs it prints."}
      </p>
      <p className="mt-2">
        <span className="text-muted-foreground">Website URL: </span>
        <code className="text-[10px] break-all">{website}</code>
      </p>
      <p className="mt-1">
        <span className="text-muted-foreground">Callback URI: </span>
        <code className="text-[10px] break-all">{redirectUri}</code>
      </p>
      <p className="text-muted-foreground mt-1.5">
        Save in the X console first. Then Connect X. If X asks you to log in, do that in the same
        tab, then click Authorize.
      </p>
    </div>
  );
}

function draftsFromCards(
  cards: ProviderCard[],
  redditUserAgent: string,
  publicBaseUrl: string,
): Record<SocialProvider, Draft> {
  const drafts = {} as Record<SocialProvider, Draft>;
  for (const card of cards) {
    drafts[card.provider] = {
      clientId: card.clientId,
      clientSecret: "",
      redirectUri: card.redirectUri,
      redditUserAgent,
      publicBaseUrl,
      hasSecret: card.hasSecret,
      configured: card.configured,
    };
  }
  return drafts;
}

export function ConnectionsClient({
  cards,
  stubs,
  redditUserAgent,
  publicBaseUrl,
  flash,
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState<SocialProvider | null>(null);
  const [drafts, setDrafts] = useState(() =>
    draftsFromCards(cards, redditUserAgent, publicBaseUrl),
  );
  const flashed = useRef(false);

  useEffect(() => {
    if (flashed.current) return;
    flashed.current = true;
    if (flash.error) toast.error(flash.error, { duration: 10_000 });
    else if (flash.connected) {
      toast.success(
        `Connected ${PROVIDER_LABELS[flash.connected as SocialProvider] ?? flash.connected}${
          flash.username ? ` as @${flash.username}` : ""
        }`,
      );
    }
    if (flash.error || flash.connected) {
      window.history.replaceState(null, "", "/settings/connections");
    }
  }, [flash]);

  function patch(provider: SocialProvider, partial: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [provider]: { ...current[provider], ...partial } }));
  }

  async function save(provider: SocialProvider, thenConnect: boolean) {
    const draft = drafts[provider];
    setSaving(provider);
    try {
      const result = await apiPost<{
        provider: { configured: boolean; hasSecret: boolean; clientId: string; redirectUri: string };
      }>("/api/settings/credentials", {
        provider,
        clientId: draft.clientId,
        clientSecret: draft.clientSecret || undefined,
        redirectUri: draft.redirectUri,
        redditUserAgent: provider === "reddit" ? draft.redditUserAgent : undefined,
        publicBaseUrl: provider === "instagram" ? draft.publicBaseUrl : undefined,
      });
      patch(provider, {
        clientId: result.provider.clientId,
        clientSecret: "",
        redirectUri: result.provider.redirectUri,
        hasSecret: result.provider.hasSecret,
        configured: result.provider.configured,
      });
      toast.success(`${PROVIDER_LABELS[provider]} app credentials saved.`);
      router.refresh();
      if (thenConnect) {
        window.location.assign(`/api/oauth/${provider}/start`);
        return;
      }
    } catch (error) {
      toast.error(errorText(error), { duration: 10_000 });
    } finally {
      setSaving(null);
    }
  }

  async function disconnect(account: PublicAccount) {
    setBusyId(account.id);
    try {
      await apiDelete(`/api/connections/${account.id}`);
      toast.success(`Disconnected @${account.username}`);
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  async function testConnection(account: PublicAccount) {
    setBusyId(account.id);
    try {
      const result = await apiPost<{ username: string }>(`/api/connections/${account.id}/test`);
      toast.success(`${PROVIDER_LABELS[account.provider]} is working - @${result.username}`);
      router.refresh();
    } catch (error) {
      toast.error(errorText(error), { duration: 10_000 });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageBanner
        title="Networks"
        lede="Each network needs an app of your own. Open the developer page, copy the id and secret, save them here, then connect."
      />

      <div className="grid gap-6">
        {cards.map((card) => {
          const draft = drafts[card.provider];
          const ready = draft.configured;
          const busy = saving === card.provider;
          return (
            <Card key={card.provider} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{PROVIDER_LABELS[card.provider]}</CardTitle>
                  {card.accounts.length > 0 ? (
                    <Badge variant="secondary" className="shrink-0">
                      {card.accounts.length} connected
                    </Badge>
                  ) : ready ? (
                    <Badge variant="outline" className="shrink-0 text-emerald-400">
                      app saved
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="text-xs">{card.description}</CardDescription>
                {DEVELOPER_PAGES[card.provider] ? (
                  <a
                    href={DEVELOPER_PAGES[card.provider].href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary mt-2 inline-block text-xs underline underline-offset-4"
                  >
                    {DEVELOPER_PAGES[card.provider].label}
                  </a>
                ) : null}
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="space-y-2">
                  <Label htmlFor={`${card.provider}-id`} className="text-xs">
                    Client ID
                  </Label>
                  <Input
                    id={`${card.provider}-id`}
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.clientId}
                    onChange={(event) => patch(card.provider, { clientId: event.target.value })}
                    placeholder={`${card.provider.toUpperCase()}_CLIENT_ID`}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${card.provider}-secret`} className="text-xs">
                    Client secret
                  </Label>
                  <Input
                    id={`${card.provider}-secret`}
                    type="password"
                    autoComplete="new-password"
                    value={draft.clientSecret}
                    onChange={(event) => patch(card.provider, { clientSecret: event.target.value })}
                    placeholder={
                      draft.hasSecret ? "Saved — leave blank to keep" : `${card.provider.toUpperCase()}_CLIENT_SECRET`
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${card.provider}-redirect`} className="text-xs">
                    Redirect URI
                  </Label>
                  <Input
                    id={`${card.provider}-redirect`}
                    spellCheck={false}
                    value={draft.redirectUri}
                    onChange={(event) => patch(card.provider, { redirectUri: event.target.value })}
                  />
                  <p className="text-muted-foreground text-[10px]">
                    Register this exact URI in the {PROVIDER_LABELS[card.provider]} developer
                    console.
                  </p>
                </div>

                {card.provider === "x" ? (
                  <XConsoleUrls redirectUri={draft.redirectUri} />
                ) : null}

                {card.provider === "reddit" ? (
                  <div className="space-y-2">
                    <Label htmlFor="reddit-ua" className="text-xs">
                      User-Agent
                    </Label>
                    <Input
                      id="reddit-ua"
                      spellCheck={false}
                      value={draft.redditUserAgent}
                      onChange={(event) =>
                        patch(card.provider, { redditUserAgent: event.target.value })
                      }
                      placeholder="web:postforge:0.1.0 (by /u/yourname)"
                    />
                  </div>
                ) : null}

                {card.provider === "instagram" ? (
                  <div className="space-y-2">
                    <Label htmlFor="public-base" className="text-xs">
                      Public HTTPS tunnel (for publishing)
                    </Label>
                    <Input
                      id="public-base"
                      spellCheck={false}
                      value={draft.publicBaseUrl}
                      onChange={(event) =>
                        patch(card.provider, { publicBaseUrl: event.target.value })
                      }
                      placeholder="https://xxxx.ngrok.app"
                    />
                    {!draft.publicBaseUrl ? (
                      <p className="text-[11px] text-amber-300">
                        You can connect without this. Publishing needs a tunnel because Instagram
                        fetches your media itself.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {card.accounts.map((account) => (
                  <div
                    key={account.id}
                    className="border-border/60 bg-card/60 space-y-2 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">@{account.username}</span>
                      {account.status === "active" ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-400">
                          <CheckCircle2 className="size-3" /> active
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400">
                          <CircleAlert className="size-3" /> {account.status.replace("_", " ")}
                        </span>
                      )}
                    </div>

                    {account.statusMessage ? (
                      <p className="text-muted-foreground text-[11px] break-words">
                        {account.statusMessage}
                      </p>
                    ) : null}

                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        disabled={busyId === account.id}
                        onClick={() => testConnection(account)}
                      >
                        {busyId === account.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Link2 className="size-3" />
                        )}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive h-7 text-xs"
                        disabled={busyId === account.id}
                        onClick={() => disconnect(account)}
                      >
                        <Unplug className="size-3" />
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex-1" />

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || draft.clientId.trim().length === 0}
                    onClick={() => save(card.provider, false)}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Save
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || draft.clientId.trim().length === 0}
                    onClick={() => save(card.provider, true)}
                  >
                    <Plug className="size-4" />
                    {card.accounts.length > 0
                      ? `Connect another`
                      : `Connect ${PROVIDER_LABELS[card.provider]}`}
                  </Button>
                </div>

                <p className="text-muted-foreground text-[10px] leading-relaxed">
                  Scopes: {card.scopes.join(", ")}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-semibold tracking-[0.16em] uppercase">Still on the desk</CardTitle>
          <CardDescription className="text-xs">
            These networks are part of Ruyah. They are not wired to publish yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {stubs.map((stub, index) => (
            <div key={stub.id}>
              {index > 0 && <Separator />}
              <div className="flex flex-wrap items-baseline justify-between gap-3 px-6 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="w-24 shrink-0 text-sm">{stub.label}</span>
                  <span className="text-muted-foreground text-xs">{stub.note}</span>
                </div>
                {DEVELOPER_PAGES[stub.id] ? (
                  <a
                    href={DEVELOPER_PAGES[stub.id].href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary text-xs underline underline-offset-4"
                  >
                    {DEVELOPER_PAGES[stub.id].label}
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

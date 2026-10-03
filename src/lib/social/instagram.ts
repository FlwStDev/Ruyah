import { AppError } from "@/lib/errors";
import { env, requireProviderCredentials } from "@/lib/env";
import { INSTAGRAM_CAPTION_LIMIT } from "@/lib/constants";
import { expiresInToDate, fetchJson, sleep } from "@/lib/social/http";
import type {
  AdapterAccount,
  ConnectedAccountTokens,
  ExchangeCodeParams,
  PublishMedia,
  PublishPayload,
  PublishResult,
  SocialAdapter,
} from "@/lib/social/types";

/**
 * Instagram adapter - "Instagram API with Instagram Login" (graph.instagram.com).
 *
 * Docs:
 *  - Login:     https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 *  - Publish:   https://developers.facebook.com/docs/instagram-platform/content-publishing
 *  - Long-lived tokens: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started#long-lived-access-tokens
 *
 * Two hard constraints, both surfaced to the user rather than worked around:
 *  1. Only professional (Business/Creator) accounts can publish.
 *  2. Instagram fetches the media itself, so every file needs a public HTTPS
 *     URL. localhost will never work - PUBLIC_BASE_URL must point at a tunnel.
 */

const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_BASE = "https://graph.instagram.com";
const GRAPH_VERSION = "v23.0";
const LABEL = "Instagram";

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];

const PROFESSIONAL_ACCOUNT_TYPES = ["BUSINESS", "MEDIA_CREATOR", "CREATOR"];

type IgShortTokenResponse = {
  access_token: string;
  user_id?: number | string;
  permissions?: string[] | string;
};

type IgLongTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type IgMeResponse = {
  id?: string;
  user_id?: string;
  username?: string;
  account_type?: string;
  name?: string;
  profile_picture_url?: string;
};

type IgContainerResponse = { id?: string };

type IgContainerStatusResponse = {
  status_code?: string;
  status?: string;
  id?: string;
};

type IgPublishResponse = { id?: string };

type IgPermalinkResponse = { permalink?: string; id?: string };

function graphUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${GRAPH_BASE}/${GRAPH_VERSION}/${path.replace(/^\//, "")}?${query.toString()}`;
}

/** Trade the short-lived code token for a 60-day token right away. */
async function exchangeForLongLived(shortToken: string): Promise<IgLongTokenResponse> {
  const credentials = requireProviderCredentials("instagram");
  return fetchJson<IgLongTokenResponse>(
    `${GRAPH_BASE}/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: credentials.clientSecret,
      access_token: shortToken,
    }).toString()}`,
    { label: LABEL },
  );
}

async function fetchMe(accessToken: string): Promise<IgMeResponse> {
  const me = await fetchJson<IgMeResponse>(
    graphUrl("me", {
      fields: "user_id,username,account_type,name,profile_picture_url",
      access_token: accessToken,
    }),
    { label: LABEL },
  );
  if (!me.username) {
    throw AppError.upstream("Instagram: /me did not return a username. Re-connect the account.");
  }
  return me;
}

function assertProfessional(me: IgMeResponse): void {
  const type = me.account_type?.toUpperCase();
  // Some responses omit account_type; don't block the connection over that.
  if (!type) return;
  if (!PROFESSIONAL_ACCOUNT_TYPES.includes(type)) {
    throw new AppError(
      `@${me.username} is a ${type.toLowerCase()} Instagram account. Publishing through the API needs a professional account - switch it to Business or Creator in the Instagram app (Settings -> Account type and tools), then connect again.`,
      { status: 400, code: "instagram_personal_account" },
    );
  }
}

/** The numeric IG user id that owns the /media endpoints. */
function igUserId(account: AdapterAccount): string {
  const profile = account.profile as { user_id?: unknown; id?: unknown };
  const fromProfile =
    typeof profile.user_id === "string"
      ? profile.user_id
      : typeof profile.id === "string"
        ? profile.id
        : null;
  return fromProfile ?? account.providerUserId;
}

function requirePublicUrl(media: PublishMedia): string {
  if (!media.publicUrl) {
    throw AppError.misconfigured(
      "Set PUBLIC_BASE_URL to a public HTTPS tunnel. Instagram downloads your media itself and cannot reach localhost.",
    );
  }
  if (!media.publicUrl.startsWith("https://")) {
    throw AppError.misconfigured(
      "PUBLIC_BASE_URL must be https://. Instagram refuses to fetch media over plain HTTP.",
    );
  }
  return media.publicUrl;
}

async function createContainer(
  account: AdapterAccount,
  params: Record<string, string>,
): Promise<string> {
  const response = await fetchJson<IgContainerResponse>(
    graphUrl(`${igUserId(account)}/media`, { ...params, access_token: account.accessToken }),
    { label: LABEL, method: "POST", timeoutMs: 120_000 },
  );
  if (!response.id) throw AppError.upstream("Instagram: container creation returned no id.");
  return response.id;
}

/**
 * Containers start as IN_PROGRESS while Instagram downloads and transcodes.
 * Reels routinely take a minute; give it two before calling it a failure.
 * https://developers.facebook.com/docs/instagram-platform/content-publishing#check-container-status
 */
async function waitForContainer(account: AdapterAccount, containerId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let delayMs = 3000;

  while (Date.now() < deadline) {
    const status = await fetchJson<IgContainerStatusResponse>(
      graphUrl(containerId, {
        fields: "status_code,status",
        access_token: account.accessToken,
      }),
      { label: LABEL },
    );

    switch (status.status_code) {
      case "FINISHED":
        return;
      case "ERROR":
        throw AppError.upstream(
          `Instagram could not process the media: ${status.status ?? "no detail given"}.`,
        );
      case "EXPIRED":
        throw AppError.upstream("Instagram: the media container expired before publishing.");
      default:
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 1.5, 15_000);
    }
  }

  throw AppError.upstream(
    "Instagram was still processing the media after 2 minutes. Check the app before retrying.",
    { retryable: true },
  );
}

async function fetchPermalink(account: AdapterAccount, mediaId: string): Promise<string> {
  try {
    const response = await fetchJson<IgPermalinkResponse>(
      graphUrl(mediaId, { fields: "permalink", access_token: account.accessToken }),
      { label: LABEL },
    );
    if (response.permalink) return response.permalink;
  } catch {
    // The post exists either way; fall through to the profile link.
  }
  return `https://www.instagram.com/${account.username}/`;
}

export const instagramAdapter: SocialAdapter<"instagram"> = {
  id: "instagram",
  label: "Instagram",
  usesPkce: false,

  getAuthUrl(state: string): string {
    const credentials = requireProviderCredentials("instagram");
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code }: ExchangeCodeParams) {
    const credentials = requireProviderCredentials("instagram");
    const short = await fetchJson<IgShortTokenResponse>(TOKEN_URL, {
      label: LABEL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: credentials.redirectUri,
        // Instagram appends #_ to the redirect; strip it before exchanging.
        code: code.replace(/#_$/, ""),
      }).toString(),
    });

    const long = await exchangeForLongLived(short.access_token);
    const me = await fetchMe(long.access_token);
    assertProfessional(me);

    const userId = me.user_id ?? me.id ?? String(short.user_id ?? "");
    return {
      providerUserId: userId,
      username: me.username ?? "",
      accessToken: long.access_token,
      // IG long-lived tokens are refreshed in place; there is no refresh token.
      refreshToken: null,
      expiresAt: expiresInToDate(long.expires_in),
      scopes: Array.isArray(short.permissions)
        ? short.permissions.join(" ")
        : (short.permissions ?? INSTAGRAM_SCOPES.join(" ")),
      profile: { ...me, user_id: userId },
    } satisfies ConnectedAccountTokens;
  },

  /**
   * Long-lived tokens are refreshed by presenting the token itself. It must be
   * at least 24 hours old and not yet expired, otherwise Instagram refuses.
   */
  async refresh(account: AdapterAccount) {
    const refreshed = await fetchJson<IgLongTokenResponse>(
      `${GRAPH_BASE}/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: account.accessToken,
      }).toString()}`,
      { label: LABEL },
    );
    const me = await fetchMe(refreshed.access_token);
    return {
      providerUserId: me.user_id ?? me.id ?? account.providerUserId,
      username: me.username ?? account.username,
      accessToken: refreshed.access_token,
      refreshToken: null,
      expiresAt: expiresInToDate(refreshed.expires_in),
      scopes: account.scopes,
      profile: { ...me, user_id: me.user_id ?? account.providerUserId },
    } satisfies ConnectedAccountTokens;
  },

  async getMe(account: AdapterAccount) {
    const me = await fetchMe(account.accessToken);
    return { id: me.user_id ?? me.id ?? account.providerUserId, username: me.username ?? "" };
  },

  validate(payload: PublishPayload<"instagram">) {
    if (payload.media.length === 0) {
      throw AppError.badRequest("Instagram posts need at least one image or video.");
    }
    if (payload.body.length > INSTAGRAM_CAPTION_LIMIT) {
      throw AppError.badRequest(
        `Instagram captions are limited to ${INSTAGRAM_CAPTION_LIMIT} characters.`,
      );
    }
    if (payload.options.publishKind === "CAROUSEL" && payload.media.length < 2) {
      throw AppError.badRequest("An Instagram carousel needs at least 2 items.");
    }
    if (payload.options.publishKind === "REELS") {
      if (payload.media.length !== 1 || payload.media[0].kind !== "video") {
        throw AppError.badRequest("A Reel is exactly one video.");
      }
    }
    if (payload.options.publishKind === "FEED" && payload.media.length !== 1) {
      throw AppError.badRequest("A single feed post takes exactly one item. Use a carousel for more.");
    }
    if (!env.publicBaseUrl) {
      throw AppError.misconfigured(
        "Set PUBLIC_BASE_URL to a public HTTPS tunnel. Instagram downloads your media itself and cannot reach localhost.",
      );
    }
  },

  async publish(
    account: AdapterAccount,
    payload: PublishPayload<"instagram">,
  ): Promise<PublishResult> {
    this.validate?.(payload);
    const caption = payload.body;
    await payload.onProgress?.("uploading");

    let containerId: string;

    if (payload.options.publishKind === "CAROUSEL") {
      const childIds: string[] = [];
      for (const item of payload.media) {
        const url = requirePublicUrl(item);
        const child = await createContainer(account, {
          is_carousel_item: "true",
          ...(item.kind === "video"
            ? { media_type: "VIDEO", video_url: url }
            : { image_url: url }),
        });
        await waitForContainer(account, child);
        childIds.push(child);
      }
      containerId = await createContainer(account, {
        media_type: "CAROUSEL",
        caption,
        children: childIds.join(","),
      });
    } else if (payload.options.publishKind === "REELS") {
      containerId = await createContainer(account, {
        media_type: "REELS",
        video_url: requirePublicUrl(payload.media[0]),
        caption,
        share_to_feed: String(payload.options.shareToFeed),
      });
    } else {
      const item = payload.media[0];
      const url = requirePublicUrl(item);
      containerId = await createContainer(
        account,
        item.kind === "video"
          ? { media_type: "VIDEO", video_url: url, caption }
          : { image_url: url, caption },
      );
    }

    await waitForContainer(account, containerId);
    await payload.onProgress?.("publishing");

    const published = await fetchJson<IgPublishResponse>(
      graphUrl(`${igUserId(account)}/media_publish`, {
        creation_id: containerId,
        access_token: account.accessToken,
      }),
      { label: LABEL, method: "POST", timeoutMs: 120_000 },
    );

    if (!published.id) {
      throw AppError.upstream("Instagram: media_publish returned no media id.");
    }

    return { id: published.id, permalink: await fetchPermalink(account, published.id) };
  },
};

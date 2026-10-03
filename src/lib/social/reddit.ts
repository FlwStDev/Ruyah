import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { env, requireProviderCredentials } from "@/lib/env";
import { REDDIT_TITLE_LIMIT } from "@/lib/constants";
import {
  basicAuthHeader,
  expiresInToDate,
  fetchJson,
  sleep,
  socialFetch,
} from "@/lib/social/http";
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
 * Reddit adapter - OAuth 2.0 authorization code (duration=permanent).
 *
 * Docs:
 *  - OAuth:  https://github.com/reddit-archive/reddit/wiki/OAuth2
 *  - API:    https://www.reddit.com/dev/api/
 *  - Submit: https://www.reddit.com/dev/api/#POST_api_submit
 *
 * Media note: images and video are uploaded straight to Reddit's own S3 bucket
 * via /api/media/asset.json, so native media works from localhost - Reddit
 * never has to fetch anything from us.
 */

const AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const LABEL = "Reddit";

export const REDDIT_SCOPES = ["identity", "submit", "read", "mysubreddits", "flair"];

type RedditTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type RedditMeResponse = {
  id: string;
  name: string;
  icon_img?: string;
  total_karma?: number;
};

type RedditSubmitResponse = {
  json?: {
    errors?: unknown[];
    data?: {
      id?: string;
      name?: string;
      url?: string;
      websocket_url?: string;
      drafts_count?: number;
    };
  };
};

type RedditAssetResponse = {
  args?: { action?: string; fields?: Array<{ name: string; value: string }> };
  asset?: { asset_id?: string; websocket_url?: string; processing_state?: string };
};

type RedditListingResponse = {
  data?: {
    children?: Array<{
      data?: { id?: string; name?: string; title?: string; permalink?: string; url?: string };
    }>;
  };
};

/**
 * Reddit bans generic user agents and will 429 or 403 you for using one.
 * https://github.com/reddit-archive/reddit/wiki/API#rules
 */
function userAgent(): string {
  const configured = env.redditUserAgent;
  if (!configured || /\/u\/replace/.test(configured)) {
    throw AppError.misconfigured(
      "REDDIT_USER_AGENT must name your Reddit account, e.g. web:postforge:0.1.0 (by /u/yourname). Reddit rate-limits generic agents hard.",
    );
  }
  return configured;
}

function apiHeaders(account: AdapterAccount): HeadersInit {
  return {
    Authorization: `Bearer ${account.accessToken}`,
    "User-Agent": userAgent(),
  };
}

async function tokenRequest(body: URLSearchParams): Promise<RedditTokenResponse> {
  const credentials = requireProviderCredentials("reddit");
  return fetchJson<RedditTokenResponse>(TOKEN_URL, {
    label: LABEL,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(credentials.clientId, credentials.clientSecret),
      "User-Agent": userAgent(),
    },
    body: body.toString(),
  });
}

async function fetchMe(accessToken: string): Promise<RedditMeResponse> {
  const me = await fetchJson<RedditMeResponse>(`${API_BASE}/api/v1/me`, {
    label: LABEL,
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent() },
  });
  if (!me?.name) {
    throw AppError.upstream("Reddit: /api/v1/me did not return a username.");
  }
  return me;
}

function toTokens(
  response: RedditTokenResponse,
  me: RedditMeResponse,
  fallbackRefreshToken: string | null,
): ConnectedAccountTokens {
  return {
    providerUserId: me.id,
    username: me.name,
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? fallbackRefreshToken,
    expiresAt: expiresInToDate(response.expires_in),
    scopes: response.scope ?? REDDIT_SCOPES.join(" "),
    profile: { ...me },
  };
}

/** Reddit reports logic errors inside a 200 body: json.errors is non-empty. */
function assertNoSubmitErrors(response: RedditSubmitResponse): void {
  const errors = response.json?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return;
  const readable = errors
    .map((entry) => (Array.isArray(entry) ? entry.filter(Boolean).join(": ") : String(entry)))
    .join(" | ");
  throw AppError.upstream(`Reddit refused the post: ${readable}`, { status: 400 });
}

/**
 * Upload bytes to Reddit's media bucket and return the resulting asset URL,
 * which is what /api/submit wants as `url` for image/video posts.
 * https://www.reddit.com/dev/api/#POST_api_media_asset.json
 */
async function uploadAsset(
  account: AdapterAccount,
  bytes: Buffer,
  fileName: string,
  mimeType: string,
): Promise<{ assetId: string; assetUrl: string }> {
  const lease = await fetchJson<RedditAssetResponse>(`${API_BASE}/api/media/asset.json`, {
    label: LABEL,
    method: "POST",
    headers: {
      ...apiHeaders(account),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ filepath: fileName, mimetype: mimeType }).toString(),
  });

  const action = lease.args?.action;
  const fields = lease.args?.fields;
  const assetId = lease.asset?.asset_id;
  if (!action || !fields || !assetId) {
    throw AppError.upstream("Reddit: the media upload lease was incomplete.");
  }

  // `action` comes back protocol-relative, e.g. //reddit-uploaded-media.s3...
  const uploadUrl = action.startsWith("//") ? `https:${action}` : action;

  const form = new FormData();
  for (const field of fields) form.append(field.name, field.value);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);

  const upload = await socialFetch(uploadUrl, {
    label: LABEL,
    method: "POST",
    body: form,
    timeoutMs: 180_000,
  });
  if (!upload.ok) {
    const text = await upload.text();
    throw AppError.upstream(
      `Reddit: media upload to storage failed (${upload.status}). ${text.slice(0, 300)}`,
      { status: upload.status },
    );
  }

  const key = fields.find((field) => field.name === "key")?.value;
  if (!key) throw AppError.upstream("Reddit: upload lease had no storage key.");
  const assetUrl = `${uploadUrl.replace(/\/$/, "")}/${key}`;
  return { assetId, assetUrl };
}

/**
 * Reddit requires a poster image for video submissions. Generating one from the
 * mp4 would mean depending on a system ffmpeg, which this app must boot
 * without, so we upload a plain dark placeholder instead.
 */
async function uploadVideoPoster(account: AdapterAccount): Promise<string> {
  const poster = await sharp({
    create: {
      width: 1280,
      height: 720,
      channels: 3,
      background: { r: 18, g: 18, b: 20 },
    },
  })
    .png()
    .toBuffer();
  const { assetUrl } = await uploadAsset(account, poster, "poster.png", "image/png");
  return assetUrl;
}

/**
 * Media submissions often answer without a permalink because Reddit finishes
 * them asynchronously. Fall back to the user's own recent submissions and match
 * on the title we just sent.
 */
async function findRecentSubmission(
  account: AdapterAccount,
  title: string,
): Promise<{ id: string; permalink: string } | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(2000);
    try {
      const listing = await fetchJson<RedditListingResponse>(
        `${API_BASE}/user/${encodeURIComponent(account.username)}/submitted?limit=10&sort=new`,
        { label: LABEL, headers: apiHeaders(account) },
      );
      const match = listing.data?.children?.find((child) => child.data?.title === title);
      if (match?.data?.id && match.data.permalink) {
        return {
          id: match.data.name ?? match.data.id,
          permalink: `https://www.reddit.com${match.data.permalink}`,
        };
      }
    } catch {
      // Listing is best-effort; the post may well have succeeded regardless.
    }
  }
  return null;
}

export const redditAdapter: SocialAdapter<"reddit"> = {
  id: "reddit",
  label: "Reddit",
  usesPkce: false,

  getAuthUrl(state: string): string {
    const credentials = requireProviderCredentials("reddit");
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      response_type: "code",
      state,
      redirect_uri: credentials.redirectUri,
      // "permanent" is what makes Reddit issue a refresh token.
      duration: "permanent",
      scope: REDDIT_SCOPES.join(" "),
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code }: ExchangeCodeParams) {
    const credentials = requireProviderCredentials("reddit");
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: credentials.redirectUri,
      }),
    );
    const me = await fetchMe(tokens.access_token);
    return toTokens(tokens, me, null);
  },

  async refresh(account: AdapterAccount) {
    if (!account.refreshToken) {
      throw new AppError(
        "Reddit did not issue a refresh token. Re-connect the account (the app must request duration=permanent).",
        { status: 401, code: "needs_reauth" },
      );
    }
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      }),
    );
    const me = await fetchMe(tokens.access_token);
    return toTokens(tokens, me, account.refreshToken);
  },

  async getMe(account: AdapterAccount) {
    const me = await fetchMe(account.accessToken);
    return { id: me.id, username: me.name };
  },

  validate(payload: PublishPayload<"reddit">) {
    const title = payload.title?.trim();
    if (!title) throw AppError.badRequest("Reddit posts need a title.");
    if (title.length > REDDIT_TITLE_LIMIT) {
      throw AppError.badRequest(`Reddit titles are limited to ${REDDIT_TITLE_LIMIT} characters.`);
    }
    if (!payload.options.subreddit) {
      throw AppError.badRequest("Choose a subreddit to post to.");
    }
    if (payload.options.kind === "link" && !payload.options.url) {
      throw AppError.badRequest("A Reddit link post needs a URL.");
    }
    if (
      (payload.options.kind === "image" || payload.options.kind === "video") &&
      payload.media.length === 0
    ) {
      throw AppError.badRequest(
        `A Reddit ${payload.options.kind} post needs ${payload.options.kind === "image" ? "an image" : "a video"} attached.`,
      );
    }
  },

  async publish(
    account: AdapterAccount,
    payload: PublishPayload<"reddit">,
  ): Promise<PublishResult> {
    this.validate?.(payload);
    const options = payload.options;
    const title = (payload.title ?? "").trim();

    const form = new URLSearchParams({
      api_type: "json",
      sr: options.subreddit,
      title,
      kind: options.kind,
      nsfw: String(options.nsfw),
      spoiler: String(options.spoiler),
      // Reddit sends a "thanks for posting" PM for every submission otherwise.
      sendreplies: "true",
      resubmit: "true",
    });
    if (options.flairText) form.set("flair_text", options.flairText);

    if (options.kind === "self") {
      form.set("text", payload.body);
    } else if (options.kind === "link") {
      form.set("url", options.url ?? "");
    } else {
      const asset = payload.media[0] as PublishMedia | undefined;
      if (!asset) throw AppError.badRequest("No media attached for this Reddit post.");
      await payload.onProgress?.("uploading");
      const bytes = await asset.read();
      const uploaded = await uploadAsset(account, bytes, asset.fileName, asset.mimeType);
      form.set("url", uploaded.assetUrl);
      if (options.kind === "video") {
        form.set("video_poster_url", await uploadVideoPoster(account));
      }
    }

    await payload.onProgress?.("publishing");

    const response = await fetchJson<RedditSubmitResponse>(`${API_BASE}/api/submit`, {
      label: LABEL,
      method: "POST",
      headers: {
        ...apiHeaders(account),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    assertNoSubmitErrors(response);

    const data = response.json?.data;
    if (data?.url && data.name) {
      return { id: data.name, permalink: data.url };
    }

    const found = await findRecentSubmission(account, title);
    if (found) return found;

    throw AppError.upstream(
      "Reddit accepted the submission but did not return a link. Check your profile before retrying - retrying may double-post.",
    );
  },
};

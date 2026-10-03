import { AppError } from "@/lib/errors";
import { requireProviderCredentials } from "@/lib/env";
import { X_SOFT_CHAR_LIMIT, MAX_IMAGES_PER_POST } from "@/lib/constants";
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
 * X (Twitter) adapter - OAuth 2.0 Authorization Code with PKCE.
 *
 * Docs:
 *  - Auth:    https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 *  - Tweets:  https://docs.x.com/x-api/posts/creation-of-a-post
 *  - Media:   https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *
 * `media.write` is required on top of the tweet scopes to attach media.
 */

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const API_BASE = "https://api.x.com/2";
const LABEL = "X";

export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "media.write",
];

type XTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type XUserResponse = {
  data?: { id: string; username: string; name?: string };
};

type XMediaUploadResponse = {
  data?: {
    id?: string;
    media_key?: string;
    processing_info?: { state: string; check_after_secs?: number; progress_percent?: number; error?: { message?: string } };
  };
  // The chunked endpoints historically answer with snake_case at the top level.
  media_id_string?: string;
  processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
};

type XTweetResponse = {
  data?: { id: string; text?: string };
};

function authHeaders(account: AdapterAccount): HeadersInit {
  return { Authorization: `Bearer ${account.accessToken}` };
}

async function tokenRequest(body: URLSearchParams): Promise<XTokenResponse> {
  const credentials = requireProviderCredentials("x");
  return fetchJson<XTokenResponse>(TOKEN_URL, {
    label: LABEL,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Confidential clients authenticate with Basic; X ignores it for public
      // clients, which still need client_id in the body (sent below).
      Authorization: basicAuthHeader(credentials.clientId, credentials.clientSecret),
    },
    body: body.toString(),
  });
}

function toTokens(
  response: XTokenResponse,
  profile: { id: string; username: string },
  fallbackRefreshToken: string | null,
): ConnectedAccountTokens {
  return {
    providerUserId: profile.id,
    username: profile.username,
    accessToken: response.access_token,
    // X rotates refresh tokens; keep the old one if a response omits it.
    refreshToken: response.refresh_token ?? fallbackRefreshToken,
    expiresAt: expiresInToDate(response.expires_in),
    scopes: response.scope ?? X_SCOPES.join(" "),
    profile,
  };
}

async function fetchMe(accessToken: string): Promise<{ id: string; username: string }> {
  const response = await fetchJson<XUserResponse>(`${API_BASE}/users/me`, {
    label: LABEL,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.data?.id) {
    throw AppError.upstream("X: /2/users/me did not return a user. Re-connect the account.");
  }
  return { id: response.data.id, username: response.data.username };
}

/** Simple (non-chunked) upload. Good for images up to a few MB. */
async function uploadImage(accessToken: string, media: PublishMedia): Promise<string> {
  const form = new FormData();
  const bytes = await media.read();
  form.append(
    "media",
    new Blob([new Uint8Array(bytes)], { type: media.mimeType }),
    media.fileName,
  );
  form.append("media_category", "tweet_image");

  const response = await fetchJson<XMediaUploadResponse>(`${API_BASE}/media/upload`, {
    label: LABEL,
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    timeoutMs: 120_000,
  });

  const id = response.data?.id ?? response.media_id_string;
  if (!id) throw AppError.upstream("X: media upload did not return a media id.");
  return id;
}

/**
 * Chunked upload for video: INIT -> APPEND(n) -> FINALIZE -> poll STATUS.
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 */
async function uploadVideo(accessToken: string, media: PublishMedia): Promise<string> {
  const bytes = await media.read();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const init = await fetchJson<XMediaUploadResponse>(`${API_BASE}/media/upload/initialize`, {
    label: LABEL,
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: media.mimeType,
      total_bytes: bytes.byteLength,
      media_category: "tweet_video",
    }),
  });

  const mediaId = init.data?.id ?? init.media_id_string;
  if (!mediaId) throw AppError.upstream("X: video upload INIT did not return a media id.");

  const CHUNK_BYTES = 4 * 1024 * 1024;
  let segment = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength));
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(chunk)]), media.fileName);
    form.append("segment_index", String(segment));
    const response = await socialFetch(`${API_BASE}/media/upload/${mediaId}/append`, {
      label: LABEL,
      method: "POST",
      headers,
      body: form,
      timeoutMs: 120_000,
    });
    if (!response.ok) {
      const text = await response.text();
      throw AppError.upstream(
        `X: video chunk ${segment} failed (${response.status}). ${text.slice(0, 300)}`,
        { status: response.status },
      );
    }
    segment += 1;
  }

  const finalized = await fetchJson<XMediaUploadResponse>(
    `${API_BASE}/media/upload/${mediaId}/finalize`,
    { label: LABEL, method: "POST", headers, timeoutMs: 120_000 },
  );

  await waitForVideoProcessing(accessToken, mediaId, finalized);
  return mediaId;
}

async function waitForVideoProcessing(
  accessToken: string,
  mediaId: string,
  finalized: XMediaUploadResponse,
): Promise<void> {
  let info = finalized.data?.processing_info ?? finalized.processing_info;
  const deadline = Date.now() + 5 * 60 * 1000;

  while (info && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw AppError.upstream(
        `X: video transcoding failed. ${info.error?.message ?? "No reason given."}`,
      );
    }
    if (Date.now() > deadline) {
      throw AppError.upstream("X: video was still processing after 5 minutes.", {
        retryable: true,
      });
    }
    await sleep(Math.max(1, info.check_after_secs ?? 5) * 1000);
    const status = await fetchJson<XMediaUploadResponse>(
      `${API_BASE}/media/upload?media_id=${encodeURIComponent(mediaId)}&command=STATUS`,
      { label: LABEL, headers: { Authorization: `Bearer ${accessToken}` } },
    );
    info = status.data?.processing_info ?? status.processing_info;
  }
}

export const xAdapter: SocialAdapter<"x"> = {
  id: "x",
  label: "X",
  usesPkce: true,

  getAuthUrl(state: string, codeChallenge?: string): string {
    const credentials = requireProviderCredentials("x");
    if (!codeChallenge) {
      throw new AppError("X requires a PKCE code challenge.", { status: 500 });
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      scope: X_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier }: ExchangeCodeParams) {
    const credentials = requireProviderCredentials("x");
    if (!codeVerifier) {
      throw AppError.badRequest("Missing PKCE verifier. Start the X connection again.");
    }
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: credentials.redirectUri,
        code_verifier: codeVerifier,
        client_id: credentials.clientId,
      }),
    );
    const profile = await fetchMe(tokens.access_token);
    return toTokens(tokens, profile, null);
  },

  async refresh(account: AdapterAccount) {
    const credentials = requireProviderCredentials("x");
    if (!account.refreshToken) {
      throw new AppError(
        "X did not issue a refresh token. Re-connect the account with the offline.access scope.",
        { status: 401, code: "needs_reauth" },
      );
    }
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: credentials.clientId,
      }),
    );
    const profile = await fetchMe(tokens.access_token);
    return toTokens(tokens, profile, account.refreshToken);
  },

  async getMe(account: AdapterAccount) {
    return fetchMe(account.accessToken);
  },

  validate(payload: PublishPayload<"x">) {
    const images = payload.media.filter((item) => item.kind === "image");
    const videos = payload.media.filter((item) => item.kind === "video");
    if (videos.length > 1) {
      throw AppError.badRequest("X accepts one video per post.");
    }
    if (videos.length > 0 && images.length > 0) {
      throw AppError.badRequest("X cannot mix a video and images in one post.");
    }
    if (images.length > MAX_IMAGES_PER_POST) {
      throw AppError.badRequest(`X accepts up to ${MAX_IMAGES_PER_POST} images per post.`);
    }
    if (payload.body.trim().length === 0 && payload.media.length === 0) {
      throw AppError.badRequest("A post on X needs text or media.");
    }
    // X Premium raises the limit, so length is a warning in the UI, not an error.
    void X_SOFT_CHAR_LIMIT;
  },

  async publish(account: AdapterAccount, payload: PublishPayload<"x">): Promise<PublishResult> {
    this.validate?.(payload);

    const mediaIds: string[] = [];
    if (payload.media.length > 0) {
      await payload.onProgress?.("uploading");
      for (const item of payload.media) {
        mediaIds.push(
          item.kind === "video"
            ? await uploadVideo(account.accessToken, item)
            : await uploadImage(account.accessToken, item),
        );
      }
    }

    await payload.onProgress?.("publishing");

    // X rejects reply_settings=everyone with 400. Omit the field for everyone.
    const body: Record<string, unknown> = {};
    if (payload.body.trim().length > 0) body.text = payload.body;
    if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
    if (
      payload.options.replySettings &&
      payload.options.replySettings !== "everyone"
    ) {
      body.reply_settings = payload.options.replySettings;
    }

    const response = await fetchJson<XTweetResponse>(`${API_BASE}/tweets`, {
      label: LABEL,
      method: "POST",
      headers: {
        ...authHeaders(account),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const id = response.data?.id;
    if (!id) throw AppError.upstream("X: the post was accepted but no id came back.");
    return { id, permalink: `https://x.com/i/web/status/${id}` };
  },
};

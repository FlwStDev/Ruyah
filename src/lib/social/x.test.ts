import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { xAdapter } from "@/lib/social/x";
import { AppError } from "@/lib/errors";
import type { AdapterAccount, PublishPayload } from "@/lib/social/types";

/**
 * X adapter against a mocked fetch. These assert the request we send (URL,
 * method, auth header, body shape) and how we read the response - not X itself.
 */

const account: AdapterAccount = {
  id: "acct_1",
  provider: "x",
  providerUserId: "99",
  username: "tester",
  accessToken: "access-token-123",
  refreshToken: "refresh-token-123",
  tokenExpiresAt: null,
  scopes: "tweet.read tweet.write users.read offline.access media.write",
  profile: {},
};

function textPayload(body: string): PublishPayload<"x"> {
  return {
    title: null,
    body,
    media: [],
    options: { replySettings: "everyone" },
    idempotencyKey: "x:post_1:abc",
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.X_CLIENT_ID = "test-client-id";
  process.env.X_CLIENT_SECRET = "test-client-secret";
  process.env.X_REDIRECT_URI = "http://localhost:3000/api/oauth/x/callback";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("x adapter auth url", () => {
  it("includes PKCE challenge, scopes and state", () => {
    const url = new URL(xAdapter.getAuthUrl("state-abc", "challenge-xyz"));

    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("tweet.write");
    expect(url.searchParams.get("scope")).toContain("offline.access");
  });

  it("refuses to build a URL without a code challenge", () => {
    expect(() => xAdapter.getAuthUrl("state-abc")).toThrow(AppError);
  });
});

describe("x adapter publish - text post", () => {
  it("posts text to /2/tweets and returns the permalink", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "1799999999" } }));

    const result = await xAdapter.publish(account, textPayload("hello from postforge"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-token-123");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.text).toBe("hello from postforge");
    // "everyone" is the API default; sending the literal value is a 400.
    expect(body).not.toHaveProperty("reply_settings");
    // No media attached, so the media key must be absent entirely.
    expect(body).not.toHaveProperty("media");

    expect(result).toEqual({
      id: "1799999999",
      permalink: "https://x.com/i/web/status/1799999999",
    });
  });

  it("sends reply_settings only when it is not everyone", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "1" } }));
    await xAdapter.publish(account, {
      ...textPayload("restricted"),
      options: { replySettings: "mentionedUsers" },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      reply_settings?: string;
    };
    expect(body.reply_settings).toBe("mentionedUsers");
  });

  it("uploads an image first and attaches the media id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "media_42" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "1800000000" } }));

    const phases: string[] = [];
    await xAdapter.publish(account, {
      ...textPayload("with a picture"),
      media: [
        {
          id: "m1",
          kind: "image",
          mimeType: "image/png",
          fileName: "shot.png",
          size: 4,
          width: 2,
          height: 2,
          read: async () => Buffer.from([1, 2, 3, 4]),
          publicUrl: null,
        },
      ],
      onProgress: (phase) => {
        phases.push(phase);
      },
    });

    expect(phases).toEqual(["uploading", "publishing"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.x.com/2/media/upload");

    const tweetBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { media?: { media_ids: string[] } };
    expect(tweetBody.media?.media_ids).toEqual(["media_42"]);
  });

  it("surfaces X's own error message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "You are not permitted to create this Post.", status: 403 }, 403),
    );

    await expect(xAdapter.publish(account, textPayload("nope"))).rejects.toThrow(
      /You are not permitted to create this Post/,
    );
  });

  it("marks rate limits as retryable and 4xx as not", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: "Too Many Requests" }, 429));
    await expect(xAdapter.publish(account, textPayload("slow down"))).rejects.toMatchObject({
      retryable: true,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "duplicate content" }, 403));
    await expect(xAdapter.publish(account, textPayload("again"))).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("rejects a post with neither text nor media before calling the API", async () => {
    await expect(xAdapter.publish(account, textPayload("   "))).rejects.toThrow(
      /needs text or media/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("x adapter token exchange", () => {
  it("sends the PKCE verifier and basic auth, then reads the profile", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 7200,
          scope: "tweet.write users.read",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { id: "77", username: "tester" } }));

    const tokens = await xAdapter.exchangeCode({ code: "the-code", codeVerifier: "the-verifier" });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.x.com/2/oauth2/token");
    const sent = new URLSearchParams(String(tokenInit.body));
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("code_verifier")).toBe("the-verifier");

    const headers = tokenInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
    );

    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("new-refresh");
    expect(tokens.providerUserId).toBe("77");
    expect(tokens.username).toBe("tester");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it("keeps the previous refresh token when X does not rotate it", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "rotated", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "99", username: "tester" } }));

    const tokens = await xAdapter.refresh(account);
    expect(tokens.refreshToken).toBe("refresh-token-123");
  });
});

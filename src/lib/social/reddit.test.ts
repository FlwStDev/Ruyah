import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redditAdapter } from "@/lib/social/reddit";
import type { AdapterAccount, PublishPayload } from "@/lib/social/types";

/**
 * Reddit adapter against a mocked fetch. Reddit reports logic errors inside a
 * 200 body, so the error cases matter as much as the happy path.
 */

const account: AdapterAccount = {
  id: "acct_2",
  provider: "reddit",
  providerUserId: "t2_abc",
  username: "postforge_tester",
  accessToken: "reddit-access",
  refreshToken: "reddit-refresh",
  tokenExpiresAt: null,
  scopes: "identity submit read mysubreddits flair",
  profile: {},
};

function selfPost(overrides: Partial<PublishPayload<"reddit">> = {}): PublishPayload<"reddit"> {
  return {
    title: "Hello from PostForge",
    body: "This is the self text.",
    media: [],
    options: {
      subreddit: "test",
      kind: "self",
      flairText: null,
      nsfw: false,
      spoiler: false,
      url: null,
    },
    idempotencyKey: "reddit:post_1:abc",
    ...overrides,
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
  process.env.REDDIT_CLIENT_ID = "reddit-client";
  process.env.REDDIT_CLIENT_SECRET = "reddit-secret";
  process.env.REDDIT_REDIRECT_URI = "http://localhost:3000/api/oauth/reddit/callback";
  process.env.REDDIT_USER_AGENT = "web:postforge:0.1.0 (by /u/postforge_tester)";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reddit adapter auth url", () => {
  it("requests a permanent grant with the write scopes", () => {
    const url = new URL(redditAdapter.getAuthUrl("state-123"));

    expect(url.origin + url.pathname).toBe("https://www.reddit.com/api/v1/authorize");
    expect(url.searchParams.get("client_id")).toBe("reddit-client");
    expect(url.searchParams.get("state")).toBe("state-123");
    // Without duration=permanent Reddit never issues a refresh token.
    expect(url.searchParams.get("duration")).toBe("permanent");
    expect(url.searchParams.get("scope")).toContain("submit");
    expect(url.searchParams.get("scope")).toContain("identity");
  });
});

describe("reddit adapter publish - self post", () => {
  it("submits kind=self with the title, text and user agent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        json: {
          errors: [],
          data: {
            id: "1abcdef",
            name: "t3_1abcdef",
            url: "https://www.reddit.com/r/test/comments/1abcdef/hello_from_postforge/",
          },
        },
      }),
    );

    const result = await redditAdapter.publish(account, selfPost());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth.reddit.com/api/submit");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer reddit-access");
    // Reddit throttles generic agents, so this header is not optional.
    expect(headers["User-Agent"]).toBe("web:postforge:0.1.0 (by /u/postforge_tester)");

    const body = new URLSearchParams(String(init.body));
    expect(body.get("api_type")).toBe("json");
    expect(body.get("sr")).toBe("test");
    expect(body.get("kind")).toBe("self");
    expect(body.get("title")).toBe("Hello from PostForge");
    expect(body.get("text")).toBe("This is the self text.");
    expect(body.get("nsfw")).toBe("false");
    expect(body.get("spoiler")).toBe("false");

    expect(result).toEqual({
      id: "t3_1abcdef",
      permalink: "https://www.reddit.com/r/test/comments/1abcdef/hello_from_postforge/",
    });
  });

  it("includes flair text when one is given", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        json: { errors: [], data: { name: "t3_x", url: "https://reddit.com/x" } },
      }),
    );

    await redditAdapter.publish(
      account,
      selfPost({
        options: {
          subreddit: "test",
          kind: "self",
          flairText: "Discussion",
          nsfw: true,
          spoiler: true,
          url: null,
        },
      }),
    );

    const body = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.get("flair_text")).toBe("Discussion");
    expect(body.get("nsfw")).toBe("true");
    expect(body.get("spoiler")).toBe("true");
  });

  it("raises Reddit's in-body errors even though the status is 200", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        json: {
          errors: [["SUBREDDIT_NOEXIST", "that subreddit doesn't exist", "sr"]],
          data: {},
        },
      }),
    );

    await expect(redditAdapter.publish(account, selfPost())).rejects.toThrow(
      /that subreddit doesn't exist/,
    );
  });

  it("requires a title before calling the API", async () => {
    await expect(
      redditAdapter.publish(account, selfPost({ title: "   " })),
    ).rejects.toThrow(/need a title/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires media for an image post", async () => {
    await expect(
      redditAdapter.publish(
        account,
        selfPost({
          options: {
            subreddit: "test",
            kind: "image",
            flairText: null,
            nsfw: false,
            spoiler: false,
            url: null,
          },
        }),
      ),
    ).rejects.toThrow(/needs an image/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reddit adapter identity", () => {
  it("reads /api/v1/me for the test-connection check", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "t2_abc", name: "postforge_tester" }));

    const me = await redditAdapter.getMe(account);

    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth.reddit.com/api/v1/me");
    expect(me).toEqual({ id: "t2_abc", username: "postforge_tester" });
  });

  it("refuses to run with a placeholder user agent", async () => {
    process.env.REDDIT_USER_AGENT = "web:postforge:0.1.0 (by /u/replace)";
    await expect(redditAdapter.getMe(account)).rejects.toThrow(/REDDIT_USER_AGENT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

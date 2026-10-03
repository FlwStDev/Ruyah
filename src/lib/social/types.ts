import { z } from "zod";
import {
  INSTAGRAM_PUBLISH_KINDS,
  REDDIT_POST_KINDS,
  X_REPLY_SETTINGS,
  type MediaKind,
  type SocialProvider,
} from "@/lib/constants";

/** A connected account with its tokens already decrypted. Never serialize this. */
export type AdapterAccount = {
  id: string;
  provider: SocialProvider;
  providerUserId: string;
  username: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string;
  profile: Record<string, unknown>;
};

/** What an adapter hands back after an OAuth exchange or refresh. */
export type ConnectedAccountTokens = {
  providerUserId: string;
  username: string;
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry. null means the token does not expire on its own. */
  expiresAt: Date | null;
  scopes: string;
  profile: Record<string, unknown>;
};

export type ExchangeCodeParams = {
  code: string;
  codeVerifier?: string | null;
  redirectUri?: string;
};

/** One attached file, resolved for the adapter that is about to publish it. */
export type PublishMedia = {
  id: string;
  kind: MediaKind;
  mimeType: string;
  fileName: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Bytes, read lazily so text posts never touch the disk. */
  read: () => Promise<Buffer>;
  /** Public HTTPS URL, or null when PUBLIC_BASE_URL is unset. */
  publicUrl: string | null;
};

export const xOptionsSchema = z.object({
  replySettings: z.enum(X_REPLY_SETTINGS).default("everyone"),
});
export type XOptions = z.infer<typeof xOptionsSchema>;

export const redditOptionsSchema = z.object({
  subreddit: z
    .string()
    .trim()
    .min(1, "Subreddit is required.")
    // Accept r/name, /r/name or bare name; normalize to the bare name.
    .transform((value) => value.replace(/^\/?r\//i, "").replace(/^\/+|\/+$/g, "")),
  kind: z.enum(REDDIT_POST_KINDS).default("self"),
  flairText: z.string().trim().max(64).optional().nullable(),
  nsfw: z.boolean().default(false),
  spoiler: z.boolean().default(false),
  /** Only used when kind is "link". */
  url: z.string().url().optional().nullable(),
});
export type RedditOptions = z.infer<typeof redditOptionsSchema>;

export const instagramOptionsSchema = z.object({
  publishKind: z.enum(INSTAGRAM_PUBLISH_KINDS).default("FEED"),
  /** Reels can also appear on the main profile grid. */
  shareToFeed: z.boolean().default(true),
});
export type InstagramOptions = z.infer<typeof instagramOptionsSchema>;

export type ProviderOptions = {
  x: XOptions;
  reddit: RedditOptions;
  instagram: InstagramOptions;
};

export type PublishPayload<P extends SocialProvider = SocialProvider> = {
  title: string | null;
  body: string;
  media: PublishMedia[];
  options: ProviderOptions[P];
  /**
   * Stable key for this publish attempt. Adapters pass it to the network when
   * the API supports deduplication and otherwise just log it, so a replayed
   * job is traceable to the original attempt.
   */
  idempotencyKey: string;
  /** Lets the worker move the job from "uploading" to "publishing" in the UI. */
  onProgress?: (phase: "uploading" | "publishing") => Promise<void> | void;
};

export type PublishResult = {
  id: string;
  permalink: string;
};

export interface SocialAdapter<P extends SocialProvider = SocialProvider> {
  readonly id: P;
  /** Human label used in errors and the UI. */
  readonly label: string;
  getAuthUrl(state: string, codeVerifier?: string): string;
  exchangeCode(params: ExchangeCodeParams): Promise<ConnectedAccountTokens>;
  refresh(account: AdapterAccount): Promise<ConnectedAccountTokens>;
  getMe(account: AdapterAccount): Promise<{ id: string; username: string }>;
  publish(account: AdapterAccount, payload: PublishPayload<P>): Promise<PublishResult>;
  /** True when this adapter needs PKCE (only X does). */
  readonly usesPkce: boolean;
  /** Checked before enqueueing so the composer can explain what is missing. */
  validate?(payload: PublishPayload<P>): void;
}

export const optionsSchemaByProvider = {
  x: xOptionsSchema,
  reddit: redditOptionsSchema,
  instagram: instagramOptionsSchema,
} as const;

import { AppError } from "@/lib/errors";
import { isSocialProvider, type SocialProvider } from "@/lib/constants";
import { xAdapter, X_SCOPES } from "@/lib/social/x";
import { redditAdapter, REDDIT_SCOPES } from "@/lib/social/reddit";
import { instagramAdapter, INSTAGRAM_SCOPES } from "@/lib/social/instagram";
import type { SocialAdapter } from "@/lib/social/types";

export const adapters = {
  x: xAdapter,
  reddit: redditAdapter,
  instagram: instagramAdapter,
} satisfies { [P in SocialProvider]: SocialAdapter<P> };

export type Adapters = typeof adapters;

export function getAdapter<P extends SocialProvider>(provider: P): Adapters[P] {
  const adapter = adapters[provider];
  if (!adapter) {
    throw AppError.badRequest(`Unknown network "${provider}".`);
  }
  return adapter;
}

/** Narrows an arbitrary string (a DB column, a route param) to a real adapter. */
export function getAdapterByName(provider: string): SocialAdapter {
  if (!isSocialProvider(provider)) {
    throw AppError.badRequest(`Unknown network "${provider}".`);
  }
  return adapters[provider] as SocialAdapter;
}

export const SCOPES_BY_PROVIDER: Record<SocialProvider, string[]> = {
  x: X_SCOPES,
  reddit: REDDIT_SCOPES,
  instagram: INSTAGRAM_SCOPES,
};

export { STUB_ADAPTERS, notImplemented } from "@/lib/social/stubs";
export * from "@/lib/social/types";

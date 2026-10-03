import { AppError } from "@/lib/errors";
import type { StubProvider } from "@/lib/constants";

/**
 * Placeholders for networks that are explicitly out of scope for the MVP. They
 * exist so the shape of "adding a network" is visible, and so nothing silently
 * half-works: every entry point throws with the same explanation.
 *
 * To implement one: copy src/lib/social/x.ts, fill in the provider's endpoints,
 * add the provider to SOCIAL_PROVIDERS, and register it in social/index.ts.
 */

export type StubAdapterInfo = {
  id: StubProvider;
  label: string;
  /** What the network's API would require beyond what PostForge already does. */
  note: string;
};

export const STUB_ADAPTERS: Record<StubProvider, StubAdapterInfo> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    note: "Content Posting API requires an audited app and a verified domain.",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    note: "Data API v3 resumable upload plus a Google Cloud OAuth consent screen.",
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    note: "Pages API with a Page access token, separate from Instagram Login.",
  },
  threads: {
    id: "threads",
    label: "Threads",
    note: "Threads API containers, similar in shape to the Instagram adapter.",
  },
};

export function notImplemented(provider: StubProvider): never {
  const info = STUB_ADAPTERS[provider];
  throw new AppError(
    `${info.label} is not part of this MVP. ${info.note}`,
    { status: 501, code: "not_implemented" },
  );
}

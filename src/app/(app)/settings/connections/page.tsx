import { requireUserPage } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts";
import { env, getPublicProviderConfig } from "@/lib/env";
import { SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/constants";
import { SCOPES_BY_PROVIDER, STUB_ADAPTERS } from "@/lib/social";
import { ConnectionsClient, type ProviderCard } from "./connections-client";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<SocialProvider, string> = {
  x: "OAuth 2.0 with PKCE. Posts text, images and video as you.",
  reddit: "OAuth 2.0. Self posts, link posts and native image/video uploads.",
  instagram: "Instagram Login on graph.instagram.com. Professional accounts only.",
};

type Props = {
  searchParams: Promise<{ connected?: string; username?: string; error?: string }>;
};

export default async function ConnectionsPage({ searchParams }: Props) {
  const user = await requireUserPage();
  const [accounts, params] = await Promise.all([listAccounts(user.id), searchParams]);

  const cards: ProviderCard[] = SOCIAL_PROVIDERS.map((provider) => {
    const config = getPublicProviderConfig(provider);
    return {
      provider,
      description: DESCRIPTIONS[provider],
      configured: config.configured,
      clientId: config.clientId,
      hasSecret: config.hasSecret,
      redirectUri: config.redirectUri,
      scopes: SCOPES_BY_PROVIDER[provider],
      accounts: accounts.filter((account) => account.provider === provider),
    };
  });

  return (
    <ConnectionsClient
      cards={cards}
      stubs={Object.values(STUB_ADAPTERS)}
      redditUserAgent={env.redditUserAgent ?? ""}
      publicBaseUrl={env.publicBaseUrl ?? ""}
      flash={{
        connected: params.connected ?? null,
        username: params.username ?? null,
        error: params.error ?? null,
      }}
    />
  );
}

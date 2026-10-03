import { prisma } from "@/lib/db";
import { requireUserPage } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts";
import { isProviderConfigured, env } from "@/lib/env";
import { SOCIAL_PROVIDERS } from "@/lib/constants";
import { serializeMedia } from "@/lib/serializers";
import { Composer } from "@/components/composer";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const user = await requireUserPage();
  const [accounts, assets] = await Promise.all([
    listAccounts(user.id),
    prisma.mediaAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);

  const providers = SOCIAL_PROVIDERS.map((provider) => {
    const account = accounts.find(
      (candidate) => candidate.provider === provider && candidate.status !== "revoked",
    );
    return {
      provider,
      configured: isProviderConfigured(provider),
      username: account?.username ?? null,
      connected: Boolean(account),
      needsReauth: account?.status === "needs_reauth",
    };
  });

  return (
    <Composer
      providers={providers}
      initialMedia={assets.map(serializeMedia)}
      publicBaseUrlSet={Boolean(env.publicBaseUrl)}
    />
  );
}

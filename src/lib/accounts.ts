import type { ConnectedAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { decryptSecret, encryptOptional, encryptSecret } from "@/lib/crypto";
import { isSocialProvider, type AccountStatus, type SocialProvider } from "@/lib/constants";
import { getAdapter } from "@/lib/social";
import type { AdapterAccount, ConnectedAccountTokens } from "@/lib/social/types";

/** Refresh a little early so a long upload never straddles the expiry. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** The shape safe to send to the browser: no tokens, ever. */
export type PublicAccount = {
  id: string;
  provider: SocialProvider;
  username: string;
  providerUserId: string;
  status: AccountStatus;
  statusMessage: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  avatarUrl: string | null;
};

function parseProfile(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function avatarFromProfile(profile: Record<string, unknown>): string | null {
  for (const key of ["profile_picture_url", "icon_img", "profile_image_url"]) {
    const value = profile[key];
    if (typeof value === "string" && value.startsWith("http")) {
      // Reddit HTML-escapes its icon URLs.
      return value.replace(/&amp;/g, "&");
    }
  }
  return null;
}

export function toPublicAccount(account: ConnectedAccount): PublicAccount {
  const profile = parseProfile(account.profileJson);
  return {
    id: account.id,
    provider: account.provider as SocialProvider,
    username: account.username,
    providerUserId: account.providerUserId,
    status: account.status as AccountStatus,
    statusMessage: account.statusMessage,
    scopes: account.scopes.split(/[\s,]+/).filter(Boolean),
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    lastCheckedAt: account.lastCheckedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    avatarUrl: avatarFromProfile(profile),
  };
}

export function toAdapterAccount(account: ConnectedAccount): AdapterAccount {
  if (!isSocialProvider(account.provider)) {
    throw AppError.badRequest(`Unknown network "${account.provider}".`);
  }
  return {
    id: account.id,
    provider: account.provider,
    providerUserId: account.providerUserId,
    username: account.username,
    accessToken: decryptSecret(account.accessToken),
    refreshToken: account.refreshToken ? decryptSecret(account.refreshToken) : null,
    tokenExpiresAt: account.tokenExpiresAt,
    scopes: account.scopes,
    profile: parseProfile(account.profileJson),
  };
}

export async function saveAccountTokens(
  userId: string,
  provider: SocialProvider,
  tokens: ConnectedAccountTokens,
): Promise<ConnectedAccount> {
  const data = {
    username: tokens.username,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: encryptOptional(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    profileJson: JSON.stringify(tokens.profile ?? {}),
    status: "active",
    statusMessage: null,
    lastCheckedAt: new Date(),
  };

  return prisma.connectedAccount.upsert({
    where: {
      userId_provider_providerUserId: {
        userId,
        provider,
        providerUserId: tokens.providerUserId,
      },
    },
    create: { userId, provider, providerUserId: tokens.providerUserId, ...data },
    update: data,
  });
}

export async function markAccountStatus(
  accountId: string,
  status: AccountStatus,
  message: string | null,
): Promise<void> {
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { status, statusMessage: message, lastCheckedAt: new Date() },
  });
}

function isExpiring(account: ConnectedAccount): boolean {
  if (!account.tokenExpiresAt) return false;
  return account.tokenExpiresAt.getTime() - REFRESH_SKEW_MS <= Date.now();
}

/**
 * Loads an account ready for publishing, refreshing the token first if it is
 * expired or about to be. A failed refresh flips the account to needs_reauth so
 * the connections page can tell the user to reconnect instead of silently
 * failing every future job.
 */
export async function getPublishableAccount(
  userId: string,
  accountId: string,
): Promise<AdapterAccount> {
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) {
    throw AppError.notFound("That account is no longer connected. Reconnect it in Settings.");
  }
  if (account.status === "revoked") {
    throw new AppError(
      `The ${account.provider} connection for @${account.username} was disconnected. Reconnect it in Settings.`,
      { status: 401, code: "needs_reauth" },
    );
  }
  if (!isExpiring(account)) {
    return toAdapterAccount(account);
  }
  return refreshAccount(account);
}

export async function refreshAccount(account: ConnectedAccount): Promise<AdapterAccount> {
  if (!isSocialProvider(account.provider)) {
    throw AppError.badRequest(`Unknown network "${account.provider}".`);
  }
  const adapter = getAdapter(account.provider);
  const current = toAdapterAccount(account);
  try {
    const tokens = await adapter.refresh(current);
    const updated = await saveAccountTokens(account.userId, account.provider, tokens);
    return toAdapterAccount(updated);
  } catch (error) {
    const appError = toAppError(error);
    // A transient outage should not force a reconnect; only auth errors do.
    const needsReauth = appError.status === 400 || appError.status === 401;
    await markAccountStatus(
      account.id,
      needsReauth ? "needs_reauth" : "error",
      appError.message,
    );
    throw new AppError(
      needsReauth
        ? `The ${account.provider} token for @${account.username} could not be refreshed: ${appError.message} Reconnect the account in Settings.`
        : appError.message,
      {
        status: appError.status,
        code: needsReauth ? "needs_reauth" : appError.code,
        retryable: appError.retryable,
      },
    );
  }
}

export async function listAccounts(userId: string): Promise<PublicAccount[]> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  return accounts.map(toPublicAccount);
}

export async function getAccountForProvider(
  userId: string,
  provider: SocialProvider,
): Promise<ConnectedAccount | null> {
  return prisma.connectedAccount.findFirst({
    where: { userId, provider, status: { not: "revoked" } },
    orderBy: { createdAt: "asc" },
  });
}

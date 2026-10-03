import { AppError } from "@/lib/errors";
import { PROVIDER_LABELS, SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/constants";
import { applyEnvUpdates, getStoredEnv } from "@/lib/env-store";

/**
 * Env access. Nothing here throws at import time: the app has to boot with an
 * empty .env so the setup checklist can tell you what is missing.
 */

function read(name: string): string | undefined {
  const stored = getStoredEnv(name);
  if (stored) return stored;
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const value = read(name);
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function int(name: string, fallback: number): number {
  const value = read(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Trailing slashes break string-concatenated callback URLs. */
function origin(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, "");
}

export const env = {
  get databaseUrl() {
    return read("DATABASE_URL");
  },
  get appUrl() {
    return origin(read("APP_URL")) ?? "http://localhost:3000";
  },
  /** Public HTTPS origin required by Instagram (and Reddit native media). */
  get publicBaseUrl() {
    return origin(read("PUBLIC_BASE_URL"));
  },
  get allowRegister() {
    return bool("ALLOW_REGISTER", true);
  },
  get tokenEncryptionKey() {
    return read("TOKEN_ENCRYPTION_KEY");
  },
  get sessionSecret() {
    return read("SESSION_SECRET");
  },
  get redditUserAgent() {
    return read("REDDIT_USER_AGENT");
  },
  get workerPollIntervalMs() {
    return int("WORKER_POLL_INTERVAL_MS", 5000);
  },
  get workerConcurrency() {
    return int("WORKER_CONCURRENCY", 2);
  },
  get seedEmail() {
    return read("SEED_EMAIL") ?? "admin@postforge.local";
  },
  get seedPassword() {
    return read("SEED_PASSWORD") ?? "postforge-dev";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

export type ProviderCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export const PROVIDER_ENV_KEYS: Record<
  SocialProvider,
  { clientId: string; clientSecret: string; redirectUri: string; defaultRedirect: string }
> = {
  x: {
    clientId: "X_CLIENT_ID",
    clientSecret: "X_CLIENT_SECRET",
    redirectUri: "X_REDIRECT_URI",
    defaultRedirect: "/api/oauth/x/callback",
  },
  reddit: {
    clientId: "REDDIT_CLIENT_ID",
    clientSecret: "REDDIT_CLIENT_SECRET",
    redirectUri: "REDDIT_REDIRECT_URI",
    defaultRedirect: "/api/oauth/reddit/callback",
  },
  instagram: {
    clientId: "INSTAGRAM_CLIENT_ID",
    clientSecret: "INSTAGRAM_CLIENT_SECRET",
    redirectUri: "INSTAGRAM_REDIRECT_URI",
    defaultRedirect: "/api/oauth/instagram/callback",
  },
};

export function getProviderCredentials(provider: SocialProvider): ProviderCredentials | null {
  const keys = PROVIDER_ENV_KEYS[provider];
  const clientId = read(keys.clientId);
  const clientSecret = read(keys.clientSecret);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    // X console rejects localhost and IPs. localtest.me is public DNS to 127.0.0.1.
    // https://docs.x.com/fundamentals/developer-apps
    redirectUri:
      read(keys.redirectUri) ??
      (provider === "x"
        ? `http://127.0.0.1:3000${keys.defaultRedirect}`
        : `${env.appUrl}${keys.defaultRedirect}`),
  };
}

/** Same as above but throws the message the UI should show. */
export function requireProviderCredentials(provider: SocialProvider): ProviderCredentials {
  const credentials = getProviderCredentials(provider);
  if (!credentials) {
    const keys = PROVIDER_ENV_KEYS[provider];
    throw AppError.misconfigured(
      `${PROVIDER_LABELS[provider]} is not configured. Paste the Client ID and Secret on Settings → Connections, then save.`,
    );
  }
  return credentials;
}

export function isProviderConfigured(provider: SocialProvider): boolean {
  return getProviderCredentials(provider) !== null;
}

export type ProviderCredentialForm = {
  provider: SocialProvider;
  clientId: string;
  /** Empty means keep the secret already stored. */
  clientSecret?: string;
  redirectUri?: string;
  redditUserAgent?: string;
  publicBaseUrl?: string;
};

export function saveProviderCredentials(input: ProviderCredentialForm): void {
  const keys = PROVIDER_ENV_KEYS[input.provider];
  const updates: Record<string, string | undefined> = {
    [keys.clientId]: input.clientId,
    [keys.redirectUri]: input.redirectUri,
  };
  if (input.clientSecret && input.clientSecret.trim().length > 0) {
    updates[keys.clientSecret] = input.clientSecret;
  }
  if (input.provider === "reddit" && input.redditUserAgent !== undefined) {
    updates.REDDIT_USER_AGENT = input.redditUserAgent;
  }
  if (input.provider === "instagram" && input.publicBaseUrl !== undefined) {
    updates.PUBLIC_BASE_URL = input.publicBaseUrl;
  }
  applyEnvUpdates(updates);
}

export type PublicProviderConfig = {
  provider: SocialProvider;
  configured: boolean;
  clientId: string;
  hasSecret: boolean;
  redirectUri: string;
};

export function getPublicProviderConfig(provider: SocialProvider): PublicProviderConfig {
  const keys = PROVIDER_ENV_KEYS[provider];
  const credentials = getProviderCredentials(provider);
  return {
    provider,
    configured: Boolean(credentials),
    clientId: read(keys.clientId) ?? "",
    hasSecret: Boolean(read(keys.clientSecret)),
    redirectUri:
      read(keys.redirectUri) ??
      (provider === "x"
        ? `http://127.0.0.1:3000${keys.defaultRedirect}`
        : `${env.appUrl}${keys.defaultRedirect}`),
  };
}

export type SetupCheck = {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  /** Never contains a secret value - only whether one is present. */
  detail: string;
};

/**
 * Powers /settings/setup. Reports presence and shape of config, never values.
 */
export function getSetupChecks(): SetupCheck[] {
  const checks: SetupCheck[] = [];

  const databaseUrl = env.databaseUrl;
  checks.push({
    key: "database",
    label: "DATABASE_URL",
    ok: Boolean(databaseUrl),
    required: true,
    detail: databaseUrl
      ? databaseUrl.startsWith("file:")
        ? "SQLite file configured."
        : "Non-SQLite datasource configured."
      : "Missing. Set DATABASE_URL=\"file:./dev.db\".",
  });

  const tokenKey = env.tokenEncryptionKey;
  const tokenKeyOk = Boolean(tokenKey && /^[0-9a-fA-F]{64,}$/.test(tokenKey));
  checks.push({
    key: "token_encryption_key",
    label: "TOKEN_ENCRYPTION_KEY",
    ok: tokenKeyOk,
    required: true,
    detail: tokenKeyOk
      ? "Present, 32+ bytes of hex."
      : tokenKey
        ? "Set, but not 32+ bytes of hex. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        : "Missing. OAuth tokens cannot be stored without it.",
  });

  const sessionSecret = env.sessionSecret;
  const sessionOk = Boolean(sessionSecret && sessionSecret.length >= 32);
  checks.push({
    key: "session_secret",
    label: "SESSION_SECRET",
    ok: sessionOk,
    required: true,
    detail: sessionOk
      ? "Present, 32+ characters."
      : sessionSecret
        ? "Set, but shorter than 32 characters."
        : "Missing. Login cookies cannot be signed without it.",
  });

  for (const provider of SOCIAL_PROVIDERS) {
    const keys = PROVIDER_ENV_KEYS[provider];
    const credentials = getProviderCredentials(provider);
    checks.push({
      key: `${provider}_credentials`,
      label: `${keys.clientId} / ${keys.clientSecret} / ${keys.redirectUri}`,
      ok: Boolean(credentials),
      required: false,
      detail: credentials
        ? `Configured. Redirect URI: ${credentials.redirectUri}`
        : `Not configured. ${PROVIDER_LABELS[provider]} will be unavailable in the composer.`,
    });
  }

  const userAgent = env.redditUserAgent;
  const userAgentOk = Boolean(
    userAgent && /^\w+:[\w.-]+:[\w.-]+ \(by \/u\/\S+\)$/.test(userAgent) && !/\/u\/replace/.test(userAgent),
  );
  checks.push({
    key: "reddit_user_agent",
    label: "REDDIT_USER_AGENT",
    ok: userAgentOk,
    required: false,
    detail: userAgentOk
      ? "Set to a unique descriptive agent."
      : "Reddit throttles generic agents. Use: web:postforge:0.1.0 (by /u/yourname)",
  });

  const publicBaseUrl = env.publicBaseUrl;
  const publicOk = Boolean(publicBaseUrl && publicBaseUrl.startsWith("https://"));
  checks.push({
    key: "public_base_url",
    label: "PUBLIC_BASE_URL",
    ok: publicOk,
    required: false,
    detail: publicOk
      ? `Public media will be served from ${publicBaseUrl}/api/public/media/...`
      : publicBaseUrl
        ? "Set, but not https://. Instagram refuses non-HTTPS media URLs."
        : "Not set. Instagram publishing is disabled; start a tunnel (ngrok/cloudflared) and set it.",
  });

  return checks;
}

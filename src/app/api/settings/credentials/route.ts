import { handle, jsonOk, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { env, getPublicProviderConfig, saveProviderCredentials } from "@/lib/env";
import { SOCIAL_PROVIDERS } from "@/lib/constants";
import { providerCredentialsSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return jsonOk({
      providers: Object.fromEntries(
        SOCIAL_PROVIDERS.map((provider) => [provider, getPublicProviderConfig(provider)]),
      ),
      redditUserAgent: env.redditUserAgent ?? "",
      publicBaseUrl: env.publicBaseUrl ?? "",
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();
    const input = await parseJson(request, providerCredentialsSchema);
    const existing = getPublicProviderConfig(input.provider);
    if (!existing.hasSecret && !input.clientSecret?.trim()) {
      throw AppError.badRequest("Client secret is required the first time you save.");
    }

    saveProviderCredentials({
      provider: input.provider,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      redirectUri: input.redirectUri || undefined,
      redditUserAgent: input.redditUserAgent,
      publicBaseUrl: input.publicBaseUrl,
    });

    return jsonOk({
      provider: getPublicProviderConfig(input.provider),
      redditUserAgent: env.redditUserAgent ?? "",
      publicBaseUrl: env.publicBaseUrl ?? "",
    });
  });
}

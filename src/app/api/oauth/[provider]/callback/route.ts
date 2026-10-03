import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { isSocialProvider } from "@/lib/constants";
import { getAdapter } from "@/lib/social";
import { saveAccountTokens } from "@/lib/accounts";

export const runtime = "nodejs";

type Params = { params: Promise<{ provider: string }> };

function back(query: Record<string, string>): NextResponse {
  const url = new URL("/settings/connections", env.appUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * Completes an OAuth handshake. The state row is the CSRF check and the single
 * source of the PKCE verifier; it is consumed on first use so a replayed
 * callback cannot mint a second token.
 */
export async function GET(request: Request, { params }: Params) {
  const { provider } = await params;

  try {
    if (!isSocialProvider(provider)) {
      throw AppError.badRequest(`Unknown network "${provider}".`);
    }

    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      const description =
        url.searchParams.get("error_description") ?? url.searchParams.get("error_reason");
      throw AppError.badRequest(
        `${provider} denied the connection: ${description ?? errorParam}`,
      );
    }
    if (!state) throw AppError.badRequest("Missing OAuth state. Start the connection again.");
    if (!code) throw AppError.badRequest("Missing authorization code. Start the connection again.");

    const stored = await prisma.oAuthState.findUnique({ where: { state } });
    if (!stored || stored.provider !== provider) {
      throw AppError.badRequest("That OAuth state is not recognised. Start the connection again.");
    }
    if (stored.consumedAt) {
      throw AppError.badRequest("That OAuth callback was already used. Start again.");
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw AppError.badRequest("The connection attempt timed out. Start again.");
    }

    // Consume before the exchange so a double callback cannot race us.
    await prisma.oAuthState.update({
      where: { id: stored.id },
      data: { consumedAt: new Date() },
    });

    const adapter = getAdapter(provider);
    const tokens = await adapter.exchangeCode({
      code,
      codeVerifier: stored.codeVerifier,
    });

    const account = await saveAccountTokens(stored.userId, provider, tokens);

    // Housekeeping: drop expired handshakes so the table does not grow forever.
    await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    return back({ connected: provider, username: account.username });
  } catch (error) {
    return back({ error: toAppError(error).message });
  }
}

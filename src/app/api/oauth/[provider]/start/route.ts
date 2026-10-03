import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { isSocialProvider } from "@/lib/constants";
import { createPkcePair, randomToken } from "@/lib/crypto";
import { requireProviderCredentials } from "@/lib/env";
import { getAdapter } from "@/lib/social";
import { getCurrentUser } from "@/lib/auth/guard";

export const runtime = "nodejs";

type Params = { params: Promise<{ provider: string }> };

/**
 * Kicks off an OAuth handshake: mints CSRF state (plus a PKCE verifier for X),
 * stores it, and redirects to the provider.
 *
 * Failures redirect back to the connections page with a readable message rather
 * than dumping JSON, because this is a top-level browser navigation.
 */
export async function GET(_request: Request, { params }: Params) {
  const { provider } = await params;
  const failureUrl = (message: string) =>
    NextResponse.redirect(
      new URL(
        `/settings/connections?error=${encodeURIComponent(message)}`,
        process.env.APP_URL || "http://localhost:3000",
      ),
    );

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(
        new URL("/login", process.env.APP_URL || "http://localhost:3000"),
      );
    }

    if (!isSocialProvider(provider)) {
      throw AppError.badRequest(`Unknown network "${provider}".`);
    }

    // Throws a message naming the exact missing variables.
    requireProviderCredentials(provider);

    const adapter = getAdapter(provider);
    const state = randomToken(24);
    const pkce = adapter.usesPkce ? createPkcePair() : null;

    await prisma.oAuthState.create({
      data: {
        userId: user.id,
        provider,
        state,
        codeVerifier: pkce?.codeVerifier ?? null,
        redirectTo: "/settings/connections",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return NextResponse.redirect(adapter.getAuthUrl(state, pkce?.codeChallenge));
  } catch (error) {
    return failureUrl(toAppError(error).message);
  }
}

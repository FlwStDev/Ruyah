import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type SessionData = {
  userId?: string;
  email?: string;
};

export const SESSION_COOKIE_NAME = "postforge_session";

function sessionOptions(): SessionOptions {
  const password = env.sessionSecret;
  if (!password || password.length < 32) {
    throw AppError.misconfigured(
      "SESSION_SECRET must be set to at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return {
    password,
    cookieName: SESSION_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.appUrl.startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions());
}

export async function createSession(user: { id: string; email: string }): Promise<void> {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

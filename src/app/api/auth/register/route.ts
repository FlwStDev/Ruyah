import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handle, jsonOk, parseJson } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { registerSchema } from "@/lib/validation";

export async function POST(request: Request) {
  return handle(async () => {
    const existingUsers = await prisma.user.count();

    // ALLOW_REGISTER only gates additional accounts: the very first user always
    // has to be creatable or the app is unusable out of the box.
    if (existingUsers > 0 && !env.allowRegister) {
      throw AppError.forbidden(
        "Registration is closed. Set ALLOW_REGISTER=true in .env to add another account.",
      );
    }

    const input = await parseJson(request, registerSchema);

    const duplicate = await prisma.user.findUnique({ where: { email: input.email } });
    if (duplicate) throw AppError.conflict("An account with that email already exists.");

    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name || null,
        passwordHash: await hashPassword(input.password),
        role: existingUsers === 0 ? "admin" : "member",
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await createSession(user);
    return jsonOk({ user }, 201);
  });
}

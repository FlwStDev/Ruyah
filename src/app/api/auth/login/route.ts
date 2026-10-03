import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { handle, jsonOk, parseJson } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  return handle(async () => {
    const input = await parseJson(request, loginSchema);
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    // Same message either way, so this cannot be used to enumerate accounts.
    const invalid = AppError.unauthorized("Email or password is incorrect.");
    if (!user) throw invalid;
    if (!(await verifyPassword(input.password, user.passwordHash))) throw invalid;

    await createSession(user);
    return jsonOk({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });
}

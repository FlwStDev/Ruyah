import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/guard";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/compose");

  const userCount = await prisma.user.count();
  const canRegister = userCount === 0 || env.allowRegister;

  return (
    <div className="space-y-4">
      <LoginForm />
      {canRegister ? (
        <p className="text-muted-foreground text-center text-sm">
          No account yet?{" "}
          <Link href="/register" className="text-foreground underline underline-offset-4">
            Create one
          </Link>
        </p>
      ) : (
        <p className="text-muted-foreground text-center text-xs">
          Registration is closed. Set ALLOW_REGISTER=true in .env to add an account.
        </p>
      )}
    </div>
  );
}

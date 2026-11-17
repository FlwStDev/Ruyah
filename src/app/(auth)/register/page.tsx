import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/compose");

  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  // The first account is always allowed; after that ALLOW_REGISTER decides.
  if (!isFirstUser && !env.allowRegister) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registration is closed</CardTitle>
          <CardDescription>
            This Ruyah install already has an account. Set ALLOW_REGISTER=true in .env and
            restart if you need another.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RegisterForm isFirstUser={isFirstUser} />
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

import { requireUserPage } from "@/lib/auth/guard";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  return <AppShell email={user.email}>{children}</AppShell>;
}

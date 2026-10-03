import { requireUserPage } from "@/lib/auth/guard";
import { AppNav } from "@/components/app-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav email={user.email} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  MoreHorizontal,
  PenLine,
  Plug,
  Rows3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import { apiPost, errorText } from "@/lib/client/api";

const WRITE = [{ href: "/compose", label: "Content Creation", icon: PenLine }];

const LIBRARY = [
  { href: "/posts", label: "Posts", icon: Rows3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/media", label: "Media", icon: ImageIcon },
];

const DESK = [
  { href: "/drip", label: "Storage", icon: FolderOpen },
  { href: "/settings/connections", label: "Networks", icon: Plug },
  { href: "/settings/setup", label: "Setup", icon: SlidersHorizontal },
];

const MOBILE = [
  WRITE[0],
  LIBRARY[0],
  LIBRARY[1],
  LIBRARY[2],
];

function active(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);

  async function logout() {
    try {
      await apiPost("/api/auth/logout");
      window.location.assign("/login");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="border-border fixed inset-y-0 left-0 z-30 hidden w-58 flex-col border-r bg-card px-4 py-5 md:flex">
        <Link href="/compose" className="px-3">
          <BrandMark />
        </Link>

        <nav className="mt-8 flex flex-1 flex-col gap-6">
          <NavGroup label="Create" links={WRITE} pathname={pathname} />
          <NavGroup label="Library" links={LIBRARY} pathname={pathname} />
          <NavGroup label="House" links={DESK} pathname={pathname} />
        </nav>

        <div className="flex items-center justify-between gap-2 px-1 pt-4">
          <span className="text-muted-foreground truncate text-xs">{email}</span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button type="button" variant="outline" size="icon" aria-label="Sign out" onClick={logout}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="md:pl-58">
        <header className="border-border sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/compose">
            <BrandMark />
          </Link>
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-270 px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-10">
          {children}
        </main>
      </div>

      <nav className="border-border bg-background fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {MOBILE.map((link) => {
          const Icon = link.icon;
          const on = active(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
                on ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {link.label}
            </Link>
          );
        })}
        <button
          type="button"
          className={cn(
            "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
            more ? "text-primary" : "text-muted-foreground",
          )}
          onClick={() => setMore((open) => !open)}
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>

      {more ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/30"
            onClick={() => setMore(false)}
          />
          <div className="bg-background absolute inset-x-0 bottom-16 border p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold tracking-[0.14em] uppercase">House</p>
              <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => setMore(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid gap-1">
              {DESK.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMore(false)}
                    className="hover:bg-muted flex min-h-11 items-center gap-3 px-3 text-[11px] font-semibold tracking-[0.14em] uppercase"
                  >
                    <Icon className="size-4" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-muted-foreground truncate text-xs">{email}</span>
              <Button type="button" variant="outline" onClick={logout}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NavGroup({
  label,
  links,
  pathname,
}: {
  label: string;
  links: { href: string; label: string; icon: typeof PenLine }[];
  pathname: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground px-3 pb-2 text-[10px] font-semibold tracking-[0.16em] uppercase">{label}</p>
      <div className="grid gap-0.5">
        {links.map((link) => {
          const Icon = link.icon;
          const on = active(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
                className={cn(
                "flex min-h-10 items-center gap-2.5 border-l-2 px-3 text-[11px] font-semibold tracking-[0.14em] uppercase",
                on
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Icon className="size-4" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

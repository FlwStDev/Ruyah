"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Flame,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  PenSquare,
  Plug,
  Rows3,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { apiPost, errorText } from "@/lib/client/api";

const LINKS = [
  { href: "/compose", label: "Compose", icon: PenSquare },
  { href: "/posts", label: "Posts", icon: Rows3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/media", label: "Media", icon: ImageIcon },
  { href: "/drip", label: "Drip", icon: FolderOpen },
  { href: "/settings/connections", label: "Connections", icon: Plug },
  { href: "/settings/setup", label: "Setup", icon: SlidersHorizontal },
];

export function AppNav({ email }: { email: string }) {
  const pathname = usePathname();

  async function logout() {
    try {
      await apiPost("/api/auth/logout");
      // Full document load so no server-rendered page survives in the cache.
      window.location.assign("/login");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <header className="border-border/60 bg-card/40 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-6">
        <Link href="/compose" className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Flame className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">PostForge</span>
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <Icon className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-xs sm:inline">{email}</span>
          <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

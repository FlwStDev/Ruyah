import { Flame } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Flame className="size-5" />
          </div>
          <div>
            <h1 className="text-lg leading-none font-semibold tracking-tight">PostForge</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              Local-first publishing to X, Reddit and Instagram
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

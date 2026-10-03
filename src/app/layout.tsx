import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostForge",
  description: "Local-first publishing to X, Reddit and Instagram.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark-only UI: no theme toggle to build or persist.
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}

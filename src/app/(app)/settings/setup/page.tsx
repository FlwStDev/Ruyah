import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { getSetupChecks, env } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageBanner } from "@/components/page-banner";

export const dynamic = "force-dynamic";

/**
 * Reads env and reports what is configured. Only presence and shape are shown -
 * no secret value ever reaches this page.
 */
export default function SetupPage() {
  const checks = getSetupChecks();
  const blocking = checks.filter((check) => check.required && !check.ok);
  const optional = checks.filter((check) => !check.required && !check.ok);

  return (
    <div className="space-y-6">
      <PageBanner
        title="Setup"
        lede="What Ruyah can see in your .env. Values are never displayed. Restart after you edit it."
      />

      {blocking.length > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <XCircle className="size-4" />
              {blocking.length} required setting{blocking.length === 1 ? "" : "s"} missing
            </CardTitle>
            <CardDescription>The app will not work correctly until these are set.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-400">
              <CheckCircle2 className="size-4" />
              Core configuration is complete
            </CardTitle>
            <CardDescription>
              {optional.length > 0
                ? `${optional.length} optional item${optional.length === 1 ? "" : "s"} left - each one gates a specific network.`
                : "Every network is configured."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {checks.map((check, index) => (
            <div key={check.key}>
              {index > 0 && <Separator />}
              <div className="flex items-start gap-3 px-6 py-3.5">
                <div className="mt-0.5">
                  {check.ok ? (
                    <CheckCircle2 className="size-4 text-emerald-400" />
                  ) : check.required ? (
                    <XCircle className="text-destructive size-4" />
                  ) : (
                    <CircleAlert className="size-4 text-amber-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate text-xs font-medium">{check.label}</code>
                    {check.required ? (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        required
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs break-words">{check.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redirect URIs to register</CardTitle>
          <CardDescription>
            Paste these exactly into each developer console. They must match character for
            character, including whether there is a trailing slash.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            ["X", "https://<your-tunnel>.trycloudflare.com/api/oauth/x/callback"],
            ["Reddit", `${env.appUrl}/api/oauth/reddit/callback`],
            ["Instagram", `${env.appUrl}/api/oauth/instagram/callback`],
          ].map(([label, uri]) => (
            <div key={label} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground w-20 shrink-0">{label}</span>
              <code className="bg-muted truncate rounded px-2 py-1">{uri}</code>
            </div>
          ))}
          {env.publicBaseUrl ? (
            <p className="text-muted-foreground pt-2 text-xs">
              Tunnel is set. If you authorize through the tunnel instead of localhost, register{" "}
              <code className="text-[11px]">{env.publicBaseUrl}/api/oauth/.../callback</code> too.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

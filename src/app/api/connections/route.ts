import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts";
import { isProviderConfigured } from "@/lib/env";
import { SOCIAL_PROVIDERS } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const accounts = await listAccounts(user.id);
    const configured = Object.fromEntries(
      SOCIAL_PROVIDERS.map((provider) => [provider, isProviderConfigured(provider)]),
    );
    return jsonOk({ accounts, configured });
  });
}

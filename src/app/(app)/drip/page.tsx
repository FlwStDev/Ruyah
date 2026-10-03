import { requireUserPage } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/accounts";
import { listFolderDrips } from "@/lib/folder-drip";
import { isSocialProvider, type SocialProvider } from "@/lib/constants";
import { DripClient } from "./drip-client";

export const dynamic = "force-dynamic";

export default async function DripPage() {
  const user = await requireUserPage();
  const [drips, accounts] = await Promise.all([listFolderDrips(user.id), listAccounts(user.id)]);
  const connected = Array.from(
    new Set(
      accounts
        .filter((account) => account.status === "active" && isSocialProvider(account.provider))
        .map((account) => account.provider as SocialProvider),
    ),
  );

  return <DripClient drips={drips} connected={connected} />;
}

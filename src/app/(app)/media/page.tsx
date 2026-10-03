import { prisma } from "@/lib/db";
import { requireUserPage } from "@/lib/auth/guard";
import { serializeMedia } from "@/lib/serializers";
import { env } from "@/lib/env";
import { MediaLibrary } from "@/components/media-library";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const user = await requireUserPage();
  const assets = await prisma.mediaAsset.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Media</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Files live in <code className="text-xs">uploads/</code> on this machine.
          {env.publicBaseUrl
            ? " PUBLIC_BASE_URL is set, so networks can fetch them through your tunnel."
            : " Set PUBLIC_BASE_URL to let Instagram fetch them."}
        </p>
      </div>
      <MediaLibrary initialMedia={assets.map(serializeMedia)} />
    </div>
  );
}

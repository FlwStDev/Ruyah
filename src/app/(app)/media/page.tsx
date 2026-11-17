import { prisma } from "@/lib/db";
import { requireUserPage } from "@/lib/auth/guard";
import { serializeMedia } from "@/lib/serializers";
import { env } from "@/lib/env";
import { MediaLibrary } from "@/components/media-library";
import { PageBanner } from "@/components/page-banner";

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
      <PageBanner
        title="Media"
        lede={
          env.publicBaseUrl
            ? "Files stay on this computer. A public address is set, so networks can fetch them."
            : "Files stay on this computer. Set a public address if Instagram needs to fetch them."
        }
      />
      <MediaLibrary initialMedia={assets.map(serializeMedia)} />
    </div>
  );
}

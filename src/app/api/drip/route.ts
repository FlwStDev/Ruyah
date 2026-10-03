import { handle, jsonOk, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { folderDripSchema } from "@/lib/validation";
import { createFolderDrip, listFolderDrips, toPublicDrip } from "@/lib/folder-drip";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return jsonOk({ drips: await listFolderDrips(user.id) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const input = await parseJson(request, folderDripSchema);
    const drip = await createFolderDrip(user.id, input);
    return jsonOk({ drip: await toPublicDrip(drip) }, 201);
  });
}

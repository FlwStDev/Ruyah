import { handle, jsonOk, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { folderDripPatchSchema } from "@/lib/validation";
import { deleteFolderDrip, toPublicDrip, updateFolderDrip } from "@/lib/folder-drip";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const input = await parseJson(request, folderDripPatchSchema);
    const drip = await updateFolderDrip(user.id, id, input);
    return jsonOk({ drip: await toPublicDrip(drip) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await deleteFolderDrip(user.id, id);
    return jsonOk({ deleted: true });
  });
}

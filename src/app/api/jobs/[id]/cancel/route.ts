import { handle, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { cancelJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await cancelJob(user.id, id);
    return jsonOk({ id, status: "canceled" });
  });
}

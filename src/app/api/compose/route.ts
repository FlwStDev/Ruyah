import { handle, jsonOk, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { composeSchema } from "@/lib/validation";
import { createComposeAndJobs } from "@/lib/compose";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const input = await parseJson(request, composeSchema);
    const result = await createComposeAndJobs(user.id, input);
    return jsonOk(result, 201);
  });
}

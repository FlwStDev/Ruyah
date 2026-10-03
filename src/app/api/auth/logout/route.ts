import { handle, jsonOk } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  return handle(async () => {
    await destroySession();
    return jsonOk({ ok: true });
  });
}

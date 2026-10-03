import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, toAppError } from "@/lib/errors";

/**
 * Thin wrapper so every route handler returns the same envelope and never leaks
 * a stack trace: { ok: true, data } or { ok: false, error: { message, code } }.
 */

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { message: string; code: string; details?: unknown };
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true as const, data }, { status });
}

export function jsonError(error: unknown): NextResponse<ApiFailure> {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    console.error("[api]", appError.code, appError.message, appError.cause ?? "");
  }
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        message: appError.message,
        code: appError.code,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
    },
    { status: appError.status },
  );
}

export function handle<T>(fn: () => Promise<NextResponse<ApiResult<T>>>) {
  return fn().catch(jsonError);
}

/** Parse + validate a JSON body, reporting the first field error plainly. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON.");
  }
  return parseWith(schema, raw);
}

export function parseWith<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw zodToAppError(result.error);
  return result.data;
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) raw[key] = value;
  return parseWith(schema, raw);
}

export function zodToAppError(error: ZodError): AppError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first
    ? first.path
      ? `${first.path}: ${first.message}`
      : first.message
    : "Invalid request.";
  return AppError.badRequest(message, issues);
}

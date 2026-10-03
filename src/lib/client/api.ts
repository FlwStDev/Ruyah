/**
 * Browser-side fetch helper. Unwraps the { ok, data | error } envelope and
 * throws the server's own message so toasts can show the adapter's wording.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code: string } };

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(
      `Server returned ${response.status} with an unreadable body.`,
      "bad_response",
      response.status,
    );
  }

  if (!payload || payload.ok !== true) {
    const error = payload && payload.ok === false ? payload.error : null;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status}).`,
      error?.code ?? "unknown",
      response.status,
    );
  }

  return payload.data;
}

export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
}

export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "PATCH",
    body: JSON.stringify(body ?? {}),
  });
}

export function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

import { AppError, isRetryableStatus } from "@/lib/errors";

/**
 * Shared fetch plumbing for the adapters: timeouts, JSON parsing, and turning a
 * provider's error body into a sentence worth putting in a toast.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export type SocialFetchInit = RequestInit & {
  timeoutMs?: number;
  /** Prefixed onto thrown messages, e.g. "X" -> "X: Unauthorized". */
  label: string;
};

export async function socialFetch(url: string, init: SocialFetchInit): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, label, ...rest } = init;
  try {
    return await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Network-level failures are transient by nature, so mark them retryable.
    throw AppError.upstream(`${label}: could not reach the API (${reason}).`, {
      status: 503,
      retryable: true,
    });
  }
}

export async function fetchJson<T>(url: string, init: SocialFetchInit): Promise<T> {
  const response = await socialFetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw AppError.upstream(`${init.label}: ${extractErrorMessage(text, response)}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
      details: { status: response.status, body: truncate(text, 2000) },
    });
  }

  if (text.trim().length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw AppError.upstream(`${init.label}: API returned a non-JSON response.`, {
      status: 502,
      details: { body: truncate(text, 500) },
    });
  }
}

/**
 * Providers disagree about where the message lives: X uses `detail`/`errors[]`,
 * Reddit uses `message`, Meta uses `error.message`. Try them all, then fall
 * back to the status line so the user never sees "[object Object]".
 */
export function extractErrorMessage(body: string, response: Response): string {
  const statusLine = `${response.status} ${response.statusText}`.trim();
  if (!body || body.trim().length === 0) return statusLine;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `${statusLine} - ${truncate(body.replace(/\s+/g, " ").trim(), 300)}`;
  }

  const message = findMessage(parsed);
  if (message) {
    return response.status === 429
      ? `${message} (rate limited${rateLimitHint(response)})`
      : `${message} (${statusLine})`;
  }
  return `${statusLine} - ${truncate(JSON.stringify(parsed), 300)}`;
}

function findMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  // Meta / Instagram: { error: { message, error_user_msg } }
  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const errObj = nestedError as Record<string, unknown>;
    const userMsg = pickString(errObj.error_user_msg) ?? pickString(errObj.message);
    if (userMsg) return userMsg;
  }
  if (typeof nestedError === "string") {
    const description = pickString(record.error_description);
    return description ? `${nestedError}: ${description}` : nestedError;
  }

  // X: { detail, title } or { errors: [{ message | detail }] }
  const detail = pickString(record.detail) ?? pickString(record.message);
  if (detail) return detail;

  const errors = record.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors
      .map((entry) =>
        typeof entry === "object" && entry
          ? (pickString((entry as Record<string, unknown>).message) ??
            pickString((entry as Record<string, unknown>).detail))
          : typeof entry === "string"
            ? entry
            : null,
      )
      .filter((entry): entry is string => Boolean(entry));
    if (messages.length > 0) return messages.join("; ");
  }

  return pickString(record.title) ?? pickString(record.reason) ?? null;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function rateLimitHint(response: Response): string {
  const reset = response.headers.get("x-rate-limit-reset");
  if (!reset) return "";
  const seconds = Number.parseInt(reset, 10);
  if (!Number.isFinite(seconds)) return "";
  const when = new Date(seconds * 1000);
  return `, resets ${when.toISOString()}`;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function expiresInToDate(expiresIn: unknown): Date | null {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

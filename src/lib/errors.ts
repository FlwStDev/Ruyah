/**
 * One error type for the whole app. Route handlers translate it into an HTTP
 * response; the worker stores `message` on the job so the UI can show the
 * adapter's own wording instead of a generic failure.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Whether a transient failure (429 / 5xx / network) is worth retrying. */
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      retryable?: boolean;
      details?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "internal_error";
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(message, { status: 400, code: "bad_request", details });
  }

  static unauthorized(message = "You need to sign in.") {
    return new AppError(message, { status: 401, code: "unauthorized" });
  }

  static forbidden(message = "Not allowed.") {
    return new AppError(message, { status: 403, code: "forbidden" });
  }

  static notFound(message = "Not found.") {
    return new AppError(message, { status: 404, code: "not_found" });
  }

  static conflict(message: string) {
    return new AppError(message, { status: 409, code: "conflict" });
  }

  /** Missing or malformed env for a provider - surfaced on the setup page. */
  static misconfigured(message: string) {
    return new AppError(message, { status: 503, code: "misconfigured" });
  }

  /** The remote network said no. `retryable` drives the worker's backoff. */
  static upstream(
    message: string,
    options: { status?: number; retryable?: boolean; details?: unknown } = {},
  ) {
    const status = options.status ?? 502;
    return new AppError(message, {
      status,
      code: "upstream_error",
      retryable: options.retryable ?? isRetryableStatus(status),
      details: options.details,
    });
  }
}

/** Retry only on rate limits and server-side faults, never on 4xx logic errors. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    // fetch() network failures are worth another go.
    const retryable =
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(error.message);
    return new AppError(error.message, {
      status: 500,
      code: retryable ? "network_error" : "internal_error",
      retryable,
      cause: error,
    });
  }
  return new AppError(typeof error === "string" ? error : "Unexpected error.", {
    status: 500,
  });
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

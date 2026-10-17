import { abortRawResponse, type Fetcher, type RawResponse } from "./generated/core/fetcher/index.js";

export interface AlgunaErrorInit {
  message: string;
  statusCode?: number;
  code?: string;
  requestId?: string;
  body?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

/** Base class of every error the SDK throws. */
export class AlgunaError extends Error {
  // Each class sets `name` itself: the bundle renames a class whose name a generated
  // error class also has (NotFoundError2), so `constructor.name` is not reliable.
  override name = "AlgunaError";
  /** HTTP status of the failed response; undefined when no response arrived. */
  readonly statusCode?: number;
  /** Machine-readable code, when the response body carries one. */
  readonly code?: string;
  /** The X-Request-Id of the failed response. Quote it to support. */
  readonly requestId?: string;
  /** The parsed response body, or its text when it is not JSON. */
  readonly body?: unknown;
  /** Response headers, lower-cased, e.g. `retry-after` on a 429. */
  readonly headers: Record<string, string>;

  constructor(init: AlgunaErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.requestId = init.requestId;
    this.body = init.body;
    this.headers = init.headers ?? {};
  }
}

/** 400 */
export class ValidationError extends AlgunaError {
  override name = "ValidationError";
}
/** 422: well-formed, but it cannot be processed */
export class UnprocessableEntityError extends ValidationError {
  override name = "UnprocessableEntityError";
}
/** 401: missing or invalid API key */
export class AuthenticationError extends AlgunaError {
  override name = "AuthenticationError";
}
/** 403: the API key may not do this */
export class PermissionDeniedError extends AlgunaError {
  override name = "PermissionDeniedError";
}
/** 404 */
export class NotFoundError extends AlgunaError {
  override name = "NotFoundError";
}
/** 409: conflicts with the current state of the resource */
export class ConflictError extends AlgunaError {
  override name = "ConflictError";
}
/** 429: `headers["retry-after"]` says when to retry */
export class RateLimitError extends AlgunaError {
  override name = "RateLimitError";
}
/** 5xx */
export class InternalServerError extends AlgunaError {
  override name = "InternalServerError";
}
/** Any other unsuccessful status */
export class ApiError extends AlgunaError {
  override name = "ApiError";
}
/** No response arrived: DNS, TLS, refused or reset connection. See `cause`. */
export class ConnectionError extends AlgunaError {
  override name = "ConnectionError";
}
/** The request exceeded `timeout` */
export class TimeoutError extends ConnectionError {
  override name = "TimeoutError";
}
/** The caller aborted the request through `abortSignal` */
export class AbortError extends AlgunaError {
  override name = "AbortError";
}

const errorByStatus: Record<number, typeof AlgunaError> = {
  400: ValidationError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};

/**
 * Maps a failed request to a typed error. Handler errors carry
 * `ErrorResponse {status, title, detail}`; the gateway rejects a missing or
 * invalid API key first, with `GatewayErrorResponse {code, message}`.
 */
export function errorFromFailure(failure: Fetcher.Error, rawResponse: RawResponse): AlgunaError {
  switch (failure.reason) {
    case "status-code":
      return errorFromResponse(failure.statusCode, failure.body, rawResponse);
    case "non-json":
      return errorFromResponse(failure.statusCode, failure.rawBody, rawResponse);
    case "body-is-null":
      return errorFromResponse(failure.statusCode, undefined, rawResponse);
    case "timeout":
      return new TimeoutError({ message: "Request timed out", cause: failure.cause });
    case "unknown":
      // The generated fetcher aborts a timed-out request with the reason
      // "timeout", which native fetch rejects with as is.
      if (failure.cause === "timeout") return new TimeoutError({ message: "Request timed out" });
      if (rawResponse === abortRawResponse) {
        return new AbortError({ message: "Request aborted", cause: failure.cause });
      }
      return new ConnectionError({ message: failure.errorMessage, cause: failure.cause });
  }
}

function errorFromResponse(statusCode: number, body: unknown, rawResponse: RawResponse): AlgunaError {
  const headers = Object.fromEntries(rawResponse.headers.entries());
  const ErrorClass = errorByStatus[statusCode] ?? (statusCode >= 500 ? InternalServerError : ApiError);
  return new ErrorClass({
    message:
      field(body, "detail") ??
      field(body, "title") ??
      field(body, "message") ??
      // HTTP/2 responses have no status text.
      (rawResponse.statusText || `HTTP ${statusCode}`),
    statusCode,
    code: field(body, "code"),
    requestId: headers["x-request-id"],
    body,
    headers,
  });
}

function field(body: unknown, name: string): string | undefined {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}

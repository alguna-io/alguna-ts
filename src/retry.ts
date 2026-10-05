/**
 * The Idempotency-Key and retry rules that every request follows, an endpoint method or
 * `alguna.fetch()`. The generated retry loop retries neither a 409 nor a request that got
 * no response, so each attempt goes through it with `maxRetries: 0` and this loop decides.
 */
import { AbortError } from "./errors.js";
import { join } from "./generated/core/url/index.js";
import { IDENTIFIED_BY_BODY } from "./identifiedByBody.js";

const DEFAULT_MAX_RETRIES = 2;

// The generator's curve (core/fetcher/requestWithRetries.ts): 1 s, doubled per retry, with
// ±10% jitter. Its 60 s cap also caps Retry-After.
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
const JITTER = 0.2;

const RETRIED_STATUSES = new Set([408, 429, 502, 503, 504]);

// The `code` that Node.js and Bun give a failure with no response that a retry can fix. Other
// codes, such as a TLS error's, fail the same way again.
const NETWORK_ERROR_CODES = new Set([
  // Refused (Bun: ConnectionRefused)
  "ECONNREFUSED",
  "ConnectionRefused",
  // Reset, or closed before the response
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  // Timed out in the network stack, before the attempt's own timeout
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

// Rejections of the `fetch` call itself, not errors in building the request.
const sendFailures = new WeakSet<object>();

/** What one attempt got: a response, or the error that `fetch` rejected with. */
type Attempt = { response: { status: number; headers: Headers; body?: ReadableStream | null } } | { error: unknown };

/**
 * The `fetch` that every attempt goes through, so that the retry loop knows where a failure came
 * from. It builds the Request first, as `fetch` does: a bad URL or init throws there, unsent, and
 * is never retried. Only a rejection of the `fetch` call itself can be a network failure.
 */
export function retryAwareFetch(customFetch: typeof fetch | undefined): typeof fetch {
  return async (input, init) => {
    new Request(input, init);
    try {
      return await (customFetch ?? globalThis.fetch)(input, init);
    } catch (error) {
      if (error instanceof Object) sendFailures.add(error);
      throw error;
    }
  };
}

/** A request to send: `url` is absolute, or a path that alguna.fetch() puts under `baseUrl`. */
type OutgoingRequest = { method: string; url: string; baseUrl: string };

/**
 * The header to add to a request so that it carries an Idempotency-Key: a new UUID v4, except
 * for a GET, when the caller set a key, or for an operation that the API identifies by its body.
 * Every attempt sends the same headers, so a retried write is applied once.
 */
export function idempotencyKeyHeader(request: OutgoingRequest, callerKey: unknown): Record<string, string> {
  if (request.method.toUpperCase() === "GET" || callerKey || identifiedByBody(request)) return {};
  // The global Web Crypto API, not node:crypto, which edge runtimes such as Workers do not have.
  return { "idempotency-key": globalThis.crypto.randomUUID() };
}

/**
 * Whether the request is an operation that the spec marks `x-alguna-identified-by-body`
 * (identifiedByBody.ts): `events.ingest`, `credits.track` and `credits.check`. The API
 * identifies their work by the body, such as the events' `unique_id`s. A key from the SDK
 * would replace that identity on `credits.track`, so a call sent again, such as a queue
 * redelivery, would draw credit twice. The retry loop still retries them: the body makes a
 * retry safe.
 */
function identifiedByBody({ method, url, baseUrl }: OutgoingRequest): boolean {
  const path = pathUnderBase(url, baseUrl);
  return path !== undefined && IDENTIFIED_BY_BODY.has(`${method.toUpperCase()} ${path}`);
}

/** The path of the request under the base URL, such as `/credits/track`; undefined when it is elsewhere. */
function pathUnderBase(url: string, baseUrl: string): string | undefined {
  try {
    const base = new URL(baseUrl);
    // The passthrough of alguna.fetch() appends a path to the base URL's path.
    const absolute = new URL(/^https?:\/\//.test(url) ? url : join(baseUrl, url));
    const prefix = base.pathname.replace(/\/$/, "");
    if (absolute.origin !== base.origin || !absolute.pathname.startsWith(`${prefix}/`)) return undefined;
    return absolute.pathname.slice(prefix.length);
  } catch {
    // A URL that does not parse also fails when the request is built, before it is sent.
    return undefined;
  }
}

/**
 * Sends, then sends again while the result is retryable and retries remain. `send` must not
 * throw: it returns a failed attempt as a result, which `attemptOf` describes. Throws
 * AbortError when the caller aborts while it waits to retry.
 */
export async function withRetries<T>(
  send: () => Promise<T>,
  attemptOf: (result: T) => Attempt,
  options: { maxRetries: number | undefined; abortSignal: AbortSignal | undefined },
): Promise<T> {
  const { abortSignal } = options;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  for (let retry = 0; ; retry++) {
    const result = await send();
    if (retry >= maxRetries || abortSignal?.aborted) return result;
    const attempt = attemptOf(result);
    const delay = delayBeforeRetry(attempt, retry);
    if (delay === undefined) return result;
    // An unread body keeps its connection open until it is garbage-collected.
    if ("response" in attempt) await attempt.response.body?.cancel();
    await sleep(delay, abortSignal);
    // A custom `fetch` can ignore an aborted signal, so the next attempt must not be sent.
    if (abortSignal?.aborted) throw new AbortError({ message: "Request aborted", cause: abortSignal.reason });
  }
}

/** Milliseconds to wait before retry number `retry` (from 0), or undefined when the attempt is final. */
function delayBeforeRetry(attempt: Attempt, retry: number): number | undefined {
  if ("error" in attempt) return isNetworkFailure(attempt.error) ? backoff(retry) : undefined;
  const { status, headers } = attempt.response;
  const retryAfter = retryAfterMs(headers.get("retry-after"));
  // The API adds Retry-After to a 409 only while a request with the same Idempotency-Key is
  // still running. A 409 without it is a real conflict, which a retry would hit again.
  if (status === 409) return retryAfter;
  if (!RETRIED_STATUSES.has(status)) return undefined;
  return retryAfter ?? backoff(retry);
}

/**
 * Whether no response arrived for a reason a retry can fix: the attempt's timeout, or a refused,
 * reset or closed connection. The caller's own abort never gets here: the loop stops first.
 */
function isNetworkFailure(error: unknown): boolean {
  // The generated code aborts a timed-out attempt with the reason "timeout", which native fetch
  // rejects with as is; a fetch that drops the reason rejects with an AbortError.
  if (error === "timeout" || (error instanceof Error && error.name === "AbortError")) return true;
  if (!(error instanceof Error) || !sendFailures.has(error)) return false;
  // Node.js rejects with TypeError("fetch failed") and the coded reason as `cause`; Bun rejects
  // with the coded error itself. Workers, Deno and browsers reject with a TypeError and no code.
  const code = codeOf(error) ?? codeOf(error.cause);
  return code === undefined ? error instanceof TypeError : NETWORK_ERROR_CODES.has(code);
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

function backoff(retry: number): number {
  const delay = Math.min(INITIAL_DELAY_MS * 2 ** retry, MAX_DELAY_MS);
  return delay * (1 + (Math.random() - 0.5) * JITTER);
}

/** Retry-After, in seconds or as an HTTP date. */
function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.min(Math.max(ms, 0), MAX_DELAY_MS);
}

/** Resolves after `ms`, or as soon as the caller aborts. */
function sleep(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    abortSignal?.addEventListener("abort", done);
  });
}

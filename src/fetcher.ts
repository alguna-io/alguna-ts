import { errorFromFailure } from "./errors.js";
import { type Fetcher, type FetchFunction, fetcher } from "./generated/core/fetcher/index.js";
import { idempotencyKeyHeader, withRetries } from "./retry.js";

/**
 * The fetcher that every endpoint method calls in place of the generated one: it adds the
 * Idempotency-Key, retries by the rules in retry.ts, and throws a typed AlgunaError in place
 * of a generated per-endpoint error. `baseUrl` is the client's.
 */
export function algunaFetcher(baseUrl: string): FetchFunction {
  return async <R>(args: Fetcher.Args) => {
    const headers = {
      ...args.headers,
      // The generated client lower-cases header names.
      ...idempotencyKeyHeader({ method: args.method, url: args.url, baseUrl }, args.headers?.["idempotency-key"]),
    };
    const response = await withRetries(
      () => fetcher<R>({ ...args, headers, maxRetries: 0 }),
      (attempt) =>
        attempt.ok || "statusCode" in attempt.error ? { response: attempt.rawResponse } : { error: attempt.error.cause },
      { maxRetries: args.maxRetries, abortSignal: args.abortSignal },
    );
    if (!response.ok) throw errorFromFailure(response.error, response.rawResponse);
    return response;
  };
}

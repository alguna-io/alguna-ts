import { AlgunaError } from "./errors.js";
import { algunaFetcher } from "./fetcher.js";
import { type logging, type PassthroughRequest, RUNTIME } from "./generated/core/index.js";
import { AlgunaApiEnvironment } from "./generated/environments.js";
import {
  AlgunaApiClient,
  type BaseIdempotentRequestOptions,
  type BaseRequestOptions,
} from "./generated/index.js";
import { idempotencyKeyHeader, retryAwareFetch, withRetries } from "./retry.js";

declare const __ALGUNA_SDK_VERSION__: string;

export interface AlgunaConfig {
  /**
   * Your API key ({id}.{secret}), or a function that returns it on every
   * request (e.g. a rotated secret).
   * @default process.env.ALGUNA_API_KEY
   */
  apiKey?: string | (() => string | Promise<string>);
  /**
   * The Alguna-Version header. Defaults to the version this SDK release was
   * generated against; pin it to stay on one version across SDK upgrades.
   * @example '2026-04-01'
   */
  apiVersion?: string;
  /** Timeout of each attempt, in milliseconds. @default 60000 */
  timeout?: number;
  /** @default 'https://api.alguna.io'; the sandbox is 'https://api.sandbox.alguna.io' */
  baseUrl?: string;
  /** Retries of a failed attempt that is safe to repeat (see the README); 0 turns retries off. @default 2 */
  maxRetries?: number;
  /** A custom `fetch`, e.g. to add tracing or a proxy. */
  fetch?: typeof fetch;
  /** Headers sent with every request. They override the SDK's own, including `User-Agent`. */
  headers?: Record<string, string>;
  /** Request and response logging; silent by default. The Authorization header is never logged. */
  logging?: logging.LogConfig | logging.Logger;
}

/** Per-request options, the optional last argument of every method. */
export type RequestOptions = BaseRequestOptions & BaseIdempotentRequestOptions;

// Generation replaces the token with the date of the spec this release is generated from.
const DEFAULT_API_VERSION = "2026-04-01";

// Browsers forbid scripts to set User-Agent; some ignore it and some fail the request.
const userAgent: Record<string, string> =
  RUNTIME.type === "browser" || RUNTIME.type === "web-worker"
    ? {}
    : { "User-Agent": `alguna-ts/${__ALGUNA_SDK_VERSION__}` };

/** The Alguna client: one field per API resource, e.g. `alguna.customers`. */
export class Alguna extends AlgunaApiClient {
  constructor(config: AlgunaConfig = {}) {
    const baseUrl = config.baseUrl ?? AlgunaApiEnvironment.Production;
    super({
      apiKey: apiKeySupplier(config.apiKey),
      apiVersion: apiVersionOf(config.apiVersion),
      baseUrl,
      timeoutInSeconds: (config.timeout ?? 60_000) / 1000,
      maxRetries: config.maxRetries,
      fetch: retryAwareFetch(config.fetch),
      logging: config.logging,
      headers: { ...userAgent, ...config.headers },
      fetcher: algunaFetcher(baseUrl),
    });
  }

  /**
   * Sends a raw request with the client's auth, headers, timeout and retries, for an endpoint
   * the SDK does not cover yet. It adds an Idempotency-Key as an endpoint method does. It
   * returns the plain `Response`, whatever its status.
   */
  override async fetch(
    input: Request | string | URL,
    init?: RequestInit,
    requestOptions?: PassthroughRequest.RequestOptions,
  ): Promise<Response> {
    // The generated passthrough reads the method, headers, body, signal and credentials from
    // `init`, or from the Request when there is no `init`; `requestOptions.headers` override the
    // headers.
    const request: RequestInit = init ?? (input instanceof Request ? input : {});
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(requestOptions?.headers ?? {})) headers.set(name, value);
    const target = {
      method: request.method ?? "GET",
      url: input instanceof Request ? input.url : String(input),
      baseUrl: String(this._options.baseUrl),
    };
    const options = {
      ...requestOptions,
      headers: { ...requestOptions?.headers, ...idempotencyKeyHeader(target, headers.get("idempotency-key")) },
      maxRetries: 0,
    };
    // Every attempt sends the body again, but a stream can be read only once and Node.js sends
    // one only with `duplex: "half"`. So read it into memory first: a Request's body is a stream.
    const sent: RequestInit = {
      method: request.method,
      headers: request.headers,
      body: request.body instanceof ReadableStream ? await new Response(request.body).arrayBuffer() : request.body,
      signal: request.signal,
      credentials: request.credentials,
    };
    // The passthrough rejects when no response arrives; hold that as a result to retry.
    const result = await withRetries(
      () => super.fetch(input, sent, options).then((response) => ({ response }), (error: unknown) => ({ error })),
      (attempt) => attempt,
      {
        maxRetries: requestOptions?.maxRetries ?? this._options.maxRetries,
        abortSignal: requestOptions?.abortSignal ?? request.signal ?? undefined,
      },
    );
    if ("error" in result) throw result.error;
    return result.response;
  }

  /** Safe to serialise: the API key is never part of the output. */
  toJSON(): { baseUrl: string; apiVersion: string } {
    return { baseUrl: String(this._options.baseUrl), apiVersion: String(this._options.apiVersion) };
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Alguna ${JSON.stringify({ ...this.toJSON(), apiKey: "[redacted]" })}`;
  }
}

/** `value`, or undefined when it is missing or only whitespace. */
const nonBlank = (value: string | undefined) => (value?.trim() ? value : undefined);

function missingApiKey(): never {
  throw new AlgunaError({
    message: "No API key. Pass `apiKey` to new Alguna() or set the ALGUNA_API_KEY environment variable.",
  });
}

/**
 * The key is held in a closure, not a property, so logging or serialising the
 * client never prints it.
 */
function apiKeySupplier(apiKey: AlgunaConfig["apiKey"]): () => string | Promise<string> {
  if (typeof apiKey === "function") return async () => nonBlank(await apiKey()) ?? missingApiKey();
  // `process` does not exist on Workers or Deno.
  const key = nonBlank(apiKey) ?? nonBlank(globalThis.process?.env?.ALGUNA_API_KEY) ?? missingApiKey();
  return () => key;
}

function apiVersionOf(apiVersion: string | undefined): string {
  if (apiVersion === undefined) return DEFAULT_API_VERSION;
  if (nonBlank(apiVersion) === undefined) {
    throw new AlgunaError({
      message: "apiVersion is empty. Omit it for the SDK's default, or pass a date such as '2026-04-01'.",
    });
  }
  return apiVersion;
}

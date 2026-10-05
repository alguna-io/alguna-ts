/**
 * Alguna SDK - Official TypeScript client
 *
 * Fern generates the client under `./generated` from the versioned Public API
 * spec. This layer adds the client defaults, typed errors, and the
 * Idempotency-Key and retry rules of retry.ts. Generation writes `types.ts`
 * and `webhooks.ts` from the generated code, and `identifiedByBody.ts` from the spec.
 * @packageDocumentation
 */

export { Alguna, type AlgunaConfig, type RequestOptions } from "./alguna.js";
export {
  AbortError,
  AlgunaError,
  type AlgunaErrorInit,
  ApiError,
  AuthenticationError,
  ConflictError,
  ConnectionError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TimeoutError,
  UnprocessableEntityError,
  ValidationError,
} from "./errors.js";
// Not `export type *`: the bundled .d.ts would still declare the enum constants
// (e.g. PaymentPayload.Status) as values the JS does not export.
export * from "./types.js";
export * as AlgunaApi from "./types.js";
export { type BinaryResponse, type logging, Page } from "./generated/core/index.js";
export type { AlgunaWebhookEvent, AlgunaWebhookEventType } from "./webhooks.js";

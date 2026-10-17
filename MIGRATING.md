# Upgrading from 0.3

- **Lists return a `Page`.** `const { data } = await x.list()` still works.
  `pagination` moved to `page.response.pagination`. `for await` walks every
  page. The API serves at most 100 items per page; a larger `limit` gets pages
  of 100, and the pager walks them all.
- **Error fields.** `ValidationError.fields`, `NotFoundError.resource` and
  `RateLimitError.retryAfter` are gone: the API never sent them. `message` is
  now the API's `detail` (or the gateway's `message` on a `401`). `code` comes
  from the response body only; the fixed per-class codes (`validation_error`,
  `not_found`, …) are gone. New: `body`. Error constructors take one options
  object.
- **One error hierarchy.** The generated `AlgunaApi.*Error` classes are not
  exported, and the method docs do not list them: they were never thrown. Catch
  `AlgunaError` and its subclasses from the package root. New:
  `PermissionDeniedError` (403), `ConflictError` (409),
  `UnprocessableEntityError` (422), `InternalServerError` (5xx),
  `ConnectionError`, `TimeoutError` and `AbortError`; `ApiError` now covers
  only other statuses. Errors carry `headers`.
- **Retries.** The SDK now retries a failed attempt when a retry is safe (see
  the README). Set `maxRetries: 0` to keep the 0.3 behaviour. `timeout` applies
  to each attempt and defaults to 60 s: with the default 2 retries, one call can
  take about 3 × `timeout` plus the waits between attempts.
- **Automatic idempotency keys.** Every request that is not a GET gets a
  generated `Idempotency-Key` when you pass none, also through `alguna.fetch()`.
  `events.ingest`, `credits.track` and `credits.check` get none: the API
  identifies their work by the body (see the README).
- **`events.ingest`** no longer accepts `idempotencyKey`. It is retried: the
  API removes duplicate events by `unique_id`.
- **PDF methods** return a `BinaryResponse`.
- **Webhook types.** `AlgunaWebhookEvent` and `AlgunaWebhookEventType` remain.
  The per-event interfaces (`PaymentWebhookData`, `SubscriptionWebhookData`,
  …) and the helper aliases (`IsoTimestamp`, `DecimalString`, `PaymentStatus`,
  …) are gone; use the generated payload types (`PaymentPayload`,
  `SubscriptionPayload`, …). The `hosted_flow.session.*` events are no longer
  in the union: they cannot be subscribed to. Optional fields are typed
  `field?: T | null`, and status enums follow the spec.
- **Type names follow the spec.** hey-api's per-operation types
  (`GetCustomerData`, `ListCustomersResponses`, `CreateCustomerErrors`, …) are
  gone. Use the schema types (`CustomerResponse`) and request types
  (`CreateCustomerRequest`, `ListCustomersRequest`). The resource client
  classes (`CustomersClient`, …) and the lowercase resource namespaces
  (`customers`, `events`, …) are not root exports.
- **Per-request options** now also take `timeoutInSeconds`, `maxRetries`,
  `headers` and `abortSignal`. The client `timeout` stays in milliseconds.
- **Transport.** Native `fetch` replaces axios; the package has no runtime
  dependencies. `baseUrl` must be an absolute URL.
- **Required query parameters are required in the types.** `customers.lookup`
  needs `alias`; `creditNotes.list` needs `customer_id`; eight `insights.*`
  methods need `date_range` (`billingsByCustomer`, `billingsByProduct`,
  `billingsOverTime`, `customersOverTime`, `revenueBreakdownOverTime`,
  `revenueByCustomer`, `revenueByProduct`, `revenueOverTime`). The API
  already rejected calls without them.
- **`apiKey` and `apiVersion` are optional.** The key falls back to
  `ALGUNA_API_KEY`; the version to the one this release targets.
- **Node.js 20 or later.** Generated idempotency keys use the global
  `crypto.randomUUID()`, which Node.js 18 does not expose by default.
- **New:** `alguna.tags.list` and `alguna.tags.get`; `alguna.fetch()` for raw
  requests with the SDK's auth, Idempotency-Key and retries. Unlike standard
  `fetch`, `alguna.fetch(request, init)` takes the method, headers and body from
  `init` alone when you pass `init`; the `Request`'s own are then ignored.

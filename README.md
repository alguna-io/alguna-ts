# @alguna/sdk

The official TypeScript SDK for the [Alguna API](https://alguna.com/docs): usage-based
billing, subscriptions, invoicing and payments. Upgrading from 0.3? Read
[MIGRATING.md](https://github.com/alguna-io/alguna-ts/blob/main/MIGRATING.md).

## Install

```bash
npm install @alguna/sdk
```

The SDK needs Node.js 20 or later, or another runtime with a global `fetch` and
`crypto.randomUUID()`, such as Deno, Bun or Cloudflare Workers. Use it on a server only: the
API key is a secret.

## Client

Create an API key in the dashboard under **Settings → Connections → Developers → API keys**.
A key looks like `<key_id>.<key_secret>`.

```typescript
import { Alguna } from "@alguna/sdk";

// With no options, the client reads the key from ALGUNA_API_KEY.
const alguna = new Alguna();

const sandbox = new Alguna({
  apiKey: process.env.ALGUNA_SANDBOX_API_KEY, // a string, or a function called on every request
  apiVersion: "2026-04-01", // default: the version this SDK release targets
  baseUrl: "https://api.sandbox.alguna.io", // default: https://api.alguna.io
  headers: { "X-Trace-Id": "abc" }, // sent on every request
  fetch: globalThis.fetch, // your own fetch, for example to add tracing
  logging: { level: "debug", silent: false }, // silent by default
});
```

`new Alguna()` throws an `AlgunaError` when it finds no key: where there is no
`process.env` (Workers, Deno), pass `apiKey`. Pin `apiVersion` to keep your integration on
one API version when you upgrade the package. The SDK sends
`User-Agent: alguna-ts/<version>` where the runtime allows it (not in browsers); a
`User-Agent` in `headers` replaces it. `console.log(alguna)` and `JSON.stringify(alguna)`
never print the API key.

## Requests

The client has one field per API resource (`alguna.customers`, `alguna.subscriptions`,
`alguna.invoices`, `alguna.wallets`, …) and one method per operation. The request and
response types are exported from the package root (`CreateCustomerRequest`,
`InvoiceResponse`) and under the `AlgunaApi` namespace.

```typescript
import { Alguna } from "@alguna/sdk";

const alguna = new Alguna();

const customer = await alguna.customers.create({
  name: "Acme Corp",
  currency: "USD",
  contacts: [{ email: "billing@acme.com", is_primary: true }],
});

const invoice = await alguna.invoices.create({
  customer_id: customer.id,
  currency: "USD",
  line_items: [{ description: "Onboarding", unit_price: "500.00", quantity: "1" }],
});

// A hosted customer portal session, where the customer can pay. It is valid for 1 hour.
const session = await alguna.portal.createSession({ customer_id: customer.id });
console.log(invoice.id, session.url);
```

Every method takes per-request options as its last argument: `idempotencyKey` (writes),
`timeoutInSeconds`, `maxRetries`, `headers` and `abortSignal`. `invoices.generatePdf`,
`quotes.getPdf` and `subscriptions.downloadPdf` return a `BinaryResponse`: read it with
`arrayBuffer()`, `blob()` or `stream()`.

For an endpoint the SDK does not cover yet, `alguna.fetch(path, init, options)` sends a raw
request with the client's auth, headers, timeout, Idempotency-Key and retries. It returns
the plain `Response`, whatever its status. When you pass `init`, the method, headers and body
come from `init` only, not from a `Request` you pass as `path`. A stream body, such as the
body of a `Request`, is read into memory before the first attempt, so that a retry can send
it again.

## Pagination

A list method returns a `Page`: `data` holds the items of the current page, and `response`
the full body, with `pagination`.

```typescript
import { Alguna } from "@alguna/sdk";

const alguna = new Alguna();

const page = await alguna.customers.list({ limit: 50 });
console.log(page.data.length, page.response.pagination); // { per_page, total_pages }

// The SDK gets the next page when you need it.
for await (const customer of await alguna.customers.list({ limit: 100 })) {
  console.log(customer.id);
}
```

The API sends at most the operation's `limit` maximum per page (100 for every list today).
Iteration stops at the first page with fewer items than `limit`, or than that maximum when
`limit` is larger. When the last page is exactly full, the SDK makes one more request, which
returns an empty page. To page by hand, use `page.hasNextPage()` and `page.getNextPage()`.

## Idempotency and retries

Every request that is not a GET sends an `Idempotency-Key`: your `idempotencyKey`, or a
UUID v4 that the SDK makes for the call. Every retry of the call sends the same key, so the
API returns the first result and does not do the write again. Pass your own key when you
repeat a call yourself, for example after a restart:

```typescript
import { Alguna } from "@alguna/sdk";

const alguna = new Alguna();

await alguna.customers.create(
  { name: "Acme Corp", currency: "USD" },
  { idempotencyKey: "signup-1234" },
);
```

The exceptions are `events.ingest`, `credits.track` and `credits.check`: they get no automatic
key, because the API identifies their work by the request body. It removes duplicate events by `unique_id`,
and `credits.track` draws credit once for the same `unique_id`s. A new key on each call would
replace that identity on `credits.track`, so a call sent again, for example by a queue, would
draw credit twice. The SDK retries these calls without a key. A key that you pass is sent on
every attempt. `credits.check` with `reserve` needs your key, because the key identifies the
hold.

A failed attempt is retried 2 times by default (3 attempts in total) when:

- the status is `408`, `429`, `502`, `503` or `504`;
- the status is `409` with a `Retry-After` header. The API sends this only while a request
  with the same key is still running. A `409` without `Retry-After` is a real conflict and is
  not retried;
- no response arrived: the connection was refused, reset or closed, or the attempt timed out.
  Workers, Deno and browsers do not say why a connection failed, so there a TLS error is
  retried too. This is safe: every retried request is a GET, carries an Idempotency-Key, or is
  one of the exceptions above.

The SDK does not retry after you abort a call through `abortSignal`. Between attempts it
waits 1 s, then 2 s, with random jitter of 10%. When the response has `Retry-After`
(seconds or an HTTP date), it waits that long instead, at most 60 s. Set `maxRetries` on the
client or on one call; `0` turns retries off.

## Timeouts

Each attempt times out after 60 s. Set `timeout` (in milliseconds) on the client, or
`timeoutInSeconds` on one call. A timed-out attempt is retried, so one call can take
3 × the timeout plus the waits. To limit the whole call, pass an `abortSignal`: when it
aborts, the SDK throws `AbortError`.

```typescript
import { Alguna } from "@alguna/sdk";

const alguna = new Alguna({ timeout: 10_000 });

// Each attempt may take 5 s; the call, with its retries, at most 20 s.
const customer = await alguna.customers.get("cus_123", {
  timeoutInSeconds: 5,
  abortSignal: AbortSignal.timeout(20_000),
});
console.log(customer.name);
```

## Errors

Every error that the SDK throws extends `AlgunaError`:

```typescript
import { Alguna, AlgunaError, NotFoundError, RateLimitError } from "@alguna/sdk";

const alguna = new Alguna();

try {
  await alguna.customers.get("nope");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log(error.message, error.statusCode, error.requestId);
  } else if (error instanceof RateLimitError) {
    console.log("retry in", error.headers["retry-after"], "seconds");
  } else if (error instanceof AlgunaError) {
    console.log(error.cause); // the underlying error, when there is one
  } else {
    throw error;
  }
}
```

| Error                      | When                                          |
| -------------------------- | --------------------------------------------- |
| `ValidationError`          | 400                                           |
| `AuthenticationError`      | 401                                           |
| `PermissionDeniedError`    | 403                                           |
| `NotFoundError`            | 404                                           |
| `ConflictError`            | 409                                           |
| `UnprocessableEntityError` | 422 (also a `ValidationError`)                |
| `RateLimitError`           | 429                                           |
| `InternalServerError`      | 5xx                                           |
| `ApiError`                 | any other unsuccessful status                 |
| `ConnectionError`          | no response: DNS, TLS, reset connection       |
| `TimeoutError`             | `timeout` exceeded (also a `ConnectionError`) |
| `AbortError`               | you aborted through `abortSignal`             |

An error from a response has `message`, `statusCode`, `requestId`, `code` (when the body has
one), `body` and `headers` (lower-cased). `message` is the body's `detail`, else its `title`,
else its `message`, else the HTTP status text. A connection failure has no `statusCode`; its
`cause` holds the original error. Give the `requestId` when you contact support.

## Webhooks

`AlgunaWebhookEvent` is a union of every webhook body. Narrow on `type` to get a typed
`data`:

```typescript
import type { AlgunaWebhookEvent } from "@alguna/sdk";

function handle(event: AlgunaWebhookEvent) {
  switch (event.type) {
    case "payment.created":
      console.log(event.data.amount); // a decimal string
      break;
    default:
      break; // new event types can arrive before you upgrade
  }
}
```

The SDK types a payload; it does not check that Alguna sent it. Alguna signs every delivery
with Svix. Before you trust a payload, verify its `svix-id`, `svix-timestamp` and
`svix-signature` headers against the raw request body with the Svix library:
`new Webhook(secret).verify(rawBody, headers)`. See
[Verifying signatures](https://alguna.com/docs/api-reference/v2/webhooks#verifying-signatures).

## Reference

- [TypeScript SDK guide](https://alguna.com/docs/api-reference/v2/sdks/typescript)
- [API reference](https://alguna.com/docs/api-reference/v2/overview)
- [Errors](https://alguna.com/docs/api-reference/v2/errors) and
  [idempotency](https://alguna.com/docs/api-reference/v2/idempotency)
- Support: support@alguna.io, with the `requestId` of the failed call

## About this repo

Alguna generates this SDK from the Alguna API spec in a private repository. Open issues
here. Alguna ports code changes to the generator, so a pull request here is not merged as is.

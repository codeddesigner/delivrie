---
title: Node.js SDK
group: SDKs and frameworks
order: 1
description: The official delivrie npm package for Node.js and TypeScript: install, configuration, results and errors, retries, every method, attachments and webhook verification.
---
The `delivrie` package is the official SDK for Node.js and TypeScript. It has no dependencies and uses only web-standard APIs (`fetch` and Web Crypto), so the same code runs on Node.js 18+, Bun, Deno, Cloudflare Workers and Vercel Edge. Source: [github.com/bysurce/delivrie](https://github.com/bysurce/delivrie/tree/main/sdk/node).

```bash npm
npm install delivrie
```

```bash pnpm
pnpm add delivrie
```

```bash yarn
yarn add delivrie
```

```bash bun
bun add delivrie
```

## Create a client

```ts
import { Delivrie } from "delivrie";

const delivrie = new Delivrie(process.env.DELIVRIE_API_KEY);
```

If you leave out the key, the client reads `DELIVRIE_API_KEY` from the environment. On edge runtimes without `process.env` (Cloudflare Workers, for example), pass the key from your bindings: `new Delivrie(env.DELIVRIE_API_KEY)`.

CommonJS works too: `const { Delivrie } = require("delivrie")`.

| Option | Default | What it does |
| --- | --- | --- |
| `baseUrl` | `https://delivrie.io/api` | API address |
| `timeout` | `30000` | Milliseconds before a request gives up |
| `maxRetries` | `2` | Retries for server errors and network failures |
| `fetch` | global `fetch` | Your own fetch, for tests or older runtimes |
| `headers` | none | Extra headers on every request |

```ts
const delivrie = new Delivrie(process.env.DELIVRIE_API_KEY, { timeout: 10_000, maxRetries: 3 });
```

## Send an email

```ts
const { data, error } = await delivrie.emails.send({
  from: "Acme <orders@mail.acme.com>",
  to: "ada@example.com",
  subject: "Your order is confirmed",
  html: "<p>Order <b>#1042</b> is on its way.</p>",
  replyTo: "support@acme.com",
  tags: [{ name: "category", value: "receipt" }],
}, { idempotencyKey: "order-1042-receipt" });
```

Field names match the API (`reply_to`, `scheduled_at`). `replyTo` and `scheduledAt` are accepted as aliases, and `scheduledAt` can be a `Date`. Every field is described in [Send an email](/docs/send-email).

## React Email

Pass a [React Email](https://react.email) component as `react`, and the SDK renders it to HTML and plain text for you:

```bash
npm install @react-email/components @react-email/render
```

```tsx
import { Welcome } from "./emails/welcome";

await delivrie.emails.send({
  from: "Acme <hello@mail.acme.com>",
  to: "ada@example.com",
  subject: "Welcome to Acme",
  react: <Welcome name="Ada" />,
});
```

`react` works in `emails.batch` too. If you also pass `html`, the `html` wins. Without `@react-email/render` installed, the call returns an error named `react_render_error` explaining what to install. On edge runtimes that can't load it at run time, render first with `await render(<Welcome />)` and pass the result as `html`.

## Results and errors

Every method resolves to `{ data, error }`, and exactly one of them is `null`. API errors never throw, so there's no `try`/`catch` to forget:

```ts
const { data, error } = await delivrie.emails.send(email);
if (error) {
  console.error(error.statusCode, error.name, error.message);
  return;
}
console.log(data.id);
```

`error.name` is the API's error name, like `validation_error` or `monthly_quota_exceeded` (see [Errors](/docs/errors)). Problems that never reach the API come back with `statusCode: 0` and the name `network_error`, `timeout` or `aborted`.

## Retries and idempotency

- `GET` and `DELETE` requests are retried up to `maxRetries` times on `5xx` responses and network failures, with exponential backoff.
- Sends (`POST`) are retried **only when you pass `idempotencyKey`**. The key makes the retry return the original email instead of sending a second one.

```ts
await delivrie.emails.send(email, { idempotencyKey: `welcome-${user.id}` });
```

Cancel a request with an `AbortSignal`: `delivrie.emails.send(email, { signal: AbortSignal.timeout(5000) })`.

## Attachments

Pass `content` as a base64 string, a Node.js `Buffer` or a `Uint8Array`; the SDK encodes bytes for you. Up to 40 MB per email.

```ts
import { readFile } from "node:fs/promises";

await delivrie.emails.send({
  from: "Billing <billing@mail.acme.com>",
  to: "ada@example.com",
  subject: "Your invoice",
  text: "Your invoice is attached.",
  attachments: [{ filename: "invoice-1042.pdf", content: await readFile("invoice-1042.pdf") }],
});
```

## Methods

| Resource | Methods |
| --- | --- |
| `emails` | `send(email, opts?)`, `batch(emails, opts?)`, `get(id)`, `list({ limit, offset, direction })`, `listReceived()`, `update(id, { scheduled_at })`, `cancel(id)`, `forward(id, { to, from, note })`, `attachments(id)`, `receivedAttachments(id)`, `share(id, { expires_in_hours })`, `unshare(id)` |
| `domains` | `create({ name })`, `get(id)`, `verify(id)`, `update(id, {...})`, `list()`, `remove(id)` |
| `apiKeys` | `create({ name, permission, domain_id })`, `list()`, `update(id, { name })`, `remove(id)` |
| `webhooks` | `create({ endpoint, events })`, `list()`, `update(id, {...})`, `remove(id)`, `deliveries(id)`, `test(id)`, `replay(deliveryId)`, `verify(opts)` |
| `contacts` | `create({...})`, `get(idOrEmail)`, `update(idOrEmail, {...})`, `list({...})`, `remove(idOrEmail)` |
| `contacts.imports` | `create({ csv \| contacts, segment_ids, columns, update_existing })`, `get(id)`, `list()` |
| `segments` | `create({ name })`, `get(id)`, `list()`, `update(id, { name })`, `remove(id)`, `contacts(id, { limit, offset })`, `addContacts(id, contacts)`, `removeContacts(id, contacts)` |
| `topics`, `contactProperties` | `list()` |
| `broadcasts` | `create({...})`, `get(id)`, `list()`, `update(id, {...})`, `duplicate(id, { name })`, `send(id, { scheduled_at })`, `cancel(id)`, `recipients(id, { status, limit })`, `links(id)`, `getContent(id)`, `editContent(id, { ops })`, `remove(id)` |
| `templates` | `create({...})`, `get(idOrAlias)`, `list()`, `update(idOrAlias, {...})`, `duplicate(idOrAlias)`, `publish(id)`, `getContent(idOrAlias)`, `editContent(idOrAlias, { ops })`, `remove(idOrAlias)` |
| `suppressions` | `add(email \| emails)`, `list()`, `remove(email)` |
| `events` | `send({ event, email, data })`, `list()` |
| `automations` | `list()`, `get(id)`, `create({...})`, `runs(id)`, `publish(id)`, `pause(id)`, `resume(id)`, `duplicate(id)`, `update(id, { name, reentry })`, `remove(id)` |
| `inbox.threads` | `list({...})`, `get(id)`, `update(id, {...})`, `reply(id, { text \| html })`, `runAgent(id)`, `notes(id)`, `addNote(id, body)` |
| `inbox.drafts` | `list({...})`, `create({...})`, `update(id, {...})`, `send(id)`, `remove(id)` |
| `inbox.labels` | `list()` |
| `inboxes` | `list()`, `create({ address, name })`, `get(idOrAddress)`, `update(idOrAddress, {...})`, `remove(idOrAddress)`, `agentRuns(idOrAddress)` |
| `ai` | `draft({ url, brief, target })`, `rewrite({ blocks, instruction })`, `subjects({ text })` |
| `metrics` | `get({ days, domain_id })` |
| `logs` | `list({ limit, offset })`, `get(id)` |
| `usage` | `get()` |

For anything not wrapped yet, call the API directly with the same auth, retries and error handling:

```ts
const { data, error } = await delivrie.request("GET", "/emails/received", undefined, { query: { limit: 10 } });
```

## Verify webhooks

`verifyWebhook` checks a webhook's signature against the raw request body and your `whsec_` secret, rejects requests older than five minutes, and returns the parsed event. It's `async` because it uses Web Crypto.

```ts
import { verifyWebhook } from "delivrie";

export async function POST(req: Request) {
  try {
    const event = await verifyWebhook({
      payload: await req.text(),
      headers: req.headers,
      secret: process.env.DELIVRIE_WEBHOOK_SECRET!,
    });
    // event.type, event.data
    return new Response("ok");
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
}
```

With Express, read the raw body with `express.raw({ type: "application/json" })` and pass `req.body` and `req.headers`. More in [Webhooks](/docs/webhooks).

## TypeScript

Types ship with the package: `SendEmailRequest`, `Email`, `Domain`, `Contact`, `WebhookEvent`, `DelivrieErrorResponse` and more.

```ts
import type { SendEmailRequest, WebhookEvent } from "delivrie";
```

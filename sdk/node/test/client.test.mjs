import { test } from "node:test";
import assert from "node:assert/strict";
import { Delivrie, VERSION } from "../dist/esm/index.js";

/** A fake fetch that replays queued responses and records every call. */
function mock(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const r = responses.length > 1 ? responses.shift() : responses[0];
    if (r instanceof Error) throw r;
    const { status = 200, body = {}, headers = {} } = r;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };
  fn.calls = calls;
  return fn;
}

test("send: auth header, JSON body, aliases normalised", async () => {
  const fetch = mock({ body: { id: "em_1" } });
  const d = new Delivrie("dlv_test", { fetch });
  const when = new Date("2026-12-01T09:00:00Z");
  const { data, error } = await d.emails.send({ from: "A <a@x.io>", to: "b@y.io", subject: "Hi", html: "<p>Hi</p>", replyTo: "r@x.io", scheduledAt: when });
  assert.equal(error, null);
  assert.deepEqual(data, { id: "em_1" });
  const c = fetch.calls[0];
  assert.equal(c.url, "https://delivrie.io/api/emails");
  assert.equal(c.init.method, "POST");
  assert.equal(c.headers.authorization, "Bearer dlv_test");
  assert.equal(c.headers["content-type"], "application/json");
  assert.equal(c.headers["user-agent"], `delivrie-node/${VERSION}`);
  assert.equal(c.body.reply_to, "r@x.io");
  assert.equal(c.body.scheduled_at, "2026-12-01T09:00:00.000Z");
  assert.ok(!("replyTo" in c.body) && !("scheduledAt" in c.body));
});

test("attachments: bytes are base64 encoded, strings passed through", async () => {
  const fetch = mock({ body: { id: "em_2" } });
  const d = new Delivrie("k", { fetch });
  const big = new Uint8Array(100_000).map((_, i) => i % 256);
  await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", text: "t", attachments: [
    { filename: "a.txt", content: new TextEncoder().encode("hello") },
    { filename: "b.txt", content: "aGk=" },
    { filename: "c.bin", content: big },
  ] });
  const att = fetch.calls[0].body.attachments;
  assert.equal(att[0].content, "aGVsbG8=");
  assert.equal(att[1].content, "aGk=");
  assert.equal(att[2].content, Buffer.from(big).toString("base64"));
});

test("API errors resolve to { data: null, error }", async () => {
  const fetch = mock({ status: 422, body: { statusCode: 422, name: "validation_error", message: "Bad from" } });
  const d = new Delivrie("k", { fetch, maxRetries: 2 });
  const r = await d.emails.send({ from: "x", to: "y", subject: "s", text: "t" });
  assert.equal(r.data, null);
  assert.deepEqual(r.error, { statusCode: 422, name: "validation_error", message: "Bad from" });
  assert.equal(fetch.calls.length, 1);
});

test("non-JSON error bodies get a sensible name", async () => {
  const d = new Delivrie("k", { fetch: mock({ status: 401, body: "nope" }) });
  const r = await d.domains.list();
  assert.equal(r.error.name, "invalid_api_key");
  assert.equal(r.error.message, "nope");
});

test("GET retries on 5xx then succeeds", async () => {
  const fetch = mock({ status: 503, body: {}, headers: { "retry-after": "0" } }, { body: { object: "list", data: [] } });
  const d = new Delivrie("k", { fetch });
  const r = await d.domains.list();
  assert.equal(r.error, null);
  assert.equal(fetch.calls.length, 2);
});

test("POST without idempotency key is never retried", async () => {
  const fetch = mock({ status: 500, body: { name: "application_error", message: "boom" } });
  const d = new Delivrie("k", { fetch });
  const r = await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", text: "t" });
  assert.equal(r.error.statusCode, 500);
  assert.equal(fetch.calls.length, 1);
});

test("POST with idempotency key retries on rate limit and sends the header", async () => {
  const fetch = mock(
    { status: 429, body: { statusCode: 429, name: "rate_limit_exceeded", message: "slow down" }, headers: { "retry-after": "0" } },
    { body: { id: "em_3" } },
  );
  const d = new Delivrie("k", { fetch });
  const r = await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", text: "t" }, { idempotencyKey: "order-42" });
  assert.deepEqual(r.data, { id: "em_3" });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].headers["idempotency-key"], "order-42");
});

test("quota 429s are not retried", async () => {
  const fetch = mock({ status: 429, body: { statusCode: 429, name: "monthly_quota_exceeded", message: "Upgrade" } });
  const d = new Delivrie("k", { fetch });
  const r = await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", text: "t" }, { idempotencyKey: "x" });
  assert.equal(r.error.name, "monthly_quota_exceeded");
  assert.equal(fetch.calls.length, 1);
});

test("network errors become error objects after retries", async () => {
  const fetch = mock(new TypeError("fetch failed"));
  const d = new Delivrie("k", { fetch, maxRetries: 1 });
  const r = await d.domains.list();
  assert.equal(r.error.name, "network_error");
  assert.equal(r.error.statusCode, 0);
  assert.equal(fetch.calls.length, 2);
});

test("timeouts", async () => {
  const fetch = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  const d = new Delivrie("k", { fetch, timeout: 20, maxRetries: 0 });
  const r = await d.usage.get();
  assert.equal(r.error.name, "timeout");
});

test("caller abort", async () => {
  const fetch = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const d = new Delivrie("k", { fetch });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10);
  const r = await d.emails.send({ from: "a", to: "b", subject: "s", text: "t" }, { signal: ctrl.signal });
  assert.equal(r.error.name, "aborted");
});

test("paths, query strings and encoding", async () => {
  const fetch = mock({ body: {} });
  const d = new Delivrie("k", { fetch, baseUrl: "http://localhost:9/api/" });
  await d.emails.list({ limit: 10, direction: "inbound" });
  await d.contacts.get("ada+x@example.com");
  await d.suppressions.add(["a@x.io", "b@x.io"]);
  await d.segments.addContacts("seg_1", ["a@x.io", { email: "b@x.io", first_name: "B" }]);
  await d.inbox.threads.reply("th_1", { text: "Thanks" });
  await d.webhooks.replay("del_1");
  const urls = fetch.calls.map((c) => `${c.init.method} ${c.url}`);
  assert.deepEqual(urls, [
    "GET http://localhost:9/api/emails?limit=10&direction=inbound",
    "GET http://localhost:9/api/contacts/ada%2Bx%40example.com",
    "POST http://localhost:9/api/suppressions",
    "POST http://localhost:9/api/segments/seg_1/contacts",
    "POST http://localhost:9/api/inbox/threads/th_1/reply",
    "POST http://localhost:9/api/webhook-deliveries/del_1/replay",
  ]);
  assert.deepEqual(fetch.calls[2].body, { emails: ["a@x.io", "b@x.io"] });
  assert.deepEqual(fetch.calls[3].body, { contacts: [{ email: "a@x.io" }, { email: "b@x.io", first_name: "B" }] });
});

test("API key from env, and a clear error without one", () => {
  const prev = process.env.DELIVRIE_API_KEY;
  process.env.DELIVRIE_API_KEY = "from_env";
  assert.doesNotThrow(() => new Delivrie(undefined, { fetch: mock({}) }));
  delete process.env.DELIVRIE_API_KEY;
  assert.throws(() => new Delivrie(undefined, { fetch: mock({}) }), /Missing API key/);
  if (prev !== undefined) process.env.DELIVRIE_API_KEY = prev;
});

test("react without @react-email/render installed returns a clear error and sends nothing", async () => {
  const fetch = mock({ body: { id: "x" } });
  const d = new Delivrie("k", { fetch });
  const r = await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", react: { type: "div", props: {} } });
  assert.equal(r.data, null);
  assert.equal(r.error.name, "react_render_error");
  assert.match(r.error.message, /npm install @react-email\/render/);
  assert.equal(fetch.calls.length, 0);
});

test("react is never sent to the API", async () => {
  const fetch = mock({ body: { id: "x" } });
  const d = new Delivrie("k", { fetch });
  await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", html: "<p>hi</p>", react: null });
  assert.ok(!("react" in fetch.calls[0].body));
});

test("new endpoints: paths, methods and bodies", async () => {
  const fetch = mock({ body: {} });
  const d = new Delivrie("k", { fetch });
  await d.broadcasts.duplicate("b1", { name: "Copy" });
  await d.broadcasts.links("b1");
  await d.broadcasts.recipients("b1", { status: "bounced", limit: 10 });
  await d.broadcasts.update("b1", { subject: "New" });
  await d.templates.editContent("welcome", { ops: [{ op: "delete", id: "x" }], summary: "s" });
  await d.templates.duplicate("welcome");
  await d.templates.remove("welcome");
  await d.apiKeys.update("k1", { name: "Prod" });
  await d.emails.receivedAttachments("e1");
  await d.emails.share("e1", { expires_in_hours: 48 });
  await d.segments.removeContacts("s1", ["a@b.com"]);
  await d.segments.contacts("s1", { limit: 5 });
  await d.contacts.imports.create({ csv: "email\na@b.com", segment_ids: ["s1"] });
  await d.contacts.imports.get("i1");
  await d.automations.duplicate("a1");
  await d.webhooks.remove("w1");
  await d.inboxes.list();
  await d.inbox.drafts.send("dr1");
  await d.ai.draft({ url: "https://acme.com", target: { type: "template", id: "welcome" } });
  const got = fetch.calls.map((c) => `${c.init.method} ${c.url.replace("https://delivrie.io/api", "")}`);
  assert.deepEqual(got, [
    "POST /broadcasts/b1/duplicate", "GET /broadcasts/b1/links", "GET /broadcasts/b1/recipients?status=bounced&limit=10", "PATCH /broadcasts/b1",
    "POST /templates/welcome/content", "POST /templates/welcome/duplicate", "DELETE /templates/welcome", "PATCH /api-keys/k1",
    "GET /emails/received/e1/attachments", "POST /emails/e1/share", "DELETE /segments/s1/contacts", "GET /segments/s1/contacts?limit=5",
    "POST /contacts/imports", "GET /contacts/imports/i1", "POST /automations/a1/duplicate", "DELETE /webhooks/w1", "GET /inboxes",
    "POST /inbox/drafts/dr1/send", "POST /ai/draft",
  ]);
  assert.deepEqual(fetch.calls[10].body, { contacts: ["a@b.com"] });
  assert.deepEqual(fetch.calls[0].body, { name: "Copy" });
});

test("attachments by URL pass through without content", async () => {
  const fetch = mock({ body: { id: "em_3" } });
  const d = new Delivrie("k", { fetch });
  await d.emails.send({ from: "a@x.io", to: "b@y.io", subject: "s", text: "t", attachments: [{ path: "https://acme.com/a.pdf" }] });
  assert.deepEqual(fetch.calls[0].body.attachments, [{ path: "https://acme.com/a.pdf" }]);
});

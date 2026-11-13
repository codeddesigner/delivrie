// Delivrie documentation. Used by the in-app Docs page and by "Ask Delivrie" (server-side retrieval).
export const DOCS = [
  { id: "getting-started", title: "Getting started", body: `Delivrie sends transactional and marketing email through a REST API, the dashboard and an MCP server for agents.

1. Create an API key in API keys. Keys start with dlv_ and are shown once, so copy it somewhere safe.
2. Add and verify a domain in Domains so you can send from your own address, for example orders@mail.yourcompany.com.
3. Send an email with POST /emails, passing from, to, subject and html or text.

Every request is authenticated with the header Authorization: Bearer dlv_your_key. The base URL is https://delivrie.io/api.` },
  { id: "send-email", title: "Send an email", body: `POST /emails sends one email. Body fields:
from (required) "Name <you@yourdomain.com>" from a verified domain.
to (required) one address or an array of up to 50.
subject (required unless you use a template).
html and/or text. If you only send html, Delivrie generates the plain-text part for you.
cc, bcc, reply_to: an address or array.
headers: an object of custom headers.
tags: [{ "name": "category", "value": "transactional" }] (letters, numbers, _ and - only).
attachments: [{ "filename": "invoice.pdf", "content": "<base64>" }] up to 40 MB total.
scheduled_at: an ISO 8601 date, or a phrase like "in 1 hour" or "tomorrow at 9am" (UTC), up to 30 days ahead.
template: { "id": "order-confirmation", "variables": { "first_name": "Ada" } } to send a published template by id or alias.

Send an Idempotency-Key header to make retries safe. The response is { "id": "<email id>" }. POST /emails/batch takes an array of up to 100 emails.` },
  { id: "test-mode", title: "Test addresses", body: `Send to these addresses to test your integration without touching your sending reputation. They go through the full pipeline and fire real events and webhooks.
delivered@test.delivrie.io is accepted and delivered.
bounced@test.delivrie.io hard-bounces, so you can test bounce handling.
complained@test.delivrie.io is delivered and then marked as spam.
suppressed@test.delivrie.io behaves like an address on a provider suppression list.
Test sends count toward your plan like any other email. They are never added to your own suppression list.` },
  { id: "email-status", title: "Email statuses and events", body: `Each email moves through statuses: queued, scheduled, sent, delivered, delivery_delayed, opened, clicked, bounced, complained, failed, canceled and suppressed.
sent means Delivrie's mail servers accepted the message for delivery. delivered means the recipient's mail server accepted it. opened and clicked need open or click tracking turned on for the sending domain.
bounced means the receiving server rejected the message. Permanent bounces add the address to your suppression list automatically. complained means the recipient marked it as spam; the address is suppressed and the contact unsubscribed.
GET /emails/:id returns an email and its events. PATCH /emails/:id with scheduled_at reschedules, POST /emails/:id/cancel cancels a scheduled email.` },
  { id: "domains", title: "Domains and DNS", body: `Add a domain in Domains or with POST /domains { "name": "mail.example.com", "region": "eu-west-1" }. Use a subdomain like mail.example.com to protect your root domain's reputation.
Delivrie gives you DNS records to add at your DNS provider:
DKIM: a TXT record at delivrie._domainkey containing your public key. This signs your mail.
SPF / return path: an MX and a TXT record on the send subdomain so bounces come back to Delivrie and SPF aligns.
DMARC (optional but recommended): a TXT record at _dmarc such as v=DMARC1; p=none;
Receiving (optional): an MX record on the domain pointing at the inbound server.
Verification runs in the background. DNS changes can take a few minutes and up to 72 hours depending on your provider. Click Verify DNS records to check again.` },
  { id: "domain-not-verifying", title: "Why isn't my domain verifying?", body: `Common causes:
The record name is doubled. Many DNS providers append your domain automatically, so enter delivrie._domainkey, not delivrie._domainkey.example.com.
The TXT value was split or quoted incorrectly. Paste the whole value starting with p= as one string.
A conflicting SPF record. You can only have one SPF TXT record per name; the send subdomain needs its own.
Cloudflare proxying. MX and TXT records cannot be proxied; make sure they are DNS only.
Propagation. Wait a few minutes and use Verify DNS records. Delivrie also re-checks pending domains automatically.` },
  { id: "dmarc", title: "How do I set up DMARC?", body: `DMARC tells mailbox providers what to do with mail that fails SPF or DKIM. Add a TXT record at _dmarc.yourdomain.com. Start with v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com to monitor, then move to p=quarantine and finally p=reject once reports look clean. Gmail and Yahoo require a DMARC record for bulk senders.` },
  { id: "deliverability", title: "Deliverability guide", body: `Bounces happen when the receiving server rejects a message: the address doesn't exist, the mailbox is full, or the server blocks you. Complaints happen when a recipient marks your email as spam.
Keep your bounce rate under 4% and your complaint rate under 0.08%. Above those thresholds mailbox providers start blocking your mail, and Delivrie may pause sending to protect your domain's reputation.
Verify addresses at sign-up, honour unsubscribes, only email people who opted in, send from a subdomain, add a plain-text part, and set up DKIM, SPF and DMARC.` },
  { id: "suppressions", title: "Suppression list", body: `Addresses that hard-bounce or complain are added to your team's suppression list and skipped on future sends, which protects your reputation. Add or remove addresses with POST /suppressions and DELETE /suppressions/:email.` },
  { id: "api-keys", title: "API keys", body: `Create keys in API keys. Full access keys can call every endpoint. Sending access keys can only send emails, optionally restricted to one domain. Keys are hashed when stored and shown only once. Revoke a key by deleting it.` },
  { id: "webhooks", title: "Webhooks", body: `Add an HTTPS endpoint in Webhooks and choose events: email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.opened, email.clicked, email.failed, email.received, contact.created, contact.updated, contact.deleted, domain.created, domain.updated.
Each request is signed using the Standard Webhooks scheme with the headers webhook-id, webhook-timestamp and webhook-signature. Compute HMAC-SHA256 over id.timestamp.body using the base64-decoded part of your whsec_ secret, then compare with the v1 signature.
Failed deliveries are retried with backoff for up to 72 hours. You can replay any attempt from the dashboard.` },
  { id: "templates", title: "Templates", body: `Templates are reusable emails with variables. Write {{{first_name}}} in the subject or body; give each variable a type and a fallback used when the value is missing. Publish to make a version live for API sends, then send with template: { "id": "your-alias", "variables": { ... } }. Every publish is kept in version history and reverting creates a new version.` },
  { id: "broadcasts", title: "Broadcasts", body: `Broadcasts send one email to a segment. Pick a verified sender, a segment and optionally a topic so recipients can opt out of that kind of email. Use {{first_name}} or any contact property, with fallbacks. Every broadcast should include an unsubscribe footer; Delivrie also adds one-click List-Unsubscribe headers. Send a test to up to five inboxes, then send now or schedule.` },
  { id: "contacts", title: "Contacts, segments and topics", body: `Contacts belong to your team and can be added by hand, imported from CSV or created with POST /contacts. Properties store custom data like plan or city. Segments group contacts for broadcasts. Topics power the hosted unsubscribe page so people can opt out of one kind of email without leaving entirely.` },
  { id: "mcp", title: "Can agents send through MCP?", body: `Yes. Delivrie runs a remote MCP server at https://delivrie.io/api/mcp with 64 tools: sending, the Inbox, automations and events, domains, contacts, segments, broadcasts, templates, webhooks, suppressions, metrics and logs. Add it to Claude Code with: claude mcp add --transport http delivrie https://delivrie.io/api/mcp. A Delivrie page opens where you pick the team and approve the scopes (send, read, manage); the app then shows under Settings → Connected apps, where you can revoke it. Clients without OAuth can send an API key as Authorization: Bearer dlv_your_key.` },
  { id: "cors", title: "How do I fix CORS errors?", body: `Never call the Delivrie API directly from a browser: it would expose your API key to anyone who opens the page. Call it from your server, a serverless function or an edge function, and keep the key in an environment variable.` },
  { id: "smtp", title: "SMTP", body: `Send through Delivrie from anything that speaks SMTP: WordPress, Laravel, Django, Rails, Ghost, Supabase Auth, Nodemailer and most other frameworks and plugins.
Host: smtp.delivrie.io
Port: 465 (SSL/TLS). Use 2465 if your host blocks 465.
Username: delivrie
Password: a Delivrie API key (dlv_…). A sending-only key is enough.
Encryption: SSL/TLS (sometimes called "implicit TLS" or "SMTPS"). STARTTLS on 587 is not supported.

Mail sent over SMTP goes through the same pipeline as POST /emails: the From address must be on a verified domain, your plan's limits apply, and every message appears in Emails with its events and webhooks. To, Cc and Bcc come from the message and the SMTP envelope, attachments are kept (up to 40 MB), and custom X- headers and List-Unsubscribe are passed through.

Add an X-Delivrie-Tags header to tag a message, for example X-Delivrie-Tags: source=wordpress, order. Each message is sent once even if your app retries, based on its Message-ID.

If the relay replies 535, the API key is wrong or was deleted. 550 means the API rejected the message (for example an unverified From domain) and the reply says why. 452 means a sending limit was reached, so your app should retry later. After five failed logins from one address, logins from that address are blocked for 15 minutes.` },
  { id: "limits", title: "Plans and limits", body: `Free includes 6,000 emails a month with a limit of 200 a day, 1 custom domain and 1 webhook endpoint. Pro includes 20,000 emails a month, 10 domains and 10 webhooks with no daily limit. Scale includes 100,000 emails a month and 1,000 domains.
On Pro and Scale, emails over the allowance keep sending and are billed per 1,000 at the end of the month. Set a spending cap in Billing to stop sending instead; the API then returns 429 spending_cap_reached.
On Free, sending pauses at the limit with 429 daily_quota_exceeded or monthly_quota_exceeded. Pay-as-you-go credits keep you sending: one credit is one email, credits never expire, and they are used after the free allowance runs out.` },
  { id: "errors", title: "Errors", body: `Errors return JSON with statusCode, name and message. 401 missing_api_key or invalid_api_key, 403 restricted_api_key, 404 not_found, 409 conflict, 422 validation_error (for example an unverified from domain), 429 daily_quota_exceeded, monthly_quota_exceeded or spending_cap_reached, 403 plan_limit_reached when you hit your plan's domain or webhook limit, 503 sending_not_configured. Every API call appears in Logs with its request and response body.` },
];

export function searchDocs(q, n = 3) {
  const words = String(q || "").toLowerCase().match(/[a-z0-9_]+/g) || [];
  const stop = new Set(["the", "a", "an", "is", "my", "i", "how", "do", "to", "of", "and", "or", "what", "why", "can", "in", "for", "on", "with", "it", "does", "are"]);
  const terms = words.filter((w) => !stop.has(w) && w.length > 1);
  return DOCS.map((d) => {
    const t = d.title.toLowerCase(), b = d.body.toLowerCase();
    let score = 0;
    for (const w of terms) {
      if (t.includes(w)) score += 4;
      const hits = b.split(w).length - 1;
      score += Math.min(hits, 5);
      if (w.endsWith("s") && b.includes(w.slice(0, -1))) score += 1;
    }
    return { doc: d, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.doc);
}

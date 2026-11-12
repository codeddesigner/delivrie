// API reference data for the docs. Mirrors the routes in supabase/functions/delivrie/index.ts.
// p: [name, type, required, description, default?]
const ID = (what) => [["id", "string", true, `The ${what} id.`]];
const PAGE = [["limit", "number", false, "Results per page, 1 to 100.", "50"], ["offset", "number", false, "How many results to skip.", "0"]];
const FULL = "Needs a full access key.";

export const API = [
  { group: "Emails", items: [
    { slug: "send-email", m: "POST", path: "/emails", title: "Send email", tool: "send_email", scope: "Sending or full access",
      desc: "Send a transactional email. Returns the email id immediately; delivery events arrive through webhooks and the Logs page.",
      headers: [["Authorization", "string", true, "Bearer token. Any API key works, including sending-only keys."], ["Idempotency-Key", "string", false, "Unique key for this request. Retrying with the same key returns the original email instead of sending again."]],
      body: [
        ["from", "string", true, "Sender address on a verified domain. Use \"Name <email@domain>\" to set a display name."],
        ["to", "string | string[]", true, "Recipient address or up to 50 addresses."],
        ["subject", "string", true, "Email subject line. Optional when you send a template."],
        ["html", "string", false, "HTML body. Provide html, text or template."],
        ["text", "string", false, "Plain-text body. Generated from html when omitted.", "auto"],
        ["cc", "string | string[]", false, "Carbon-copy recipients."],
        ["bcc", "string | string[]", false, "Blind carbon-copy recipients."],
        ["reply_to", "string | string[]", false, "Where replies go."],
        ["template", "object", false, "Send a published template: { \"id\": \"alias-or-id\", \"variables\": { … } }."],
        ["scheduled_at", "string", false, "ISO 8601 date or a phrase like \"in 1 hour\" or \"tomorrow at 9am\" (UTC). Up to 30 days ahead."],
        ["tags", "object[]", false, "Name/value pairs attached to the email and its webhook events. Letters, numbers, _ and - only."],
        ["headers", "object", false, "Custom email headers."],
        ["attachments", "object[]", false, "{ filename, content } with base64 content. Up to 40 MB per email."],
      ],
      example: { from: "Kora <orders@kora.ng>", to: ["ada@example.com"], subject: "Your order is confirmed", html: "<p>Thanks for your order!</p>", tags: [{ name: "category", value: "receipt" }] },
      response: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" },
      errors: [["401", "missing_api_key", "No Authorization header was sent."], ["401", "invalid_api_key", "The key doesn't exist or was deleted."], ["403", "invalid_from_address", "The from domain isn't verified on this team."], ["422", "validation_error", "A required field is missing or malformed."], ["429", "daily_quota_exceeded", "Free plan limit of 100 emails a day reached."], ["429", "monthly_quota_exceeded", "Free plan monthly limit reached and no credits left."], ["429", "spending_cap_reached", "This send would take overage past your spending cap."]] },
    { slug: "send-batch", m: "POST", path: "/emails/batch", title: "Send batch", tool: "send_batch", scope: "Sending or full access",
      desc: "Send up to 100 emails in one request, each with its own recipients and content. Batch emails can't have attachments or scheduled_at.",
      headers: [["Authorization", "string", true, "Bearer token."], ["Idempotency-Key", "string", false, "Makes the whole batch safe to retry."]],
      body: [["[ ]", "object[]", true, "An array of up to 100 email objects with the same fields as Send email."]],
      example: [{ from: "Kora <orders@kora.ng>", to: ["ada@example.com"], subject: "Receipt", html: "<p>Order 1</p>" }, { from: "Kora <orders@kora.ng>", to: ["tobi@example.com"], subject: "Receipt", html: "<p>Order 2</p>" }],
      response: { data: [{ id: "4ef9a417-…" }, { id: "9a1c22b0-…" }] },
      errors: [["422", "validation_error", "More than 100 emails, or an email uses attachments or scheduled_at."]] },
    { slug: "retrieve-email", m: "GET", path: "/emails/:id", title: "Retrieve email", tool: "get_email", scope: FULL,
      desc: "Get one email with its status and every delivery event.", params: ID("email"),
      response: { object: "email", id: "4ef9a417-…", from: "Kora <orders@kora.ng>", to: ["ada@example.com"], subject: "Your order is confirmed", last_event: "delivered", created_at: "2026-11-12T09:12:04Z", events: [{ type: "sent" }, { type: "delivered" }] } },
    { slug: "update-email", m: "PATCH", path: "/emails/:id", title: "Update email", scope: "Sending or full access",
      desc: "Reschedule an email that hasn't been sent yet.", params: ID("email"),
      body: [["scheduled_at", "string", true, "New send time: ISO 8601 or a phrase like \"in 2 hours\"."]],
      example: { scheduled_at: "tomorrow at 9am" }, response: { object: "email", id: "4ef9a417-…" },
      errors: [["422", "validation_error", "Only scheduled emails can be updated."]] },
    { slug: "cancel-email", m: "POST", path: "/emails/:id/cancel", title: "Cancel email", tool: "cancel_email", scope: "Sending or full access",
      desc: "Cancel a scheduled email before it sends.", params: ID("email"), response: { object: "email", id: "4ef9a417-…" } },
    { slug: "list-emails", m: "GET", path: "/emails", title: "List emails", tool: "list_emails", scope: FULL,
      desc: "List sent emails, newest first.", query: [...PAGE, ["direction", "string", false, "outbound or inbound.", "outbound"]],
      response: { object: "list", data: [{ id: "4ef9a417-…", subject: "Your order is confirmed", last_event: "delivered" }], has_more: false } },
  ]},
  { group: "Domains", items: [
    { slug: "create-domain", m: "POST", path: "/domains", title: "Create domain", tool: "create_domain", scope: FULL,
      desc: "Add a sending domain. The response includes the DNS records to add at your DNS provider.",
      body: [["name", "string", true, "The domain or subdomain, for example mail.kora.ng."], ["region", "string", false, "Sending region.", "eu-west-1"], ["return_path", "string", false, "Subdomain used for bounces and SPF.", "send"], ["click_tracking", "boolean", false, "Rewrite links to track clicks.", "false"], ["open_tracking", "boolean", false, "Add a tracking pixel.", "false"]],
      example: { name: "mail.kora.ng", region: "eu-west-1" },
      response: { object: "domain", id: "d91e…", name: "mail.kora.ng", status: "pending", records: [{ record: "DKIM", type: "TXT", name: "delivrie._domainkey.mail", status: "pending" }] },
      errors: [["403", "plan_limit_reached", "Your plan's domain limit is reached."], ["422", "validation_error", "The domain name isn't valid or is already added."]] },
    { slug: "retrieve-domain", m: "GET", path: "/domains/:id", title: "Retrieve domain", scope: FULL, desc: "Get a domain with its DNS records and their status.", params: ID("domain"), response: { object: "domain", id: "d91e…", name: "mail.kora.ng", status: "verified" } },
    { slug: "verify-domain", m: "POST", path: "/domains/:id/verify", title: "Verify domain", tool: "verify_domain", scope: FULL, desc: "Check the DNS records again. Verification usually completes within minutes of the records going live.", params: ID("domain"), response: { object: "domain", id: "d91e…", status: "verified" } },
    { slug: "update-domain", m: "PATCH", path: "/domains/:id", title: "Update domain", scope: FULL, desc: "Change tracking, TLS or the return path.", params: ID("domain"),
      body: [["click_tracking", "boolean", false, "Track link clicks."], ["open_tracking", "boolean", false, "Track opens."], ["tls", "string", false, "opportunistic or enforced."], ["return_path", "string", false, "Bounce subdomain label."]], example: { open_tracking: true }, response: { object: "domain", id: "d91e…" } },
    { slug: "list-domains", m: "GET", path: "/domains", title: "List domains", tool: "list_domains", scope: FULL, desc: "List the team's domains.", response: { object: "list", data: [{ id: "d91e…", name: "mail.kora.ng", status: "verified" }] } },
    { slug: "delete-domain", m: "DELETE", path: "/domains/:id", title: "Delete domain", scope: FULL, desc: "Remove a domain. Emails can no longer be sent from it.", params: ID("domain"), response: { object: "domain", id: "d91e…", deleted: true } },
  ]},
  { group: "API keys", items: [
    { slug: "create-api-key", m: "POST", path: "/api-keys", title: "Create API key", tool: "create_api_key", scope: FULL, desc: "Create a key. The token is returned once, so store it somewhere safe.",
      body: [["name", "string", true, "A name to recognise the key."], ["permission", "string", false, "full_access or sending_access.", "full_access"], ["domain_id", "string", false, "Limit a sending key to one domain."]],
      example: { name: "Production", permission: "sending_access" }, response: { id: "k_31…", token: "dlv_••••••••" } },
    { slug: "list-api-keys", m: "GET", path: "/api-keys", title: "List API keys", tool: "list_api_keys", scope: FULL, desc: "List keys. Tokens are never shown again.", response: { object: "list", data: [{ id: "k_31…", name: "Production", prefix: "dlv_a1b2", permission: "sending" }] } },
    { slug: "delete-api-key", m: "DELETE", path: "/api-keys/:id", title: "Delete API key", scope: FULL, desc: "Revoke a key immediately.", params: ID("API key"), response: { object: "api_key", id: "k_31…", deleted: true } },
  ]},
  { group: "Webhooks", items: [
    { slug: "create-webhook", m: "POST", path: "/webhooks", title: "Create webhook", tool: "create_webhook", scope: FULL, desc: "Send events to an HTTPS endpoint. Each payload is signed; failed deliveries are retried with backoff.",
      body: [["endpoint", "string", true, "An https:// URL."], ["events", "string[]", true, "Events to send, for example email.delivered and email.bounced."]],
      example: { endpoint: "https://kora.ng/hooks/delivrie", events: ["email.delivered", "email.bounced", "email.complained"] }, response: { object: "webhook", id: "w_8c…", signing_secret: "whsec_••••" },
      errors: [["403", "plan_limit_reached", "Your plan's webhook limit is reached."]] },
    { slug: "list-webhooks", m: "GET", path: "/webhooks", title: "List webhooks", scope: FULL, desc: "List webhook endpoints.", response: { object: "list", data: [{ id: "w_8c…", endpoint: "https://kora.ng/hooks/delivrie", status: "enabled" }] } },
    { slug: "webhook-events", m: "GET", path: "/webhooks/:id/events", title: "List deliveries", tool: "list_webhook_events", scope: FULL, desc: "The last 100 delivery attempts for an endpoint, with status codes.", params: ID("webhook"), response: { object: "list", data: [{ event_type: "email.delivered", status_code: 200, attempts: 1, delivered: true }] } },
    { slug: "test-webhook", m: "POST", path: "/webhooks/:id/test", title: "Send test event", scope: FULL, desc: "Send a sample event to the endpoint and return the delivery attempt.", params: ID("webhook"), response: { id: "wd_5…", event_type: "email.delivered", status_code: 200, attempts: 1, delivered: true } },
    { slug: "replay-delivery", m: "POST", path: "/webhook-deliveries/:id/replay", title: "Replay delivery", scope: FULL, desc: "Send a past delivery again and return the new attempt.", params: ID("delivery"), response: { id: "wd_5…", status_code: 200, attempts: 2, delivered: true } },
  ]},
  { group: "Contacts", items: [
    { slug: "create-contact", m: "POST", path: "/contacts", title: "Create contact", tool: "create_contact", scope: FULL, desc: "Create a contact, or update it if the email already exists.",
      body: [["email", "string", true, "Contact email."], ["first_name", "string", false, "First name."], ["last_name", "string", false, "Last name."], ["properties", "object", false, "Custom properties."], ["segments", "string[]", false, "Segment ids to add the contact to."]],
      example: { email: "ada@example.com", first_name: "Ada", properties: { plan: "pro" } }, response: { object: "contact", id: "c_12…" } },
    { slug: "list-contacts", m: "GET", path: "/contacts", title: "List contacts", tool: "list_contacts", scope: FULL, desc: "List contacts, newest first.", query: [...PAGE, ["created_after", "string", false, "ISO date, or today."]], response: { object: "list", data: [{ id: "c_12…", email: "ada@example.com" }], has_more: false } },
    { slug: "retrieve-contact", m: "GET", path: "/contacts/:id", title: "Retrieve contact", scope: FULL, desc: "Get a contact by id or email.", params: [["id", "string", true, "Contact id or email address."]], response: { object: "contact", id: "c_12…", email: "ada@example.com", unsubscribed: false } },
    { slug: "update-contact", m: "PATCH", path: "/contacts/:id", title: "Update contact", scope: FULL, desc: "Update names, properties or the unsubscribed flag.", params: [["id", "string", true, "Contact id or email address."]], body: [["first_name", "string", false, "First name."], ["last_name", "string", false, "Last name."], ["unsubscribed", "boolean", false, "Stop broadcasts to this contact."], ["properties", "object", false, "Merged into existing properties."]], example: { unsubscribed: true }, response: { object: "contact", id: "c_12…" } },
    { slug: "delete-contact", m: "DELETE", path: "/contacts/:id", title: "Delete contact", scope: FULL, desc: "Delete a contact.", params: [["id", "string", true, "Contact id or email address."]], response: { object: "contact", id: "c_12…", deleted: true } },
    { slug: "add-to-segment", m: "POST", path: "/segments/:id/contacts", title: "Add to segment", scope: FULL, desc: "Add contacts to a segment, creating any that don't exist.", params: ID("segment"), body: [["contacts", "string[] | object[]", true, "Emails or contact objects."]], example: { contacts: ["ada@example.com", "tobi@example.com"] }, response: { object: "segment", id: "s_4…", added: 2 } },
  ]},
  { group: "Broadcasts", items: [
    { slug: "create-broadcast", m: "POST", path: "/broadcasts", title: "Create broadcast", tool: "create_broadcast", scope: FULL, desc: "Create a broadcast draft. Nothing sends until you call Send broadcast.",
      body: [["from", "string", true, "Sender on a verified domain."], ["subject", "string", true, "Subject line."], ["segment_id", "string", true, "Who receives it."], ["html", "string", false, "HTML body. Include an unsubscribe link with {{{unsubscribe_url}}}."], ["topic_id", "string", false, "Topic people can opt out of."], ["name", "string", false, "Internal name."]],
      example: { from: "Kora <news@kora.ng>", subject: "March at Kora", segment_id: "s_4…", html: "<p>Hi {{{first_name|there}}}</p>" }, response: { object: "broadcast", id: "b_7…" } },
    { slug: "send-broadcast", m: "POST", path: "/broadcasts/:id/send", title: "Send broadcast", tool: "send_broadcast", scope: FULL, desc: "Send now, or schedule with scheduled_at.", params: ID("broadcast"), body: [["scheduled_at", "string", false, "ISO 8601 date to schedule."]], example: { scheduled_at: "2026-11-20T08:00:00Z" }, response: { object: "broadcast", id: "b_7…", status: "scheduled", recipients: 3240 } },
    { slug: "cancel-broadcast", m: "POST", path: "/broadcasts/:id/cancel", title: "Cancel broadcast", scope: FULL, desc: "Move a scheduled broadcast back to draft.", params: ID("broadcast"), response: { object: "broadcast", id: "b_7…", status: "draft" } },
    { slug: "list-broadcasts", m: "GET", path: "/broadcasts", title: "List broadcasts", scope: FULL, desc: "List broadcasts.", response: { object: "list", data: [{ id: "b_7…", name: "March at Kora", status: "sent" }] } },
  ]},
  { group: "Templates", items: [
    { slug: "create-template", m: "POST", path: "/templates", title: "Create template", tool: "create_template", scope: FULL, desc: "Create a template. Publish it before sending it from the API.",
      body: [["name", "string", true, "Template name."], ["alias", "string", false, "Stable name to send by, like order-confirmation."], ["subject", "string", false, "Subject with {{{variables}}}."], ["html", "string", false, "HTML body."], ["from", "string", false, "Default sender."]],
      example: { name: "Order confirmation", alias: "order-confirmation", subject: "Order {{{order_id}}} confirmed", html: "<p>Hi {{{first_name}}}</p>" }, response: { object: "template", id: "t_2…" } },
    { slug: "publish-template", m: "POST", path: "/templates/:id/publish", title: "Publish template", scope: FULL, desc: "Make the current draft the live version. Every publish is kept in version history.", params: [["id", "string", true, "Template id or alias."]], response: { object: "template", id: "t_2…", version: 3, warnings: [] } },
    { slug: "list-templates", m: "GET", path: "/templates", title: "List templates", tool: "list_templates", scope: FULL, desc: "List templates.", response: { object: "list", data: [{ id: "t_2…", name: "Order confirmation", alias: "order-confirmation", status: "published" }] } },
  ]},
  { group: "Suppressions", items: [
    { slug: "add-suppression", m: "POST", path: "/suppressions", title: "Add suppression", tool: "add_suppression", scope: FULL, desc: "Stop sending to one or more addresses.", body: [["email", "string | string[]", true, "Address or addresses."]], example: { email: "old@example.com" }, response: { object: "suppression", added: 1 } },
    { slug: "list-suppressions", m: "GET", path: "/suppressions", title: "List suppressions", tool: "list_suppressions", scope: FULL, desc: "Up to 1,000 suppressed addresses with the reason.", response: { object: "list", data: [{ email: "old@example.com", reason: "bounce" }] } },
    { slug: "delete-suppression", m: "DELETE", path: "/suppressions/:email", title: "Remove suppression", scope: FULL, desc: "Allow sending to an address again.", params: [["email", "string", true, "The suppressed address."]], response: { deleted: true } },
  ]},
  { group: "Metrics & logs", items: [
    { slug: "metrics", m: "GET", path: "/metrics", title: "Get metrics", tool: "get_metrics", scope: FULL, desc: "Daily totals and rates for delivery, opens, clicks, bounces and complaints.", query: [["days", "number", false, "Days to include, up to 90.", "15"], ["domain_id", "string", false, "Only one domain."]], response: { totals: { sent: 17402, delivered: 17247, bounced: 104, complained: 3 }, rates: { delivery: 0.991, bounce: 0.006, complaint: 0.0002 } } },
    { slug: "list-logs", m: "GET", path: "/logs", title: "List logs", scope: FULL, desc: "Every API request, newest first.", query: PAGE, response: { object: "list", data: [{ id: "l_1…", method: "POST", endpoint: "/emails", status: 200 }] } },
    { slug: "retrieve-log", m: "GET", path: "/logs/:id", title: "Retrieve log", tool: "get_log", scope: FULL, desc: "One request with its request and response bodies.", params: ID("log"), response: { id: "l_1…", method: "POST", endpoint: "/emails", status: 200, request_body: {}, response_body: {} } },
  ]},
];
export const ALL_ENDPOINTS = API.flatMap((g) => g.items.map((e) => ({ ...e, group: g.group })));
export const METHOD_COLOR = { GET: "#4c8df6", POST: "#3fa672", PATCH: "#e2b400", DELETE: "#e5484d" };

// Code samples for an endpoint, as plain REST calls.
export function samples(e, base) {
  const url = base + e.path.replace(/:(\w+)/g, (_m, k) => k === "id" ? "4ef9a417" : k === "email" ? "old@example.com" : k);
  const body = e.example ? JSON.stringify(e.example, null, 2) : null;
  const ind = (s, n) => s.split("\n").join("\n" + " ".repeat(n));
  return {
    "Node.js": `const res = await fetch('${url}', {\n  method: '${e.m}',\n  headers: {\n    Authorization: 'Bearer dlv_live_••••',${body ? "\n    'Content-Type': 'application/json'," : ""}\n  },${body ? `\n  body: JSON.stringify(${ind(body, 2)}),` : ""}\n});\n\nconst data = await res.json();`,
    Python: `import requests\n\nres = requests.${e.m.toLowerCase()}(\n    '${url}',\n    headers={'Authorization': 'Bearer dlv_live_••••'},${body ? `\n    json=${ind(body.replace(/true/g, "True").replace(/false/g, "False"), 4)},` : ""}\n)\n\nprint(res.json())`,
    PHP: `$ch = curl_init('${url}');\ncurl_setopt_array($ch, [\n  CURLOPT_CUSTOMREQUEST => '${e.m}',\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => [\n    'Authorization: Bearer dlv_live_••••',\n    'Content-Type: application/json',\n  ],${body ? `\n  CURLOPT_POSTFIELDS => '${JSON.stringify(e.example)}',` : ""}\n]);\n$data = json_decode(curl_exec($ch), true);`,
    Go: `${body ? `body := strings.NewReader(\`${JSON.stringify(e.example)}\`)\n` : ""}req, _ := http.NewRequest("${e.m}", "${url}", ${body ? "body" : "nil"})\nreq.Header.Set("Authorization", "Bearer dlv_live_••••")\nreq.Header.Set("Content-Type", "application/json")\n\nres, err := http.DefaultClient.Do(req)`,
    cURL: `curl -X ${e.m} '${url}' \\\n  -H 'Authorization: Bearer dlv_live_••••'${body ? ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${ind(body, 2)}'` : ""}`,
  };
}

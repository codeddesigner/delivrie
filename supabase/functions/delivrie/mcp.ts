// Remote MCP server (Streamable HTTP, JSON responses). Every tool maps onto a REST route, so it follows the
// same permissions as the API key or connected app (OAuth scopes) that calls it.
import { CORS, HttpError, type Any } from "./util.ts";

type Call = (method: string, path: string, body: Any) => Promise<unknown>;
const s = (props: Record<string, Any>, required: string[] = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const arr = (d: string) => ({ type: "array", items: { type: "string" }, description: d });
const obj = (d: string) => ({ type: "object", description: d, additionalProperties: true });
const q = (params: Record<string, unknown>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v)); const t = u.toString(); return t ? `?${t}` : ""; };
const enc = encodeURIComponent;
// Every tool sets all three hints explicitly (ChatGPT and Claude directory review both check them).
// SEND: reaches people outside the workspace (emails, webhooks, automations that send).
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const SEND = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

interface Tool { name: string; title: string; description: string; inputSchema: Any; annotations: Any; run: (a: Any, call: Call) => Promise<unknown> }
const T = (name: string, title: string, description: string, inputSchema: Any, annotations: Any, run: Tool["run"]): Tool => ({ name, title, description, inputSchema, annotations, run });

const email = { from: str("Sender on a verified domain, e.g. \"Kora <orders@kora.ng>\""), to: arr("Recipients (up to 50)"), subject: str("Subject line"), html: str("HTML body"), text: str("Plain-text body (generated from html if left out)"), cc: arr("Cc recipients"), bcc: arr("Bcc recipients"), reply_to: arr("Reply-to addresses"), tags: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] }, description: "Tags for filtering, e.g. [{name:\"category\",value:\"welcome\"}]" }, template: { type: "object", properties: { id: str("Template id or alias"), variables: obj("Variables for the template") }, required: ["id"], description: "Send a published template instead of html/text" } };

const TOOLS: Tool[] = [
  // emails
  T("send_email", "Send email", "Send one email from a verified domain. Use a template, or html/text. Returns the email id.", s({ ...email, scheduled_at: str("Optional: ISO 8601 date or a phrase like \"in 1 hour\" / \"tomorrow at 9am\" (UTC), up to 30 days ahead") }, ["from", "to"]), SEND, (a, c) => c("POST", "/emails", a)),
  T("send_batch", "Send batch", "Send up to 100 emails in one call. Pass `emails` (array of send_email inputs), or `template` + `to` + `from` to send one template to many recipients.", s({ emails: { type: "array", items: { type: "object" }, description: "Array of email objects (from, to, subject, html/text or template)" }, template: str("Template id or alias"), to: arr("Recipients, one email each, when using template"), from: str("Sender when using template"), variables: obj("Template variables shared by every recipient") }), SEND, (a, c) => c("POST", "/emails/batch", a.emails ?? (a.to || []).map((t: string) => ({ from: a.from, to: t, template: { id: a.template, variables: a.variables || {} } })))),
  T("list_emails", "List sent emails", "Recent sent emails with their latest status (delivered, opened, bounced…).", s({ limit: num("1-100, default 20"), offset: num("Skip this many") }), RO, (a, c) => c("GET", `/emails${q({ limit: a.limit || 20, offset: a.offset })}`, null)),
  T("get_email", "Get email", "One email (sent or received) with its content and every delivery event.", s({ id: str("Email id") }, ["id"]), RO, (a, c) => c("GET", `/emails/${enc(a.id)}`, null)),
  T("reschedule_email", "Reschedule email", "Change when a scheduled email goes out.", s({ id: str("Email id"), scheduled_at: str("ISO 8601 date or a phrase like \"in 2 hours\"") }, ["id", "scheduled_at"]), WRITE, (a, c) => c("PATCH", `/emails/${enc(a.id)}`, { scheduled_at: a.scheduled_at })),
  T("cancel_email", "Cancel scheduled email", "Cancel an email that is scheduled and not yet sent.", s({ id: str("Email id") }, ["id"]), DESTROY, (a, c) => c("POST", `/emails/${enc(a.id)}/cancel`, {})),
  T("list_received_emails", "List received emails", "Emails that arrived on your receiving domains, newest first.", s({ limit: num("1-100, default 20"), to: str("Only mail sent to this address") }), RO, (a, c) => c("GET", `/emails/received${q({ limit: a.limit, to: a.to })}`, null)),
  T("forward_email", "Forward email", "Forward an email (usually a received one) to other people, with an optional note. Attachments aren't included.", s({ id: str("Email id"), to: arr("Recipients"), from: str("Sender on a verified domain"), note: str("Optional note above the forwarded message") }, ["id", "to", "from"]), SEND, (a, c) => c("POST", `/emails/${enc(a.id)}/forward`, { to: a.to, from: a.from, note: a.note })),

  // inbox
  T("list_inbox_threads", "List inbox threads", "Conversations in the Inbox. Filter by status, unread, needs reply, mailbox, label or a search term.", s({ status: { type: "string", enum: ["open", "archived", "all"], description: "Default open" }, unread: bool("Only unread"), needs_reply: bool("Only threads whose last message is from the customer"), mailbox: str("e.g. support@in.kora.ng"), label: str("Label name"), q: str("Search subject, contact or snippet"), limit: num("1-100, default 20") }), RO, (a, c) => c("GET", `/inbox/threads${q({ status: a.status, unread: a.unread, needs_reply: a.needs_reply, mailbox: a.mailbox, label: a.label, q: a.q, limit: a.limit })}`, null)),
  T("get_inbox_thread", "Get inbox thread", "A conversation with every message as plain text, oldest first.", s({ id: str("Thread id") }, ["id"]), RO, (a, c) => c("GET", `/inbox/threads/${enc(a.id)}`, null)),
  T("reply_to_thread", "Reply to thread", "Reply in an Inbox conversation. Threads correctly with In-Reply-To and References. Sends from the mailbox the mail arrived at unless `from` is given.", s({ id: str("Thread id"), text: str("Reply as plain text"), html: str("Reply as HTML (optional)"), from: str("Optional sender, e.g. \"Kora Support <support@kora.ng>\"") }, ["id", "text"]), SEND, (a, c) => c("POST", `/inbox/threads/${enc(a.id)}/reply`, { text: a.text, html: a.html, from: a.from })),
  T("update_thread", "Update thread", "Archive or reopen a thread, mark it read or unread, or set its labels (labels are created if they don't exist).", s({ id: str("Thread id"), status: { type: "string", enum: ["open", "archived"] }, unread: bool("Mark unread (true) or read (false)"), labels: arr("Label names; replaces the thread's labels") }, ["id"]), WRITE, (a, c) => c("PATCH", `/inbox/threads/${enc(a.id)}`, { status: a.status, unread: a.unread, labels: a.labels })),
  T("list_inbox_labels", "List inbox labels", "Labels you can put on inbox threads.", s({}), RO, (_a, c) => c("GET", "/inbox/labels", null)),

  // domains
  T("list_domains", "List domains", "Sending domains with status, region, tracking and receiving settings.", s({}), RO, (_a, c) => c("GET", "/domains", null)),
  T("get_domain", "Get domain", "A domain and the DNS records to add, with each record's status.", s({ domain: str("Domain id or name") }, ["domain"]), RO, (a, c) => c("GET", `/domains/${enc(a.domain)}`, null)),
  T("create_domain", "Add domain", "Add a sending domain and get its DNS records. Prefer a subdomain like mail.example.com.", s({ name: str("Domain, e.g. mail.example.com"), region: str("AWS region, default eu-west-1"), receiving_enabled: bool("Also receive email on it") }, ["name"]), WRITE, (a, c) => c("POST", "/domains", a)),
  T("verify_domain", "Verify domain", "Check DNS now and update the domain's verification status.", s({ domain: str("Domain id or name") }, ["domain"]), WRITE, (a, c) => c("POST", `/domains/${enc(a.domain)}/verify`, {})),
  T("update_domain", "Update domain", "Change tracking, TLS or receiving. For receiving, use a subdomain (receiving_subdomain: \"in\") and optionally only accept listed addresses.", s({ domain: str("Domain id or name"), open_tracking: bool("Track opens"), click_tracking: bool("Track clicks"), tls: { type: "string", enum: ["opportunistic", "enforced"] }, receiving_enabled: bool("Receive email"), receiving_subdomain: str("e.g. in (mail to anything@in.example.com)"), receiving_mode: { type: "string", enum: ["all", "specific"] }, receiving_addresses: arr("Addresses or local parts to accept when mode is specific") }, ["domain"]), WRITE, (a, c) => { const { domain, ...rest } = a; return c("PATCH", `/domains/${enc(domain)}`, rest); }),
  T("delete_domain", "Delete domain", "Remove a domain. Sending from it stops immediately.", s({ domain: str("Domain id or name") }, ["domain"]), DESTROY, (a, c) => c("DELETE", `/domains/${enc(a.domain)}`, {})),
  T("claim_domain", "Claim domain", "Start claiming a domain another Delivrie team added. Returns a TXT record to add; then call verify_domain_claim.", s({ name: str("Domain name"), region: str("Region, default eu-west-1") }, ["name"]), WRITE, (a, c) => c("POST", "/domains/claims", a)),
  T("verify_domain_claim", "Verify domain claim", "Check the claim TXT record and move the domain to this team when it's found.", s({ id: str("Claim id from claim_domain") }, ["id"]), DESTROY, (a, c) => c("POST", `/domains/claims/${enc(a.id)}/verify`, {})),

  // contacts, segments, topics
  T("list_contacts", "List contacts", "Contacts, newest first. created_after accepts an ISO date or 'today'.", s({ created_after: str("ISO date or 'today'"), limit: num("1-100, default 50"), offset: num("Skip this many") }), RO, (a, c) => c("GET", `/contacts${q({ limit: a.limit || 50, offset: a.offset, created_after: a.created_after })}`, null)),
  T("get_contact", "Get contact", "A contact by id or email.", s({ contact: str("Contact id or email") }, ["contact"]), RO, (a, c) => c("GET", `/contacts/${enc(a.contact)}`, null)),
  T("create_contact", "Create contact", "Create or update a contact by email, optionally adding it to segments.", s({ email: str("Email"), first_name: str("First name"), last_name: str("Last name"), properties: obj("Custom properties, e.g. {plan: \"pro\"}"), segments: arr("Segment ids to add the contact to"), unsubscribed: bool("Unsubscribed from broadcasts") }, ["email"]), WRITE, (a, c) => c("POST", "/contacts", a)),
  T("update_contact", "Update contact", "Change a contact's name, properties or subscription.", s({ contact: str("Contact id or email"), first_name: str("First name"), last_name: str("Last name"), properties: obj("Properties to merge"), unsubscribed: bool("Unsubscribed from broadcasts") }, ["contact"]), WRITE, (a, c) => { const { contact, ...rest } = a; return c("PATCH", `/contacts/${enc(contact)}`, rest); }),
  T("delete_contact", "Delete contact", "Delete a contact.", s({ contact: str("Contact id or email") }, ["contact"]), DESTROY, (a, c) => c("DELETE", `/contacts/${enc(a.contact)}`, {})),
  T("list_contact_properties", "List contact properties", "Custom contact properties and their fallbacks.", s({}), RO, (_a, c) => c("GET", "/contact-properties", null)),
  T("list_segments", "List segments", "Segments used to target broadcasts and automations.", s({}), RO, (_a, c) => c("GET", "/segments", null)),
  T("create_segment", "Create segment", "Create a segment.", s({ name: str("Name") }, ["name"]), WRITE, (a, c) => c("POST", "/segments", a)),
  T("add_contacts_to_segment", "Add contacts to segment", "Add contacts (by email) to a segment, creating them if needed.", s({ segment_id: str("Segment id"), emails: arr("Emails to add") }, ["segment_id", "emails"]), WRITE, (a, c) => c("POST", `/segments/${enc(a.segment_id)}/contacts`, { contacts: a.emails })),
  T("delete_segment", "Delete segment", "Delete a segment (contacts stay).", s({ segment_id: str("Segment id") }, ["segment_id"]), DESTROY, (a, c) => c("DELETE", `/segments/${enc(a.segment_id)}`, {})),
  T("list_topics", "List topics", "Topics people can opt out of on the unsubscribe page.", s({}), RO, (_a, c) => c("GET", "/topics", null)),

  // broadcasts
  T("list_broadcasts", "List broadcasts", "Broadcasts with status and schedule.", s({}), RO, (_a, c) => c("GET", "/broadcasts", null)),
  T("get_broadcast", "Get broadcast", "A broadcast with delivery stats.", s({ id: str("Broadcast id") }, ["id"]), RO, (a, c) => c("GET", `/broadcasts/${enc(a.id)}`, null)),
  T("create_broadcast", "Create broadcast", "Create a broadcast draft for a segment. Include an unsubscribe link ({{{unsubscribe_url}}}) in html.", s({ name: str("Name"), from: str("Sender"), subject: str("Subject"), segment_id: str("Segment id"), html: str("HTML content"), text: str("Text content"), topic_id: str("Topic id"), preview_text: str("Inbox preview text"), reply_to: str("Reply-to address") }, ["from", "subject", "segment_id"]), WRITE, (a, c) => c("POST", "/broadcasts", a)),
  T("send_broadcast", "Send broadcast", "Send a broadcast now, or schedule it with scheduled_at.", s({ id: str("Broadcast id"), scheduled_at: str("Optional ISO 8601 date") }, ["id"]), SEND, (a, c) => c("POST", `/broadcasts/${enc(a.id)}/send`, { scheduled_at: a.scheduled_at })),
  T("cancel_broadcast", "Cancel broadcast", "Cancel a scheduled broadcast (it goes back to draft).", s({ id: str("Broadcast id") }, ["id"]), WRITE, (a, c) => c("POST", `/broadcasts/${enc(a.id)}/cancel`, {})),

  // templates
  T("list_templates", "List templates", "Templates with alias and published version.", s({}), RO, (_a, c) => c("GET", "/templates", null)),
  T("get_template", "Get template", "A template by id or alias, with its content and variables.", s({ template: str("Template id or alias") }, ["template"]), RO, (a, c) => c("GET", `/templates/${enc(a.template)}`, null)),
  T("create_template", "Create template", "Create a template. Use {{{variable}}} placeholders and list them in variables with fallbacks, then publish_template.", s({ name: str("Name"), alias: str("Alias for the API, e.g. welcome"), subject: str("Subject"), from: str("Default sender"), html: str("HTML with {{{variables}}}"), variables: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, fallback: { type: "string" } }, required: ["name"] }, description: "Variables with optional fallbacks" } }, ["name"]), WRITE, (a, c) => c("POST", "/templates", a)),
  T("publish_template", "Publish template", "Publish the current draft so API sends and automations use it.", s({ id: str("Template id") }, ["id"]), WRITE, (a, c) => c("POST", `/templates/${enc(a.id)}/publish`, {})),

  // automations & events
  T("list_automations", "List automations", "Automations with trigger and status (draft, live, paused).", s({}), RO, (_a, c) => c("GET", "/automations", null)),
  T("get_automation", "Get automation", "An automation's trigger, steps and run counts.", s({ id: str("Automation id") }, ["id"]), RO, (a, c) => c("GET", `/automations/${enc(a.id)}`, null)),
  T("create_automation", "Create automation", "Create a simple automation: a trigger (an event name or a segment) and a list of send/wait steps. Set publish to start it. Build branches in the dashboard.", s({ name: str("Name"), trigger: { type: "object", properties: { event: str("Event name, e.g. user.created"), segment_id: str("Or: start when a contact joins this segment") }, description: "What starts it" }, steps: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["send", "wait"] }, template_id: str("Template id or alias (send)"), from: str("Override sender (send)"), subject: str("Override subject (send)"), amount: num("How long (wait)"), unit: { type: "string", enum: ["minutes", "hours", "days", "weeks"] } }, required: ["type"] }, description: "Steps in order" }, reentry: { type: "string", enum: ["once", "always"], description: "Can a contact go through it more than once" }, publish: bool("Publish right away") }, ["name", "trigger", "steps"]), SEND, (a, c) => c("POST", "/automations", a)),
  T("publish_automation", "Publish automation", "Publish (or republish) an automation so it starts running.", s({ id: str("Automation id") }, ["id"]), SEND, (a, c) => c("POST", `/automations/${enc(a.id)}/publish`, {})),
  T("pause_automation", "Pause automation", "Pause a live automation. Runs in progress wait until it's resumed.", s({ id: str("Automation id") }, ["id"]), WRITE, (a, c) => c("POST", `/automations/${enc(a.id)}/pause`, {})),
  T("resume_automation", "Resume automation", "Resume a paused automation.", s({ id: str("Automation id") }, ["id"]), SEND, (a, c) => c("POST", `/automations/${enc(a.id)}/resume`, {})),
  T("list_automation_runs", "List automation runs", "Recent runs of an automation, with each step's log.", s({ id: str("Automation id"), status: { type: "string", enum: ["running", "completed", "failed", "canceled"] }, limit: num("1-100, default 20") }, ["id"]), RO, (a, c) => c("GET", `/automations/${enc(a.id)}/runs${q({ status: a.status, limit: a.limit })}`, null)),
  T("send_event", "Send event", "Record an event for a contact (e.g. user.created, order.paid). Live automations listening for it start a run.", s({ event: str("Event name: lowercase letters, numbers, dots, dashes, underscores"), email: str("The contact's email"), data: obj("Event data, usable in templates as {{{data.field}}}") }, ["event", "email"]), SEND, (a, c) => c("POST", "/events", a)),
  T("list_events", "List events", "Without a name: every event your app has sent, with its fields. With a name: the latest occurrences.", s({ name: str("Event name"), limit: num("1-100, default 20") }), RO, (a, c) => c("GET", `/events${q({ name: a.name, limit: a.limit })}`, null)),

  // webhooks
  T("list_webhooks", "List webhooks", "Webhook endpoints and their events.", s({}), RO, (_a, c) => c("GET", "/webhooks", null)),
  T("create_webhook", "Create webhook", "Create a webhook endpoint. Returns the signing secret once.", s({ endpoint: str("https URL"), events: arr("Event types, e.g. email.delivered, email.bounced, email.received") }, ["endpoint", "events"]), WRITE, (a, c) => c("POST", "/webhooks", a)),
  T("list_webhook_events", "List webhook deliveries", "Recent delivery attempts for a webhook with status codes.", s({ id: str("Webhook id") }, ["id"]), RO, (a, c) => c("GET", `/webhooks/${enc(a.id)}/events`, null)),
  T("test_webhook", "Send test webhook", "Send a test event to a webhook and return the response.", s({ id: str("Webhook id") }, ["id"]), SEND, (a, c) => c("POST", `/webhooks/${enc(a.id)}/test`, {})),
  T("replay_webhook_delivery", "Replay webhook delivery", "Send a past webhook delivery again.", s({ id: str("Delivery id") }, ["id"]), SEND, (a, c) => c("POST", `/webhook-deliveries/${enc(a.id)}/replay`, {})),

  // suppressions
  T("list_suppressions", "List suppressions", "Addresses Delivrie won't send to (bounces, complaints, manual).", s({}), RO, (_a, c) => c("GET", "/suppressions", null)),
  T("add_suppression", "Add suppression", "Stop sending to one or more addresses.", s({ emails: arr("Addresses") }, ["emails"]), WRITE, (a, c) => c("POST", "/suppressions", { emails: a.emails })),
  T("remove_suppression", "Remove suppression", "Allow sending to an address again.", s({ email: str("Address") }, ["email"]), DESTROY, (a, c) => c("DELETE", `/suppressions/${enc(a.email)}`, {})),

  // insight & account
  T("get_metrics", "Get metrics", "Sent, delivered, opened, clicked, bounced and complained totals and rates.", s({ days: num("Look-back window, 1-90, default 15"), domain_id: str("Only this domain") }), RO, (a, c) => c("GET", `/metrics${q({ days: a.days || 15, domain_id: a.domain_id })}`, null)),
  T("list_logs", "List API logs", "Recent API requests with status codes.", s({ limit: num("1-100, default 20") }), RO, (a, c) => c("GET", `/logs${q({ limit: a.limit || 20 })}`, null)),
  T("get_log", "Get API log", "One API request with its request and response bodies.", s({ id: str("Log id") }, ["id"]), RO, (a, c) => c("GET", `/logs/${enc(a.id)}`, null)),
  T("get_usage", "Get usage", "Plan, emails sent this month and today, the allowance, and pay-as-you-go credits.", s({}), RO, (_a, c) => c("GET", "/usage", null)),
  T("list_api_keys", "List API keys", "API keys (tokens are never shown).", s({}), RO, (_a, c) => c("GET", "/api-keys", null)),
  T("create_api_key", "Create API key", "Create an API key. The token is returned once.", s({ name: str("Name"), permission: { type: "string", enum: ["full_access", "sending_access"] }, domain_id: str("Optional: only send from this domain") }, ["name"]), WRITE, (a, c) => c("POST", "/api-keys", a)),
];

const INSTRUCTIONS = `Delivrie: email API for transactional email, broadcasts, automations and an inbox.
- Send only from verified domains. Call list_domains first if you're unsure which sender to use.
- Prefer published templates (send_email with template) for repeat emails; list_templates shows aliases.
- Test addresses: delivered@test.delivrie.io, bounced@test.delivrie.io, complained@test.delivrie.io.
- For support work: list_inbox_threads (needs_reply: true), get_inbox_thread, then reply_to_thread.
- Events (send_event) start live automations listening for that event name.
- What you can call depends on the API key or the scopes approved for this app (send, read, manage).`;

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

export async function handleMcp(req: Request, call: Call): Promise<Response> {
  const headers = { "content-type": "application/json", ...CORS };
  if (req.method === "GET") return new Response(JSON.stringify({ error: "This server answers POST requests (Streamable HTTP with JSON responses)." }), { status: 405, headers: { ...headers, allow: "POST, DELETE" } });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  const msg = await req.json().catch(() => null);
  if (!msg) return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), { status: 400, headers });
  const handle = async (m: Any) => {
    if (m.id === undefined) return null; // notification
    switch (m.method) {
      case "initialize": {
        const want = m.params?.protocolVersion;
        return rpc(m.id, { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "delivrie", title: "Delivrie", version: "1.1.0", websiteUrl: "https://delivrie.io" }, instructions: INSTRUCTIONS });
      }
      case "ping": return rpc(m.id, {});
      case "tools/list": return rpc(m.id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) });
      case "resources/list": return rpc(m.id, { resources: [] });
      case "prompts/list": return rpc(m.id, { prompts: [] });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === m.params?.name);
        if (!tool) return rpcErr(m.id, -32602, `Unknown tool ${m.params?.name}`);
        try {
          const out = await tool.run(m.params?.arguments || {}, call);
          return rpc(m.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out && typeof out === "object" && !Array.isArray(out) ? out : { result: out } });
        } catch (e) {
          if (e instanceof HttpError && e.status === 401) throw e;
          const err = e as HttpError;
          return rpc(m.id, { isError: true, content: [{ type: "text", text: err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message }] });
        }
      }
      default: return rpcErr(m.id, -32601, `Method not found: ${m.method}`);
    }
  };
  try {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(handle))).filter(Boolean);
      return out.length ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handle(msg);
    return out ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202, headers: CORS });
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ statusCode: e.status, name: e.name, message: e.message }), { status: e.status, headers: { ...headers, "www-authenticate": 'Bearer realm="delivrie", resource_metadata="https://delivrie.io/.well-known/oauth-protected-resource"' } });
    throw e;
  }
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// Remote MCP server (Streamable HTTP, JSON responses). Each tool maps onto a REST route.
import { CORS, HttpError, type Any } from "./util.ts";

type Call = (method: string, path: string, body: Any) => Promise<unknown>;
const s = (props: Record<string, Any>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (d: string) => ({ type: "string", description: d });
const arr = (d: string) => ({ type: "array", items: { type: "string" }, description: d });

const TOOLS: { name: string; description: string; inputSchema: Any; run: (a: Any, call: Call) => Promise<unknown> }[] = [
  { name: "send_email", description: "Send an email from a verified domain.", inputSchema: s({ from: str("Sender, e.g. Kora <orders@kora.ng>"), to: arr("Recipients"), subject: str("Subject"), html: str("HTML body"), text: str("Plain-text body"), reply_to: str("Reply-to address") }, ["from", "to", "subject"]), run: (a, c) => c("POST", "/emails", a) },
  { name: "send_batch", description: "Send up to 100 emails, or one template to many recipients.", inputSchema: s({ emails: { type: "array", items: { type: "object" }, description: "Array of email objects" }, template: str("Template id or alias to send to each recipient"), to: arr("Recipients when using template"), from: str("Sender when using template"), variables: { type: "object" } }), run: (a, c) => c("POST", "/emails/batch", a.emails ?? (a.to || []).map((t: string) => ({ from: a.from, to: t, template: { id: a.template, variables: a.variables || {} } }))) },
  { name: "schedule_email", description: "Schedule an email for later (ISO 8601 scheduled_at, up to 30 days ahead).", inputSchema: s({ from: str("Sender"), to: arr("Recipients"), subject: str("Subject"), html: str("HTML"), text: str("Text"), scheduled_at: str("ISO 8601 date") }, ["from", "to", "subject", "scheduled_at"]), run: (a, c) => c("POST", "/emails", a) },
  { name: "cancel_email", description: "Cancel a scheduled email.", inputSchema: s({ id: str("Email id") }, ["id"]), run: (a, c) => c("POST", `/emails/${a.id}/cancel`, {}) },
  { name: "get_email", description: "Get an email with its delivery events.", inputSchema: s({ id: str("Email id") }, ["id"]), run: (a, c) => c("GET", `/emails/${a.id}`, null) },
  { name: "list_emails", description: "List recent emails.", inputSchema: s({ limit: { type: "number" } }), run: (a, c) => c("GET", `/emails?limit=${a.limit || 20}`, null) },
  { name: "create_broadcast", description: "Create a broadcast draft for a segment.", inputSchema: s({ name: str("Name"), from: str("Sender"), subject: str("Subject"), segment_id: str("Segment id"), html: str("HTML content"), text: str("Text content"), topic_id: str("Topic id") }, ["from", "subject", "segment_id"]), run: (a, c) => c("POST", "/broadcasts", a) },
  { name: "send_broadcast", description: "Send or schedule a broadcast.", inputSchema: s({ id: str("Broadcast id"), scheduled_at: str("Optional ISO 8601 date") }, ["id"]), run: (a, c) => c("POST", `/broadcasts/${a.id}/send`, { scheduled_at: a.scheduled_at }) },
  { name: "create_template", description: "Create a template.", inputSchema: s({ name: str("Name"), alias: str("Alias for the API"), subject: str("Subject"), from: str("Sender"), html: str("HTML with {{{variables}}}") }, ["name"]), run: (a, c) => c("POST", "/templates", a) },
  { name: "list_templates", description: "List templates.", inputSchema: s({}), run: (_a, c) => c("GET", "/templates", null) },
  { name: "create_contact", description: "Create or update a contact.", inputSchema: s({ email: str("Email"), first_name: str("First name"), last_name: str("Last name"), segment_id: str("Optional segment id") }, ["email"]), run: (a, c) => c("POST", "/contacts", a) },
  { name: "list_contacts", description: "List contacts, optionally created after a date ('today' works).", inputSchema: s({ created_after: str("ISO date or 'today'"), limit: { type: "number" } }), run: (a, c) => c("GET", `/contacts?limit=${a.limit || 50}${a.created_after ? `&created_after=${encodeURIComponent(a.created_after)}` : ""}`, null) },
  { name: "create_segment", description: "Create a segment.", inputSchema: s({ name: str("Name") }, ["name"]), run: (a, c) => c("POST", "/segments", a) },
  { name: "create_domain", description: "Add a sending domain and get its DNS records.", inputSchema: s({ name: str("Domain, e.g. mail.example.com"), region: str("AWS region, default eu-west-1") }, ["name"]), run: (a, c) => c("POST", "/domains", a) },
  { name: "verify_domain", description: "Check DNS and verification status for a domain (id or name).", inputSchema: s({ domain: str("Domain id or name") }, ["domain"]), run: (a, c) => c("POST", `/domains/${encodeURIComponent(a.domain)}/verify`, {}) },
  { name: "list_domains", description: "List domains.", inputSchema: s({}), run: (_a, c) => c("GET", "/domains", null) },
  { name: "create_webhook", description: "Create a webhook endpoint.", inputSchema: s({ endpoint: str("https URL"), events: arr("Event types") }, ["endpoint", "events"]), run: (a, c) => c("POST", "/webhooks", a) },
  { name: "list_webhook_events", description: "List delivery attempts for a webhook.", inputSchema: s({ id: str("Webhook id") }, ["id"]), run: (a, c) => c("GET", `/webhooks/${a.id}/events`, null) },
  { name: "create_api_key", description: "Create an API key (returned once).", inputSchema: s({ name: str("Name"), permission: { type: "string", enum: ["full_access", "sending_access"] } }, ["name"]), run: (a, c) => c("POST", "/api-keys", a) },
  { name: "list_api_keys", description: "List API keys (tokens are never shown).", inputSchema: s({}), run: (_a, c) => c("GET", "/api-keys", null) },
  { name: "get_metrics", description: "Delivery, open, click, bounce and complaint totals.", inputSchema: s({ days: { type: "number" } }), run: (a, c) => c("GET", `/metrics?days=${a.days || 15}`, null) },
  { name: "get_log", description: "Get an API request log with request and response bodies.", inputSchema: s({ id: str("Log id") }, ["id"]), run: (a, c) => c("GET", `/logs/${a.id}`, null) },
  { name: "add_suppression", description: "Stop sending to an address.", inputSchema: s({ email: str("Email") }, ["email"]), run: (a, c) => c("POST", "/suppressions", a) },
  { name: "list_suppressions", description: "List suppressed addresses.", inputSchema: s({}), run: (_a, c) => c("GET", "/suppressions", null) },
];

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleMcp(req: Request, call: Call): Promise<Response> {
  const headers = { "content-type": "application/json", ...CORS };
  if (req.method === "GET") return new Response(JSON.stringify({ error: "Use POST (Streamable HTTP, JSON responses)" }), { status: 405, headers });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  const msg = await req.json().catch(() => null);
  if (!msg) return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), { status: 400, headers });
  const handle = async (m: Any) => {
    if (m.id === undefined) return null; // notification
    switch (m.method) {
      case "initialize":
        return rpc(m.id, { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "delivrie", version: "1.0.0" }, instructions: "Delivrie email API. Send from verified domains only; use list_domains first if unsure." });
      case "ping": return rpc(m.id, {});
      case "tools/list": return rpc(m.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === m.params?.name);
        if (!tool) return rpcErr(m.id, -32602, `Unknown tool ${m.params?.name}`);
        try {
          const out = await tool.run(m.params?.arguments || {}, call);
          return rpc(m.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          if (e instanceof HttpError && e.status === 401) throw e;
          return rpc(m.id, { isError: true, content: [{ type: "text", text: (e as Error).message }] });
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
    if (e instanceof HttpError) return new Response(JSON.stringify({ statusCode: e.status, name: e.name, message: e.message }), { status: e.status, headers: { ...headers, "www-authenticate": 'Bearer realm="delivrie"' } });
    throw e;
  }
}

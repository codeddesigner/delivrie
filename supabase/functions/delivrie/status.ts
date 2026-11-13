// delivrie.io/status: every 5 minutes pg_cron calls POST /status/run, which checks each component and stores
// the result in status_checks. GET /public/status returns the live state, 90 days of uptime and incidents.
// Details shown publicly are written for customers: no provider names, keys, volumes or internal errors.
import { type Any, APP_URL, db, SUPABASE_URL, setting } from "./util.ts";
import { accountStatus, hasAws } from "./ses.ts";

type State = "operational" | "degraded" | "down";
interface Result { state: State; latency_ms?: number; detail?: string }

export const COMPONENTS: { id: string; name: string; about: string }[] = [
  { id: "api", name: "Email API", about: "REST API for sending and managing email" },
  { id: "sending", name: "Email sending", about: "Accepting and sending new emails" },
  { id: "delivery", name: "Email delivery", about: "Emails reaching recipients' mail servers" },
  { id: "smtp", name: "SMTP relay", about: "smtp.delivrie.io on ports 587, 465, 2587 and 2465" },
  { id: "webhooks", name: "Webhooks", about: "Delivering events to your endpoints" },
  { id: "scheduler", name: "Scheduled sends and automations", about: "Scheduled emails, broadcasts and automation runs" },
  { id: "mcp", name: "MCP server", about: "AI assistants connected through delivrie.io/api/mcp" },
  { id: "dashboard", name: "Dashboard", about: "The Delivrie app at delivrie.io" },
  { id: "website", name: "Website and docs", about: "delivrie.io and the documentation" },
  { id: "billing", name: "Billing", about: "Plans, checkout and credit top-ups" },
];

async function timed<T>(fn: () => Promise<T>, ms = 8000): Promise<[T, number]> {
  const t0 = Date.now();
  const v = await Promise.race([fn(), new Promise<never>((_, j) => setTimeout(() => j(new Error("timed out")), ms))]);
  return [v, Date.now() - t0];
}
const since = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function smtpGreeting(port: number, tls: boolean): Promise<boolean> {
  const conn = tls ? await Deno.connectTls({ hostname: "smtp.delivrie.io", port }) : await Deno.connect({ hostname: "smtp.delivrie.io", port });
  try {
    const buf = new Uint8Array(256);
    const n = await conn.read(buf);
    const line = new TextDecoder().decode(buf.subarray(0, n || 0));
    await conn.write(new TextEncoder().encode("QUIT\r\n")).catch(() => {});
    return line.startsWith("220 ");
  } finally { try { conn.close(); } catch { /* closed */ } }
}

const CHECKS: Record<string, () => Promise<Result>> = {
  async api() {
    const [{ error }, ms] = await timed(() => db.from("teams").select("id").limit(1));
    if (error) return { state: "down", detail: "The API can't reach its database" };
    return { state: ms > 2500 ? "degraded" : "operational", latency_ms: ms, detail: ms > 2500 ? "Slower than usual" : undefined };
  },
  async sending() {
    if (!hasAws()) return { state: "down", detail: "Sending isn't available" };
    const [a, ms] = await timed(() => accountStatus("eu-west-1"));
    if (a.error) return { state: "down", latency_ms: ms, detail: "Our mail servers aren't responding" };
    if (!a.sending) return { state: "down", latency_ms: ms, detail: "Sending is paused" };
    // queued emails that should have gone out more than 15 minutes ago
    const { count } = await db.from("emails").select("id", { count: "exact", head: true }).in("status", ["queued", "sending"]).lt("created_at", since(15)).or(`scheduled_at.is.null,scheduled_at.lt.${since(15)}`);
    if ((count || 0) > 0) return { state: "degraded", latency_ms: ms, detail: "Some emails are taking longer than usual to send" };
    return { state: "operational", latency_ms: ms };
  },
  async delivery() {
    const c = async (s: string[]) => (await db.from("emails").select("id", { count: "exact", head: true }).eq("direction", "outbound").in("status", s).gte("created_at", since(60))).count || 0;
    const [ok, failed] = await Promise.all([c(["sent", "delivered", "opened", "clicked", "bounced", "complained", "delivery_delayed"]), c(["failed"])]);
    const total = ok + failed;
    if (total >= 20 && failed / total > 0.2) return { state: "down", detail: "Many emails are failing to send" };
    if (total >= 20 && failed / total > 0.05) return { state: "degraded", detail: "Some emails are failing to send" };
    return { state: "operational" };
  },
  async smtp() {
    // Outbound connections to 587 aren't allowed from here, so check the same listeners on their backup ports.
    const [[tlsOk, starttlsOk], ms] = await timed(() => Promise.all([smtpGreeting(465, true).catch(() => false), smtpGreeting(2587, false).catch(() => false)]), 10000);
    if (!tlsOk && !starttlsOk) return { state: "down", latency_ms: ms, detail: "The SMTP relay isn't answering" };
    if (!tlsOk || !starttlsOk) return { state: "degraded", latency_ms: ms, detail: !tlsOk ? "Port 465 isn't answering; 587 is working" : "Port 587 isn't answering; 465 is working" };
    return { state: "operational", latency_ms: ms };
  },
  async webhooks() {
    // deliveries whose retry is more than 15 minutes overdue mean the delivery worker is stuck (failing customer endpoints don't count)
    const { count } = await db.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("delivered", false).not("next_attempt_at", "is", null).lt("next_attempt_at", since(15));
    return (count || 0) > 0 ? { state: "degraded", detail: "Webhook events are arriving late" } : { state: "operational" };
  },
  async scheduler() {
    const { data, error } = await db.rpc("status_cron");
    if (error) return { state: "degraded", detail: "Couldn't confirm the scheduler is running" };
    const ages = Object.values(data || {}).map((t) => (t ? (Date.now() - new Date(String(t)).getTime()) / 60000 : Infinity));
    const worst = Math.max(...ages, 0);
    if (worst > 15) return { state: "down", detail: "Scheduled emails and automations are paused" };
    if (worst > 5) return { state: "degraded", detail: "Scheduled emails and automations are running late" };
    return { state: "operational" };
  },
  async mcp() {
    const [r, ms] = await timed(() => fetch(`${APP_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }));
    await r.body?.cancel();
    const ok = r.status === 401 && /resource_metadata/.test(r.headers.get("www-authenticate") || "");
    return ok ? { state: ms > 4000 ? "degraded" : "operational", latency_ms: ms } : { state: "down", latency_ms: ms, detail: "The MCP server isn't responding" };
  },
  async dashboard() {
    const [r, ms] = await timed(() => fetch(`${APP_URL}/app/js/main.js`, { headers: { "cache-control": "no-cache" } }));
    await r.body?.cancel();
    return r.ok ? { state: ms > 4000 ? "degraded" : "operational", latency_ms: ms } : { state: "down", latency_ms: ms, detail: "The dashboard isn't loading" };
  },
  async website() {
    const [r, ms] = await timed(() => fetch(`${APP_URL}/`, { headers: { "cache-control": "no-cache" } }));
    const text = await r.text();
    const [d] = await timed(() => fetch(`${APP_URL}/docs/send-email`)).catch(() => [null] as const);
    await d?.body?.cancel();
    if (!r.ok || !text.includes("Delivrie")) return { state: "down", latency_ms: ms, detail: "delivrie.io isn't loading" };
    if (!d?.ok) return { state: "degraded", latency_ms: ms, detail: "The docs aren't loading" };
    return { state: ms > 4000 ? "degraded" : "operational", latency_ms: ms };
  },
  async billing() {
    const secret = String(await setting("cron_secret"));
    const [r, ms] = await timed(() => fetch(`${SUPABASE_URL}/functions/v1/billing/cron/health`, { method: "POST", headers: { "x-cron-secret": secret } }));
    const j: Any = await r.json().catch(() => ({}));
    if (!j.configured) return { state: "degraded", latency_ms: ms, detail: "Payments aren't available right now" };
    return j.ok ? { state: "operational", latency_ms: ms } : { state: "degraded", latency_ms: ms, detail: "Checkout may be unavailable" };
  },
};

export async function runStatusChecks() {
  const results = await Promise.all(COMPONENTS.map(async (c) => {
    let r: Result;
    try { r = await CHECKS[c.id](); } catch (e) { console.error("status check", c.id, e); r = { state: "down", detail: `${c.name} isn't responding` }; }
    return { component: c.id, state: r.state, latency_ms: r.latency_ms ?? null, detail: r.detail ?? null };
  }));
  await db.from("status_checks").insert(results);
  // keep about 95 days
  await db.from("status_checks").delete().lt("checked_at", since(95 * 24 * 60));
  return { checked: results.length, results };
}

export async function publicStatus() {
  const { data, error } = await db.rpc("status_summary", { p_days: 90 });
  if (error) throw error;
  const s: Any = data || {};
  const latest = new Map((s.latest || []).map((l: Any) => [l.component, l]));
  const days = new Map<string, Any[]>();
  for (const d of s.daily || []) { if (!days.has(d.component)) days.set(d.component, []); days.get(d.component)!.push({ day: d.day, uptime: d.uptime, worst: d.worst }); }
  const components = COMPONENTS.map((c) => {
    const l: Any = latest.get(c.id);
    return { id: c.id, name: c.name, about: c.about, state: l?.state || "operational", detail: l?.detail || null, latency_ms: l?.latency_ms ?? null, checked_at: l?.checked_at || null,
      uptime_90d: s.uptime?.[c.id] ?? null, days: (days.get(c.id) || []).sort((a, b) => String(a.day).localeCompare(String(b.day))) };
  });
  const states = components.map((c) => c.state);
  const overall = states.includes("down") ? "major_outage" : states.includes("degraded") ? "degraded" : "operational";
  const names = new Map(COMPONENTS.map((c) => [c.id, c.name]));
  const checkedAt = components.map((c) => c.checked_at).filter(Boolean).sort().pop() || null;
  const sending = components.find((c) => c.id === "sending");
  return {
    status: overall === "operational" ? "operational" : overall, // "operational" | "degraded" | "major_outage"
    sending: sending ? sending.state !== "down" : hasAws(),
    checked_at: checkedAt,
    components,
    incidents: (s.incidents || []).map((i: Any) => ({ component: i.component, component_name: names.get(i.component) || i.component, severity: i.severity, detail: i.detail, started_at: i.started_at, resolved_at: i.resolved_at })),
  };
}

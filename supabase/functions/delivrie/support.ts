// Support chat: customers write from the dashboard (chat button), the Delivrie team replies from Admin → Support.
// New customer messages email the platform admins; replies email the customer if they haven't seen them within a minute.
import { type Any, APP_URL, bad, db, domainOf, forbidden, notFound, SYSTEM_FROM } from "./util.ts";
import { hasAws } from "./ses.ts";
import { deliver } from "./send.ts";

// deno-lint-ignore no-explicit-any
type Route = (method: string, path: string, h: (req: Request, c: Any, p: Record<string, string>, url: URL, body: Any) => Promise<any>) => void;

const MAX = 5000;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const preview = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 140);
const msgOut = (m: Any) => ({ id: m.id, author: m.author, author_name: m.author === "support" ? (m.author_name || "Delivrie support") : m.author_name, body: m.body, created_at: m.created_at });

function needDashboard(c: Any) { if (c.via !== "dashboard" || !c.userId) throw forbidden("Support chat is only available from the dashboard"); }
async function isAdmin(userId: string | null) {
  if (!userId) return false;
  const { data } = await db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}
async function needAdmin(c: Any) { needDashboard(c); if (!(await isAdmin(c.userId))) throw forbidden("Platform admins only"); }
async function userEmail(id: string | null) {
  if (!id) return null;
  const { data } = await db.auth.admin.getUserById(id);
  return data?.user?.email || null;
}

// Notifications go out from the team that owns the system sender's domain, so they never appear in a customer's email log.
async function systemTeam(): Promise<string | null> {
  if (!SYSTEM_FROM) return null;
  const { data } = await db.from("domains").select("team_id").eq("name", domainOf(SYSTEM_FROM)).eq("status", "verified").limit(1);
  return data?.[0]?.team_id || null;
}
async function notify(to: string[], subject: string, html: string, text: string) {
  if (!to.length || !SYSTEM_FROM || !hasAws()) return false;
  const team = await systemTeam();
  if (!team) return false;
  try {
    const { data: row } = await db.from("emails").insert({ team_id: team, from: SYSTEM_FROM, to, subject, html, text, tags: [{ name: "category", value: "support" }] }).select("id").single();
    if (row) await deliver(row.id);
    return true;
  } catch (e) { console.error("support notify", e); return false; }
}
const wrap = (inner: string) => `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1a1a;max-width:560px">${inner}<p style="color:#8a8f98;font-size:12px;margin-top:28px">Delivrie · Lagos · delivrie.io</p></div>`;

async function threadForUser(userId: string) {
  const { data } = await db.from("support_threads").select("*").eq("user_id", userId).order("last_message_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}
async function messages(threadId: string) {
  const { data } = await db.from("support_messages").select("*").eq("thread_id", threadId).order("created_at").limit(500);
  return (data || []).map(msgOut);
}

// The tables come from supabase/migrations/20261113150000_delivrie_support_chat.sql. If that migration hasn't been
// applied yet, create them on first use through the database connection every edge function receives.
const SCHEMA = `
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  status text not null default 'open' check (status in ('open', 'closed')),
  last_message_at timestamptz not null default now(),
  last_author text check (last_author in ('customer', 'support')),
  last_preview text,
  unread_support int not null default 0,   -- customer messages the team hasn't read
  unread_customer int not null default 0,  -- replies the customer hasn't read
  customer_seen_at timestamptz,
  support_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_threads_user on public.support_threads(user_id, last_message_at desc);
create index if not exists support_threads_status on public.support_threads(status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author text not null check (author in ('customer', 'support')),
  user_id uuid references auth.users(id) on delete set null,
  author_name text,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread on public.support_messages(thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;`;
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const { error } = await db.from("support_threads").select("id").limit(1);
  if (!error) { schemaReady = true; return; }
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("Support chat tables are missing and SUPABASE_DB_URL isn't set");
  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres(url, { max: 1, prepare: false });
  try { await sql.unsafe(SCHEMA); await sql.unsafe("notify pgrst, 'reload schema'"); } finally { await sql.end(); }
  await new Promise((r) => setTimeout(r, 1500)); // let the REST layer pick up the new tables
  schemaReady = true;
}

export function registerSupport(route: Route) {
  const r0 = route;
  route = (method, path, h) => r0(method, path, async (req, c, p, url, body) => { await ensureSchema(); return h(req, c, p, url, body); });
  // ------------------------------------------------------------ customer
  route("GET", "/support/chat", async (_r, c) => {
    needDashboard(c);
    const t = await threadForUser(c.userId);
    if (!t) return { thread: null, messages: [], unread: 0 };
    if (t.unread_customer) await db.from("support_threads").update({ unread_customer: 0, customer_seen_at: new Date().toISOString() }).eq("id", t.id);
    else await db.from("support_threads").update({ customer_seen_at: new Date().toISOString() }).eq("id", t.id);
    return { thread: { id: t.id, status: t.status }, messages: await messages(t.id), unread: 0 };
  });
  route("GET", "/support/chat/unread", async (_r, c) => {
    needDashboard(c);
    const t = await threadForUser(c.userId);
    return { unread: t?.unread_customer || 0 };
  });
  route("POST", "/support/chat", async (_r, c, _p, _u, b) => {
    needDashboard(c);
    const body = String(b?.body || "").trim();
    if (!body) throw bad("Write a message first");
    if (body.length > MAX) throw bad(`Messages can be up to ${MAX.toLocaleString()} characters`);
    // light rate limit: 20 messages per 10 minutes per person
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    let t = await threadForUser(c.userId);
    if (t) {
      const { count } = await db.from("support_messages").select("id", { count: "exact", head: true }).eq("thread_id", t.id).eq("author", "customer").gte("created_at", since);
      if ((count || 0) >= 20) throw bad("You've sent a lot of messages in a short time. Give us a moment to reply.");
    }
    const email = c.email || await userEmail(c.userId);
    const { data: profile } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
    const name = profile?.full_name || email || "Customer";
    const now = new Date().toISOString();
    if (!t || t.status === "closed") {
      const { data } = await db.from("support_threads").insert({ team_id: c.teamId, user_id: c.userId, email, last_message_at: now, last_author: "customer", last_preview: preview(body), unread_support: 1 }).select().single();
      t = data;
    } else {
      await db.from("support_threads").update({ team_id: c.teamId, last_message_at: now, last_author: "customer", last_preview: preview(body), unread_support: (t.unread_support || 0) + 1 }).eq("id", t.id);
    }
    const { data: m } = await db.from("support_messages").insert({ thread_id: t.id, author: "customer", user_id: c.userId, author_name: name, body }).select().single();

    // Email the platform admins, at most once every 10 minutes per conversation.
    const last = t.support_notified_at ? new Date(t.support_notified_at).getTime() : 0;
    if (Date.now() - last > 10 * 60_000) {
      const { data: admins } = await db.from("platform_admins").select("user_id");
      const to = (await Promise.all((admins || []).map((a: Any) => userEmail(a.user_id)))).filter(Boolean) as string[];
      const { data: team } = c.teamId ? await db.from("teams").select("name").eq("id", c.teamId).maybeSingle() : { data: null };
      const link = `${APP_URL}/admin/support?t=${t.id}`;
      const sent = await notify(to, `New support message from ${name}`,
        wrap(`<p><b>${esc(name)}</b>${team?.name ? ` (${esc(team.name)})` : ""} wrote:</p><blockquote style="margin:0;padding:10px 14px;border-left:3px solid #fad600;background:#f6f6f4;white-space:pre-wrap">${esc(body)}</blockquote><p><a href="${link}" style="color:#1b1a1a;font-weight:600">Reply in Delivrie →</a></p>`),
        `${name}${team?.name ? ` (${team.name})` : ""} wrote:\n\n${body}\n\nReply: ${link}`);
      if (sent) await db.from("support_threads").update({ support_notified_at: now }).eq("id", t.id);
    }
    return { thread: { id: t.id, status: "open" }, message: msgOut(m) };
  });

  // ------------------------------------------------------------ admin
  route("GET", "/support/admin/threads", async (_r, c, _p, url) => {
    await needAdmin(c);
    const status = url.searchParams.get("status") || "open";
    let q = db.from("support_threads").select("*").order("last_message_at", { ascending: false }).limit(200);
    if (status !== "all") q = q.eq("status", status);
    const { data: rows } = await q;
    const teamIds = [...new Set((rows || []).map((r: Any) => r.team_id).filter(Boolean))];
    const { data: teams } = teamIds.length ? await db.from("teams").select("id,name,plan_transactional").in("id", teamIds) : { data: [] };
    const tm = new Map((teams || []).map((t: Any) => [t.id, t]));
    const { count } = await db.from("support_threads").select("id", { count: "exact", head: true }).gt("unread_support", 0);
    return {
      unread_threads: count || 0,
      data: (rows || []).map((r: Any) => ({ id: r.id, email: r.email, team: tm.get(r.team_id)?.name || null, plan: tm.get(r.team_id)?.plan_transactional || null, status: r.status, last_message_at: r.last_message_at, last_author: r.last_author, preview: r.last_preview, unread: r.unread_support })),
    };
  });
  route("GET", "/support/admin/unread", async (_r, c) => {
    await needAdmin(c);
    const { count } = await db.from("support_threads").select("id", { count: "exact", head: true }).gt("unread_support", 0);
    return { unread_threads: count || 0 };
  });
  route("GET", "/support/admin/threads/:id", async (_r, c, p) => {
    await needAdmin(c);
    const { data: t } = await db.from("support_threads").select("*").eq("id", p.id).maybeSingle();
    if (!t) throw notFound("Conversation");
    if (t.unread_support) await db.from("support_threads").update({ unread_support: 0 }).eq("id", t.id);
    const { data: team } = t.team_id ? await db.from("teams").select("id,name,plan_transactional,created_at").eq("id", t.team_id).maybeSingle() : { data: null };
    return { thread: { id: t.id, email: t.email, status: t.status, team, customer_seen_at: t.customer_seen_at, created_at: t.created_at }, messages: await messages(t.id) };
  });
  route("POST", "/support/admin/threads/:id/messages", async (_r, c, p, _u, b) => {
    await needAdmin(c);
    const body = String(b?.body || "").trim();
    if (!body) throw bad("Write a reply first");
    if (body.length > MAX) throw bad(`Replies can be up to ${MAX.toLocaleString()} characters`);
    const { data: t } = await db.from("support_threads").select("*").eq("id", p.id).maybeSingle();
    if (!t) throw notFound("Conversation");
    const { data: profile } = await db.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
    const first = String(profile?.full_name || "").split(" ")[0];
    const author = first ? `${first} from Delivrie` : "Delivrie support";
    const now = new Date().toISOString();
    const { data: m } = await db.from("support_messages").insert({ thread_id: t.id, author: "support", user_id: c.userId, author_name: author, body }).select().single();
    await db.from("support_threads").update({ status: "open", last_message_at: now, last_author: "support", last_preview: preview(body), unread_customer: (t.unread_customer || 0) + 1, unread_support: 0 }).eq("id", t.id);

    // Email the customer unless they're looking at the chat right now (seen in the last minute).
    const seen = t.customer_seen_at ? new Date(t.customer_seen_at).getTime() : 0;
    let emailed = false;
    if (t.email && Date.now() - seen > 60_000) {
      emailed = await notify([t.email], "Delivrie support replied",
        wrap(`<p><b>${esc(author)}</b> replied to your message:</p><blockquote style="margin:0;padding:10px 14px;border-left:3px solid #fad600;background:#f6f6f4;white-space:pre-wrap">${esc(body)}</blockquote><p><a href="${APP_URL}/emails?support=1" style="color:#1b1a1a;font-weight:600">Open the conversation →</a></p><p style="color:#62666d;font-size:13px">Reply from the chat button in your Delivrie dashboard.</p>`),
        `${author} replied:\n\n${body}\n\nOpen the conversation: ${APP_URL}/emails?support=1`);
    }
    return { message: msgOut(m), emailed };
  });
  route("PATCH", "/support/admin/threads/:id", async (_r, c, p, _u, b) => {
    await needAdmin(c);
    const status = b?.status === "closed" ? "closed" : "open";
    const { data } = await db.from("support_threads").update({ status }).eq("id", p.id).select("id,status").maybeSingle();
    if (!data) throw notFound("Conversation");
    return data;
  });
}

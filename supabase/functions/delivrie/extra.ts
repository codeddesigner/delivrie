// REST routes behind the newer MCP tools: inbox threads, automations and events, usage, received mail.
import { type Any, bad, db, HttpError, LIMITS, notFound, setting, SUPABASE_URL } from "./util.ts";

// deno-lint-ignore no-explicit-any
type Route = (method: string, path: string, h: (req: Request, c: Any, p: Record<string, string>, url: URL, body: Any) => Promise<any>) => void;
interface Deps { needFull: (c: Any) => void; sendEmails: (c: Any, bodies: Any[], idem: string | null) => Promise<{ id: string }[]> }

const clampLimit = (url: URL, d = 20, max = 100) => Math.min(Math.max(parseInt(url.searchParams.get("limit") || String(d)) || d, 1), max);

// The automations function owns publishing, validation and event ingestion; call it as this team.
async function automationsFn(teamId: string, method: string, path: string, body: Any) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/automations${path}`, {
    method, headers: { "content-type": "application/json", "x-internal-secret": await setting("cron_secret"), "x-team-id": teamId },
    body: JSON.stringify(body || {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, out.name || "automation_error", out.message || `Automations returned ${res.status}`);
  return out;
}

const threadOut = (t: Any, labels: Map<string, string>) => ({ object: "inbox_thread", id: t.id, mailbox: t.mailbox, contact: t.contact, contact_name: t.contact_name, subject: t.subject, snippet: t.snippet, message_count: t.message_count, unread: t.unread, status: t.status, labels: (t.labels || []).map((id: string) => labels.get(id)).filter(Boolean), last_at: t.last_at, needs_reply: !!t.last_inbound_at && (!t.last_outbound_at || t.last_inbound_at > t.last_outbound_at) });

export function registerExtra(route: Route, d: Deps) {
  // ------------------------------------------------------------ usage
  route("GET", "/usage", async (_r, c) => {
    const { data: t } = await db.from("teams").select("plan_transactional,plan_marketing,credits").eq("id", c.teamId).single();
    const plan = t?.plan_transactional || "free";
    const L = LIMITS[plan] || LIMITS.free;
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [m, dd] = await Promise.all([db.rpc("team_usage", { p_team: c.teamId, p_from: month.toISOString() }), db.rpc("team_usage", { p_team: c.teamId, p_from: day.toISOString() })]);
    return { object: "usage", plan, marketing_plan: t?.plan_marketing || "free", emails_this_month: Number(m.data || 0), monthly_allowance: L.month || null, emails_today: Number(dd.data || 0), daily_limit: L.day || null, credits_emails: Number(t?.credits || 0), overage_after_allowance: !!L.overage, billing_url: "https://delivrie.io/billing" };
  });

  // ------------------------------------------------------------ received mail
  route("GET", "/emails/received", async (_r, c, _p, url) => {
    d.needFull(c);
    const limit = clampLimit(url);
    let q = db.from("emails").select("id,from,to,subject,created_at,thread_id,attachments").eq("team_id", c.teamId).eq("direction", "inbound").order("created_at", { ascending: false }).limit(limit);
    const to = url.searchParams.get("to");
    if (to) q = q.contains("to", [to]);
    const { data } = await q;
    return { object: "list", data: (data || []).map((e: Any) => ({ ...e, attachments: (e.attachments || []).map((a: Any) => ({ filename: a.filename, content_type: a.content_type, size: a.size })) })) };
  });

  // ------------------------------------------------------------ inbox
  const labelMap = async (teamId: string) => {
    const { data } = await db.from("inbox_labels").select("id,name").eq("team_id", teamId);
    return { byId: new Map<string, string>((data || []).map((l: Any) => [l.id, l.name])), rows: data || [] };
  };
  route("GET", "/inbox/threads", async (_r, c, _p, url) => {
    d.needFull(c);
    const { byId, rows } = await labelMap(c.teamId);
    let q = db.from("inbox_threads").select("*").eq("team_id", c.teamId).order("last_at", { ascending: false }).limit(clampLimit(url));
    const status = url.searchParams.get("status") || "open";
    if (status !== "all") q = q.eq("status", status);
    if (url.searchParams.get("unread") === "true") q = q.eq("unread", true);
    const mailbox = url.searchParams.get("mailbox"); if (mailbox) q = q.eq("mailbox", mailbox.toLowerCase());
    const label = url.searchParams.get("label");
    if (label) { const l = rows.find((x: Any) => x.name.toLowerCase() === label.toLowerCase()); if (!l) return { object: "list", data: [] }; q = q.contains("labels", [l.id]); }
    const s = (url.searchParams.get("q") || "").replace(/[,%()]/g, " ").trim();
    if (s) q = q.or(`subject.ilike.%${s}%,contact.ilike.%${s}%,contact_name.ilike.%${s}%,snippet.ilike.%${s}%`);
    const { data } = await q;
    let out = (data || []).map((t: Any) => threadOut(t, byId));
    if (url.searchParams.get("needs_reply") === "true") out = out.filter((t: Any) => t.needs_reply);
    return { object: "list", data: out };
  });
  const getThread = async (c: Any, id: string) => {
    const { data: t } = await db.from("inbox_threads").select("*").eq("team_id", c.teamId).eq("id", id).maybeSingle();
    if (!t) throw notFound("Thread");
    return t;
  };
  route("GET", "/inbox/threads/:id", async (_r, c, p) => {
    d.needFull(c);
    const t = await getThread(c, p.id);
    const { byId } = await labelMap(c.teamId);
    const { data: msgs } = await db.from("emails").select("id,direction,from,to,subject,text,html,status,created_at,headers,attachments").eq("thread_id", t.id).order("created_at").limit(100);
    const strip = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    return { ...threadOut(t, byId), messages: (msgs || []).map((m: Any) => ({ id: m.id, direction: m.direction, from: m.from, to: m.to, subject: m.subject, status: m.status, created_at: m.created_at, message_id: m.headers?.["message-id"] || null, text: (m.text || (m.html ? strip(m.html) : "")).slice(0, 20000), attachments: (m.attachments || []).map((a: Any) => a.filename) })) };
  });
  route("POST", "/inbox/threads/:id/reply", async (_r, c, p, _u, b) => {
    const t = await getThread(c, p.id);
    const text = String(b?.text || "").trim();
    const html = b?.html ? String(b.html) : text ? `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</div>` : "";
    if (!text && !html) throw bad("Write a reply in `text` or `html`");
    const { data: last } = await db.from("emails").select("headers").eq("thread_id", t.id).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const mid = last?.headers?.["message-id"];
    const refs = [last?.headers?.references, mid].filter(Boolean).join(" ").trim();
    const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
    const [out] = await d.sendEmails(c, [{ from: b?.from || t.mailbox, to: [t.contact], subject, text: text || undefined, html, headers: mid ? { "In-Reply-To": mid, References: refs } : {}, tags: [{ name: "source", value: "inbox" }] }], null);
    return { object: "email", id: out.id, thread_id: t.id };
  });
  route("PATCH", "/inbox/threads/:id", async (_r, c, p, _u, b) => {
    d.needFull(c);
    const t = await getThread(c, p.id);
    const patch: Any = {};
    if (b?.status) { if (!["open", "archived"].includes(b.status)) throw bad("status must be open or archived"); patch.status = b.status; }
    if (typeof b?.unread === "boolean") patch.unread = b.unread;
    if (Array.isArray(b?.labels)) {
      const { rows } = await labelMap(c.teamId);
      const ids: string[] = [];
      for (const name of b.labels.map((x: unknown) => String(x).trim()).filter(Boolean)) {
        let l = rows.find((x: Any) => x.name.toLowerCase() === name.toLowerCase());
        if (!l) { const { data } = await db.from("inbox_labels").insert({ team_id: c.teamId, name: name.slice(0, 40), color: "#a774f2" }).select("id,name").single(); l = data; rows.push(l); }
        if (l) ids.push(l.id);
      }
      patch.labels = ids;
    }
    if (!Object.keys(patch).length) throw bad("Nothing to change. Pass status, unread or labels.");
    await db.from("inbox_threads").update(patch).eq("id", t.id);
    return { object: "inbox_thread", id: t.id, ...patch, labels: b?.labels };
  });
  route("GET", "/inbox/labels", async (_r, c) => { d.needFull(c); const { rows } = await labelMap(c.teamId); return { object: "list", data: rows }; });

  // ------------------------------------------------------------ automations & events
  const autoOut = (a: Any) => ({ object: "automation", id: a.id, name: a.name, status: a.status, trigger: a.trigger, steps: Object.values(a.steps || {}).length, reentry: a.reentry, version: a.version, published_at: a.published_at, updated_at: a.updated_at });
  route("GET", "/automations", async (_r, c) => { d.needFull(c); const { data } = await db.from("automations").select("*").eq("team_id", c.teamId).order("updated_at", { ascending: false }); return { object: "list", data: (data || []).map(autoOut) }; });
  route("GET", "/automations/:id", async (_r, c, p) => {
    d.needFull(c);
    const { data: a } = await db.from("automations").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
    if (!a) throw notFound("Automation");
    const { data: stats } = await db.from("automation_runs").select("status").eq("automation_id", a.id).eq("test", false).limit(5000);
    const count = (s: string) => (stats || []).filter((r: Any) => r.status === s).length;
    return { ...autoOut(a), steps: a.steps, start_step: a.start_step, runs: { running: count("running"), completed: count("completed"), failed: count("failed"), canceled: count("canceled") } };
  });
  route("GET", "/automations/:id/runs", async (_r, c, p, url) => {
    d.needFull(c);
    let q = db.from("automation_runs").select("id,email,status,trigger,current_step,started_at,finished_at,error,log").eq("team_id", c.teamId).eq("automation_id", p.id).order("started_at", { ascending: false }).limit(clampLimit(url));
    const st = url.searchParams.get("status"); if (st) q = q.eq("status", st);
    const { data } = await q;
    return { object: "list", data: data || [] };
  });
  // Simple linear automations: a trigger and a list of send / wait steps. Branches are built in the dashboard.
  route("POST", "/automations", async (_r, c, _p, _u, b) => {
    d.needFull(c);
    const name = String(b?.name || "Untitled automation").slice(0, 120);
    const trig = b?.trigger || {};
    let trigger: Any;
    if (trig.event || trig.type === "event") trigger = { type: "event", event: String(trig.event || "").trim() };
    else if (trig.segment_id) trigger = { type: "segment", segment_id: trig.segment_id };
    else throw bad("trigger needs an event name (e.g. { \"event\": \"user.created\" }) or a segment_id");
    const list: Any[] = Array.isArray(b?.steps) ? b.steps : [];
    if (!list.length || list.length > 30) throw bad("Add between 1 and 30 steps");
    const steps: Any = {};
    const ids = list.map((_s, i) => `s${i + 1}`);
    for (const [i, s] of list.entries()) {
      const id = ids[i], next = ids[i + 1] || null;
      if (s.type === "send" || s.template_id) {
        if (!s.template_id) throw bad(`Step ${i + 1}: a send step needs a template_id`);
        const { data: t } = await db.from("templates").select("id").eq("team_id", c.teamId).or(`id.eq.${/^[0-9a-f-]{36}$/i.test(s.template_id) ? s.template_id : "00000000-0000-0000-0000-000000000000"},alias.eq.${s.template_id}`).maybeSingle();
        if (!t) throw bad(`Step ${i + 1}: template ${s.template_id} not found`);
        steps[id] = { id, type: "send", template_id: t.id, from: s.from || undefined, subject: s.subject || undefined, next };
      } else if (s.type === "wait") {
        steps[id] = { id, type: "wait", amount: Math.max(1, Number(s.amount) || 1), unit: ["minutes", "hours", "days", "weeks"].includes(s.unit) ? s.unit : "days", next };
      } else throw bad(`Step ${i + 1}: use type send or wait. Build branches in the dashboard.`);
    }
    const { data: a, error } = await db.from("automations").insert({ team_id: c.teamId, name, trigger, steps, start_step: ids[0], reentry: b?.reentry === "always" ? "always" : "once", created_by: c.userId }).select().single();
    if (error) throw bad(error.message);
    if (b?.publish) await automationsFn(c.teamId, "POST", `/automations/${a.id}/publish`, {});
    const { data: fresh } = await db.from("automations").select("*").eq("id", a.id).single();
    return { ...autoOut(fresh), url: `https://delivrie.io/automations/${a.id}` };
  });
  route("POST", "/automations/:id/:action", async (_r, c, p, _u, b) => {
    d.needFull(c);
    if (!["publish", "pause", "resume", "test"].includes(p.action)) throw notFound("Action");
    return await automationsFn(c.teamId, "POST", `/automations/${p.id}/${p.action}`, b || {});
  });
  route("POST", "/events", async (_r, c, _p, _u, b) => automationsFn(c.teamId, "POST", "/events", b || {}));
  route("GET", "/events", async (_r, c, _p, url) => {
    d.needFull(c);
    const name = url.searchParams.get("name");
    if (name) { const { data } = await db.from("events").select("id,name,email,data,created_at").eq("team_id", c.teamId).eq("name", name).order("created_at", { ascending: false }).limit(clampLimit(url)); return { object: "list", data: data || [] }; }
    const { data } = await db.from("event_definitions").select("name,description,fields,first_seen_at,last_seen_at").eq("team_id", c.teamId).order("last_seen_at", { ascending: false, nullsFirst: false });
    return { object: "list", data: data || [] };
  });

  // ------------------------------------------------------------ topics & contact properties (read)
  route("GET", "/topics", async (_r, c) => { d.needFull(c); const { data } = await db.from("topics").select("id,name,description,default_subscription,visibility").eq("team_id", c.teamId).order("created_at"); return { object: "list", data: data || [] }; });
  route("GET", "/contact-properties", async (_r, c) => { d.needFull(c); const { data } = await db.from("contact_properties").select("key,type,fallback").eq("team_id", c.teamId).order("key"); return { object: "list", data: data || [] }; });
}

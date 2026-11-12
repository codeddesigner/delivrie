// Delivrie automations: custom events in, runs that walk an automation's steps, emails out.
// Served at https://delivrie.io/api/automations/* (Vercel rewrite) and called by pg_cron every minute.
//   POST /events                      { event, email, data? }  API key (dlv_…) or dashboard session
//   POST /automations/:id/publish     { enroll_recent? }        dashboard
//   POST /automations/:id/pause | /resume | /test { email, data? }
//   POST /runs/:id/retry | /skip | /cancel
//   POST /cron                        x-cron-secret
// Emails are queued in the emails table; the main delivrie function delivers them.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// deno-lint-ignore no-explicit-any
type Any = any;
const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-team-id, x-client-info, apikey", "access-control-allow-methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });
class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const bad = (m: string) => new HttpError(422, "validation_error", m);
const enc = new TextEncoder();
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
// deno-lint-ignore no-explicit-any
const waitUntil = (p: Promise<unknown>) => { try { (globalThis as any).EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

// ---------------------------------------------------------------- auth
async function auth(req: Request) {
  // The Delivrie API (MCP tools) calls in on behalf of a team it has already authenticated.
  const internal = req.headers.get("x-internal-secret");
  if (internal) {
    const { data: s } = await db.from("system_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const teamId = req.headers.get("x-team-id") || "";
    if (!s?.value || internal !== s.value || !teamId) throw new HttpError(401, "unauthorized", "Unauthorized");
    return { teamId, dashboard: true, full: true };
  }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "missing_api_key", "Missing API key in the Authorization header. Use Authorization: Bearer dlv_xxx");
  if (token.startsWith("dlv_")) {
    const { data: key } = await db.from("api_keys").select("id,team_id,permission").eq("key_hash", await sha256(token)).maybeSingle();
    if (!key) throw new HttpError(401, "invalid_api_key", "API key is invalid");
    return { teamId: key.team_id as string, dashboard: false, full: key.permission === "full" };
  }
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) throw new HttpError(401, "invalid_api_key", "Session expired. Log in again.");
  const teamId = req.headers.get("x-team-id") || "";
  const { data: m } = await db.from("team_members").select("role").eq("team_id", teamId).eq("user_id", u.user.id).maybeSingle();
  if (!m) throw new HttpError(403, "forbidden", "You are not a member of this team");
  return { teamId, dashboard: true, full: true };
}

// ---------------------------------------------------------------- helpers
const get = (o: Any, path: string) => path.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
function render(str: string | null, vars: Record<string, unknown>) {
  if (!str) return str;
  return str.replace(/\{\{\{?\s*([\w.]+)\s*(?:\|\s*([^}]*?))?\s*\}?\}\}/g, (_m, k, fb) => {
    const v = get(vars, k) ?? vars[k];
    const s = v == null || v === "" ? (fb ?? "").replace(/^["']|["']$/g, "") : String(v);
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  });
}
function passes(filter: Any, ctx: Any) {
  if (!filter?.field) return true;
  const v = get(ctx, filter.field);
  const want = filter.value;
  switch (filter.op || "eq") {
    case "eq": return String(v ?? "") === String(want ?? "");
    case "neq": return String(v ?? "") !== String(want ?? "");
    case "contains": return String(v ?? "").toLowerCase().includes(String(want ?? "").toLowerCase());
    case "exists": return v !== undefined && v !== null && v !== "";
    case "gt": return Number(v) > Number(want);
    case "lt": return Number(v) < Number(want);
    default: return true;
  }
}
const ms = (amount: number, unit: string) => amount * ({ minutes: 60e3, hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3 }[unit] || 86400e3);
const typeOf = (v: unknown) => typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : Array.isArray(v) ? "array" : v && typeof v === "object" ? "object" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : "string";
function flatten(o: Any, prefix = "data", out: Any[] = []) {
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out.length < 40) flatten(v, `${prefix}.${k}`, out);
    else out.push({ name: `${prefix}.${k}`, type: typeOf(v), example: typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60) });
  }
  return out;
}

async function contactFor(teamId: string, email: string, extra: Any = {}) {
  const e = email.toLowerCase();
  const { data: c } = await db.from("contacts").select("*").eq("team_id", teamId).eq("email", e).maybeSingle();
  if (c) return c;
  const { data: created } = await db.from("contacts").insert({ team_id: teamId, email: e, first_name: extra.first_name || null, last_name: extra.last_name || null }).select().single();
  return created || (await db.from("contacts").select("*").eq("team_id", teamId).eq("email", e).single()).data;
}

async function startRun(a: Any, email: string, data: Any, trigger: string, test = false) {
  if (!a.start_step) return null;
  if (!test && a.reentry === "once") {
    const { count } = await db.from("automation_runs").select("id", { count: "exact", head: true }).eq("automation_id", a.id).eq("email", email.toLowerCase()).eq("test", false);
    if (count) return null;
  }
  const c = await contactFor(a.team_id, email);
  const { data: run } = await db.from("automation_runs").insert({ automation_id: a.id, team_id: a.team_id, contact_id: c?.id || null, email: email.toLowerCase(), data: data || {}, trigger, version: a.version, current_step: a.start_step, next_at: new Date().toISOString(), test, log: [{ type: "trigger", title: trigger, at: new Date().toISOString(), status: "done" }] }).select().single();
  return run;
}

// ---------------------------------------------------------------- runner
const autoCache = new Map<string, Any>();
async function automation(id: string) {
  if (autoCache.has(id)) return autoCache.get(id);
  const { data } = await db.from("automations").select("*").eq("id", id).single();
  autoCache.set(id, data); return data;
}
async function verifiedFrom(teamId: string, from: string) {
  const dom = (from.match(/@([^>\s]+)>?\s*$/)?.[1] || "").toLowerCase();
  if (!dom) return false;
  const { data } = await db.from("domains").select("name,status").eq("team_id", teamId).eq("status", "verified");
  return (data || []).some((d: Any) => dom === d.name || dom.endsWith("." + d.name));
}

async function processRun(run: Any): Promise<void> {
  const a = await automation(run.automation_id);
  if (!a) return;
  if (a.status === "paused" && !run.test) { await db.from("automation_runs").update({ next_at: new Date(Date.now() + 3600e3).toISOString() }).eq("id", run.id); return; }
  const log: Any[] = Array.isArray(run.log) ? run.log : [];
  const now = () => new Date().toISOString();
  const save = (patch: Any) => db.from("automation_runs").update({ log, ...patch }).eq("id", run.id);
  const fail = async (step: Any, code: string, message: string) => { log.push({ step: step?.id, type: step?.type, title: stepTitle(step), at: now(), status: "failed", error: message, code }); await save({ status: "failed", error: message, next_at: null }); };
  const { data: contact } = run.contact_id ? await db.from("contacts").select("*").eq("id", run.contact_id).maybeSingle() : { data: null };
  const vars = { ...(contact?.properties || {}), first_name: contact?.first_name, last_name: contact?.last_name, email: run.email, contact_id: contact?.id, data: run.data || {}, ...(run.data || {}) };

  for (let i = 0; i < 25; i++) {
    const step = a.steps?.[run.current_step];
    if (!step || step.type === "end") {
      log.push({ type: "end", title: "Run completed", at: now(), status: "done" });
      await save({ status: "completed", current_step: null, next_at: null, finished_at: now() });
      return;
    }
    let next: string | null = step.next || null;
    try {
      if (step.type === "send") {
        const { data: t } = await db.from("templates").select("id,name,subject,html,text,from,reply_to,status").eq("team_id", a.team_id).eq("id", step.template_id || "").maybeSingle();
        if (!t) return fail(step, "template_not_found", "Choose a template for this step.");
        if (t.status !== "published" || !t.html) return fail(step, "template_not_published", `Publish “${t.name}” before it can be sent.`);
        const from = step.from || t.from;
        if (!from) return fail(step, "missing_from", "Add a From address to this step or its template.");
        if (!(await verifiedFrom(a.team_id, from))) return fail(step, "invalid_from_address", `The from address ${from} isn’t on a verified domain. Fix the domain, then retry.`);
        if (contact?.unsubscribed && step.marketing) { log.push({ step: step.id, type: "send", title: stepTitle(step, t), at: now(), status: "skipped", detail: "Contact is unsubscribed" }); }
        else {
          const { data: e, error } = await db.from("emails").insert({
            team_id: a.team_id, template_id: t.id, contact_id: contact?.id || null, from, to: [run.email], reply_to: step.reply_to || t.reply_to ? [step.reply_to || t.reply_to] : null,
            subject: render(step.subject || t.subject || "", vars), html: render(t.html, vars), text: render(t.text, vars), status: "queued",
            tags: [{ name: "automation", value: a.id }, { name: "run", value: run.id }], headers: {},
          }).select("id").single();
          if (error) return fail(step, "send_failed", error.message);
          log.push({ step: step.id, type: "send", title: stepTitle(step, t), at: now(), status: "sent", email_id: e.id });
        }
      } else if (step.type === "wait") {
        const last = log[log.length - 1];
        if (last?.step === step.id && last.status === "waiting") {
          if (new Date(last.until) > new Date()) { await save({ next_at: last.until }); return; }
          last.status = "done"; last.at_done = now();
        } else {
          const until = new Date(Date.now() + ms(Number(step.amount) || 1, step.unit || "days")).toISOString();
          log.push({ step: step.id, type: "wait", title: stepTitle(step), at: now(), status: "waiting", until });
          await save({ next_at: until }); return;
        }
      } else if (step.type === "condition") {
        let yes = false;
        if (step.kind === "opened" || step.kind === "clicked") {
          const sent = [...log].reverse().find((l) => l.type === "send" && l.email_id && (!step.ref || l.step === step.ref));
          if (sent) {
            const { data: evs } = await db.from("email_events").select("type,created_at").eq("email_id", sent.email_id).in("type", step.kind === "opened" ? ["opened", "clicked"] : ["clicked"]).limit(1);
            yes = !!evs?.length;
            const deadline = new Date(new Date(sent.at).getTime() + ms(Number(step.within) || 2, step.within_unit || "days"));
            if (!yes && deadline > new Date()) {
              const last = log[log.length - 1];
              if (!(last?.step === step.id && last.status === "checking")) log.push({ step: step.id, type: "condition", title: stepTitle(step), at: now(), status: "checking", until: deadline.toISOString() });
              await save({ next_at: new Date(Math.min(deadline.getTime(), Date.now() + 15 * 60e3)).toISOString() }); return;
            }
            if (log[log.length - 1]?.step === step.id && log[log.length - 1].status === "checking") log.pop();
          }
        } else {
          const field = step.field?.startsWith("data.") ? step.field : step.field ? `contact.${step.field}` : "";
          yes = passes({ field, op: step.op, value: step.value }, { data: run.data || {}, contact: { ...(contact?.properties || {}), first_name: contact?.first_name, last_name: contact?.last_name, email: run.email } });
        }
        next = yes ? step.yes || null : step.no || null;
        log.push({ step: step.id, type: "condition", title: `${stepTitle(step)} → ${yes ? "Yes" : "No"}`, at: now(), status: "done", result: yes });
      } else if (step.type === "update_contact") {
        if (!contact) return fail(step, "no_contact", "This run has no contact to update.");
        const patch: Any = {};
        if (step.field === "unsubscribed") patch.unsubscribed = step.value === true || step.value === "true";
        else if (["first_name", "last_name"].includes(step.field)) patch[step.field] = render(String(step.value ?? ""), vars);
        else if (step.field) patch.properties = { ...(contact.properties || {}), [step.field]: render(String(step.value ?? ""), vars) };
        await db.from("contacts").update(patch).eq("id", contact.id);
        log.push({ step: step.id, type: "update_contact", title: stepTitle(step), at: now(), status: "done" });
      } else if (step.type === "add_segment") {
        if (!contact || !step.segment_id) return fail(step, "invalid_step", "Choose a segment for this step.");
        await db.from("segment_contacts").upsert({ segment_id: step.segment_id, contact_id: contact.id, team_id: a.team_id }, { onConflict: "segment_id,contact_id", ignoreDuplicates: true });
        log.push({ step: step.id, type: "add_segment", title: stepTitle(step), at: now(), status: "done" });
      } else if (step.type === "webhook") {
        if (!/^https:\/\//.test(step.url || "")) return fail(step, "invalid_step", "The webhook URL must start with https://");
        const r = await fetch(step.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Delivrie-Automations/1.0" }, body: JSON.stringify({ type: "automation.step", automation_id: a.id, run_id: run.id, email: run.email, data: run.data || {} }), signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, status: 0, statusText: String(e.message) } as Any));
        if (!r.ok) return fail(step, "webhook_failed", `${step.url} returned ${r.status || "no response"}${r.statusText ? ` (${r.statusText})` : ""}.`);
        log.push({ step: step.id, type: "webhook", title: stepTitle(step), at: now(), status: "done", detail: `${r.status}` });
      }
    } catch (e) {
      return fail(step, "step_error", String((e as Error).message || e));
    }
    run.current_step = next;
    await save({ current_step: next, next_at: now(), status: "running", error: null });
  }
}
function stepTitle(s: Any, t?: Any) {
  if (!s) return "Step";
  switch (s.type) {
    case "send": return `Sent “${t?.name || s.label || "email"}”`;
    case "wait": return `Wait ${s.amount || 1} ${s.unit || "days"}`;
    case "condition": return s.kind === "opened" ? "Opened email?" : s.kind === "clicked" ? "Clicked email?" : `${s.field || "Condition"} ${s.op || "is"} ${s.value ?? ""}`;
    case "update_contact": return `Set ${s.field || "contact"}`;
    case "add_segment": return "Added to segment";
    case "webhook": return "Called webhook";
    default: return s.type;
  }
}

async function processDue(teamId?: string, limit = 200) {
  autoCache.clear();
  let q = db.from("automation_runs").select("*").eq("status", "running").lte("next_at", new Date().toISOString()).order("next_at").limit(limit);
  if (teamId) q = q.eq("team_id", teamId);
  const { data: runs } = await q;
  let n = 0;
  for (const r of runs || []) {
    // claim the run so overlapping invocations don't double-process it
    const { data: claimed } = await db.from("automation_runs").update({ next_at: new Date(Date.now() + 5 * 60e3).toISOString() }).eq("id", r.id).eq("next_at", r.next_at).eq("status", "running").select("id");
    if (!claimed?.length) continue;
    await processRun(r).catch((e) => console.error("run failed", r.id, e));
    n++;
  }
  return n;
}

async function fireSchedules() {
  const { data: autos } = await db.from("automations").select("*").eq("status", "live").lte("next_fire_at", new Date().toISOString());
  let started = 0;
  for (const a of autos || []) {
    await db.from("automations").update({ next_fire_at: nextFire(a.trigger, new Date(Date.now() + 60e3)) }).eq("id", a.id);
    if (!a.trigger?.segment_id) continue;
    const { data: members } = await db.from("segment_contacts").select("contacts(email,unsubscribed)").eq("segment_id", a.trigger.segment_id).limit(5000);
    for (const m of members || []) { const c = (m as Any).contacts; if (c?.email && !c.unsubscribed && await startRun({ ...a, reentry: "always" }, c.email, {}, "schedule")) started++; }
  }
  return started;
}
function nextFire(t: Any, from = new Date()) {
  if (t?.type !== "schedule") return null;
  const [h, m] = String(t.at || "09:00").split(":").map(Number);
  const d = new Date(from); d.setUTCSeconds(0, 0); d.setUTCHours(h || 0, m || 0);
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  if (t.every === "week") { const wd = Number(t.weekday ?? 1); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); }
  return d.toISOString();
}

// ---------------------------------------------------------------- routes
async function handle(req: Request, path: string) {
  if (path === "/cron" && req.method === "POST") {
    const { data: s } = await db.from("system_settings").select("value").eq("key", "cron_secret").maybeSingle();
    if (!s?.value || req.headers.get("x-cron-secret") !== s.value) throw new HttpError(401, "unauthorized", "Unauthorized");
    const scheduled = await fireSchedules();
    const processed = await processDue();
    return json({ scheduled, processed });
  }
  const c = await auth(req);
  const body = await req.json().catch(() => ({}));

  if (path === "/events" && req.method === "POST") {
    const name = String(body.event || body.name || "").trim();
    const email = String(body.email || body.contact?.email || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(name)) throw bad("`event` must be lowercase letters, numbers, dots, dashes or underscores, like user.created");
    if (!EMAIL_RE.test(email)) throw bad("`email` must be a valid email address");
    const data = body.data && typeof body.data === "object" ? body.data : {};
    if (JSON.stringify(data).length > 32000) throw bad("`data` must be under 32 KB");
    const contact = await contactFor(c.teamId, email, body.contact || {});
    const { data: ev } = await db.from("events").insert({ team_id: c.teamId, name, email, contact_id: contact?.id || null, data }).select("id,created_at").single();
    const { data: def } = await db.from("event_definitions").select("id,fields,first_seen_at").eq("team_id", c.teamId).eq("name", name).maybeSingle();
    const seen = new Set((def?.fields || []).map((f: Any) => f.name));
    const fields = [...(def?.fields || []), ...flatten(data).filter((f) => !seen.has(f.name))].slice(0, 40);
    if (def) await db.from("event_definitions").update({ last_seen_at: ev.created_at, first_seen_at: def.first_seen_at || ev.created_at, fields }).eq("id", def.id);
    else await db.from("event_definitions").insert({ team_id: c.teamId, name, fields, first_seen_at: ev.created_at, last_seen_at: ev.created_at });
    const { data: autos } = await db.from("automations").select("*").eq("team_id", c.teamId).eq("status", "live").eq("trigger->>type", "event").eq("trigger->>event", name);
    const runs = [];
    for (const a of autos || []) if (passes(a.trigger.filter, { data, email })) { const r = await startRun(a, email, data, name); if (r) runs.push(r.id); }
    if (runs.length) waitUntil(processDue(c.teamId, 50));
    return json({ object: "event", id: ev.id, event: name, runs: runs.length });
  }

  if (!c.dashboard) throw new HttpError(403, "forbidden", "Use the dashboard to manage automations.");
  let m = path.match(/^\/automations\/([0-9a-f-]{36})\/(publish|pause|resume|test)$/);
  if (m && req.method === "POST") {
    const { data: a } = await db.from("automations").select("*").eq("team_id", c.teamId).eq("id", m[1]).maybeSingle();
    if (!a) throw new HttpError(404, "not_found", "Automation not found");
    if (m[2] === "pause") { await db.from("automations").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", a.id); return json({ id: a.id, status: "paused" }); }
    const problems = validate(a);
    if (m[2] === "test") {
      if (problems.length) throw bad(problems[0]);
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw bad("Enter an email address for the test run");
      const run = await startRun(a, email, body.data || {}, "test", true);
      await processDue(c.teamId, 20);
      return json({ run_id: run?.id });
    }
    if (problems.length) throw bad(problems[0]);
    const patch: Any = { status: "live", updated_at: new Date().toISOString(), next_fire_at: nextFire(a.trigger) };
    if (m[2] === "publish") { patch.version = (a.version || 0) + 1; patch.published_at = new Date().toISOString(); }
    await db.from("automations").update(patch).eq("id", a.id);
    let enrolled = 0;
    if (m[2] === "publish" && body.enroll_recent) {
      const live = { ...a, ...patch };
      if (a.trigger.type === "event") {
        const { data: evs } = await db.from("events").select("email,data").eq("team_id", c.teamId).eq("name", a.trigger.event).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(2000);
        const done = new Set<string>();
        for (const e of evs || []) { if (!e.email || done.has(e.email)) continue; done.add(e.email); if (passes(a.trigger.filter, { data: e.data, email: e.email }) && await startRun(live, e.email, e.data, a.trigger.event)) enrolled++; }
      } else if (a.trigger.type === "segment") {
        const { data: members } = await db.from("segment_contacts").select("contacts(email)").eq("segment_id", a.trigger.segment_id).limit(5000);
        for (const mm of members || []) { const e = (mm as Any).contacts?.email; if (e && await startRun(live, e, {}, "segment")) enrolled++; }
      }
      if (enrolled) waitUntil(processDue(c.teamId, 100));
    }
    return json({ id: a.id, status: "live", version: patch.version ?? a.version, enrolled });
  }
  m = path.match(/^\/runs\/([0-9a-f-]{36})\/(retry|skip|cancel)$/);
  if (m && req.method === "POST") {
    const { data: r } = await db.from("automation_runs").select("*").eq("team_id", c.teamId).eq("id", m[1]).maybeSingle();
    if (!r) throw new HttpError(404, "not_found", "Run not found");
    if (m[2] === "cancel") { await db.from("automation_runs").update({ status: "canceled", next_at: null, finished_at: new Date().toISOString() }).eq("id", r.id); return json({ id: r.id, status: "canceled" }); }
    if (r.status !== "failed") throw bad("Only failed runs can be retried or skipped");
    const a = await automation(r.automation_id);
    const step = a?.steps?.[r.current_step];
    const patch: Any = { status: "running", error: null, next_at: new Date().toISOString(), finished_at: null };
    if (m[2] === "skip") { patch.current_step = step?.type === "condition" ? step.no || null : step?.next || null; patch.log = [...r.log, { step: r.current_step, type: step?.type, title: "Step skipped", at: new Date().toISOString(), status: "skipped" }]; }
    await db.from("automation_runs").update(patch).eq("id", r.id);
    await processDue(c.teamId, 20);
    const { data: after } = await db.from("automation_runs").select("status,error").eq("id", r.id).single();
    return json({ id: r.id, ...after });
  }
  throw new HttpError(404, "not_found", "Not found");
}

function validate(a: Any) {
  const out: string[] = [];
  const t = a.trigger || {};
  if (t.type === "event" && !t.event) out.push("Choose the event that starts this automation.");
  if ((t.type === "segment" || t.type === "schedule") && !t.segment_id) out.push("Choose a segment for the trigger.");
  if (!a.start_step || !a.steps?.[a.start_step]) out.push("Add at least one step.");
  for (const s of Object.values(a.steps || {}) as Any[]) {
    if (s.type === "send" && !s.template_id) out.push("Every Send email step needs a template.");
    if (s.type === "webhook" && !/^https:\/\//.test(s.url || "")) out.push("Every webhook step needs an https:// URL.");
    if (s.type === "add_segment" && !s.segment_id) out.push("Choose a segment in the Add to segment step.");
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const i = url.pathname.indexOf("/automations");
  let path = i >= 0 ? url.pathname.slice(i + "/automations".length) : url.pathname;
  path = path.replace(/\/$/, "") || "/";
  try { return await handle(req, path); }
  catch (e) {
    if (e instanceof HttpError) return json({ statusCode: e.status, name: e.code, message: e.message }, e.status);
    console.error(e);
    return json({ statusCode: 500, name: "internal_error", message: "Something went wrong. Try again." }, 500);
  }
});

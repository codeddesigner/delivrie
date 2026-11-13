import { type Any, APP_URL, asArray, bad, CORS, db, domainOf, emailOnly, ENFORCE_LIMITS, errorJson, forbidden, HttpError, json, LIMITS, notFound, pageParams, randomToken, setting, sha256, SYSTEM_FROM, waitUntil } from "./util.ts";
import { accountStatus, createDomain, deleteDomain, doh, hasAws, regionLabel, updateDomainConfig, verifyDomain } from "./ses.ts";
import { attemptDelivery, deliver, emit, handleSesEvent, payloadFor, systemDomain, validateRecipients, verifyUnsubscribeToken } from "./send.ts";
import { EMAIL_RE, parseAddress } from "./mime.ts";
import { blocksToText, renderBlocks, renderVars, usedVars } from "./blocks.js";
import { DOCS, searchDocs } from "./docs.js";
import { oauthAuthorize, oauthGrantFromToken, oauthPublic, scopeAllows } from "./oauth.ts";
import { handleMcp } from "./mcp.ts";
import { registerExtra } from "./extra.ts";
import { SES_REGIONS } from "./aws.ts";

interface Ctx { teamId: string; userId: string | null; apiKey: Any | null; permission: "full" | "sending"; via: "api" | "dashboard"; userAgent: string; email?: string; scopes?: string[] }

// ---------------------------------------------------------------- auth
async function authenticate(req: Request): Promise<Ctx> {
  const h = req.headers.get("authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  const ua = req.headers.get("user-agent") || "";
  if (!token) throw new HttpError(401, "missing_api_key", "Missing API key in the Authorization header. Use Authorization: Bearer dlv_xxx");
  if (token.startsWith("dlv_")) {
    const { data: key } = await db.from("api_keys").select("*").eq("key_hash", await sha256(token)).maybeSingle();
    if (!key) throw new HttpError(401, "invalid_api_key", "API key is invalid");
    waitUntil(db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id));
    return { teamId: key.team_id, userId: null, apiKey: key, permission: key.permission, via: "api", userAgent: ua };
  }
  // Connected apps (OAuth access tokens for MCP clients)
  if (token.startsWith("dlvo_")) {
    const g = await oauthGrantFromToken(token);
    return { teamId: g.team_id, userId: g.user_id, apiKey: null, permission: "full", via: "api", userAgent: ua || g.client_name, scopes: g.scopes };
  }
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) throw new HttpError(401, "invalid_api_key", "Session expired. Log in again.");
  const teamId = req.headers.get("x-team-id") || "";
  if (!teamId) throw new HttpError(400, "missing_team", "x-team-id header is required");
  const { data: m } = await db.from("team_members").select("role").eq("team_id", teamId).eq("user_id", u.user.id).maybeSingle();
  if (!m) throw new HttpError(403, "forbidden", "You are not a member of this team");
  return { teamId, userId: u.user.id, apiKey: null, permission: "full", via: "dashboard", userAgent: "Dashboard", email: u.user.email };
}
const needFull = (c: Ctx) => { if (c.permission !== "full") throw forbidden("This API key can only send emails"); };

async function logRequest(c: Ctx, endpoint: string, method: string, status: number, reqBody: unknown, resBody: unknown) {
  const clean = (b: Any) => {
    if (!b || typeof b !== "object") return b ?? null;
    const s = JSON.stringify(b, (k, v) => (k === "content" && typeof v === "string" && v.length > 200 ? `<${v.length} bytes base64>` : k === "token" ? "dlv_••••" : v));
    return s.length > 20000 ? { truncated: true, preview: s.slice(0, 2000) } : JSON.parse(s);
  };
  await db.from("request_logs").insert({ team_id: c.teamId, api_key_id: c.apiKey?.id ?? null, endpoint, method, status, user_agent: c.via === "dashboard" ? "Dashboard" : c.userAgent, request_body: clean(reqBody), response_body: clean(resBody) });
}

// ---------------------------------------------------------------- emails
async function resolveTemplate(teamId: string, ref: Any) {
  const id = String(ref?.id || ref?.alias || "");
  if (!id) throw bad("template.id is required");
  const q = db.from("templates").select("*").eq("team_id", teamId);
  const { data: t } = /^[0-9a-f-]{36}$/i.test(id) ? await q.eq("id", id).maybeSingle() : await q.eq("alias", id).maybeSingle();
  if (!t) throw notFound("Template");
  if (t.status !== "published" || !t.published_version) throw bad(`Template ${t.alias || t.name} has no published version`);
  const { data: v } = await db.from("template_versions").select("snapshot").eq("template_id", t.id).eq("version", t.published_version).single();
  return { t, snap: v.snapshot };
}

async function checkFrom(c: Ctx, from: string, recipients: string[]) {
  const fromDomain = domainOf(from);
  if (!fromDomain || !EMAIL_RE.test(emailOnly(from))) throw bad("Invalid `from` field. Use \"Name <you@yourdomain.com>\" or you@yourdomain.com");
  const { data: doms } = await db.from("domains").select("*").eq("team_id", c.teamId);
  const owned = (doms || []).find((x: Any) => x.name === fromDomain) || (doms || []).find((x: Any) => fromDomain.endsWith("." + x.name));
  if (fromDomain === await systemDomain() && owned?.status !== "verified") {
    // the shared onboarding sender may only email the team's own members (and the test addresses),
    // unless this team owns and has verified the domain itself
    recipients = recipients.filter((r) => !/@test\.delivrie\.io$/i.test(emailOnly(r)));
    if (!recipients.length) return null;
    const { data: members } = await db.from("team_members").select("user_id").eq("team_id", c.teamId);
    const emails = new Set<string>();
    for (const m of members || []) { const { data } = await db.auth.admin.getUserById(m.user_id); if (data?.user?.email) emails.add(data.user.email.toLowerCase()); }
    if (recipients.some((r) => !emails.has(emailOnly(r)))) throw bad(`${fromDomain} can only send to members of your team. Verify your own domain to send to anyone.`);
    return null;
  }
  const d = owned;
  if (!d) throw bad(`The from domain ${fromDomain} is not verified. Add it in Domains.`);
  if (d.status !== "verified") throw bad(`The from domain ${fromDomain} is not verified yet (status: ${d.status}).`);
  if (!d.sending_enabled) throw bad(`Sending is turned off for ${d.name}.`);
  if (c.apiKey?.domain_id && c.apiKey.domain_id !== d.id) throw forbidden(`This API key can only send from its assigned domain`);
  return d;
}

async function checkQuota(c: Ctx, n: number) {
  if (!ENFORCE_LIMITS) return;
  const { data: t } = await db.from("teams").select("plan_transactional,billing,credits").eq("id", c.teamId).single();
  const plan = t?.plan_transactional || "free";
  const L = LIMITS[plan] || LIMITS.free;
  const name = plan.charAt(0).toUpperCase() + plan.slice(1);
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const count = async (from: string) => (await db.from("emails").select("id", { count: "exact", head: true }).eq("team_id", c.teamId).is("broadcast_id", null).eq("direction", "outbound").not("tags", "cs", JSON.stringify([{ name: "system" }])).gte("created_at", from)).count || 0;

  // Paid plans never hard-stop at the monthly allowance: emails over it are billed as overage at month end,
  // unless the team set a spending cap in Billing.
  if (L.overage) {
    const cap = Number(t?.billing?.spend_cap || 0);
    if (!cap || !L.month) return;
    const cur = t?.billing?.currency === "USD" ? "USD" : "NGN";
    const over = Math.max(0, (await count(month)) + n - L.month);
    const cost = Math.ceil(over / 1000) * L.overage[cur];
    if (cost > cap) throw new HttpError(429, "spending_cap_reached", `This send would take overage past your spending cap. Raise or remove the cap in Billing.`);
    return;
  }

  // Free plan: daily and monthly allowance first, then pay-as-you-go credits.
  let within = true;
  if (L.day && (await count(day)) + n > L.day) within = false;
  if (within && L.month && (await count(month)) + n > L.month) within = false;
  if (within) return;
  if (Number(t?.credits || 0) >= n) {
    const { data: ok } = await db.rpc("use_credits", { p_team: c.teamId, p_n: n });
    if (ok) return;
  }
  const which = L.day && (await count(day)) + n > L.day ? `daily limit of ${L.day.toLocaleString("en-US")}` : `monthly limit of ${L.month.toLocaleString("en-US")}`;
  throw new HttpError(429, L.day && which.startsWith("daily") ? "daily_quota_exceeded" : "monthly_quota_exceeded", `You've reached the ${name} plan's ${which} emails. Upgrade or buy credits in Billing.`);
}

async function checkLimit(c: Ctx, table: "domains" | "webhooks", key: "domains" | "webhooks", label: string) {
  if (!ENFORCE_LIMITS) return;
  const { data: t } = await db.from("teams").select("plan_transactional").eq("id", c.teamId).single();
  const max = (LIMITS[t?.plan_transactional || "free"] || LIMITS.free)[key];
  if (!max) return;
  const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("team_id", c.teamId);
  if ((count || 0) >= max) throw new HttpError(403, "plan_limit_reached", `Your plan includes ${max} ${label}${max === 1 ? "" : "s"}. Upgrade in Billing to add more.`);
}

// "in 2 hours", "in 30 minutes", "tomorrow at 9am", "tomorrow 14:30" (UTC), or any ISO 8601 date.
export function parseWhen(v: unknown): Date | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const iso = new Date(String(v));
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(iso.getTime())) return iso;
  const rel = s.match(/^in\s+(\d+(?:\.\d+)?|an?|one)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/);
  if (rel) {
    const k = /^(a|an|one)$/.test(rel[1]) ? 1 : Number(rel[1]);
    const u = rel[2][0], unit = u === "m" ? 60e3 : u === "h" ? 3600e3 : u === "d" ? 86400e3 : 7 * 86400e3;
    return new Date(Date.now() + k * unit);
  }
  const at = s.match(/^(today|tomorrow)(?:\s+at)?\s*(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?:\s*utc)?$/);
  if (at) {
    const d = new Date(); d.setUTCSeconds(0, 0);
    if (at[1] === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
    let h = at[2] ? Number(at[2]) : 9; const m = at[3] ? Number(at[3]) : 0;
    if (at[4] === "pm" && h < 12) h += 12; if (at[4] === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    d.setUTCHours(h, m);
    return d;
  }
  return isNaN(iso.getTime()) ? null : iso;
}

async function prepareEmail(c: Ctx, b: Any, idempotencyKey?: string | null) {
  if (!b || typeof b !== "object") throw bad("Request body must be a JSON object");
  let { subject, html, text, from, reply_to } = b;
  let templateId: string | null = null;
  if (b.template) {
    const { t, snap } = await resolveTemplate(c.teamId, b.template);
    const vars = b.template.variables || {};
    const defs = snap.variables || [];
    from = from || snap.from;
    reply_to = reply_to || snap.reply_to;
    subject = renderVars(subject || snap.subject || "", vars, defs);
    html = renderVars(snap.html || renderBlocks(snap.content, { subject }), vars, defs);
    text = renderVars(snap.text || blocksToText(snap.content), vars, defs);
    templateId = t.id;
  }
  const to = asArray(b.to), cc = asArray(b.cc), bcc = asArray(b.bcc), replyTo = asArray(reply_to);
  if (!from) throw bad("Missing `from` field");
  if (!to.length) throw bad("Missing `to` field");
  if (!subject && !b.template) throw bad("Missing `subject` field");
  if (!html && !text) throw bad("Provide `html` or `text`");
  validateRecipients(to, "to"); validateRecipients(cc, "cc"); validateRecipients(bcc, "bcc"); validateRecipients(replyTo, "reply_to");
  const d = await checkFrom(c, from, [...to, ...cc, ...bcc]);
  let scheduledAt: string | null = null;
  if (b.scheduled_at) {
    const t = parseWhen(b.scheduled_at);
    if (!t) throw bad("scheduled_at must be an ISO 8601 date or a phrase like \"in 1 hour\" or \"tomorrow at 9am\"");
    if (t.getTime() > Date.now() + 30 * 86400e3) throw bad("scheduled_at can be at most 30 days in the future");
    if (t.getTime() > Date.now() + 30e3) scheduledAt = t.toISOString();
  }
  const attachments = (b.attachments || []).map((a: Any) => {
    if (!a?.filename) throw bad("Each attachment needs a filename");
    if (!a.content && !a.path) throw bad("Each attachment needs base64 `content`");
    if (a.path) throw bad("Attachment `path` isn't supported yet. Send base64 `content` instead.");
    return { filename: String(a.filename), content: String(a.content), content_type: a.content_type, content_id: a.content_id };
  });
  const totalAtt = attachments.reduce((s: number, a: Any) => s + a.content.length * 0.75, 0);
  if (totalAtt > 40 * 1024 * 1024) throw bad("Attachments are limited to 40 MB per email");
  const tags = (b.tags || []).map((t: Any) => {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(String(t?.name)) || !/^[A-Za-z0-9_-]{1,256}$/.test(String(t?.value))) throw bad("Tag names and values can only contain ASCII letters, numbers, underscores and dashes");
    return { name: String(t.name), value: String(t.value) };
  });
  return {
    team_id: c.teamId, api_key_id: c.apiKey?.id ?? null, domain_id: d?.id ?? null, template_id: templateId,
    from, to, cc: cc.length ? cc : null, bcc: bcc.length ? bcc : null, reply_to: replyTo.length ? replyTo : null,
    subject: subject || "", html: html || null, text: text || null, headers: b.headers || {}, tags, attachments,
    status: scheduledAt ? "scheduled" : "queued", scheduled_at: scheduledAt, idempotency_key: idempotencyKey || null,
  };
}

async function sendEmails(c: Ctx, bodies: Any[], idem: string | null) {
  await checkQuota(c, bodies.length);
  if (idem) {
    const { data: prev } = await db.from("emails").select("id").eq("team_id", c.teamId).eq("idempotency_key", idem).maybeSingle();
    if (prev) return [prev];
  }
  const rows = [];
  for (let i = 0; i < bodies.length; i++) rows.push(await prepareEmail(c, bodies[i], bodies.length === 1 ? idem : idem ? `${idem}:${i}` : null));
  const { data, error } = await db.from("emails").insert(rows).select("id,status,team_id");
  if (error) throw new HttpError(422, "validation_error", error.message);
  await db.from("email_events").insert((data || []).filter((e: Any) => e.status === "scheduled").map((e: Any) => ({ email_id: e.id, team_id: c.teamId, type: "scheduled", data: {} })));
  const queued = (data || []).filter((e: Any) => e.status === "queued");
  if (queued.length) waitUntil((async () => { for (const e of queued) await deliver(e.id); })());
  return (data || []).map((e: Any) => ({ id: e.id }));
}

async function getEmail(c: Ctx, id: string) {
  const { data: e } = await db.from("emails").select("*").eq("team_id", c.teamId).eq("id", id).maybeSingle();
  if (!e) throw notFound("Email");
  const { data: events } = await db.from("email_events").select("type,data,created_at").eq("email_id", id).order("created_at");
  return { object: "email", id: e.id, from: e.from, to: e.to, cc: e.cc, bcc: e.bcc, reply_to: e.reply_to, subject: e.subject, html: e.html, text: e.text, last_event: e.status, created_at: e.created_at, scheduled_at: e.scheduled_at, tags: e.tags, error: e.error, events };
}

// ---------------------------------------------------------------- contacts
async function upsertContacts(c: Ctx, list: Any[], segmentIds: string[] = []) {
  const rows = list.map((x) => {
    const email = String(x.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw bad(`Invalid email: ${x.email}`);
    return { team_id: c.teamId, email, first_name: x.first_name ?? null, last_name: x.last_name ?? null, unsubscribed: !!x.unsubscribed, properties: x.properties || {} };
  });
  const { data, error } = await db.from("contacts").upsert(rows, { onConflict: "team_id,email" }).select("*");
  if (error) throw bad(error.message);
  if (segmentIds.length) await db.from("segment_contacts").upsert(data!.flatMap((ct: Any) => segmentIds.map((s) => ({ segment_id: s, contact_id: ct.id, team_id: c.teamId }))), { onConflict: "segment_id,contact_id", ignoreDuplicates: true });
  for (const ct of data || []) await emit(c.teamId, "contact.created", { id: ct.id, email: ct.email, first_name: ct.first_name, last_name: ct.last_name, unsubscribed: ct.unsubscribed, created_at: ct.created_at });
  return data;
}
async function findContact(c: Ctx, idOrEmail: string) {
  const q = db.from("contacts").select("*").eq("team_id", c.teamId);
  const { data } = idOrEmail.includes("@") ? await q.eq("email", idOrEmail.toLowerCase()).maybeSingle() : await q.eq("id", idOrEmail).maybeSingle();
  if (!data) throw notFound("Contact");
  return data;
}

// ---------------------------------------------------------------- broadcasts
async function compileBroadcast(b: Any) {
  const html = renderBlocks(b.content, { subject: b.subject, previewText: b.preview_text });
  const text = blocksToText(b.content);
  return { html, text };
}
async function recipientsFor(teamId: string, b: Any) {
  if (!b.segment_id) throw bad("Choose a segment before sending");
  const { data: sc } = await db.from("segment_contacts").select("contact_id, contacts!inner(id,email,unsubscribed)").eq("segment_id", b.segment_id).eq("team_id", teamId).limit(50000);
  let list = (sc || []).map((r: Any) => r.contacts).filter((ct: Any) => ct && !ct.unsubscribed);
  let topicOptOut = 0;
  if (b.topic_id) {
    const { data: topic } = await db.from("topics").select("*").eq("id", b.topic_id).single();
    const { data: prefs } = await db.from("contact_topics").select("contact_id,subscription").eq("topic_id", b.topic_id);
    const map = new Map((prefs || []).map((p: Any) => [p.contact_id, p.subscription]));
    const before = list.length;
    list = list.filter((ct: Any) => (map.get(ct.id) || topic?.default_subscription || "opt_in") === "opt_in");
    topicOptOut = before - list.length;
  }
  const { data: sup } = await db.from("suppressions").select("email").eq("team_id", teamId);
  const s = new Set((sup || []).map((x: Any) => x.email));
  const total = (sc || []).length;
  list = list.filter((ct: Any) => !s.has(ct.email));
  return { list, total, topicOptOut };
}
async function scheduleBroadcast(c: Ctx, id: string, when?: string | null) {
  const { data: b } = await db.from("broadcasts").select("*").eq("team_id", c.teamId).eq("id", id).maybeSingle();
  if (!b) throw notFound("Broadcast");
  if (!["draft", "scheduled"].includes(b.status)) throw bad(`This broadcast is already ${b.status}`);
  if (!b.from) throw bad("Choose a sender before sending");
  if (!b.subject) throw bad("Add a subject before sending");
  await checkFrom(c, b.from, []);
  const { list } = await recipientsFor(c.teamId, b);
  if (!list.length) throw bad("This segment has no subscribed contacts");
  const { html, text } = await compileBroadcast(b);
  const at = when ? new Date(when) : new Date();
  if (isNaN(at.getTime())) throw bad("scheduled_at must be an ISO 8601 date");
  const { count } = await db.from("broadcasts").select("id", { count: "exact", head: true }).eq("team_id", c.teamId).not("stamp_no", "is", null);
  const { data } = await db.from("broadcasts").update({ status: "scheduled", scheduled_at: at.toISOString(), html, text, recipients: list.length, stamp_no: b.stamp_no || (count || 0) + 1 }).eq("id", id).select().single();
  if (at.getTime() <= Date.now() + 5000) waitUntil(startBroadcast(data));
  return data;
}
async function startBroadcast(b: Any) {
  const { data: claimed } = await db.from("broadcasts").update({ status: "sending" }).eq("id", b.id).eq("status", "scheduled").select("*");
  if (!claimed?.length) return;
  const { list } = await recipientsFor(b.team_id, b);
  for (let i = 0; i < list.length; i += 500) {
    const rows = list.slice(i, i + 500).map((ct: Any) => ({ team_id: b.team_id, broadcast_id: b.id, contact_id: ct.id, from: b.from, to: [ct.email], reply_to: b.reply_to ? [b.reply_to] : null, subject: b.subject, status: "queued", tags: [{ name: "broadcast_id", value: b.id }] }));
    await db.from("emails").insert(rows);
  }
  await db.from("broadcasts").update({ recipients: list.length }).eq("id", b.id);
  await drainQueue(25_000, b.id);
}

// ---------------------------------------------------------------- queue worker (cron)
async function drainQueue(budgetMs: number, broadcastId?: string) {
  const start = Date.now();
  const rate = parseInt(Deno.env.get("SES_MAX_SEND_RATE") || "10");
  while (Date.now() - start < budgetMs) {
    let q = db.from("emails").select("id").eq("status", "queued").or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`).order("created_at").limit(rate);
    if (broadcastId) q = q.eq("broadcast_id", broadcastId);
    const { data } = await q;
    if (!data?.length) break;
    const t0 = Date.now();
    await Promise.all(data.map((e: Any) => deliver(e.id)));
    const spent = Date.now() - t0;
    if (spent < 1000) await new Promise((r) => setTimeout(r, 1000 - spent));
  }
}
async function runCron() {
  const now = new Date().toISOString();
  // 1. scheduled transactional emails
  const { data: due } = await db.from("emails").update({ status: "queued" }).eq("status", "scheduled").lte("scheduled_at", now).select("id");
  // 2. scheduled broadcasts
  const { data: bc } = await db.from("broadcasts").select("*").eq("status", "scheduled").lte("scheduled_at", now);
  for (const b of bc || []) await startBroadcast(b);
  // 3. queue (retries + broadcast batches)
  await drainQueue(25_000);
  // 4. finish broadcasts with nothing left to send
  const { data: sending } = await db.from("broadcasts").select("id").eq("status", "sending");
  for (const b of sending || []) {
    const { count } = await db.from("emails").select("id", { count: "exact", head: true }).eq("broadcast_id", b.id).eq("status", "queued");
    if (!count) await db.from("broadcasts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", b.id);
  }
  // 5. webhook retries
  const { data: retries } = await db.from("webhook_deliveries").select("*").eq("delivered", false).not("next_attempt_at", "is", null).lte("next_attempt_at", now).limit(100);
  await Promise.all((retries || []).map((d: Any) => attemptDelivery(d)));
  // 6. poll pending domains every few minutes
  if (hasAws()) {
    const stale = new Date(Date.now() - 4 * 60e3).toISOString();
    const { data: pend } = await db.from("domains").select("*").in("status", ["pending", "not_started", "temporary_failure"]).or(`last_checked_at.is.null,last_checked_at.lt.${stale}`).limit(20);
    for (const d of pend || []) {
      const u = await verifyDomain(d).catch(() => null);
      if (u && u.status !== d.status) await emit(d.team_id, "domain.updated", { id: u.id, name: u.name, status: u.status, region: u.region });
    }
  }
  return { scheduled_released: due?.length || 0, broadcasts_started: bc?.length || 0 };
}

// ---------------------------------------------------------------- router
type Handler = (req: Request, c: Ctx, p: Record<string, string>, url: URL, body: Any) => Promise<Response | unknown>;
const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:([a-z_]+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push([method, re, keys, h]);
}
const list = (data: unknown[], extra: Any = {}) => ({ object: "list", data, ...extra });
// inbox, automations, events, usage, received mail (registered first so /emails/received wins over /emails/:id)
registerExtra(route, { needFull, sendEmails });

// emails
route("POST", "/emails", async (req, c, _p, _u, b) => (await sendEmails(c, [b], req.headers.get("idempotency-key")))[0]);
route("POST", "/emails/batch", async (req, c, _p, _u, b) => {
  if (!Array.isArray(b)) throw bad("Body must be an array of emails");
  if (b.length > 100) throw bad("A batch can contain at most 100 emails");
  if (b.some((x: Any) => x.attachments?.length || x.scheduled_at)) throw bad("Batch emails don't support attachments or scheduled_at");
  return { data: await sendEmails(c, b, req.headers.get("idempotency-key")) };
});
route("GET", "/emails", async (_r, c, _p, url) => {
  needFull(c);
  const { limit, offset } = pageParams(url);
  const { data } = await db.from("emails").select("id,from,to,subject,status,created_at,scheduled_at").eq("team_id", c.teamId).eq("direction", url.searchParams.get("direction") || "outbound").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  return list((data || []).map((e: Any) => ({ ...e, last_event: e.status })), { has_more: (data || []).length === limit });
});
route("GET", "/emails/:id", (_r, c, p) => { needFull(c); return getEmail(c, p.id); });
route("PATCH", "/emails/:id", async (_r, c, p, _u, b) => {
  const { data: e } = await db.from("emails").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!e) throw notFound("Email");
  if (e.status !== "scheduled") throw bad("Only scheduled emails can be updated");
  const t = parseWhen(b?.scheduled_at);
  if (!t) throw bad("scheduled_at must be an ISO 8601 date or a phrase like \"in 1 hour\"");
  await db.from("emails").update({ scheduled_at: t.toISOString() }).eq("id", e.id);
  return { object: "email", id: e.id };
});
route("POST", "/emails/:id/cancel", async (_r, c, p) => {
  const { data } = await db.from("emails").update({ status: "canceled" }).eq("team_id", c.teamId).eq("id", p.id).eq("status", "scheduled").select("id,team_id");
  if (!data?.length) throw bad("Only scheduled emails can be canceled");
  await db.from("email_events").insert({ email_id: p.id, team_id: c.teamId, type: "canceled", data: {} });
  return { object: "email", id: p.id };
});

route("POST", "/emails/:id/forward", async (_r, c, p, _u, b) => {
  const { data: e } = await db.from("emails").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!e) throw notFound("Email");
  const to = asArray(b?.to);
  if (!to.length) throw bad("Add who to forward it to");
  if (!b?.from) throw bad("Choose a From address on a verified domain");
  const note = String(b?.note || "").trim();
  const escH = (x: string) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = [`From: ${e.from}`, `Date: ${new Date(e.sent_at || e.created_at).toUTCString()}`, `Subject: ${e.subject}`, `To: ${(e.to || []).join(", ")}`];
  const original = e.html || (e.text ? `<pre style="white-space:pre-wrap;font:inherit">${escH(e.text)}</pre>` : "");
  const html = `${note ? `<p>${escH(note).replace(/\n/g, "<br>")}</p>` : ""}<div style="color:#6b6f76">---------- Forwarded message ----------<br>${head.map(escH).join("<br>")}</div><br>${original}`;
  const text = `${note ? note + "\n\n" : ""}---------- Forwarded message ----------\n${head.join("\n")}\n\n${e.text || ""}`;
  const subject = /^fwd?:/i.test(e.subject || "") ? e.subject : `Fwd: ${e.subject || ""}`;
  const [out] = await sendEmails(c, [{ from: b.from, to, subject, html, text, tags: [{ name: "forwarded_from", value: e.id }] }], null);
  return { object: "email", id: out.id, forwarded_from: e.id };
});

// claim a domain another team added, by proving DNS control (TXT _delivrie-claim)
const CLAIM_HOST = "_delivrie-claim";
const claimOut = (cl: Any) => ({ object: "domain_claim", id: cl.id, name: cl.name, status: cl.status, expires_at: cl.expires_at, record: { type: "TXT", name: CLAIM_HOST, value: `delivrie-claim=${cl.token}` } });
route("POST", "/domains/claims", async (_r, c, _p, _u, b) => {
  needFull(c);
  const name = String(b?.name || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const { data: existing } = await db.from("domains").select("id,team_id").eq("name", name).maybeSingle();
  if (!existing) throw bad(`${name} isn't on Delivrie yet. Add it as a new domain instead.`);
  if (existing.team_id === c.teamId) throw bad(`${name} is already in this team.`);
  await checkLimit(c, "domains", "domains", "custom domain");
  const { data: open } = await db.from("domain_claims").select("*").eq("team_id", c.teamId).eq("name", name).eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (open) return claimOut(open);
  const token = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { data: cl } = await db.from("domain_claims").insert({ team_id: c.teamId, name, region: b?.region || "eu-west-1", token, created_by: c.userId }).select().single();
  return claimOut(cl);
});
route("POST", "/domains/claims/:id/verify", async (_r, c, p) => {
  needFull(c);
  const { data: cl } = await db.from("domain_claims").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!cl) throw notFound("Claim");
  if (cl.status === "claimed") return { ...claimOut(cl), claimed: true };
  if (new Date(cl.expires_at) < new Date()) { await db.from("domain_claims").update({ status: "expired" }).eq("id", cl.id); throw bad("This claim expired. Start a new one."); }
  const answers = await doh(`${CLAIM_HOST}.${cl.name}`, "TXT");
  if (!answers.some((a) => a.replace(/\s+/g, "") === `delivrie-claim=${cl.token}`)) {
    return { ...claimOut(cl), claimed: false, message: `We couldn't find the TXT record at ${CLAIM_HOST}.${cl.name} yet. DNS changes can take up to an hour.` };
  }
  const { data: d } = await db.from("domains").select("*").eq("name", cl.name).maybeSingle();
  if (!d) throw bad(`${cl.name} was removed from Delivrie. Add it as a new domain.`);
  const from = d.team_id;
  if (from !== c.teamId) {
    await db.from("api_keys").update({ domain_id: null }).eq("domain_id", d.id);
    await db.from("domains").update({ team_id: c.teamId }).eq("id", d.id);
    await emit(from, "domain.updated", { id: d.id, name: d.name, status: "claimed_by_another_team", region: d.region });
    await emit(c.teamId, "domain.created", { id: d.id, name: d.name, status: d.status, region: d.region });
  }
  const { data: done } = await db.from("domain_claims").update({ status: "claimed", claimed_at: new Date().toISOString(), claimed_from: from }).eq("id", cl.id).select().single();
  return { ...claimOut(done), claimed: true, domain_id: d.id };
});

// domains
const domainOut = (d: Any) => ({ object: "domain", id: d.id, name: d.name, status: d.status, region: d.region, region_label: regionLabel(d.region), records: d.records, created_at: d.created_at, click_tracking: d.click_tracking, open_tracking: d.open_tracking, tls: d.tls, return_path: d.return_path, receiving_enabled: d.receiving_enabled, receiving_subdomain: d.receiving_subdomain, receiving_mode: d.receiving_mode, receiving_addresses: d.receiving_addresses, receiving_verified_at: d.receiving_verified_at });
async function getDomain(c: Ctx, id: string) {
  const q = db.from("domains").select("*").eq("team_id", c.teamId);
  const { data } = id.includes(".") ? await q.eq("name", id).maybeSingle() : await q.eq("id", id).maybeSingle();
  if (!data) throw notFound("Domain");
  return data;
}
route("GET", "/domains", async (_r, c) => { needFull(c); const { data } = await db.from("domains").select("*").eq("team_id", c.teamId).order("created_at", { ascending: false }); return list((data || []).map(domainOut)); });
route("POST", "/domains", async (_r, c, _p, _u, b) => {
  needFull(c);
  await checkLimit(c, "domains", "domains", "custom domain");
  const want = String(b?.name || "").trim().toLowerCase();
  const { data: taken } = await db.from("domains").select("team_id").eq("name", want).maybeSingle();
  if (taken && taken.team_id !== c.teamId) throw new HttpError(409, "domain_in_use", `${want} is already added to another Delivrie team. If it's yours, claim it by proving you control its DNS.`);
  const d = await createDomain(c.teamId, String(b?.name || ""), b?.region || "eu-west-1", b || {});
  await emit(c.teamId, "domain.created", { id: d.id, name: d.name, status: d.status, region: d.region });
  return domainOut(d);
});
route("GET", "/domains/:id", async (_r, c, p) => { needFull(c); return domainOut(await getDomain(c, p.id)); });
route("POST", "/domains/:id/verify", async (_r, c, p) => {
  needFull(c);
  const d = await getDomain(c, p.id);
  const u = await verifyDomain(d);
  if (u.status !== d.status) await emit(c.teamId, "domain.updated", { id: u.id, name: u.name, status: u.status, region: u.region });
  return domainOut(u);
});
route("PATCH", "/domains/:id", async (_r, c, p, _u, b) => { needFull(c); return domainOut(await updateDomainConfig(await getDomain(c, p.id), b || {})); });
route("DELETE", "/domains/:id", async (_r, c, p) => { needFull(c); const d = await getDomain(c, p.id); await deleteDomain(d); return { object: "domain", id: d.id, deleted: true }; });

// api keys
route("GET", "/api-keys", async (_r, c) => { needFull(c); const { data } = await db.from("api_keys").select("id,name,prefix,permission,domain_id,last_used_at,created_at").eq("team_id", c.teamId).order("created_at", { ascending: false }); return list(data || []); });
route("POST", "/api-keys", async (_r, c, _p, _u, b) => {
  needFull(c);
  const name = String(b?.name || "").trim();
  if (!name) throw bad("Missing `name`");
  const permission = b?.permission === "sending_access" || b?.permission === "sending" ? "sending" : "full";
  const token = "dlv_" + randomToken(24);
  const { data, error } = await db.from("api_keys").insert({ team_id: c.teamId, name, prefix: token.slice(0, 8), key_hash: await sha256(token), permission, domain_id: b?.domain_id || null, created_by: c.userId }).select("id").single();
  if (error) throw bad(error.message);
  return { id: data.id, token };
});
route("DELETE", "/api-keys/:id", async (_r, c, p) => { needFull(c); await db.from("api_keys").delete().eq("team_id", c.teamId).eq("id", p.id); return { object: "api_key", id: p.id, deleted: true }; });

// contacts
route("GET", "/contacts", async (_r, c, _p, url) => {
  needFull(c);
  const { limit, offset } = pageParams(url);
  let q = db.from("contacts").select("*").eq("team_id", c.teamId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  const after = url.searchParams.get("created_after");
  if (after) q = q.gte("created_at", after === "today" ? new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString() : after);
  const { data } = await q;
  return list(data || [], { has_more: (data || []).length === limit });
});
route("POST", "/contacts", async (_r, c, _p, _u, b) => { needFull(c); const [ct] = await upsertContacts(c, [b], asArray(b?.segments ?? b?.segment_id)); return { object: "contact", id: ct.id }; });
route("GET", "/contacts/:id", async (_r, c, p) => { needFull(c); return { object: "contact", ...(await findContact(c, decodeURIComponent(p.id))) }; });
route("PATCH", "/contacts/:id", async (_r, c, p, _u, b) => {
  needFull(c);
  const ct = await findContact(c, decodeURIComponent(p.id));
  const patch: Any = {};
  for (const k of ["first_name", "last_name", "unsubscribed"]) if (k in (b || {})) patch[k] = b[k];
  if (b?.properties) patch.properties = { ...ct.properties, ...b.properties };
  const { data } = await db.from("contacts").update(patch).eq("id", ct.id).select().single();
  await emit(c.teamId, "contact.updated", { id: data.id, email: data.email, unsubscribed: data.unsubscribed });
  return { object: "contact", id: data.id };
});
route("DELETE", "/contacts/:id", async (_r, c, p) => { needFull(c); const ct = await findContact(c, decodeURIComponent(p.id)); await db.from("contacts").delete().eq("id", ct.id); await emit(c.teamId, "contact.deleted", { id: ct.id, email: ct.email }); return { object: "contact", id: ct.id, deleted: true }; });

// segments
route("GET", "/segments", async (_r, c) => { needFull(c); const { data } = await db.from("segments").select("*").eq("team_id", c.teamId).order("created_at"); return list(data || []); });
route("POST", "/segments", async (_r, c, _p, _u, b) => { needFull(c); if (!b?.name) throw bad("Missing `name`"); const { data } = await db.from("segments").insert({ team_id: c.teamId, name: b.name }).select().single(); return { object: "segment", id: data.id, name: data.name }; });
route("DELETE", "/segments/:id", async (_r, c, p) => { needFull(c); await db.from("segments").delete().eq("team_id", c.teamId).eq("id", p.id); return { object: "segment", id: p.id, deleted: true }; });
route("POST", "/segments/:id/contacts", async (_r, c, p, _u, b) => {
  needFull(c);
  const { data: s } = await db.from("segments").select("id").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!s) throw notFound("Segment");
  const items = Array.isArray(b?.contacts) ? b.contacts : [b];
  const cts = await upsertContacts(c, items.map((x: Any) => typeof x === "string" ? { email: x } : x), [p.id]);
  return { object: "segment", id: p.id, added: cts?.length || 0 };
});

// broadcasts
route("GET", "/broadcasts", async (_r, c) => { needFull(c); const { data } = await db.from("broadcasts").select("id,name,status,segment_id,scheduled_at,sent_at,created_at").eq("team_id", c.teamId).order("created_at", { ascending: false }); return list(data || []); });
route("POST", "/broadcasts", async (_r, c, _p, _u, b) => {
  needFull(c);
  const content = b?.content || { blocks: b?.html ? [{ id: "h1", type: "html", html: b.html }] : (b?.text ? [{ id: "t1", type: "text", html: String(b.text).replace(/\n/g, "<br>") }] : []) };
  const { data, error } = await db.from("broadcasts").insert({ team_id: c.teamId, name: b?.name || b?.subject || "Untitled", from: b?.from, reply_to: b?.reply_to, segment_id: b?.segment_id, topic_id: b?.topic_id, subject: b?.subject, preview_text: b?.preview_text, content, created_by: c.userId }).select().single();
  if (error) throw bad(error.message);
  return { object: "broadcast", id: data.id };
});
route("GET", "/broadcasts/:id", async (_r, c, p) => { needFull(c); const { data } = await db.from("broadcasts").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle(); if (!data) throw notFound("Broadcast"); const { data: stats } = await db.rpc("broadcast_stats", { p_broadcast: p.id }); return { object: "broadcast", ...data, stats }; });
route("POST", "/broadcasts/:id/send", async (_r, c, p, _u, b) => { needFull(c); const d = await scheduleBroadcast(c, p.id, b?.scheduled_at); return { object: "broadcast", id: d.id, status: d.status, scheduled_at: d.scheduled_at, recipients: d.recipients, stamp_no: d.stamp_no }; });
route("POST", "/broadcasts/:id/cancel", async (_r, c, p) => { needFull(c); const { data } = await db.from("broadcasts").update({ status: "draft", scheduled_at: null }).eq("team_id", c.teamId).eq("id", p.id).eq("status", "scheduled").select("id"); if (!data?.length) throw bad("Only scheduled broadcasts can be canceled"); return { object: "broadcast", id: p.id, status: "draft" }; });
route("DELETE", "/broadcasts/:id", async (_r, c, p) => { needFull(c); await db.from("broadcasts").delete().eq("team_id", c.teamId).eq("id", p.id).neq("status", "sending"); return { object: "broadcast", id: p.id, deleted: true }; });
route("GET", "/broadcasts/:id/recipients", async (_r, c, p) => {
  const { data: b } = await db.from("broadcasts").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!b) throw notFound("Broadcast");
  const r = await recipientsFor(c.teamId, b);
  return { total: r.total, topic_opt_out: r.topicOptOut, recipients: r.list.length };
});

// templates
route("GET", "/templates", async (_r, c) => { needFull(c); const { data } = await db.from("templates").select("id,name,alias,status,published_version,created_at,updated_at").eq("team_id", c.teamId).order("created_at"); return list(data || []); });
route("GET", "/templates/:id", async (_r, c, p) => { needFull(c); const q = db.from("templates").select("*").eq("team_id", c.teamId); const { data } = /^[0-9a-f-]{36}$/i.test(p.id) ? await q.eq("id", p.id).maybeSingle() : await q.eq("alias", p.id).maybeSingle(); if (!data) throw notFound("Template"); return { object: "template", ...data }; });
route("POST", "/templates", async (_r, c, _p, _u, b) => {
  needFull(c);
  if (!b?.name) throw bad("Missing `name`");
  const content = b.content || { blocks: b.html ? [{ id: "h1", type: "html", html: b.html }] : [] };
  const { data, error } = await db.from("templates").insert({ team_id: c.teamId, name: b.name, alias: b.alias || null, from: b.from, subject: b.subject, content, html: b.html || null, variables: b.variables || [] , created_by: c.userId }).select().single();
  if (error) throw bad(error.message.includes("duplicate") ? "A template with this alias already exists" : error.message);
  return { object: "template", id: data.id };
});
route("POST", "/templates/:id/publish", async (_r, c, p) => {
  const { data: t } = await db.from("templates").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!t) throw notFound("Template");
  const html = t.html && !(t.content?.blocks?.length) ? t.html : renderBlocks(t.content, { subject: t.subject });
  const text = blocksToText(t.content) || null;
  const used = new Set([...usedVars(t.subject), ...usedVars(html)]);
  const defined = new Set((t.variables || []).map((v: Any) => v.name));
  const missing = [...used].filter((v) => !defined.has(v));
  const { data: last } = await db.from("template_versions").select("version").eq("template_id", t.id).order("version", { ascending: false }).limit(1);
  const version = (last?.[0]?.version || 0) + 1;
  let byName: string | null = null;
  if (c.userId) { const { data: pr } = await db.from("profiles").select("full_name,email").eq("id", c.userId).maybeSingle(); byName = pr?.full_name || pr?.email || null; }
  await db.from("template_versions").insert({ template_id: t.id, team_id: c.teamId, version, published: true, created_by: c.userId, created_by_name: byName, snapshot: { name: t.name, subject: t.subject, from: t.from, reply_to: t.reply_to, content: t.content, html, text, variables: t.variables } });
  await db.from("templates").update({ status: "published", published_version: version, html, text }).eq("id", t.id);
  return { object: "template", id: t.id, version, warnings: missing.length ? [`Variables without a definition: ${missing.join(", ")}`] : [] };
});

// webhooks
route("GET", "/webhooks", async (_r, c) => { needFull(c); const { data } = await db.from("webhooks").select("id,endpoint,events,status,created_at").eq("team_id", c.teamId); return list(data || []); });
route("POST", "/webhooks", async (_r, c, _p, _u, b) => {
  needFull(c);
  if (!/^https:\/\//.test(String(b?.endpoint || ""))) throw bad("endpoint must be an https:// URL");
  if (!Array.isArray(b?.events) || !b.events.length) throw bad("Choose at least one event");
  await checkLimit(c, "webhooks", "webhooks", "webhook endpoint");
  const secret = "whsec_" + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const { data } = await db.from("webhooks").insert({ team_id: c.teamId, endpoint: b.endpoint, events: b.events, signing_secret: secret }).select().single();
  return { object: "webhook", id: data.id, signing_secret: secret };
});
route("GET", "/webhooks/:id/events", async (_r, c, p) => { needFull(c); const { data } = await db.from("webhook_deliveries").select("id,event_id,event_type,status_code,attempts,delivered,created_at,updated_at").eq("team_id", c.teamId).eq("webhook_id", p.id).order("created_at", { ascending: false }).limit(100); return list(data || []); });
route("POST", "/webhooks/:id/test", async (_r, c, p) => {
  const { data: h } = await db.from("webhooks").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!h) throw notFound("Webhook");
  const { data: d } = await db.from("webhook_deliveries").insert({ webhook_id: h.id, team_id: c.teamId, event_id: "evt_" + randomToken(12), event_type: h.events[0] || "email.delivered", payload: { type: h.events[0] || "email.delivered", created_at: new Date().toISOString(), data: { test: true, email_id: crypto.randomUUID(), from: "Delivrie <test@delivrie.dev>", to: ["you@example.com"], subject: "Test event from Delivrie" } } }).select().single();
  await attemptDelivery(d, true);
  const { data: after } = await db.from("webhook_deliveries").select("*").eq("id", d.id).single();
  return after;
});
route("POST", "/webhook-deliveries/:id/replay", async (_r, c, p) => {
  const { data: d } = await db.from("webhook_deliveries").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle();
  if (!d) throw notFound("Delivery");
  await attemptDelivery(d, true);
  const { data: after } = await db.from("webhook_deliveries").select("*").eq("id", d.id).single();
  return after;
});

// suppressions
route("GET", "/suppressions", async (_r, c) => { needFull(c); const { data } = await db.from("suppressions").select("*").eq("team_id", c.teamId).order("created_at", { ascending: false }).limit(1000); return list(data || []); });
route("POST", "/suppressions", async (_r, c, _p, _u, b) => { needFull(c); const emails = asArray(b?.email ?? b?.emails).map((e) => e.toLowerCase()); if (!emails.length) throw bad("Missing `email`"); await db.from("suppressions").upsert(emails.map((email) => ({ team_id: c.teamId, email, reason: "manual" })), { onConflict: "team_id,email", ignoreDuplicates: true }); return { object: "suppression", added: emails.length }; });
route("DELETE", "/suppressions/:email", async (_r, c, p) => { needFull(c); await db.from("suppressions").delete().eq("team_id", c.teamId).eq("email", decodeURIComponent(p.email).toLowerCase()); return { deleted: true }; });

// metrics & logs
route("GET", "/metrics", async (_r, c, _p, url) => {
  needFull(c);
  const days = Math.min(parseInt(url.searchParams.get("days") || "15"), 90);
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const { data } = await db.rpc("email_metrics", { p_team: c.teamId, p_since: since, p_domain: url.searchParams.get("domain_id") });
  const sum = (k: string) => (data || []).reduce((s: number, r: Any) => s + Number(r[k]), 0);
  const sent = sum("sent");
  return { days: data, totals: { sent, delivered: sum("delivered"), opened: sum("opened"), clicked: sum("clicked"), bounced: sum("bounced"), complained: sum("complained") }, rates: { delivery: sent ? sum("delivered") / sent : 0, bounce: sent ? sum("bounced") / sent : 0, complaint: sent ? sum("complained") / sent : 0 } };
});
route("GET", "/logs", async (_r, c, _p, url) => { needFull(c); const { limit, offset } = pageParams(url); const { data } = await db.from("request_logs").select("id,endpoint,method,status,user_agent,created_at").eq("team_id", c.teamId).order("created_at", { ascending: false }).range(offset, offset + limit - 1); return list(data || []); });
route("GET", "/logs/:id", async (_r, c, p) => { needFull(c); const { data } = await db.from("request_logs").select("*").eq("team_id", c.teamId).eq("id", p.id).maybeSingle(); if (!data) throw notFound("Log"); return data; });

// ---------------------------------------------------------------- dashboard-only helpers
const dash = (h: Handler): Handler => (req, c, p, u, b) => { if (c.via !== "dashboard") throw forbidden("This endpoint is only available from the dashboard"); return h(req, c, p, u, b); };

route("GET", "/dashboard/status", dash(async (_r, c) => {
  const { data: d } = await db.from("domains").select("region").eq("team_id", c.teamId).limit(1);
  const { data: t } = await db.from("teams").select("plan_transactional,credits").eq("id", c.teamId).single();
  return { credits: t?.credits || 0, aws: await accountStatus(d?.[0]?.region || "eu-west-1"), system_from: SYSTEM_FROM ? SYSTEM_FROM : null, regions: Object.entries(SES_REGIONS).map(([id]) => ({ id, label: regionLabel(id) })), limits_enforced: ENFORCE_LIMITS, plan: t?.plan_transactional || "free", limits: LIMITS[t?.plan_transactional || "free"] || LIMITS.free };
}));
route("POST", "/dashboard/test-email", dash(async (_r, c, _p, _u, b) => {
  const to = asArray(b?.to);
  if (!to.length || to.length > 5) throw bad("Add between one and five addresses");
  validateRecipients(to, "to");
  let from: string, subject: string, html: string, text: string;
  const sample = { first_name: "Ada", last_name: "Lovelace", email: to[0], ...(b?.variables || {}) };
  if (b?.broadcast_id) {
    const { data: bc } = await db.from("broadcasts").select("*").eq("team_id", c.teamId).eq("id", b.broadcast_id).single();
    if (!bc?.from) throw bad("Choose a sender first");
    const comp = await compileBroadcast(bc);
    from = bc.from; subject = "[Test] " + renderVars(bc.subject || bc.name, sample); html = renderVars(comp.html, { ...sample, unsubscribe_url: APP_URL, preferences_url: APP_URL }); text = renderVars(comp.text, sample);
  } else if (b?.template_id) {
    const { data: t } = await db.from("templates").select("*").eq("team_id", c.teamId).eq("id", b.template_id).single();
    if (!t?.from) throw bad("Set a From address on the template first");
    const defs = t.variables || [];
    from = t.from; subject = "[Test] " + renderVars(t.subject || t.name, sample, defs); html = renderVars(renderBlocks(t.content, { subject }), sample, defs); text = renderVars(blocksToText(t.content), sample, defs);
  } else throw bad("Nothing to test");
  return (await sendEmails(c, [{ from, to, subject, html, text, tags: [{ name: "test", value: "true" }] }], null))[0];
}));
route("POST", "/dashboard/invite", dash(async (_r, c, _p, _u, b) => {
  const email = String(b?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad("Enter a valid email address");
  const { data: me } = await db.from("team_members").select("role").eq("team_id", c.teamId).eq("user_id", c.userId).single();
  if (me?.role !== "admin") throw forbidden("Only admins can invite people");
  const { data: inv } = await db.from("team_invites").insert({ team_id: c.teamId, email, role: b?.role === "admin" ? "admin" : "member", invited_by: c.userId }).select().single();
  const { data: team } = await db.from("teams").select("name").eq("id", c.teamId).single();
  const link = `${APP_URL}/invite/${inv.token}`;
  let emailed = false;
  if (SYSTEM_FROM && hasAws()) {
    try {
      const { data: row } = await db.from("emails").insert({ team_id: c.teamId, from: SYSTEM_FROM, to: [email], subject: `You're invited to ${team?.name} on Delivrie`, html: `<p>You've been invited to join <strong>${team?.name}</strong> on Delivrie.</p><p><a href="${link}">Accept invite</a></p>`, status: "queued", tags: [{ name: "system", value: "invite" }] }).select("id").single();
      await deliver(row.id); emailed = true;
    } catch (e) { console.error(e); }
  }
  return { id: inv.id, link, emailed };
}));
route("DELETE", "/dashboard/team", dash(async (_r, c, _p, _u, b) => {
  const { data: me } = await db.from("team_members").select("role").eq("team_id", c.teamId).eq("user_id", c.userId).single();
  if (me?.role !== "admin") throw forbidden("Only admins can delete the team");
  const { data: team } = await db.from("teams").select("name").eq("id", c.teamId).single();
  if (b?.confirm !== team?.name) throw bad("Type the team name to confirm");
  const { data: doms } = await db.from("domains").select("*").eq("team_id", c.teamId);
  for (const d of doms || []) await deleteDomain(d).catch(() => {});
  await db.from("teams").delete().eq("id", c.teamId);
  return { deleted: true };
}));
route("POST", "/dashboard/oauth/authorize", dash(async (_r, c, _p, _u, b) => oauthAuthorize(c.teamId, c.userId!, b || {})));
route("POST", "/dashboard/ask", dash(async (_r, _c, _p, _u, b) => askDelivrie(String(b?.question || ""))));

// account endpoints work without a team
async function accountRoutes(req: Request, path: string): Promise<Response | null> {
  if (!path.startsWith("/account")) return null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) throw new HttpError(401, "unauthorized", "Log in again");
  if (req.method === "DELETE" && path === "/account") {
    const { data: admin } = await db.from("team_members").select("team_id").eq("user_id", u.user.id).eq("role", "admin");
    for (const a of admin || []) {
      const { count } = await db.from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", a.team_id);
      if ((count || 0) <= 1) throw bad("Leave or delete your teams first");
    }
    await db.auth.admin.deleteUser(u.user.id);
    return json({ deleted: true });
  }
  if (req.method === "POST" && path === "/account/feedback") {
    const b = await req.json().catch(() => ({}));
    await db.from("feedback").insert({ user_id: u.user.id, team_id: b.team_id || null, page: b.page || null, message: String(b.message || "").slice(0, 5000) });
    return json({ ok: true });
  }
  return null;
}

// ---------------------------------------------------------------- ask
async function askDelivrie(question: string) {
  if (!question.trim()) throw bad("Ask a question");
  const hits = searchDocs(question, 3);
  const sources = hits.map((d: Any) => ({ id: d.id, title: d.title, url: `${APP_URL}/docs#${d.id}` }));
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (key && hits.length) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("ASK_MODEL") || "claude-haiku-5-5", max_tokens: 500, system: "You are Delivrie's support assistant. Answer in 2-5 plain sentences using only the documentation provided. If the docs don't cover it, say so and suggest contacting support.", messages: [{ role: "user", content: `Documentation:\n${hits.map((d: Any) => `## ${d.title}\n${d.body}`).join("\n\n")}\n\nQuestion: ${question}` }] }),
      });
      const j = await res.json();
      const text = j?.content?.[0]?.text;
      if (text) return { answer: text, sources, mode: "ai" };
    } catch (e) { console.error(e); }
  }
  if (!hits.length) return { answer: "I couldn't find that in the docs. Try rephrasing, or contact support and the team will reply within one business day.", sources: [], mode: "search" };
  const best = hits[0];
  const terms = (question.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const paras = best.body.split(/\n+/).filter(Boolean);
  const scored = paras.map((p: string) => ({ p, s: terms.reduce((n: number, t: string) => n + (p.toLowerCase().includes(t) ? 1 : 0), 0) })).sort((a: Any, b: Any) => b.s - a.s);
  const answer = (scored[0]?.s ? [scored[0].p, scored[1]?.s ? scored[1].p : ""] : paras.slice(0, 2)).filter(Boolean).join(" ");
  return { answer, sources, mode: "search" };
}

// ---------------------------------------------------------------- public endpoints
async function publicRoutes(req: Request, path: string, url: URL): Promise<Response | null> {
  if (path === "/public/status") return json({ status: "operational", sending: hasAws() });
  // ChatGPT plugin domain verification: the token from the OpenAI portal, stored in system_settings, as plain text.
  if (path === "/public/openai-apps-challenge") {
    const token = await setting("openai_apps_challenge");
    return new Response(token || "", { status: token ? 200 : 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path.startsWith("/public/share/")) {
    const token = path.split("/")[3];
    const { data: s } = await db.from("email_shares").select("*").eq("token", token).maybeSingle();
    if (!s || new Date(s.expires_at) < new Date()) return json({ statusCode: 404, name: "not_found", message: "This link has expired" }, 404);
    const { data: e } = await db.from("emails").select("id,from,to,subject,html,text,status,created_at").eq("id", s.email_id).single();
    const { data: events } = await db.from("email_events").select("type,created_at").eq("email_id", s.email_id).order("created_at");
    return json({ email: e, events, expires_at: s.expires_at });
  }
  if (path === "/public/unsubscribe" || path === "/public/unsubscribe/one-click") {
    const t = url.searchParams.get("t") || "";
    const emailId = await verifyUnsubscribeToken(t);
    if (!emailId) return json({ statusCode: 400, name: "invalid_link", message: "This unsubscribe link is invalid" }, 400);
    const { data: e } = await db.from("emails").select("id,team_id,to,contact_id,broadcast_id").eq("id", emailId).single();
    if (!e) return json({ statusCode: 404, name: "not_found", message: "Not found" }, 404);
    const { data: team } = await db.from("teams").select("name,avatar_url,unsubscribe_page").eq("id", e.team_id).single();
    const { data: contact } = e.contact_id ? await db.from("contacts").select("*").eq("id", e.contact_id).maybeSingle() : await db.from("contacts").select("*").eq("team_id", e.team_id).eq("email", emailOnly(e.to[0])).maybeSingle();
    const { data: topics } = await db.from("topics").select("id,name,description,default_subscription").eq("team_id", e.team_id).eq("visibility", "public").order("created_at");
    const unsubscribeAll = async () => {
      if (contact) await db.from("contacts").update({ unsubscribed: true }).eq("id", contact.id);
      await db.from("email_events").insert({ email_id: e.id, team_id: e.team_id, type: "unsubscribed", data: { all: true } });
      if (contact) await emit(e.team_id, "contact.updated", { id: contact.id, email: contact.email, unsubscribed: true });
    };
    if (path.endsWith("one-click")) { if (req.method === "POST") await unsubscribeAll(); return new Response(null, { status: 200, headers: CORS }); }
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b.all) await unsubscribeAll();
      else if (contact && b.topics) {
        const rows = Object.entries(b.topics).filter(([id]) => (topics || []).some((tp: Any) => tp.id === id)).map(([id, v]) => ({ contact_id: contact.id, topic_id: id, team_id: e.team_id, subscription: v === "opt_in" ? "opt_in" : "opt_out", updated_at: new Date().toISOString() }));
        if (rows.length) await db.from("contact_topics").upsert(rows, { onConflict: "contact_id,topic_id" });
        if (contact.unsubscribed && b.resubscribe) await db.from("contacts").update({ unsubscribed: false }).eq("id", contact.id);
      }
      return json({ ok: true });
    }
    const { data: prefs } = contact ? await db.from("contact_topics").select("topic_id,subscription").eq("contact_id", contact.id) : { data: [] };
    const pm = new Map((prefs || []).map((p: Any) => [p.topic_id, p.subscription]));
    return json({ team: { name: team?.name, avatar_url: team?.avatar_url, page: team?.unsubscribe_page || {} }, email: contact?.email || emailOnly(e.to[0]), unsubscribed: !!contact?.unsubscribed, topics: (topics || []).map((tp: Any) => ({ ...tp, subscription: pm.get(tp.id) || tp.default_subscription })) });
  }
  if (path === "/public/invite") {
    const { data: inv } = await db.from("team_invites").select("email,role,status,teams(name)").eq("token", url.searchParams.get("token") || "").maybeSingle();
    if (!inv || inv.status !== "pending") return json({ statusCode: 404, name: "not_found", message: "This invite is no longer valid" }, 404);
    return json({ email: inv.email, role: inv.role, team: (inv as Any).teams?.name });
  }
  return null;
}

// ---------------------------------------------------------------- server
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/delivrie(?=\/|$)/, "").replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
  try {
    if (path === "/" ) return json({ name: "Delivrie API", docs: `${APP_URL}/docs` });
    // SES -> SNS -> here
    if (path === "/events/ses" && req.method === "POST") {
      if (url.searchParams.get("token") !== await setting("link_secret")) return json({ error: "forbidden" }, 403);
      const msg = JSON.parse(await req.text());
      if (msg.Type === "SubscriptionConfirmation") {
        const sub = new URL(msg.SubscribeURL);
        if (/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(sub.hostname)) await fetch(sub.toString());
        return json({ confirmed: true });
      }
      if (msg.Type === "Notification") await handleSesEvent(JSON.parse(msg.Message));
      return json({ ok: true });
    }
    if (path === "/cron" && req.method === "POST") {
      if (req.headers.get("x-cron-secret") !== await setting("cron_secret")) return json({ error: "forbidden" }, 403);
      return json(await runCron());
    }
    if (path === "/docs") return json({ docs: DOCS });
    const oauth = await oauthPublic(req, path);
    if (oauth) return oauth;
    const pub = await publicRoutes(req, path, url);
    if (pub) return pub;
    const acct = await accountRoutes(req, path);
    if (acct) return acct;
    if (path === "/mcp") {
      // Authenticate up front so MCP clients get a 401 that points them at OAuth (or an API key).
      let c: Ctx | null = null;
      if (req.method === "POST") {
        try { c = await authenticate(req); } catch (e) {
          if (!(e instanceof HttpError)) console.error("mcp auth failed", e);
          const err = e instanceof HttpError ? e : new HttpError(401, "invalid_api_key", "Authentication failed");
          return json({ statusCode: err.status, name: err.name, message: err.message }, err.status, { "www-authenticate": `Bearer realm="delivrie", resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"` });
        }
      }
      return await handleMcp(req, async (method, p, body) => dispatch(req, c!, method, p, body, new URL("https://x" + p)));
    }

    const c = await authenticate(req);
    const raw = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? (await req.text()).trim() : "";
    // An empty body on POST/PATCH/PUT/DELETE means "no options" (e.g. POST /domains/:id/verify), as in other email APIs.
    const body = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? (raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : {}) : null;
    if (["POST", "PATCH", "PUT"].includes(req.method) && body === null) throw bad("Request body must be valid JSON");
    return json(await dispatch(req, c, req.method, path, body, url));
  } catch (e) {
    return errorJson(e);
  }
});

async function dispatch(req: Request, c: Ctx, method: string, path: string, body: Any, url: URL) {
  for (const [m, re, keys, h] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    const params = Object.fromEntries(keys.map((k, i) => [k, match[i + 1]]));
    if (c.scopes && !scopeAllows(c.scopes, method, path)) throw new HttpError(403, "insufficient_scope", `This connected app wasn't given access to ${method} ${path}. Reconnect it and approve the ${method === "GET" ? "read" : path.startsWith("/emails") ? "send" : "manage"} scope.`);
    const logged = c.via === "api" || /^\/(domains|emails|api-keys|broadcasts\/[^/]+\/send)/.test(path) && method !== "GET";
    try {
      const out = await h(req, c, params, url, body);
      if (logged) waitUntil(logRequest(c, path, method, 200, body, out));
      return out;
    } catch (e) {
      if (logged && e instanceof HttpError) waitUntil(logRequest(c, path, method, e.status, body, { statusCode: e.status, name: e.name, message: e.message }));
      throw e;
    }
  }
  throw new HttpError(404, "not_found", `No route for ${method} ${path}`);
}

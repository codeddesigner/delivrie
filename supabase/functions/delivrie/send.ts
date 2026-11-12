import { AwsError, sesv2 } from "./aws.ts";
import { buildMime, EMAIL_RE, parseAddress, parseMime, b64ToBytes } from "./mime.ts";
import { creds } from "./ses.ts";
import { type Any, APP_URL, db, domainOf, emailOnly, FUNCTION_URL, hmacB64, hmacUrl, HttpError, randomToken, setting, SYSTEM_FROM, SYSTEM_REGION } from "./util.ts";
import { renderVars } from "./blocks.js";

// ---------------- status precedence ----------------
const RANK: Record<string, number> = { queued: 0, scheduled: 0, sent: 1, delivery_delayed: 2, delivered: 3, opened: 4, clicked: 5, bounced: 8, complained: 9, failed: 9, suppressed: 9, canceled: 9, received: 1 };
export function nextStatus(cur: string, ev: string) {
  if (["bounced", "complained", "failed"].includes(ev)) return ev;
  if (["bounced", "complained", "failed", "canceled", "suppressed"].includes(cur)) return cur;
  return (RANK[ev] ?? 0) > (RANK[cur] ?? 0) ? ev : cur;
}

// ---------------- webhooks ----------------
export async function emit(teamId: string, type: string, data: Any) {
  const { data: hooks } = await db.from("webhooks").select("id,events,status").eq("team_id", teamId).eq("status", "enabled");
  const targets = (hooks || []).filter((h: Any) => (h.events || []).includes(type) || (h.events || []).includes("*"));
  if (!targets.length) return;
  const eventId = "evt_" + randomToken(12);
  const payload = { type, created_at: new Date().toISOString(), data };
  const rows = targets.map((h: Any) => ({ webhook_id: h.id, team_id: teamId, event_id: eventId, event_type: type, payload }));
  const { data: inserted } = await db.from("webhook_deliveries").insert(rows).select("*");
  await Promise.all((inserted || []).map((d: Any) => attemptDelivery(d)));
}

const BACKOFF = [5, 300, 1800, 7200, 18000, 36000, 36000, 36000, 36000, 36000]; // seconds; covers ~72h

export async function signWebhook(secret: string, id: string, ts: number, body: string) {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return "v1," + await hmacB64(b64ToBytes(raw), `${id}.${ts}.${body}`);
}

export async function attemptDelivery(d: Any, force = false) {
  const { data: hook } = await db.from("webhooks").select("*").eq("id", d.webhook_id).single();
  if (!hook || (hook.status !== "enabled" && !force)) return;
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  let status = 0, text = "";
  try {
    const sig = await signWebhook(hook.signing_secret, d.event_id, ts, body);
    const res = await fetch(hook.endpoint, {
      method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", "user-agent": "Delivrie-Webhooks/1.0", "webhook-id": d.event_id, "webhook-timestamp": String(ts), "webhook-signature": sig },
    });
    status = res.status; text = (await res.text()).slice(0, 4000);
  } catch (e) { status = 0; text = (e as Error).message.slice(0, 500); }
  const attempts = (d.attempts || 0) + 1;
  const ok = status >= 200 && status < 300;
  const age = (Date.now() - new Date(d.created_at).getTime()) / 1000;
  const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
  const giveUp = !ok && (age + wait > 72 * 3600);
  await db.from("webhook_deliveries").update({
    status_code: status, response_body: text, attempts, delivered: ok, updated_at: new Date().toISOString(),
    next_attempt_at: ok || giveUp ? null : new Date(Date.now() + wait * 1000).toISOString(),
  }).eq("id", d.id);
}

// ---------------- unsubscribe links ----------------
export async function unsubscribeToken(emailId: string) {
  return `${emailId}.${await hmacUrl(await setting("link_secret"), "unsub:" + emailId)}`;
}
export async function verifyUnsubscribeToken(t: string) {
  const [id, sig] = String(t || "").split(".");
  if (!id || !sig) return null;
  return (await hmacUrl(await setting("link_secret"), "unsub:" + id)) === sig ? id : null;
}

// ---------------- sending ----------------
function isTransient(e: unknown) {
  if (e instanceof AwsError) return e.status >= 500 || /Throttl|TooManyRequests|LimitExceeded/i.test(e.code);
  return true; // network
}

export async function systemDomain() { return SYSTEM_FROM ? domainOf(SYSTEM_FROM) : ""; }

/** Sends one queued email row through SES. Safe to call repeatedly. */
export async function deliver(emailId: string) {
  // claim the row (queued -> sending marker via attempts++) to avoid double sends
  const { data: e } = await db.from("emails").select("*").eq("id", emailId).single();
  if (!e || e.status !== "queued") return;
  const { data: claimed } = await db.from("emails").update({ attempts: e.attempts + 1 }).eq("id", e.id).eq("attempts", e.attempts).eq("status", "queued").select("id");
  if (!claimed?.length) return;

  // recipients minus suppressions
  const all = [...(e.to || []), ...(e.cc || []), ...(e.bcc || [])].map(emailOnly);
  const { data: sup } = await db.from("suppressions").select("email").eq("team_id", e.team_id).in("email", all);
  const suppressed = new Set((sup || []).map((s: Any) => s.email.toLowerCase()));
  const keep = (list: string[] | null) => (list || []).filter((a) => !suppressed.has(emailOnly(a)));
  const to = keep(e.to), cc = keep(e.cc), bcc = keep(e.bcc);
  if (!to.length && !cc.length && !bcc.length) {
    await db.from("emails").update({ status: "suppressed", error: "All recipients are on the suppression list" }).eq("id", e.id);
    await db.from("email_events").insert({ email_id: e.id, team_id: e.team_id, type: "suppressed", data: { recipients: all } });
    return;
  }

  // domain / region / configuration set
  const fromDomain = domainOf(e.from);
  let region = SYSTEM_REGION, configSet: string | undefined;
  if (fromDomain && fromDomain !== await systemDomain()) {
    const { data: dom } = await db.from("domains").select("*").eq("team_id", e.team_id).eq("name", fromDomain).maybeSingle();
    const parent = dom || (await db.from("domains").select("*").eq("team_id", e.team_id).eq("status", "verified")).data?.find((d: Any) => fromDomain.endsWith("." + d.name));
    if (!parent || parent.status !== "verified") {
      await fail(e, `The from domain ${fromDomain} is not verified`);
      return;
    }
    region = parent.region; configSet = parent.config_set || undefined;
    if (!e.domain_id) await db.from("emails").update({ domain_id: parent.id }).eq("id", e.id);
  }

  // broadcast personalisation happens at send time
  let html = e.html, text = e.text, subject = e.subject;
  const headers: Record<string, string> = { ...(e.headers || {}) };
  if (e.broadcast_id) {
    const { data: b } = await db.from("broadcasts").select("html,text,subject,team_id").eq("id", e.broadcast_id).single();
    const { data: c } = e.contact_id ? await db.from("contacts").select("*").eq("id", e.contact_id).single() : { data: null };
    const { data: props } = await db.from("contact_properties").select("key,fallback").eq("team_id", e.team_id);
    const token = await unsubscribeToken(e.id);
    const unsubscribeUrl = `${APP_URL}/unsubscribe?t=${token}`;
    const vars = { ...(c?.properties || {}), first_name: c?.first_name, last_name: c?.last_name, email: c?.email, contact_id: c?.id, unsubscribe_url: unsubscribeUrl, preferences_url: unsubscribeUrl, RESEND_UNSUBSCRIBE_URL: unsubscribeUrl };
    const defs = [...(props || []).map((p: Any) => ({ name: p.key, fallback: p.fallback })), { name: "first_name", fallback: "there" }];
    html = renderVars(b?.html || "", vars, defs);
    text = renderVars(b?.text || "", vars, defs);
    subject = renderVars(b?.subject || e.subject, vars, defs);
    headers["List-Unsubscribe"] = `<${FUNCTION_URL}/public/unsubscribe/one-click?t=${token}>, <mailto:unsubscribe@${fromDomain || "delivrie.dev"}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  headers["X-Entity-Ref-ID"] = e.id;

  const raw = buildMime({ from: e.from, to, cc, replyTo: e.reply_to || undefined, subject, html, text, headers, attachments: e.attachments?.filter((a: Any) => a.content) || [] });
  const rawB64 = btoa(raw); // MIME output is 7-bit ASCII
  const tags = [{ Name: "email_id", Value: e.id }, { Name: "team_id", Value: e.team_id }];
  for (const t of (e.tags || []).slice(0, 8)) if (/^[A-Za-z0-9_-]{1,256}$/.test(t.name) && /^[A-Za-z0-9_-]{1,256}$/.test(String(t.value))) tags.push({ Name: t.name, Value: String(t.value) });
  try {
    const res = await sesv2(creds(), region, "POST", "/v2/email/outbound-emails", {
      FromEmailAddress: parseAddress(e.from).email,
      Destination: { ToAddresses: to.map(emailOnly), CcAddresses: cc.map(emailOnly), BccAddresses: bcc.map(emailOnly) },
      Content: { Raw: { Data: rawB64 } },
      EmailTags: tags,
      ...(configSet ? { ConfigurationSetName: configSet } : {}),
    });
    const now = new Date().toISOString();
    // strip attachment payloads once sent; keep metadata
    const attMeta = (e.attachments || []).map((a: Any) => ({ filename: a.filename, content_type: a.content_type, size: a.content ? Math.floor(a.content.length * 0.75) : a.size }));
    await db.from("emails").update({ status: "sent", sent_at: now, ses_message_id: res.MessageId, html, text, subject, attachments: attMeta, error: null }).eq("id", e.id);
    await db.from("email_events").insert({ email_id: e.id, team_id: e.team_id, type: "sent", data: { message_id: res.MessageId } });
    await emit(e.team_id, "email.sent", payloadFor({ ...e, subject }));
  } catch (err) {
    if (isTransient(err) && e.attempts + 1 < 5) {
      const wait = [30, 120, 600, 1800][e.attempts] || 1800;
      await db.from("emails").update({ scheduled_at: new Date(Date.now() + wait * 1000).toISOString(), error: (err as Error).message }).eq("id", e.id);
      return;
    }
    await fail(e, err instanceof AwsError ? `${err.code}: ${err.message}` : (err as Error).message);
  }
}

async function fail(e: Any, message: string) {
  await db.from("emails").update({ status: "failed", error: message }).eq("id", e.id);
  await db.from("email_events").insert({ email_id: e.id, team_id: e.team_id, type: "failed", data: { reason: message } });
  await emit(e.team_id, "email.failed", { ...payloadFor(e), failed: { reason: message } });
}

export function payloadFor(e: Any) {
  return { email_id: e.id, from: e.from, to: e.to, subject: e.subject, created_at: e.created_at, ...(e.broadcast_id ? { broadcast_id: e.broadcast_id } : {}), ...(e.tags?.length ? { tags: Object.fromEntries(e.tags.map((t: Any) => [t.name, t.value])) } : {}) };
}

// ---------------- SES events (SNS) ----------------
const MAP: Record<string, string> = { Send: "", Delivery: "delivered", Bounce: "bounced", Complaint: "complained", Open: "opened", Click: "clicked", DeliveryDelay: "delivery_delayed", Reject: "failed", "Rendering Failure": "failed" };

export async function handleSesEvent(msg: Any) {
  if (msg.notificationType === "Received" || msg.receipt) return handleInbound(msg);
  const type = MAP[msg.eventType ?? msg.notificationType];
  if (!type) return;
  const emailId = msg.mail?.tags?.email_id?.[0];
  let e: Any = null;
  if (emailId) e = (await db.from("emails").select("*").eq("id", emailId).maybeSingle()).data;
  if (!e && msg.mail?.messageId) e = (await db.from("emails").select("*").eq("ses_message_id", msg.mail.messageId).maybeSingle()).data;
  if (!e) return;
  let data: Any = {};
  if (type === "delivered") data = { mx_host: msg.delivery?.reportingMTA?.replace(/^dns;\s*/, "") || msg.delivery?.remoteMtaIp, smtp_response: msg.delivery?.smtpResponse, latency_ms: msg.delivery?.processingTimeMillis, recipients: msg.delivery?.recipients };
  if (type === "bounced") data = { type: msg.bounce?.bounceType, sub_type: msg.bounce?.bounceSubType, recipients: msg.bounce?.bouncedRecipients, message: msg.bounce?.bouncedRecipients?.[0]?.diagnosticCode };
  if (type === "complained") data = { feedback_type: msg.complaint?.complaintFeedbackType, user_agent: msg.complaint?.userAgent, recipients: msg.complaint?.complainedRecipients };
  if (type === "opened") data = { user_agent: msg.open?.userAgent, ip: msg.open?.ipAddress };
  if (type === "clicked") data = { link: msg.click?.link, user_agent: msg.click?.userAgent, ip: msg.click?.ipAddress };
  if (type === "delivery_delayed") data = { type: msg.deliveryDelay?.delayType, recipients: msg.deliveryDelay?.delayedRecipients, expiration: msg.deliveryDelay?.expirationTime };
  if (type === "failed") data = { reason: msg.reject?.reason || msg.failure?.errorMessage };
  const at = msg[Object.keys(msg).find((k) => msg[k]?.timestamp && k !== "mail") || ""]?.timestamp || new Date().toISOString();
  await db.from("email_events").insert({ email_id: e.id, team_id: e.team_id, type, data, created_at: at });
  await db.from("emails").update({ status: nextStatus(e.status, type) }).eq("id", e.id);

  // suppression & contact hygiene
  if (type === "bounced" && msg.bounce?.bounceType === "Permanent") {
    for (const r of msg.bounce.bouncedRecipients || []) await db.from("suppressions").upsert({ team_id: e.team_id, email: String(r.emailAddress).toLowerCase(), reason: "bounce" }, { onConflict: "team_id,email", ignoreDuplicates: true });
  }
  if (type === "complained") {
    for (const r of msg.complaint?.complainedRecipients || []) {
      const addr = String(r.emailAddress).toLowerCase();
      await db.from("suppressions").upsert({ team_id: e.team_id, email: addr, reason: "complaint" }, { onConflict: "team_id,email", ignoreDuplicates: true });
      await db.from("contacts").update({ unsubscribed: true }).eq("team_id", e.team_id).eq("email", addr);
    }
  }
  const hookType = { delivered: "email.delivered", bounced: "email.bounced", complained: "email.complained", opened: "email.opened", clicked: "email.clicked", delivery_delayed: "email.delivery_delayed", failed: "email.failed" }[type]!;
  await emit(e.team_id, hookType, { ...payloadFor(e), ...(type === "bounced" ? { bounce: data } : {}), ...(type === "clicked" ? { click: data } : {}) });
}

async function handleInbound(msg: Any) {
  const recipients: string[] = msg.receipt?.recipients || msg.mail?.destination || [];
  const raw = msg.content ? new TextDecoder().decode(b64ToBytes(msg.content)) : "";
  const parsed = raw ? parseMime(raw) : null;
  const seenTeams = new Set<string>();
  for (const rcpt of recipients) {
    const dom = domainOf(rcpt);
    const { data: doms } = await db.from("domains").select("id,team_id,name").eq("receiving_enabled", true);
    const d = (doms || []).find((x: Any) => dom === x.name || dom.endsWith("." + x.name));
    if (!d || seenTeams.has(d.team_id)) continue;
    seenTeams.add(d.team_id);
    const common = msg.mail?.commonHeaders || {};
    const { data: e } = await db.from("emails").insert({
      team_id: d.team_id, domain_id: d.id, direction: "inbound", status: "received",
      from: parsed?.from || common.from?.[0] || msg.mail?.source || "",
      to: parsed?.to?.length ? parsed.to : (common.to || recipients),
      cc: parsed?.cc || common.cc || null,
      subject: parsed?.subject || common.subject || "", html: parsed?.html, text: parsed?.text,
      headers: parsed?.headers ? Object.fromEntries(Object.entries(parsed.headers).slice(0, 60)) : {},
      attachments: parsed?.attachments || [], ses_message_id: msg.mail?.messageId, sent_at: msg.mail?.timestamp,
    }).select().single();
    if (e) {
      await db.from("email_events").insert({ email_id: e.id, team_id: d.team_id, type: "received", data: { spam: msg.receipt?.spamVerdict?.status, virus: msg.receipt?.virusVerdict?.status, spf: msg.receipt?.spfVerdict?.status, dkim: msg.receipt?.dkimVerdict?.status, dmarc: msg.receipt?.dmarcVerdict?.status } });
      await emit(d.team_id, "email.received", { email_id: e.id, from: e.from, to: e.to, subject: e.subject, created_at: e.created_at });
    }
  }
}

// ---------------- validation shared by API + dashboard ----------------
export interface SendBody { from: string; to: string | string[]; subject?: string; html?: string; text?: string; cc?: string | string[]; bcc?: string | string[]; reply_to?: string | string[]; headers?: Record<string, string>; tags?: { name: string; value: string }[]; attachments?: Any[]; scheduled_at?: string; template?: { id: string; variables?: Record<string, unknown> } }

export function validateRecipients(list: string[], field: string) {
  if (list.length > 50) throw new HttpError(422, "validation_error", `${field} can have at most 50 addresses`);
  for (const a of list) if (!EMAIL_RE.test(emailOnly(a))) throw new HttpError(422, "validation_error", `Invalid \`${field}\` address: ${a}`);
}

// Delivrie billing on Paystack: Pro/Scale (monthly or yearly), pay-as-you-go credits, month-end overage
// and the marketing add-on, in USD or NGN.
//
// Routes (served at https://delivrie.io/api/billing/* via a Vercel rewrite):
//   GET  /summary    plan, prices, subscription and invoices for the current team
//   POST /checkout   { plan, currency, interval, kind? } -> Paystack checkout URL (kind "marketing" for the add-on)
//   POST /credits    { pack, currency } -> Paystack checkout for pay-as-you-go credits
//   POST /details    { email, name, country, state, address, city, postal_code, tax_id_type, tax_id }
//   POST /cap        { amount } -> monthly overage spending cap (major units; empty clears it)
//   POST /cron/overage  month-end overage charges (pg_cron, x-cron-secret)
//   POST /verify     { reference } -> applies a completed payment (the webhook does the same)
//   POST /card       -> Paystack page to update the card on the subscription
//   POST /cancel     -> stop renewing; the plan stays until the paid period ends
//   POST /webhook    Paystack events (signed with the secret key)
//
// Secrets: PAYSTACK_SECRET_KEY (sk_test_… or sk_live_…), APP_URL.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// deno-lint-ignore no-explicit-any
type Any = any;
const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const PSK = env("PAYSTACK_SECRET_KEY");
const APP_URL = (env("APP_URL") || "https://delivrie.io").replace(/\/$/, "");

// Prices follow the pricing page. Amounts are in the smallest unit: cents for USD, kobo for NGN.
type Price = Record<string, number>;
export const PLANS: Record<string, { name: string; emails: number; monthly: Price; yearly: Price; overage: Price }> = {
  pro: { name: "Pro", emails: 20_000, monthly: { USD: 10_00, NGN: 10_000_00 }, yearly: { USD: 100_00, NGN: 100_000_00 }, overage: { USD: 45, NGN: 450_00 } },
  scale: { name: "Scale", emails: 100_000, monthly: { USD: 45_00, NGN: 45_000_00 }, yearly: { USD: 450_00, NGN: 450_000_00 }, overage: { USD: 40, NGN: 400_00 } },
};
// Marketing add-on, priced by contacts. "free" (Starter, 1,000 contacts) needs no subscription.
export const MARKETING: Record<string, { name: string; contacts: number; monthly: Price; yearly: Price; extra?: Price }> = {
  growth: { name: "Growth", contacts: 5_000, monthly: { USD: 20_00, NGN: 20_000_00 }, yearly: { USD: 200_00, NGN: 200_000_00 } },
  pro: { name: "Pro marketing", contacts: 10_000, monthly: { USD: 40_00, NGN: 40_000_00 }, yearly: { USD: 400_00, NGN: 400_000_00 }, extra: { USD: 3_50, NGN: 3_500_00 } },
};
// Pay-as-you-go credit packs: one credit sends one email. Credits never expire.
export const PACKS: { emails: number; price: Price; note?: string }[] = [
  { emails: 8_300, price: { USD: 5_00, NGN: 5_000_00 }, note: "Minimum" },
  { emails: 41_600, price: { USD: 25_00, NGN: 25_000_00 } },
  { emails: 172_400, price: { USD: 100_00, NGN: 100_000_00 }, note: "Save 3%" },
  { emails: 925_900, price: { USD: 500_00, NGN: 500_000_00 }, note: "Save 10%" },
];
const CURRENCIES = ["USD", "NGN"];
const INTERVALS = ["monthly", "yearly"];
const catalog = (kind: string) => (kind === "marketing" ? MARKETING : PLANS) as Record<string, { name: string; monthly: Price; yearly: Price }>;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-team-id, x-client-info, apikey",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

// ---------------------------------------------------------------- Paystack
async function ps(method: string, path: string, body?: unknown): Promise<Any> {
  if (!PSK) throw new HttpError(503, "Payments aren't connected yet. Add PAYSTACK_SECRET_KEY to the edge function secrets.");
  const r = await fetch("https://api.paystack.co" + path, {
    method,
    headers: { authorization: `Bearer ${PSK}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) {
    const msg = String(j.message || `Paystack returned ${r.status}`);
    if (/currency/i.test(msg)) throw new HttpError(400, "This currency isn't enabled on the Paystack account yet. Choose the other currency or contact support.");
    throw new HttpError(r.status >= 500 ? 502 : 400, msg);
  }
  return j.data;
}

async function setting(key: string) {
  const { data } = await db.from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) || null;
}
async function setSetting(key: string, value: string) {
  await db.from("system_settings").upsert({ key, value });
}

// One Paystack plan per (kind, plan, interval, currency, price). Changing a price creates a new Paystack plan.
async function planCode(kind: string, plan: string, interval: string, currency: string) {
  const p = catalog(kind)[plan];
  const amount = p[interval as "monthly" | "yearly"][currency];
  const key = `paystack_plan:${PSK.startsWith("sk_live") ? "live" : "test"}:${kind}:${plan}:${interval}:${currency}:${amount}`;
  const existing = await setting(key);
  if (existing) return existing;
  const d = await ps("POST", "/plan", {
    name: `Delivrie ${p.name} ${interval === "yearly" ? "yearly" : "monthly"} (${currency})`,
    interval: interval === "yearly" ? "annually" : "monthly",
    amount,
    currency,
    description: kind === "marketing" ? `Marketing up to ${(p as Any).contacts.toLocaleString("en-US")} contacts` : `${(p as Any).emails.toLocaleString("en-US")} emails a month`,
  });
  await setSetting(key, d.plan_code);
  await setSetting(`paystack_code:${d.plan_code}`, `${kind}:${plan}:${interval}:${currency}`);
  return d.plan_code as string;
}
async function planFromCode(code?: string | null): Promise<{ kind: string; plan: string; interval: string; currency: string } | null> {
  if (!code) return null;
  const v = await setting(`paystack_code:${code}`);
  if (!v) return null;
  const parts = v.split(":");
  if (parts.length === 2) return { kind: "transactional", plan: parts[0], interval: "monthly", currency: parts[1] };
  const [kind, plan, interval, currency] = parts;
  return { kind, plan, interval, currency };
}

// ---------------------------------------------------------------- auth
async function auth(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const teamId = req.headers.get("x-team-id") || "";
  if (!jwt || !teamId) throw new HttpError(401, "Log in again to manage billing.");
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Log in again.");
  const { data: m } = await db.from("team_members").select("role").eq("team_id", teamId).eq("user_id", data.user.id).maybeSingle();
  if (!m) throw new HttpError(403, "You're not a member of this team.");
  return { user: data.user, teamId, admin: m.role === "admin" };
}
const requireAdmin = (a: { admin: boolean }) => { if (!a.admin) throw new HttpError(403, "Only team admins can change billing."); };

async function team(teamId: string) {
  const { data } = await db.from("teams").select("id,name,plan_transactional,plan_marketing,credits,billing").eq("id", teamId).single();
  return data as Any;
}
async function saveBilling(teamId: string, patch: Record<string, unknown>, plan?: string) {
  const t = await team(teamId);
  const billing = { ...(t.billing || {}), ...patch, updated_at: new Date().toISOString() };
  const update: Any = { billing };
  if (plan) update.plan_transactional = plan;
  await db.from("teams").update(update).eq("id", teamId);
}

// ---------------------------------------------------------------- applying payments
const cardOf = (a: Any) => a?.last4 ? `${(a.brand || a.card_type || "Card").trim().replace(/^\w/, (c: string) => c.toUpperCase())} •••• ${a.last4}` : null;

async function teamForCustomer(customerCode: string, planCodeHint?: string) {
  const { data } = await db.from("teams").select("id,billing").eq("billing->>customer_code", customerCode);
  const rows = data || [];
  return (rows.find((r: Any) => planCodeHint && r.billing?.plan_code === planCodeHint) || rows[0])?.id as string | undefined;
}

const parseMeta = (m: Any) => typeof m === "string" ? (() => { try { return JSON.parse(m); } catch { return {}; } })() : (m || {});

async function recordInvoice(teamId: string, tx: Any, kind: string, plan: string | null, description: string) {
  const { data: prev } = await db.from("billing_invoices").select("status").eq("reference", tx.reference).maybeSingle();
  await db.from("billing_invoices").upsert({
    team_id: teamId, reference: tx.reference, plan, kind, description, amount: tx.amount, currency: tx.currency,
    status: tx.status === "success" ? "success" : "failed", card: cardOf(tx.authorization),
    paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(),
  }, { onConflict: "reference" });
  return prev?.status === "success"; // already applied before
}

// Keep the reusable card so month-end overage can be charged without the customer present.
function cardPatch(tx: Any, old: Any) {
  const a = tx.authorization || {};
  return {
    card: cardOf(a) || old.card,
    ...(a.reusable && a.authorization_code ? { authorization_code: a.authorization_code } : {}),
    customer_code: tx.customer?.customer_code || old.customer_code, customer_id: tx.customer?.id || old.customer_id, email: tx.customer?.email || old.email,
  };
}

async function findSub(customerId: number | undefined, code: string | null) {
  if (!customerId || !code) return null;
  try {
    const subs: Any[] = await ps("GET", `/subscription?customer=${customerId}&perPage=50`);
    return subs.filter((s) => s.plan?.plan_code === code && s.status === "active").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  } catch (e) { console.error("subscription lookup failed", e); return null; }
}

async function applyCharge(tx: Any) {
  const code = tx.plan_object?.plan_code || tx.plan?.plan_code || (typeof tx.plan === "string" && tx.plan ? tx.plan : null);
  const meta = parseMeta(tx.metadata);
  const fromCode = await planFromCode(code);
  const kind = meta.kind || fromCode?.kind || "transactional";
  const teamId = meta.team_id || (tx.customer?.customer_code ? await teamForCustomer(tx.customer.customer_code, code) : undefined);
  if (!teamId) return null;
  const before = await team(teamId);
  const old = before.billing || {};

  if (kind === "credits") {
    const emails = Number(meta.emails || 0);
    const done = await recordInvoice(teamId, tx, "credits", null, `${emails.toLocaleString("en-US")} email credits`);
    if (tx.status === "success" && !done && emails > 0) {
      await db.rpc("add_credits", { p_team: teamId, p_n: emails });
      await saveBilling(teamId, { ...cardPatch(tx, old), provider: "paystack", currency: old.currency || tx.currency });
    }
    return teamId;
  }
  if (kind === "overage") {
    await recordInvoice(teamId, tx, "overage", before.plan_transactional, meta.description || "Overage");
    return teamId;
  }

  const plan = meta.plan || fromCode?.plan;
  const interval = meta.interval || fromCode?.interval || "monthly";
  const currency = tx.currency || meta.currency || fromCode?.currency;
  if (!plan || !catalog(kind)[plan]) return null;
  const label = `${catalog(kind)[plan].name} · ${interval}`;
  await recordInvoice(teamId, tx, kind, plan, label);
  if (tx.status !== "success") return teamId;
  const sub = await findSub(tx.customer?.id, code);

  if (kind === "marketing") {
    const m = old.marketing || {};
    const patch = { plan, interval, currency, plan_code: code, status: "active", cancel_at: null, ...(sub ? { subscription_code: sub.subscription_code, email_token: sub.email_token, next_payment_date: sub.next_payment_date } : {}) };
    if (m.subscription_code && sub && m.subscription_code !== sub.subscription_code && m.email_token) {
      await ps("POST", "/subscription/disable", { code: m.subscription_code, token: m.email_token }).catch((e) => console.error("old marketing subscription disable failed", e));
    }
    await saveBilling(teamId, { ...cardPatch(tx, old), provider: "paystack", marketing: { ...m, ...patch } });
    await db.from("teams").update({ plan_marketing: plan }).eq("id", teamId);
    return teamId;
  }

  const patch: Any = {
    ...cardPatch(tx, old), provider: "paystack", plan, interval, currency, plan_code: code, status: "active", cancel_at: null,
    last_payment_at: tx.paid_at || new Date().toISOString(),
    ...(sub ? { subscription_code: sub.subscription_code, email_token: sub.email_token, next_payment_date: sub.next_payment_date } : {}),
  };
  // Switching plans: stop the previous subscription so the customer isn't charged twice.
  if (old.subscription_code && patch.subscription_code && old.subscription_code !== patch.subscription_code && old.email_token) {
    await ps("POST", "/subscription/disable", { code: old.subscription_code, token: old.email_token }).catch((e) => console.error("old subscription disable failed", e));
  }
  await saveBilling(teamId, patch, plan);
  return teamId;
}

// ---------------------------------------------------------------- usage
const monthStart = (d = new Date(), back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
async function usage(teamId: string, from: Date, to = new Date()) {
  const { data } = await db.rpc("team_usage", { p_team: teamId, p_from: from.toISOString(), p_to: to.toISOString() });
  return Number(data || 0);
}
const overageCost = (plan: string, used: number, cur: string) => {
  const p = PLANS[plan];
  if (!p) return { over: 0, cost: 0 };
  const over = Math.max(0, used - p.emails);
  return { over, cost: Math.ceil(over / 1000) * p.overage[cur] };
};

// ---------------------------------------------------------------- handlers
async function summary(teamId: string, admin: boolean) {
  const t = await team(teamId);
  const { data: invoices } = await db.from("billing_invoices").select("reference,plan,kind,description,amount,currency,status,card,paid_at").eq("team_id", teamId).order("created_at", { ascending: false }).limit(24);
  const b = t.billing || {};
  const plan = t.plan_transactional || "free";
  const used = await usage(teamId, monthStart());
  const cur = b.currency === "USD" ? "USD" : "NGN";
  const { count: contacts } = await db.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", teamId);
  return {
    plan,
    plan_marketing: t.plan_marketing || "free",
    admin,
    payments_ready: !!PSK,
    mode: PSK.startsWith("sk_live") ? "live" : PSK ? "test" : null,
    currencies: CURRENCIES,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
    marketing: Object.entries(MARKETING).map(([id, p]) => ({ id, ...p })),
    packs: PACKS,
    credits: Number(t.credits || 0),
    usage: { month: used, included: PLANS[plan]?.emails ?? (plan === "free" ? 3000 : 0), contacts: contacts || 0, ...overageCost(plan, used, cur), currency: cur },
    spend_cap: b.spend_cap || null,
    card: b.card || null,
    can_charge_card: !!b.authorization_code,
    subscription: b.provider === "paystack" && b.plan && b.plan !== "free" ? {
      plan: b.plan, interval: b.interval || "monthly", currency: b.currency, status: b.status, card: b.card || null,
      next_payment_date: b.next_payment_date || null, cancel_at: b.cancel_at || null, can_manage: !!b.subscription_code,
    } : null,
    marketing_subscription: b.marketing?.plan ? { ...b.marketing, email_token: undefined, subscription_code: undefined, can_manage: !!b.marketing.subscription_code } : null,
    details: b.details || {},
    invoices: invoices || [],
  };
}

async function overageRun() {
  // Bill last month's overage for every paid team with a saved card. Safe to re-run: references are per team-month.
  const from = monthStart(new Date(), 1), to = monthStart();
  const tag = `${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
  const { data: teams } = await db.from("teams").select("id,name,plan_transactional,plan_marketing,billing").in("plan_transactional", Object.keys(PLANS));
  const results: Any[] = [];
  for (const t of teams || []) {
    const b = t.billing || {};
    const cur = b.currency === "USD" ? "USD" : "NGN";
    const used = await usage(t.id, from, to);
    const { over, cost } = overageCost(t.plan_transactional, used, cur);
    let amount = cost;
    const lines = over ? [`${over.toLocaleString("en-US")} emails over ${PLANS[t.plan_transactional].name}`] : [];
    if (t.plan_marketing === "pro") {
      const { count } = await db.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", t.id);
      const extra = Math.max(0, (count || 0) - MARKETING.pro.contacts);
      if (extra) { amount += Math.ceil(extra / 1000) * MARKETING.pro.extra![cur]; lines.push(`${extra.toLocaleString("en-US")} extra contacts`); }
    }
    if (!amount) continue;
    const reference = `ovg_${tag}_${t.id.slice(0, 8)}`;
    const { data: done } = await db.from("billing_invoices").select("status").eq("reference", reference).maybeSingle();
    if (done?.status === "success") continue;
    if (!b.authorization_code || !b.email) {
      await db.from("billing_invoices").upsert({ team_id: t.id, reference, kind: "overage", plan: t.plan_transactional, description: lines.join(" · ") + " (no saved card)", amount, currency: cur, status: "failed" }, { onConflict: "reference" });
      results.push({ team: t.id, amount, status: "no_card" });
      continue;
    }
    try {
      const tx = await ps("POST", "/transaction/charge_authorization", {
        email: b.email, amount, currency: cur, authorization_code: b.authorization_code, reference,
        metadata: { team_id: t.id, kind: "overage", description: lines.join(" · ") },
      });
      await recordInvoice(t.id, { ...tx, reference, currency: cur, amount }, "overage", t.plan_transactional, lines.join(" · "));
      if (tx.status !== "success") await saveBilling(t.id, { status: "past_due" });
      results.push({ team: t.id, amount, status: tx.status });
    } catch (e) {
      results.push({ team: t.id, amount, status: "error", error: String((e as Error).message) });
    }
  }
  return { month: tag, charged: results };
}

async function handle(req: Request, path: string): Promise<Response> {
  if (path === "/webhook" && req.method === "POST") return webhook(req);
  if (path === "/cron/overage" && req.method === "POST") {
    const secret = await setting("cron_secret");
    if (!secret || req.headers.get("x-cron-secret") !== secret) throw new HttpError(401, "Unauthorized");
    return json(await overageRun());
  }
  const a = await auth(req);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (path === "/summary" && req.method === "GET") return json(await summary(a.teamId, a.admin));

  if (path === "/checkout" && req.method === "POST") {
    requireAdmin(a);
    const kind = body.kind === "marketing" ? "marketing" : "transactional";
    const plan = String(body.plan || ""), currency = String(body.currency || "").toUpperCase();
    const interval = INTERVALS.includes(body.interval) ? body.interval : "monthly";
    const p = catalog(kind)[plan];
    if (!p) throw new HttpError(400, kind === "marketing" ? "Choose Growth or Pro marketing." : "Choose Pro or Scale.");
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, "Choose USD or NGN.");
    const t = await team(a.teamId);
    const cur = kind === "marketing" ? (t.billing?.marketing || {}) : (t.billing || {});
    const current = kind === "marketing" ? t.plan_marketing : t.plan_transactional;
    if (current === plan && cur.status === "active" && cur.currency === currency && (cur.interval || "monthly") === interval) throw new HttpError(400, `You're already on ${p.name}.`);
    const code = await planCode(kind, plan, interval, currency);
    const init = await ps("POST", "/transaction/initialize", {
      email: t.billing?.details?.email || a.user.email,
      amount: p[interval as "monthly" | "yearly"][currency],
      currency,
      plan: code,
      callback_url: `${APP_URL}/settings/billing`,
      metadata: { team_id: a.teamId, kind, plan, interval, currency, user_id: a.user.id, cancel_action: `${APP_URL}/settings/billing?canceled=1` },
    });
    return json({ url: init.authorization_url, reference: init.reference });
  }

  if (path === "/credits" && req.method === "POST") {
    requireAdmin(a);
    const pack = PACKS[Number(body.pack)];
    const currency = String(body.currency || "").toUpperCase();
    if (!pack) throw new HttpError(400, "Choose a credit pack.");
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, "Choose USD or NGN.");
    const init = await ps("POST", "/transaction/initialize", {
      email: a.user.email,
      amount: pack.price[currency],
      currency,
      callback_url: `${APP_URL}/settings/billing`,
      metadata: { team_id: a.teamId, kind: "credits", emails: pack.emails, currency, user_id: a.user.id, cancel_action: `${APP_URL}/settings/billing?canceled=1` },
    });
    return json({ url: init.authorization_url, reference: init.reference });
  }

  if (path === "/cap" && req.method === "POST") {
    requireAdmin(a);
    const v = body.amount == null || body.amount === "" ? null : Math.round(Number(body.amount) * 100);
    if (v != null && (!isFinite(v) || v < 0)) throw new HttpError(400, "Enter a positive amount, or leave it empty for no cap.");
    await saveBilling(a.teamId, { spend_cap: v || null });
    return json(await summary(a.teamId, a.admin));
  }

  if (path === "/details" && req.method === "POST") {
    requireAdmin(a);
    const clip = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
    const email = clip(body.email, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid billing email.");
    const t = await team(a.teamId);
    const prev = t.billing?.details || {};
    const next: Any = { ...prev };
    for (const k of ["name", "country", "state", "address", "city", "postal_code", "tax_id_type", "tax_id"]) if (k in body) next[k] = clip(body[k]);
    if ("email" in body) next.email = email;
    await saveBilling(a.teamId, { details: next });
    return json(await summary(a.teamId, a.admin));
  }

  if (path === "/verify" && req.method === "POST") {
    const ref = String(body.reference || "");
    if (!ref) throw new HttpError(400, "Missing payment reference.");
    const tx = await ps("GET", `/transaction/verify/${encodeURIComponent(ref)}`);
    const meta = parseMeta(tx.metadata);
    if (meta.team_id && meta.team_id !== a.teamId) throw new HttpError(403, "This payment belongs to a different team.");
    if (tx.status === "success") await applyCharge(tx);
    return json({ status: tx.status, kind: meta.kind || "transactional", ...(await summary(a.teamId, a.admin)) });
  }

  if (path === "/card" && req.method === "POST") {
    requireAdmin(a);
    const t = await team(a.teamId);
    const b = t.billing || {};
    const code = b.subscription_code || b.marketing?.subscription_code;
    if (!code) throw new HttpError(400, "There's no active subscription to update.");
    const d = await ps("GET", `/subscription/${code}/manage/link`);
    return json({ url: d.link });
  }

  if (path === "/cancel" && req.method === "POST") {
    requireAdmin(a);
    const t = await team(a.teamId);
    const all = t.billing || {};
    const marketing = body.kind === "marketing";
    const b = marketing ? (all.marketing || {}) : all;
    if (!b.subscription_code || !b.email_token) throw new HttpError(400, "There's no active subscription to cancel.");
    await ps("POST", "/subscription/disable", { code: b.subscription_code, token: b.email_token });
    const end = b.next_payment_date || new Date().toISOString();
    if (marketing) await saveBilling(a.teamId, { marketing: { ...b, status: "cancelling", cancel_at: end } });
    else await saveBilling(a.teamId, { status: "cancelling", cancel_at: end });
    return json(await summary(a.teamId, a.admin));
  }

  throw new HttpError(404, "Not found");
}

async function webhook(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") || "";
  if (!PSK || !sig) return json({ error: "invalid signature" }, 401);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PSK), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))).map((x) => x.toString(16).padStart(2, "0")).join("");
  if (!PSK || mac !== sig) return json({ error: "invalid signature" }, 401);
  const evt = JSON.parse(raw);
  const d = evt.data || {};
  try {
    switch (evt.event) {
      case "charge.success":
        await applyCharge(d);
        break;
      case "subscription.create": {
        const teamId = d.customer?.customer_code ? await teamForCustomer(d.customer.customer_code, d.plan?.plan_code) : undefined;
        const info = await planFromCode(d.plan?.plan_code);
        const sub = { subscription_code: d.subscription_code, email_token: d.email_token, next_payment_date: d.next_payment_date, plan_code: d.plan?.plan_code };
        if (teamId && info?.kind === "marketing") await saveBilling(teamId, { marketing: { ...((await team(teamId)).billing?.marketing || {}), ...sub } });
        else if (teamId) await saveBilling(teamId, sub);
        break;
      }
      case "invoice.create":
      case "invoice.update": {
        const teamId = d.customer?.customer_code ? await teamForCustomer(d.customer.customer_code, d.subscription?.plan?.plan_code) : undefined;
        if (teamId && d.subscription?.next_payment_date) await saveBilling(teamId, { next_payment_date: d.subscription.next_payment_date });
        break;
      }
      case "invoice.payment_failed": {
        const teamId = d.customer?.customer_code ? await teamForCustomer(d.customer.customer_code) : undefined;
        if (teamId) await saveBilling(teamId, { status: "past_due" });
        break;
      }
      case "subscription.not_renew":
      case "subscription.disable": {
        const { data: mk } = await db.from("teams").select("id,billing").eq("billing->marketing->>subscription_code", d.subscription_code);
        for (const r of mk || []) {
          const m = r.billing?.marketing || {};
          const end = m.next_payment_date || d.next_payment_date;
          if (end && new Date(end) > new Date()) await saveBilling(r.id, { marketing: { ...m, status: "cancelling", cancel_at: end } });
          else { await saveBilling(r.id, { marketing: { ...m, status: "canceled", plan: "free" } }); await db.from("teams").update({ plan_marketing: "free" }).eq("id", r.id); }
        }
        const { data: rows } = await db.from("teams").select("id,billing").eq("billing->>subscription_code", d.subscription_code);
        for (const r of rows || []) {
          const end = r.billing?.next_payment_date || d.next_payment_date;
          const stillPaid = end && new Date(end) > new Date();
          if (stillPaid) await saveBilling(r.id, { status: "cancelling", cancel_at: end });
          else await saveBilling(r.id, { status: "canceled", plan: "free" }, "free");
        }
        break;
      }
    }
  } catch (e) {
    console.error("webhook handling failed", evt.event, e);
    return json({ received: true, error: String((e as Error).message) }, 500);
  }
  return json({ received: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const i = url.pathname.indexOf("/billing");
  const path = (i >= 0 ? url.pathname.slice(i + "/billing".length) : url.pathname) || "/";
  try {
    return await handle(req, path.replace(/\/$/, "") || "/");
  } catch (e) {
    if (e instanceof HttpError) return json({ statusCode: e.status, message: e.message }, e.status);
    console.error(e);
    return json({ statusCode: 500, message: "Something went wrong with billing. Try again." }, 500);
  }
});

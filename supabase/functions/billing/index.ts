// Delivrie billing: Paystack subscriptions for the Pro and Scale plans, in USD or NGN.
//
// Routes (served at https://delivrie.io/api/billing/* via a Vercel rewrite):
//   GET  /summary    plan, prices, subscription and invoices for the current team
//   POST /checkout   { plan, currency } -> Paystack checkout URL
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

// Prices are in the smallest unit: cents for USD, kobo for NGN.
export const PLANS: Record<string, { name: string; emails: number; prices: Record<string, number> }> = {
  pro: { name: "Pro", emails: 50_000, prices: { USD: 10_00, NGN: 15_000_00 } },
  scale: { name: "Scale", emails: 100_000, prices: { USD: 30_00, NGN: 45_000_00 } },
};
const CURRENCIES = ["USD", "NGN"];

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

// One Paystack plan per (plan, currency, price). Changing a price creates a new Paystack plan.
async function planCode(plan: string, currency: string) {
  const amount = PLANS[plan].prices[currency];
  const key = `paystack_plan:${PSK.startsWith("sk_live") ? "live" : "test"}:${plan}:${currency}:${amount}`;
  const existing = await setting(key);
  if (existing) return existing;
  const d = await ps("POST", "/plan", {
    name: `Delivrie ${PLANS[plan].name} (${currency})`,
    interval: "monthly",
    amount,
    currency,
    description: `${PLANS[plan].emails.toLocaleString("en-US")} emails a month`,
  });
  await setSetting(key, d.plan_code);
  await setSetting(`paystack_code:${d.plan_code}`, `${plan}:${currency}`);
  return d.plan_code as string;
}
async function planFromCode(code?: string | null): Promise<{ plan: string; currency: string } | null> {
  if (!code) return null;
  const v = await setting(`paystack_code:${code}`);
  if (!v) return null;
  const [plan, currency] = v.split(":");
  return { plan, currency };
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
  const { data } = await db.from("teams").select("id,name,plan_transactional,billing").eq("id", teamId).single();
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

async function applyCharge(tx: Any) {
  const code = tx.plan_object?.plan_code || tx.plan?.plan_code || (typeof tx.plan === "string" ? tx.plan : null);
  const meta = typeof tx.metadata === "string" ? (() => { try { return JSON.parse(tx.metadata); } catch { return {}; } })() : (tx.metadata || {});
  const fromCode = await planFromCode(code);
  const plan = meta.plan || fromCode?.plan;
  const currency = tx.currency || meta.currency || fromCode?.currency;
  const teamId = meta.team_id || (tx.customer?.customer_code ? await teamForCustomer(tx.customer.customer_code, code) : undefined);
  if (!teamId || !plan || !PLANS[plan]) return null;

  await db.from("billing_invoices").upsert({
    team_id: teamId, reference: tx.reference, plan, amount: tx.amount, currency,
    status: tx.status === "success" ? "success" : "failed", card: cardOf(tx.authorization),
    paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(),
  }, { onConflict: "reference" });
  if (tx.status !== "success") return teamId;

  const before = await team(teamId);
  const old = before.billing || {};
  const patch: Any = {
    provider: "paystack", plan, currency, plan_code: code, status: "active", cancel_at: null,
    customer_code: tx.customer?.customer_code, customer_id: tx.customer?.id, email: tx.customer?.email,
    card: cardOf(tx.authorization) || old.card, last_payment_at: tx.paid_at || new Date().toISOString(),
  };
  // Find the subscription Paystack created for this plan.
  if (tx.customer?.id && code) {
    try {
      const subs: Any[] = await ps("GET", `/subscription?customer=${tx.customer.id}&perPage=50`);
      const sub = subs.filter((s) => s.plan?.plan_code === code && s.status === "active").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (sub) Object.assign(patch, { subscription_code: sub.subscription_code, email_token: sub.email_token, next_payment_date: sub.next_payment_date });
    } catch (e) { console.error("subscription lookup failed", e); }
  }
  // Switching plans: stop the previous subscription so the customer isn't charged twice.
  if (old.subscription_code && patch.subscription_code && old.subscription_code !== patch.subscription_code && old.email_token) {
    await ps("POST", "/subscription/disable", { code: old.subscription_code, token: old.email_token }).catch((e) => console.error("old subscription disable failed", e));
  }
  await saveBilling(teamId, patch, plan);
  return teamId;
}

// ---------------------------------------------------------------- handlers
async function summary(teamId: string, admin: boolean) {
  const t = await team(teamId);
  const { data: invoices } = await db.from("billing_invoices").select("reference,plan,amount,currency,status,card,paid_at").eq("team_id", teamId).order("created_at", { ascending: false }).limit(24);
  const b = t.billing || {};
  return {
    plan: t.plan_transactional || "free",
    admin,
    payments_ready: !!PSK,
    mode: PSK.startsWith("sk_live") ? "live" : PSK ? "test" : null,
    currencies: CURRENCIES,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, emails: p.emails, prices: p.prices })),
    subscription: b.provider === "paystack" ? {
      plan: b.plan, currency: b.currency, status: b.status, card: b.card || null,
      next_payment_date: b.next_payment_date || null, cancel_at: b.cancel_at || null, can_manage: !!b.subscription_code,
    } : null,
    invoices: invoices || [],
  };
}

async function handle(req: Request, path: string): Promise<Response> {
  if (path === "/webhook" && req.method === "POST") return webhook(req);
  const a = await auth(req);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (path === "/summary" && req.method === "GET") return json(await summary(a.teamId, a.admin));

  if (path === "/checkout" && req.method === "POST") {
    requireAdmin(a);
    const plan = String(body.plan || ""), currency = String(body.currency || "").toUpperCase();
    if (!PLANS[plan]) throw new HttpError(400, "Choose Pro or Scale.");
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, "Choose USD or NGN.");
    const t = await team(a.teamId);
    if (t.plan_transactional === plan && t.billing?.status === "active" && t.billing?.currency === currency) throw new HttpError(400, `You're already on ${PLANS[plan].name}.`);
    const code = await planCode(plan, currency);
    const init = await ps("POST", "/transaction/initialize", {
      email: a.user.email,
      amount: PLANS[plan].prices[currency],
      currency,
      plan: code,
      callback_url: `${APP_URL}/settings/billing`,
      metadata: { team_id: a.teamId, plan, currency, user_id: a.user.id, cancel_action: `${APP_URL}/settings/billing?canceled=1` },
    });
    return json({ url: init.authorization_url, reference: init.reference });
  }

  if (path === "/verify" && req.method === "POST") {
    const ref = String(body.reference || "");
    if (!ref) throw new HttpError(400, "Missing payment reference.");
    const tx = await ps("GET", `/transaction/verify/${encodeURIComponent(ref)}`);
    const meta = typeof tx.metadata === "string" ? JSON.parse(tx.metadata || "{}") : (tx.metadata || {});
    if (meta.team_id && meta.team_id !== a.teamId) throw new HttpError(403, "This payment belongs to a different team.");
    if (tx.status === "success") await applyCharge(tx);
    return json({ status: tx.status, ...(await summary(a.teamId, a.admin)) });
  }

  if (path === "/card" && req.method === "POST") {
    requireAdmin(a);
    const b = (await team(a.teamId)).billing || {};
    if (!b.subscription_code) throw new HttpError(400, "There's no active subscription to update.");
    const d = await ps("GET", `/subscription/${b.subscription_code}/manage/link`);
    return json({ url: d.link });
  }

  if (path === "/cancel" && req.method === "POST") {
    requireAdmin(a);
    const b = (await team(a.teamId)).billing || {};
    if (!b.subscription_code || !b.email_token) throw new HttpError(400, "There's no active subscription to cancel.");
    await ps("POST", "/subscription/disable", { code: b.subscription_code, token: b.email_token });
    const end = b.next_payment_date || new Date().toISOString();
    await saveBilling(a.teamId, { status: "cancelling", cancel_at: end });
    return json(await summary(a.teamId, a.admin));
  }

  throw new HttpError(404, "Not found");
}

async function webhook(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") || "";
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
        if (teamId) await saveBilling(teamId, { subscription_code: d.subscription_code, email_token: d.email_token, next_payment_date: d.next_payment_date, plan_code: d.plan?.plan_code });
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

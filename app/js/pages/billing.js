// Billing (Figma 9.11 · Plan, usage & top-ups): overview, usage, credits & top-ups, invoices, payment methods.
import { state, api } from "../lib/sb.js";
import { esc, icon, fmtDate, num, toast, errToast, modal, formModal, confirmModal, badge, on, menu } from "../lib/ui.js";
import { usageTab } from "./settings.js";

const TABS = [["overview", "Overview"], ["usage", "Usage"], ["credits", "Credits & top-ups"], ["invoices", "Invoices"], ["payment-methods", "Payment methods"]];
const money = (amount, currency, exact) => new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", { style: "currency", currency, minimumFractionDigits: exact && amount % 100 ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 }).format((amount || 0) / 100);
const cap1 = (x) => String(x || "").replace(/^\w/, (c) => c.toUpperCase());
const DAY = 864e5;
const fullDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
function since(d) {
  if (!d) return "";
  const a = new Date(d), b = new Date();
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) months--;
  const anchor = new Date(a); anchor.setMonth(a.getMonth() + months);
  const days = Math.max(0, Math.floor((b - anchor) / DAY));
  const p = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return months > 0 ? `${p(months, "month")}, ${p(days, "day")}` : p(days, "day");
}
const inDays = (d) => { const n = Math.ceil((new Date(d) - Date.now()) / DAY); return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; };
const segmented = (items, cur, attr) => `<div class="seg" role="group">${items.map(([v, l]) => `<button type="button" class="${v === cur ? "on" : ""}" ${attr}="${v}">${l}</button>`).join("")}</div>`;
const planName = (id, kind) => kind === "marketing" ? ({ free: "Starter", growth: "Growth", pro: "Pro marketing" }[id] || cap1(id)) : id === "payg" ? "Pay as you go" : cap1(id);

export default async function billingPage(ctx) {
  const tab = ctx.params.tab || "overview";
  if (!TABS.some(([k]) => k === tab)) return ctx.navigate("/billing", { replace: true });
  ctx.crumb("card", "Billing");
  ctx.root.innerHTML = `<div class="page wide bill"><div class="page-head"><h1>Billing</h1><div class="actions"><a class="btn btn-secondary btn-sm" href="/billing/invoices">${icon("download", 13)} Invoices</a><a class="btn btn-secondary btn-sm" href="/pricing" target="_blank" data-native>${icon("external", 13)} Compare plans</a></div></div>
    <div class="ul-tabs">${TABS.map(([k, l]) => `<a class="ul-tab ${k === tab ? "on" : ""}" href="/billing${k === "overview" ? "" : "/" + k}">${l}</a>`).join("")}</div><div data-body></div></div>`;
  const body = ctx.root.querySelector("[data-body]");
  if (tab === "usage") return usageTab(body);

  // Returning from Paystack checkout
  const ref = ctx.query.reference || ctx.query.trxref;
  let s;
  if (ref) {
    body.innerHTML = `<div class="card card-pad row-flex"><span class="spinner"></span><span class="muted">Confirming your payment…</span></div>`;
    try {
      s = await api("POST", "/billing/verify", { reference: ref });
      const ok = s.status === "success";
      const what = s.kind === "credits" ? `Credits added. You have ${money(s.credit_value, s.currency)} of credit.` : s.kind === "marketing" ? "Marketing plan updated. Thanks!" : `You're on ${cap1(s.plan)}. Thanks!`;
      toast(ok ? what : "Payment wasn't completed. You haven't been charged.", ok ? "ok" : "info", 6000);
    } catch (e) { errToast(e); }
    history.replaceState(null, "", location.pathname);
  }
  if (ctx.query.canceled) { toast("Checkout canceled. You haven't been charged.", "info"); history.replaceState(null, "", location.pathname); }
  if (!s) s = await api("GET", "/billing/summary");

  const B = { s, ctx, body, tab };
  B.draw = () => { ({ overview, credits: creditsTab, invoices: invoicesTab, "payment-methods": methodsTab }[tab])(B); };
  B.refresh = async (next) => { B.s = s = next || await api("GET", "/billing/summary"); B.draw(); };
  bindActions(B);
  B.draw();

  // Arriving from the pricing page: /billing?upgrade=pro&interval=yearly
  const up = ctx.query.upgrade;
  if (up) {
    history.replaceState(null, "", location.pathname);
    if (!B.s.admin) toast("Only team admins can change the plan. Ask an admin to upgrade.", "info", 6000);
    else if (up === "payg" || up === "credits") topUp(B);
    else if (B.s.plans.some((p) => p.id === up)) changePlan(B, "transactional", ctx.query.interval === "yearly" ? "yearly" : "monthly", up);
  }
}

// ------------------------------------------------------------ shared pieces
const isPayg = (s) => s.plan === "free" && (s.credits > 0 || s.invoices.some((i) => i.kind === "credits" && i.status === "success"));
const rateLine = (s) => `${money(s.credit_rate[s.currency] * 1000, s.currency, true)} / 1,000`;
const autoLine = (s) => { const a = s.auto_topup; const p = s.packs[a.pack] || s.packs[1]; return a.enabled ? `Below ${money(a.threshold, s.currency)} → +${money(p.price[s.currency], s.currency)}` : "Off"; };

function chart(s, { future = true } = {}) {
  const P = s.period, start = new Date(P.start);
  const byDay = Object.fromEntries(s.daily.map((d) => [String(d.day).slice(0, 10), d.n]));
  const days = future ? P.days : P.day;
  const vals = Array.from({ length: days }, (_, i) => byDay[new Date(start.getTime() + i * DAY).toISOString().slice(0, 10)] || 0);
  const max = Math.max(1, ...vals.slice(0, P.day));
  const bars = vals.map((v, i) => i < P.day ? `<i style="height:${Math.max(4, v / max * 100)}%" title="${shortDate(new Date(start.getTime() + i * DAY))}: ${num(v)} emails"></i>` : `<i class="f"></i>`).join("");
  return `<div class="bars ${future ? "" : "past"}">${bars}</div>`;
}

function creditsCard(s, { low } = {}) {
  const cur = s.currency, last = s.invoices.find((i) => i.kind === "credits" && i.status === "success");
  const paid = s.plan !== "free";
  return `<div class="card bcard"><div class="bc-head"><h3>Credits</h3>${s.admin ? `<button class="ibtn" data-credit-menu aria-label="Credit options">${icon("more", 15)}</button>` : ""}</div>
    <div class="big ${low ? "low" : ""}">${money(s.credit_value, cur)}</div>
    ${low && last ? `<div class="meter thin warn"><i style="width:${Math.min(100, s.credit_value / last.amount * 100)}%"></i></div><p class="dim sm">of ${money(last.amount, last.currency)} last top-up · ≈ ${num(s.credits)} emails</p>`
      : `<p class="dim sm">≈ ${num(s.credits)} emails at ${rateLine(s)} · never expire</p>`}
    ${paid ? `<p class="muted sm">On ${esc(cap1(s.plan))}, credits pay for overage before your card is charged.</p>` : ""}
    ${s.admin ? `<button class="btn btn-primary btn-block" data-topup ${s.payments_ready ? "" : "disabled"}>${icon("plus", 13)} Top up</button>` : ""}
    <div class="kv-row"><span>Auto top-up</span><span class="grow"></span><span class="dim sm">${esc(autoLine(s))}</span>${s.admin ? `<input type="checkbox" class="toggle" data-auto ${s.auto_topup.enabled ? "checked" : ""} aria-label="Auto top-up">` : ""}</div></div>`;
}

function banner(kind, title, sub, actions) {
  return `<div class="bbanner ${kind}">${icon("alert", 15)}<div class="grow"><b>${title}</b><span>${sub}</span></div>${actions}</div>`;
}

// ------------------------------------------------------------ Overview
function overview(B) {
  const s = B.s;
  if (s.plan !== "free") return overviewPaid(B);
  if (isPayg(s)) return overviewPayg(B);
  return overviewFree(B);
}

function payBanner(s) {
  if (!s.payments_ready) return `<div class="banner">${icon("info", 14)} Payments aren't connected yet. Plans can't be bought until the Paystack key is added.</div>`;
  if (s.mode === "test") return `<div class="banner">${icon("info", 14)} Test mode: use Paystack's test card <b>4084 0840 8408 4081</b>, any future expiry, CVV <b>408</b>. No real money moves.</div>`;
  return "";
}

function overviewPaid(B) {
  const s = B.s, cur = s.currency, u = s.usage, P = s.period, sub = s.subscription;
  const plan = s.plans.find((p) => p.id === s.plan) || { name: cap1(s.plan), emails: u.included, monthly: {}, yearly: {}, overage: {} };
  const pc = sub?.currency || cur, yearly = sub?.interval === "yearly";
  const pct = u.included ? u.month / u.included : 0;
  const left = Math.max(0, u.included - u.month), daysLeft = P.days - P.day;
  const perDay = P.day ? u.month / P.day : 0;
  const hitDate = pct < 1 && perDay > 0 ? new Date(Date.now() + Math.ceil(left / perDay) * DAY) : null;
  const save = (plan.monthly[pc] || 0) * 12 - (plan.yearly[pc] || 0);
  const ni = s.next_invoice;
  const L = s.limits;
  const limitRow = (label, used, limit, extra = "") => `<div class="lim"><span class="muted">${label}</span>${limit ? `<div class="meter thin"><i style="width:${Math.min(100, used / limit * 100)}%"></i></div>` : `<span class="grow"></span>`}<span>${num(used)} / ${limit ? num(limit) : "Unlimited"}${extra}</span></div>`;
  const alertRow = (on, label) => `<div class="al ${on ? "on" : ""}">${icon(on ? "check-circle" : "x-circle", 14)}<span>${label}</span></div>`;
  const status = sub?.status === "cancelling" ? `<span class="badge orange">Ends ${fmtDate(sub.cancel_at)}</span>` : sub?.status === "past_due" ? `<span class="badge red">Payment failed</span>` : "";

  B.body.innerHTML = `${payBanner(s)}
    ${sub?.status === "past_due" ? banner("err", "Your last payment failed", "Update your card so your plan keeps renewing. Sending continues for now.", s.admin && sub.can_manage ? `<button class="btn btn-primary btn-sm" data-card>Update card</button>` : "") : ""}
    ${pct >= 0.8 ? banner("warn", `You’ve used ${Math.floor(pct * 100)}% of this month’s ${num(u.included)} emails`, `${pct >= 1 ? `You’re ${num(u.month - u.included)} emails over.` : hitDate ? `At this pace you’ll hit the limit around ${shortDate(hitDate)}.` : ""} Sending won’t stop: extra emails cost ${money(plan.overage[cur], cur, true)} per 1,000, paid from credits first.`, s.admin ? `<button class="btn btn-primary btn-sm" data-topup>Top up credits</button>${s.plan === "pro" ? `<button class="btn btn-secondary btn-sm" data-upgrade="scale">Upgrade to Scale</button>` : ""}` : "") : ""}
    <div class="bgrid"><div class="bcol">
      <div class="card bcard plan-card"><div class="pc-top"><span class="pc-ico">${icon("bolt", 16)}</span><div class="grow"><div class="row-flex" style="gap:8px;flex-wrap:wrap"><h3 class="pc-name">${esc(plan.name)}</h3><span class="badge yellow">Current plan</span><span class="badge gray">${yearly ? "Yearly" : "Monthly"}</span>${status}</div>
        <p class="dim sm">${yearly ? `${money(plan.yearly[pc], pc)} / year` : `${money(plan.monthly[pc], pc)} / month`} · ${num(plan.emails)} emails · ${money(plan.overage[cur], cur, true)} per extra 1,000</p></div>
        ${s.admin ? `<div class="row-flex" style="gap:8px"><button class="btn btn-secondary btn-sm" data-plan>Change plan</button>${!yearly && save > 0 && s.payments_ready ? `<button class="btn btn-secondary btn-sm" data-yearly>${icon("sparkle", 12)} Switch to yearly · save ${money(save, pc)}</button>` : ""}</div>` : ""}</div>
        <div class="pc-facts">
          <div><span class="k">Customer since</span><b>${fullDate(s.customer_since)}</b><span class="dim">${since(s.customer_since)}</span></div>
          <div><span class="k">On ${esc(plan.name)} since</span><b>${fullDate(s.plan_since)}</b><span class="dim">${s.plan_since ? since(s.plan_since) : "—"}</span></div>
          <div><span class="k">${sub?.status === "cancelling" ? "Ends" : "Renews"}</span><b>${fullDate(sub?.cancel_at || sub?.next_payment_date)}</b><span class="dim">${sub?.cancel_at || sub?.next_payment_date ? inDays(sub.cancel_at || sub.next_payment_date) : "—"}</span></div>
          <div><span class="k">Payment</span><b>${esc(s.card || "No card")}</b><span class="dim">${sub?.status === "cancelling" ? "Auto-renew off" : sub?.can_manage ? "Auto-renew on" : "—"}</span></div>
        </div></div>

      <div class="card bcard"><div class="bc-head"><h3>Emails this billing period</h3><span class="chip">Day ${P.day} of ${P.days}</span></div>
        <div class="row-flex usage-big"><b data-count>${num(u.month)}</b><span class="muted">of ${num(u.included)} included</span><span class="grow"></span><span class="${pct >= 0.9 ? "warn-t" : ""}">${Math.floor(pct * 100)}% used</span></div>
        <div class="meter fat ${pct >= 0.9 ? "warn" : ""}"><i style="width:${Math.min(100, pct * 100)}%"></i></div>
        <div class="row-flex dim sm" style="margin-top:8px"><span>${shortDate(P.start)} – ${shortDate(P.end)}</span><span class="grow"></span><span>${pct < 1 ? `${num(left)} left` : `${num(u.month - u.included)} over`} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go</span></div>
        ${chart(s)}
        <div class="row-flex dim sm"><span>${shortDate(P.start)}</span><span class="grow" style="text-align:center">Today · ${shortDate(new Date())}</span><span>${shortDate(P.end)}</span></div>
        <div class="note">${icon("chart", 13)}<span>Projected ~${num(Math.round(P.projected / 100) * 100)} emails by ${shortDate(P.end)}${P.projected_over ? ` · about ${num(P.projected_over)} over the plan (${money(P.projected_cost, cur)} overage)` : ` · within the plan`}</span></div></div>

      <div class="card bcard"><h3>Other limits</h3><div class="lims">
        <div class="lim"><span class="muted">Daily sending</span><span class="grow"></span><span>${num(u.today)} today · ${u.day_limit ? `limit ${num(u.day_limit)}` : "No daily limit"}</span></div>
        ${limitRow("Domains", L.domains.used, L.domains.limit)}
        ${limitRow("Team members", L.members.used, L.members.limit)}
        ${limitRow("Marketing contacts", L.contacts.used, L.contacts.limit, ` <span class="dim">(${esc(planName(s.plan_marketing, "marketing"))}${s.plan_marketing === "free" ? "" : " add-on"})</span>`)}
        <div class="lim"><span class="muted">Data retention</span><span class="grow"></span><span>${L.retention_days} day${L.retention_days === 1 ? "" : "s"} · ${esc(plan.name)}</span></div>
      </div></div>
    </div>
    <div class="bcol bside">
      ${creditsCard(s)}
      <div class="card bcard"><h3>Next invoice · ${shortDate(ni.date)}</h3><div class="inv-rows">
        ${ni.plan ? `<div><span class="muted">${esc(plan.name)} plan</span><span>${money(ni.plan, ni.plan_currency)}</span></div>` : ""}
        <div><span class="muted">Projected overage${ni.overage_units ? ` (${num(ni.overage_units)} × ${money(plan.overage[cur], cur, true)})` : ""}</span><span>${money(ni.overage, cur)}</span></div>
        ${ni.credits ? `<div><span class="muted">Credits applied</span><span class="pos">−${money(ni.credits, cur)}</span></div>` : ""}
        ${s.vat_rate ? `<div><span class="muted">VAT ${s.vat_rate}%</span><span>${money(ni.vat, cur)}</span></div>` : ""}
        <div class="tot"><span>Estimated total</span><span>${ni.plan_currency === cur || !ni.plan ? money(ni.total, cur) : `${money(ni.plan, ni.plan_currency)} + ${money(ni.total - ni.plan, cur)}`}</span></div></div>
        <p class="dim sm">Estimate updates daily. Final amount depends on usage until ${shortDate(P.end)}.${ni.overage && new Date(ni.date) < new Date(P.end) ? " Overage is billed on the 1st." : ""}</p></div>
      <div class="card bcard"><div class="bc-head"><h3>Usage alerts</h3>${s.admin ? `<button class="btn btn-ghost btn-sm" data-alerts>Edit</button>` : ""}</div><div class="als">
        ${alertRow(s.alerts.p80, "Email at 80% of plan")}${alertRow(s.alerts.p100, "Email at 100% of plan")}${alertRow(s.alerts.credits_low, `Credits below ${money(s.auto_topup.threshold, cur)}`)}${alertRow(!!s.spend_cap, s.spend_cap ? `Monthly spend cap · ${money(s.spend_cap, cur)}` : "No monthly spend cap")}</div></div>
    </div></div>`;
}

function overviewFree(B) {
  const s = B.s, cur = s.currency, u = s.usage, P = s.period;
  const pro = s.plans.find((p) => p.id === "pro");
  const dayFull = u.day_limit && u.today >= u.day_limit, monthFull = u.month >= u.included;
  const now = new Date(), midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const mins = Math.max(0, Math.round((midnight - now) / 6e4));
  const resetIn = `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const dPct = u.day_limit ? Math.min(1, u.today / u.day_limit) : 0, mPct = u.included ? Math.min(1, u.month / u.included) : 0;
  const nextMonth = new Date(new Date(P.end).getTime() + 1);
  B.body.innerHTML = `${payBanner(s)}
    ${dayFull || monthFull ? banner("err", dayFull && !monthFull ? `Daily limit reached · ${num(u.today)} of ${num(u.day_limit)} emails sent today` : `Monthly limit reached · ${num(u.month)} of ${num(u.included)} emails`, dayFull && !monthFull ? `Sending is paused until midnight UTC (resets in ${resetIn}). Upgrade or switch to pay as you go to keep sending.` : `Sending is paused until ${shortDate(nextMonth)}. Upgrade or switch to pay as you go to keep sending.`, s.admin ? `<button class="btn btn-primary btn-sm" data-upgrade="pro">Upgrade to Pro</button><button class="btn btn-secondary btn-sm" data-topup>Buy credits</button>` : "")
      : mPct >= 0.8 ? banner("warn", `You’ve used ${Math.floor(mPct * 100)}% of this month’s free emails`, "When you hit the limit, sending pauses. Upgrade or buy credits to keep going.", s.admin ? `<button class="btn btn-primary btn-sm" data-upgrade="pro">Upgrade to Pro</button><button class="btn btn-secondary btn-sm" data-topup>Buy credits</button>` : "") : ""}
    <div class="bgrid"><div class="bcol">
      <div class="card bcard"><div class="row-flex" style="gap:8px"><h3 class="pc-name">Free</h3><span class="badge yellow">Current plan</span><span class="grow"></span><a class="btn btn-secondary btn-sm" href="/pricing" target="_blank" data-native>Compare plans</a></div>
        <p class="dim sm">${num(u.included)} emails / month · ${num(u.day_limit)} / day · 1 domain · customer since ${fullDate(s.customer_since)} (${since(s.customer_since)})</p></div>
      <div class="card bcard"><div class="row-flex"><h3>Today</h3><span class="grow"></span><span class="${dayFull ? "err-t" : ""}">${num(u.today)} / ${num(u.day_limit)}</span></div><div class="meter fat ${dayFull ? "err" : ""}"><i style="width:${dPct * 100}%"></i></div><p class="dim sm">Resets at 00:00 UTC</p></div>
      <div class="card bcard"><div class="row-flex"><h3>This month</h3><span class="grow"></span><span class="${monthFull ? "err-t" : ""}">${num(u.month)} / ${num(u.included)}</span></div><div class="meter fat ${monthFull ? "err" : ""}"><i style="width:${mPct * 100}%"></i></div><p class="dim sm">Resets ${shortDate(nextMonth)} · ${P.days - P.day + 1} days left</p></div>
    </div>
    <div class="bcol bside">
      ${pro ? `<div class="card bcard rec"><div class="row-flex"><h3>Pro</h3><span class="grow"></span><span class="badge yellow">Recommended</span></div><div class="price">${money(pro.monthly[cur], cur)} / month</div><p class="dim sm">${num(pro.emails)} emails, no daily limit, 10 domains</p>${s.admin ? `<button class="btn btn-primary btn-block" data-upgrade="pro" ${s.payments_ready ? "" : "disabled"}>Upgrade to Pro</button>` : ""}</div>` : ""}
      <div class="card bcard"><h3>Pay as you go</h3><div class="price">${rateLine(s).replace(" / ", " / ")} emails</div><p class="dim sm">No monthly fee, credits never expire. Used after the free allowance.</p>${s.admin ? `<button class="btn btn-secondary btn-block" data-topup ${s.payments_ready ? "" : "disabled"}>Buy credits</button>` : ""}</div>
    </div></div>`;
}

function overviewPayg(B) {
  const s = B.s, cur = s.currency, u = s.usage, P = s.period;
  const rate = s.credit_rate[cur];
  const low = s.credit_value < s.auto_topup.threshold;
  const pro = s.plans.find((p) => p.id === "pro");
  const firstCredit = s.invoices.filter((i) => i.kind === "credits" && i.status === "success").map((i) => i.paid_at).sort()[0];
  const avg = P.day ? Math.round(u.month / P.day) : 0;
  const paidEmails = Math.max(0, u.month - u.included); // beyond the free allowance
  const usedValue = Math.round(paidEmails * rate);
  const paidPerDay = P.day ? paidEmails / P.day : 0;
  const lastDays = paidPerDay > 0 ? Math.floor(s.credits / paidPerDay) : null;
  const monthProj = P.projected, paygCost = Math.max(0, monthProj - u.included) * rate;
  const breakEven = pro ? Math.round(pro.monthly[cur] / rate + u.included) : 0;
  const rec = pro && paygCost > pro.monthly[cur]
    ? `At ~${num(Math.round(monthProj / 100) * 100)} emails a month, Pro would cost ${money(pro.monthly[cur], cur)} instead of about ${money(paygCost, cur)} on credits. Switch once you pass ~${num(Math.round(breakEven / 100) * 100)}.`
    : `At ~${num(Math.round(monthProj / 100) * 100)} emails a month, credits cost about ${money(paygCost, cur)}. Pro (${money(pro?.monthly[cur] || 0, cur)}) pays off once you pass ~${num(Math.round(breakEven / 100) * 100)}. Stay on pay as you go until then.`;
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });
  B.body.innerHTML = `${payBanner(s)}
    ${low ? banner("warn", s.credits ? `Credits are running low · ${money(s.credit_value, cur)} left` : "You're out of credits", s.credits ? `That covers about ${num(s.credits)} more emails past the free allowance. Sending past it stops at ${money(0, cur)} unless auto top-up is on.` : `Sending past the free allowance (${num(u.included)} a month, ${num(u.day_limit)} a day) is paused until you top up.`, s.admin ? `<button class="btn btn-primary btn-sm" data-topup>Top up</button>${s.auto_topup.enabled ? "" : `<button class="btn btn-secondary btn-sm" data-auto-on>Turn on auto top-up</button>`}` : "") : ""}
    <div class="bgrid"><div class="bcol">
      <div class="card bcard"><div class="row-flex" style="gap:8px"><h3 class="pc-name">Pay as you go</h3><span class="badge yellow">Current plan</span><span class="grow"></span>${s.admin && pro ? `<button class="btn btn-secondary btn-sm" data-upgrade="pro">Switch to Pro · ${money(pro.monthly[cur], cur)}/mo</button>` : ""}</div>
        <p class="dim sm">${rateLine(s)} emails · no monthly fee · ${num(u.included)} free emails a month first${firstCredit ? ` · on this plan since ${fullDate(firstCredit)} (${since(firstCredit)})` : ""}</p></div>
      <div class="card bcard"><h3>${monthName} so far</h3>
        <div class="kpis"><div><span class="k">Emails sent</span><b>${num(u.month)}</b></div><div><span class="k">Credits used</span><b>${money(usedValue, cur)}</b></div><div><span class="k">Avg per day</span><b>${num(avg)}</b></div><div><span class="k">Credits last</span><b>${lastDays == null ? "—" : `~${num(lastDays)} day${lastDays === 1 ? "" : "s"}`}</b></div></div>
        ${chart(s, { future: false })}
        <div class="row-flex dim sm"><span>${shortDate(P.start)}</span><span class="grow" style="text-align:center">Daily emails</span><span>Today · ${shortDate(new Date())}</span></div>
        <div class="note">${icon("sparkle", 13)}<span>${rec}</span></div></div>
    </div>
    <div class="bcol bside">${creditsCard(s, { low })}</div></div>`;
}

// ------------------------------------------------------------ Credits & top-ups
function creditsTab(B) {
  const s = B.s, cur = s.currency;
  const hist = s.invoices.filter((i) => i.kind === "credits" || (i.kind === "overage" && /credits/.test(i.description || "")));
  const tiles = s.packs.map((k, i) => `<button class="pack" data-pack="${i}" ${s.admin && s.payments_ready ? "" : "disabled"}><b>${money(k.price[cur], cur)}</b><span class="dim">${num(k.emails)} emails</span>${k.note && k.note !== "Minimum" ? `<span class="badge green">${esc(k.note)}</span>` : ""}</button>`).join("");
  B.body.innerHTML = `${payBanner(s)}<div class="bgrid"><div class="bcol">
      <div class="card bcard"><h3>Buy credits</h3><p class="dim sm">Credits never expire. On Pro and Scale they pay for overage first; on pay as you go they pay for every email past the free allowance.</p><div class="packs">${tiles}<button class="pack" data-pack="custom" ${s.admin && s.payments_ready ? "" : "disabled"}><b>Custom</b><span class="dim">Min ${money(s.min_topup[cur], cur)}</span></button></div></div>
      <div class="card bcard"><h3>Top-up history</h3>${hist.length ? `<div class="table-wrap flat"><table class="t"><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${hist.map((i) => `<tr><td class="muted">${fullDate(i.paid_at)}</td><td>${esc(i.description || "Credit top-up")}</td><td class="r num">${i.kind === "overage" ? "−" : ""}${money(i.amount, i.currency, true)}</td><td>${statusBadge(i)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-mini"><b>No top-ups yet</b><span class="dim">Credits you buy show up here.</span></div>`}</div>
    </div><div class="bcol bside">${creditsCard(s)}
      <div class="card bcard"><h3>How credits work</h3><ul class="howto"><li>One credit sends one email. Value shown at ${rateLine(s)}.</li><li>Free plan: used after the ${num(3000)} free emails a month and 100 a day.</li><li>Pro and Scale: at month end, credits pay overage before your card.</li><li>Auto top-up buys a pack when credits drop below your threshold.</li></ul></div></div></div>`;
}

// ------------------------------------------------------------ Invoices
const TYPE = { credits: "Top-up", overage: "Overage", transactional: "Subscription", marketing: "Subscription" };
const statusBadge = (i) => i.status === "success" ? badge("Paid", "green") : i.status === "refunded" ? badge("Refunded", "blue") : badge("Failed", "red");
function invoicesTab(B) {
  const s = B.s, d = s.details || {};
  B.body.innerHTML = s.invoices.length ? `<div class="table-wrap"><table class="t inv"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${s.invoices.map((i, n) => `<tr><td class="muted">${fullDate(i.paid_at)}</td><td>${esc(i.description || cap1(i.plan))}</td><td><span class="badge gray">${TYPE[i.kind] || "Subscription"}</span></td><td class="num">${money(i.amount, i.currency, true)}</td><td>${statusBadge(i)}</td><td class="r"><button class="btn btn-ghost btn-sm" data-pdf="${n}">${icon("download", 12)} PDF</button></td></tr>`).join("")}</tbody></table></div>
      <p class="dim sm foot-note">${icon("info", 12)} Invoices go to ${esc(d.email || s.card_email || state.user?.email || "your billing email")}. ${s.vat_rate ? `Prices include VAT at ${s.vat_rate}% where applicable.` : "Add your address and tax ID under Payment methods to show them on invoices."}</p>`
    : `<div class="empty"><b>No invoices yet</b><span class="dim">Invoices appear here after your first payment.</span></div>`;
}

function printInvoice(s, i) {
  const d = s.details || {}, w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to download the invoice.", "info");
  const addr = [d.name, d.address, [d.city, d.state, d.postal_code].filter(Boolean).join(", "), d.country].filter(Boolean).map(esc).join("<br>");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Delivrie invoice ${esc(i.reference)}</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#111;max-width:720px;margin:48px auto;padding:0 24px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:28px 0}td,th{text-align:left;padding:10px 0;border-bottom:1px solid #e5e5e5}th{font-weight:500;color:#666;font-size:12px}.r{text-align:right}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:28px}.muted{color:#666}.tot td{font-weight:600;border:0}@media print{button{display:none}}</style></head><body>
    <div class="grid" style="margin:0"><div><h1>${i.status === "success" ? "Receipt" : "Invoice"}</h1><div class="muted">${esc(i.reference)}</div></div><div class="r"><b>Delivrie</b><br><span class="muted">South Circle · delivrie.io<br>billing@delivrie.io</span></div></div>
    <div class="grid"><div><div class="muted">Billed to</div>${addr || esc(state.team?.name || "")}${d.tax_id ? `<br>Tax ID: ${esc(d.tax_id)}` : ""}${d.email ? `<br>${esc(d.email)}` : ""}</div><div class="r"><div class="muted">Date</div>${fullDate(i.paid_at)}<div class="muted" style="margin-top:8px">Status</div>${i.status === "success" ? "Paid" : cap1(i.status)}${i.card ? `<div class="muted" style="margin-top:8px">Payment</div>${esc(i.card)}` : ""}</div></div>
    <table><thead><tr><th>Description</th><th>Type</th><th class="r">Amount</th></tr></thead><tbody><tr><td>${esc(i.description || cap1(i.plan))}</td><td>${TYPE[i.kind] || "Subscription"}</td><td class="r">${money(i.amount, i.currency, true)}</td></tr><tr class="tot"><td>Total</td><td></td><td class="r">${money(i.amount, i.currency, true)}</td></tr></tbody></table>
    <p class="muted">Team: ${esc(state.team?.name || "")}. Payments are processed by Paystack.</p><button onclick="print()">Print or save as PDF</button><script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// ------------------------------------------------------------ Payment methods
function methodsTab(B) {
  const s = B.s, d = s.details || {}, admin = s.admin, sub = s.subscription, msub = s.marketing_subscription, cur = s.currency;
  const COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa", "United States", "United Kingdom", "Canada", "Other"];
  const TAX_TYPES = [["ng_tin", "NG TIN"], ["vat", "VAT"], ["ein", "EIN"], ["other", "Other"]];
  const sect = (title, desc, inner) => `<div class="card bill-sect"><div class="bs-l"><h3>${title}</h3><p>${desc}</p></div><div class="bs-r">${inner}</div></div>`;
  const field = (name, label, val, attrs = "") => `<div class="field"><label>${label}</label><input class="input" name="${name}" value="${esc(val || "")}" ${admin ? "" : "disabled"} ${attrs}></div>`;
  const sel = (name, label, val, opts) => `<div class="field"><label>${label}</label><select class="input" name="${name}" ${admin ? "" : "disabled"}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const tPrice = (() => { const p = s.plans.find((x) => x.id === s.plan); if (!p) return money(0, cur); const c = sub?.currency || cur; return sub?.interval === "yearly" ? `${money(p.yearly[c], c)} / yr` : `${money(p.monthly[c], c)} / mo`; })();
  const mPrice = (() => { const p = s.marketing.find((x) => x.id === s.plan_marketing); const c = msub?.currency || cur; return p ? `${money(p.monthly[c], c)} / mo` : `${money(0, c)} / mo`; })();
  const st = (x) => !x ? "" : x.status === "cancelling" ? badge(`Ends ${fmtDate(x.cancel_at)}`, "orange") : x.status === "past_due" ? badge("Payment failed", "red") : "";
  B.body.innerHTML = `${payBanner(s)}
    ${sect("Payment method", "Used for subscriptions, overage and auto top-ups.", `<div class="pm-row">${icon("card", 15)}<span class="grow">${s.card ? `${esc(s.card)}${s.can_charge_card ? ` <span class="dim">· Default</span>` : ""}` : `<span class="muted">No card yet. Add one when you upgrade or top up.</span>`}</span>${admin && (sub?.can_manage || msub?.can_manage) ? `<button class="btn btn-secondary btn-sm" data-card>${icon("edit", 12)} Update card</button>` : ""}</div>`)}
    ${sect("Subscriptions", "Plans for this team.", `<div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th>Plan</th><th class="r">Price</th></tr></thead><tbody>
        <tr><td>Transactional</td><td>${esc(isPayg(s) ? "Pay as you go" : planName(s.plan))} ${sub?.interval === "yearly" ? badge("Yearly", "gray") : ""} ${st(sub)}</td><td class="r">${tPrice}</td></tr>
        <tr><td>Marketing</td><td>${esc(planName(s.plan_marketing || "free", "marketing"))} · ${num(s.limits.contacts.limit)} contacts ${st(msub)}</td><td class="r">${mPrice}</td></tr></tbody></table></div>
      ${admin ? `<div class="row-flex" style="gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-plan ${s.payments_ready ? "" : "disabled"}>${s.plan === "free" ? "Upgrade plan" : "Change plan"}</button><button class="btn btn-secondary btn-sm" data-mkt ${s.payments_ready ? "" : "disabled"}>Marketing plan</button><span class="grow"></span>${sub?.can_manage && sub.status !== "cancelling" ? `<button class="btn btn-ghost btn-sm" data-cancel-sub style="color:var(--red)">Cancel subscription</button>` : ""}${msub?.can_manage && msub.status !== "cancelling" ? `<button class="btn btn-ghost btn-sm" data-cancel-mkt style="color:var(--red)">Cancel marketing</button>` : ""}</div>` : ""}`)}
    ${sect("Spending cap", "The most overage you'll pay in a month.", `<div class="row-flex" style="gap:8px"><span class="grow">${s.spend_cap ? money(s.spend_cap, cur) : `<span class="muted">No cap</span>`}</span>${admin ? `<button class="btn btn-secondary btn-sm" data-cap>Edit</button>` : ""}</div>`)}
    ${sect("Billing email", "Invoices and receipts go here.", `<div class="row-flex" style="gap:8px"><input class="input" data-bemail type="email" placeholder="${esc(state.user?.email || "finance@company.com")}" value="${esc(d.email || "")}" ${admin ? "" : "disabled"}>${admin ? `<button class="btn btn-secondary" data-save-email>Save</button>` : ""}</div>`)}
    ${sect("Billing address", "Shown on invoices.", `<form data-addr class="addr">${field("name", "Full name", d.name, 'placeholder="Kora Commerce Ltd"')}<div class="two">${sel("country", "Country", d.country || "Nigeria", COUNTRIES.map((c) => [c, c]))}${field("state", "State", d.state, 'placeholder="Lagos"')}</div>${field("address", "Address", d.address, 'placeholder="12 Admiralty Way, Lekki Phase 1"')}<div class="two">${field("city", "City", d.city, 'placeholder="Lagos"')}${field("postal_code", "Postal code", d.postal_code, 'placeholder="106104"')}</div>${admin ? `<button class="btn btn-primary btn-sm" type="submit">Save address</button>` : ""}</form>`)}
    ${sect("Tax ID", "Optional. Appears on invoices.", `<div class="row-flex" style="gap:8px"><select class="input" data-taxtype style="width:120px" ${admin ? "" : "disabled"}>${TAX_TYPES.map(([v, l]) => `<option value="${v}" ${v === (d.tax_id_type || "ng_tin") ? "selected" : ""}>${l}</option>`).join("")}</select><input class="input" data-taxid placeholder="Tax ID number" value="${esc(d.tax_id || "")}" ${admin ? "" : "disabled"}>${admin ? `<button class="btn btn-secondary" data-save-tax>Save</button>` : ""}</div>`)}`;
}

// ------------------------------------------------------------ actions
function bindActions(B) {
  const body = B.body;
  const saveDetails = async (patch, btn, msg) => { if (btn) btn.disabled = true; try { await B.refresh(await api("POST", "/billing/details", patch)); toast(msg); } catch (e) { errToast(e); if (btn) btn.disabled = false; } };
  on(body, "click", "[data-topup]", () => topUp(B));
  on(body, "click", "[data-pack]", (_e, b) => topUp(B, b.dataset.pack));
  on(body, "click", "[data-plan]", () => changePlan(B, "transactional"));
  on(body, "click", "[data-mkt]", () => changePlan(B, "marketing"));
  on(body, "click", "[data-yearly]", () => changePlan(B, "transactional", "yearly", B.s.plan));
  on(body, "click", "[data-upgrade]", (_e, b) => changePlan(B, "transactional", "monthly", b.dataset.upgrade));
  on(body, "click", "[data-auto-on]", () => autoTopup(B));
  on(body, "change", "[data-auto]", (_e, t) => { if (t.checked) { t.checked = false; autoTopup(B); } else saveSettings(B, { auto_topup: { enabled: false } }, "Auto top-up turned off"); });
  on(body, "click", "[data-credit-menu]", (e, b) => menu(b, [
    { label: "Top up", icon: "plus", onClick: () => topUp(B) },
    { label: "Auto top-up settings", icon: "gear", onClick: () => autoTopup(B) },
    { label: "Top-up history", icon: "list", onClick: () => B.ctx.navigate("/billing/credits") },
  ]));
  on(body, "click", "[data-alerts]", () => editAlerts(B));
  on(body, "click", "[data-pdf]", (_e, b) => printInvoice(B.s, B.s.invoices[Number(b.dataset.pdf)]));
  on(body, "click", "[data-card]", async (_e, b) => { b.disabled = true; try { const r = await api("POST", "/billing/card"); location.href = r.url; } catch (e) { errToast(e); b.disabled = false; } });
  on(body, "click", "[data-cancel-sub]", () => cancelSub(B));
  on(body, "click", "[data-cancel-mkt]", () => cancelMkt(B));
  on(body, "click", "[data-cap]", () => editCap(B));
  on(body, "click", "[data-save-email]", (_e, b) => saveDetails({ email: body.querySelector("[data-bemail]").value.trim() }, b, "Billing email saved"));
  on(body, "click", "[data-save-tax]", (_e, b) => saveDetails({ tax_id_type: body.querySelector("[data-taxtype]").value, tax_id: body.querySelector("[data-taxid]").value.trim() }, b, "Tax ID saved"));
  on(body, "submit", "[data-addr]", (e, f) => { e.preventDefault(); saveDetails(Object.fromEntries(new FormData(f)), f.querySelector("button"), "Billing address updated"); });
}

async function saveSettings(B, patch, msg) {
  try { await B.refresh(await api("POST", "/billing/settings", patch)); toast(msg); } catch (e) { errToast(e); B.draw(); }
}

function editCap(B) {
  const s = B.s, cur = s.currency;
  formModal({ title: "Spending cap", desc: `The most overage you'll pay in a month, in ${cur}. When a send would go past it, the API returns spending_cap_reached. Leave empty for no cap.`, fields: [{ name: "amount", label: `Cap (${cur})`, placeholder: cur === "NGN" ? "50000" : "50", value: s.spend_cap ? String(s.spend_cap / 100) : "" }], submit: "Save",
    async onSubmit(v) { await B.refresh(await api("POST", "/billing/cap", { amount: v.amount.trim() })); toast(B.s.spend_cap ? "Spending cap saved" : "Spending cap removed"); } });
}

function editAlerts(B) {
  const s = B.s, a = s.alerts, cur = s.currency;
  const row = (k, label, sub) => `<label class="alert-opt"><input type="checkbox" class="checkbox" name="${k}" ${a[k] ? "checked" : ""}><span class="grow"><b>${label}</b><span class="dim">${sub}</span></span></label>`;
  modal({ title: "Usage alerts", body: `<p class="desc">Emails go to ${esc(s.details?.email || "the billing email")}, at most once a month each.</p>
      ${s.plan !== "free" ? row("p80", "Email at 80% of plan", `When this month passes ${num(s.usage.included * 0.8)} emails`) + row("p100", "Email at 100% of plan", `When this month passes ${num(s.usage.included)} emails`) : ""}
      ${row("credits_low", `Credits below ${money(s.auto_topup.threshold, cur)}`, "Skipped while auto top-up is on")}
      <div class="alert-opt"><span class="grow"><b>Monthly spend cap</b><span class="dim">${s.spend_cap ? money(s.spend_cap, cur) : "No cap"} · sending pauses past it</span></span><button class="btn btn-secondary btn-sm" data-cap-edit>Edit</button></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Save</button>`,
    onMount(m, close) {
      m.querySelector("[data-cap-edit]").onclick = () => { close(); editCap(B); };
      m.querySelector("[data-go]").onclick = async () => {
        const alerts = Object.fromEntries([...m.querySelectorAll("input[type=checkbox]")].map((i) => [i.name, i.checked]));
        close(); await saveSettings(B, { alerts }, "Alerts saved");
      };
    } });
}

function autoTopup(B) {
  const s = B.s, cur = s.currency, a = s.auto_topup;
  if (!s.can_charge_card) return toast("Auto top-up charges your saved card. Top up once with a card first, then turn it on.", "info", 6000);
  let pack = s.packs[a.pack] ? a.pack : 1;
  modal({ title: "Auto top-up", body: `<p class="desc">When credits drop below the threshold, we charge ${esc(s.card)} for a pack. Checked every 15 minutes.</p>
      <div class="field"><label>When credits drop below (${cur})</label><input class="input" name="threshold" inputmode="decimal" value="${a.threshold / 100}"></div>
      <div class="field"><label>Add</label><div class="packs sm">${s.packs.map((k, i) => `<button type="button" class="pack ${i === pack ? "on" : ""}" data-p="${i}"><b>${money(k.price[cur], cur)}</b><span class="dim">${num(k.emails)} emails</span></button>`).join("")}</div></div>
      ${s.vat_rate ? `<p class="dim sm">Plus VAT at ${s.vat_rate}%.</p>` : ""}`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Turn on</button>`,
    onMount(m, close) {
      on(m, "click", "[data-p]", (_e, b) => { pack = Number(b.dataset.p); m.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b)); });
      m.querySelector("[data-go]").onclick = async () => {
        const threshold = Number(m.querySelector("[name=threshold]").value.replace(/[,\s]/g, ""));
        if (!isFinite(threshold) || threshold < 0) return toast("Enter a threshold amount", "err");
        close(); await saveSettings(B, { auto_topup: { enabled: true, pack, threshold } }, `Auto top-up on: +${money(s.packs[pack].price[cur], cur)} below ${money(threshold * 100, cur)}`);
      };
    } });
}

// Top up credits (Figma 9.11 · Top up)
function topUp(B, preset) {
  const s = B.s, cur = s.currency;
  if (!s.admin) return toast("Only team admins can buy credits.", "info");
  if (!s.payments_ready) return toast("Payments aren't connected yet.", "info");
  let pick = preset === "custom" ? "custom" : preset != null && s.packs[preset] ? Number(preset) : 1;
  let method = s.can_charge_card ? "card" : "checkout";
  let auto = false;
  const shown = [0, 1, 2];
  if (typeof pick === "number" && !shown.includes(pick)) shown.push(pick);
  return modal({ title: "Top up credits", size: "md", body: `<p class="desc" style="margin-top:-4px">Credits never expire. ${s.plan === "free" ? "On pay as you go they pay for every email past the free allowance; on Pro they cover overage first." : `On ${esc(cap1(s.plan))} they cover overage first; on pay as you go they pay for every email.`}</p><div data-tb></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Pay</button>`,
    onMount(m, close) {
      const tb = m.querySelector("[data-tb]"), go = m.querySelector("[data-go]");
      let custom = "";
      const amount = () => pick === "custom" ? Math.round(Number(String(custom).replace(/[,\s]/g, "")) * 100) || 0 : s.packs[pick].price[cur];
      const emails = () => pick === "custom" ? Math.floor(amount() / s.credit_rate[cur]) : s.packs[pick].emails;
      const autoPack = () => pick === "custom" ? 1 : pick;
      const render = () => {
        const a = amount(), vat = Math.round(a * s.vat_rate / 100);
        const methods = [[s.can_charge_card ? "card" : "checkout", s.can_charge_card ? esc(s.card) : "Card"], ["bank_transfer", "Bank transfer"], ["ussd", "USSD"]];
        tb.innerHTML = `<div class="packs">${shown.map((i) => { const k = s.packs[i]; return `<button type="button" class="pack ${pick === i ? "on" : ""}" data-k="${i}"><b>${money(k.price[cur], cur)}</b><span class="dim">${num(k.emails)} emails</span>${k.note && k.note !== "Minimum" ? `<span class="badge green">${esc(k.note)}</span>` : ""}</button>`; }).join("")}
            <div class="pack ${pick === "custom" ? "on" : ""}" data-k="custom" tabindex="0"><b>Custom</b>${pick === "custom" ? `<input class="input sm" data-custom inputmode="decimal" placeholder="${s.min_topup[cur] / 100}" value="${esc(custom)}">` : `<span class="dim">Min ${money(s.min_topup[cur], cur)}</span>`}</div></div>
          <div class="field" style="margin-top:14px"><label>Pay with</label>${segmented(methods, method, "data-mth")}</div>
          <label class="auto-row"><span class="grow"><b>Turn on auto top-up</b><span class="dim">Add ${money(s.packs[autoPack()].price[cur], cur)} when credits drop below ${money(s.auto_topup.threshold, cur)}${method !== "card" ? " · needs a card payment" : ""}</span></span><input type="checkbox" class="toggle" data-autot ${auto ? "checked" : ""} ${s.auto_topup.enabled ? "disabled" : ""}></label>
          <div class="sum"><div><span class="muted">Credits${pick === "custom" && a ? ` · ${num(emails())} emails` : ""}</span><span>${money(a, cur)}</span></div>${s.vat_rate ? `<div><span class="muted">VAT ${s.vat_rate}%</span><span>${money(vat, cur)}</span></div>` : ""}<div class="tot"><span>Charged today</span><span>${money(a + vat, cur)}</span></div></div>`;
        go.textContent = a ? `Pay ${money(a + vat, cur)}` : "Pay";
        go.disabled = !a || a < s.min_topup[cur];
        if (pick === "custom") { const i = tb.querySelector("[data-custom]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      };
      render();
      on(m, "click", "[data-k]", (e, b) => { if (e.target.matches("[data-custom]")) return; const k = b.dataset.k; pick = k === "custom" ? "custom" : Number(k); render(); });
      on(m, "input", "[data-custom]", (_e, i) => { custom = i.value; const a = amount(), vat = Math.round(a * s.vat_rate / 100); go.textContent = a ? `Pay ${money(a + vat, cur)}` : "Pay"; go.disabled = !a || a < s.min_topup[cur]; const c = m.querySelector(".sum div span:last-child"); if (c) c.textContent = money(a, cur); const t = m.querySelector(".sum .tot span:last-child"); if (t) t.textContent = money(a + vat, cur); });
      on(m, "click", "[data-mth]", (_e, b) => { method = b.dataset.mth; render(); });
      on(m, "change", "[data-autot]", (_e, t) => { auto = t.checked; });
      go.addEventListener("click", async () => {
        const a = amount();
        if (!a || a < s.min_topup[cur]) return;
        const label = go.textContent;
        go.disabled = true; go.innerHTML = `<span class="spinner"></span>`;
        try {
          const payload = { currency: cur, method, ...(pick === "custom" ? { amount: a / 100 } : { pack: pick }), ...(auto ? { auto: { enabled: true, pack: autoPack(), threshold: s.auto_topup.threshold / 100 } } : {}) };
          const r = await api("POST", "/billing/topup", payload);
          if (r.url) { location.href = r.url; return; }
          close();
          await B.refresh(r);
          toast(`Credits added · ${money(a, cur)} (${num(r.emails)} emails)${auto ? ". Auto top-up is on" : ""}`, "ok", 6000);
        } catch (e) { errToast(e); go.disabled = false; go.textContent = label; }
      });
    } });
}

// Change plan (Figma 9.8): choose plan → Paystack checkout
function changePlan(B, kind, startMode, preselect) {
  const s = B.s;
  let currency = s.currency;
  let mode = startMode || (s.subscription?.interval === "yearly" ? "yearly" : "monthly");
  let pick = preselect || null;
  const lockedCur = (s.subscription && s.subscription.status !== "canceled" && s.plan !== "free" && s.subscription.currency) || (s.marketing_subscription?.status === "active" && s.marketing_subscription.currency) || null;
  const isCurrent = (id) => s.plan === id && (s.subscription?.interval || "monthly") === mode;
  if (pick && kind === "transactional" && isCurrent(pick)) pick = null;
  return modal({ title: kind === "marketing" ? "Marketing plan" : preselect && !isCurrent(preselect) && s.plan === "free" ? `Upgrade to ${planName(preselect)}` : "Change plan", size: "lg", body: `<p class="desc" style="margin-top:-6px">${kind === "marketing" ? "Priced by contacts, with unlimited broadcasts." : "Transactional emails for this team."}</p><div data-mb></div>`,
    foot: `<a class="btn btn-ghost" href="/pricing" target="_blank" data-native style="margin-right:auto">Compare all plans ${icon("arrow-right", 12)}</a><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go disabled>Continue</button>`,
    onMount(m, close) {
      const mb = m.querySelector("[data-mb]"), go = m.querySelector("[data-go]");
      const row = (id, title, sub, price, cur) => `<label class="pick ${pick === id ? "on" : ""} ${cur ? "cur" : ""}"><input type="radio" name="pick" value="${id}" ${pick === id ? "checked" : ""} ${cur ? "disabled" : ""}><span class="radio"></span><span class="grow"><span class="row-flex" style="gap:6px"><b>${title}</b>${cur ? `<span class="badge gray">Current</span>` : ""}</span><span class="dim">${sub}</span></span><span class="pr">${price}</span></label>`;
      const render = () => {
        const cur = currency;
        let list;
        if (kind === "marketing") {
          list = row("free", "Starter", "Up to 1,000 contacts · unlimited broadcasts", money(0, cur) + "<em>/mo</em>", (s.plan_marketing || "free") === "free")
            + s.marketing.map((p) => row(p.id, p.name, `Up to ${num(p.contacts)} contacts${p.extra ? ` · +${money(p.extra[cur], cur, true)} per extra 1,000` : ""}`, money(p.monthly[cur], cur) + "<em>/mo</em>", s.plan_marketing === p.id)).join("");
        } else {
          const yr = mode === "yearly";
          list = row("free", "Free", "3,000 emails/month · 100/day", money(0, cur) + "<em>/mo</em>", s.plan === "free")
            + s.plans.map((p) => row(p.id, p.name, `${num(p.emails)} emails/month · ${money(p.overage[cur], cur, true)} per extra 1k${yr ? ` · ${money(p.yearly[cur], cur)} billed yearly` : ""}`, money(yr ? Math.round(p.yearly[cur] / 12) : p.monthly[cur], cur, yr) + "<em>/mo</em>", isCurrent(p.id))).join("")
            + `<a class="pick" href="/contact-sales" target="_blank" data-native><span class="radio" style="visibility:hidden"></span><span class="grow"><b>Enterprise</b><span class="dim">Custom volume, SSO, SLA</span></span><span class="pr">Talk to sales</span></a>`;
        }
        mb.innerHTML = `<div class="row-flex" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">${kind === "marketing" ? "" : segmented([["monthly", "Monthly"], ["yearly", `Yearly <span class="save">2 months free</span>`]], mode, "data-m")}<span class="grow"></span>${segmented(s.currencies.map((c) => [c, c === "USD" ? "$ USD" : "₦ NGN"]), currency, "data-c")}</div>
          ${lockedCur && lockedCur !== currency ? `<p class="hint" style="margin:0 0 10px">Your current plan is billed in ${esc(lockedCur)}. Paying in ${esc(currency)} starts a new subscription and stops the old one.</p>` : ""}
          <div class="picks stagger">${list}</div>${kind === "marketing" ? "" : `<p class="dim sm" style="margin:12px 0 0">Need emails without a monthly fee? <button class="link" data-payg>Buy pay-as-you-go credits</button></p>`}`;
        go.textContent = !pick ? "Continue" : pick === "free" ? (kind === "marketing" ? "Move to Starter" : "Downgrade to Free") : `Continue with ${planName(pick, kind)}${kind === "transactional" ? ` · ${mode}` : ""}`;
        go.disabled = !pick;
      };
      render();
      on(m, "click", "[data-m]", (_e, b) => { mode = b.dataset.m; if (pick && pick !== "free" && isCurrent(pick)) pick = null; render(); });
      on(m, "click", "[data-c]", (_e, b) => { currency = b.dataset.c; try { localStorage.setItem("dlv_currency", currency); } catch {} render(); });
      on(m, "change", "input[name=pick]", (_e, i) => { pick = i.value; render(); });
      on(m, "click", "[data-payg]", () => { close(); topUp(B); });
      go.addEventListener("click", async () => {
        if (!pick) return;
        if (pick === "free") { close(); return kind === "marketing" ? cancelMkt(B) : cancelSub(B); }
        go.disabled = true; go.innerHTML = `<span class="spinner"></span> Opening checkout`;
        try {
          const r = await api("POST", "/billing/checkout", { kind, plan: pick, currency, interval: kind === "marketing" ? "monthly" : mode });
          location.href = r.url;
        } catch (e) { errToast(e); render(); }
      });
    } });
}

async function cancelSub(B) {
  const sub = B.s.subscription;
  if (!sub?.can_manage) return toast("There's no paid subscription to cancel.", "info");
  const until = sub.next_payment_date ? fmtDate(sub.next_payment_date) : "the end of this billing period";
  if (!(await confirmModal({ title: "Cancel subscription", desc: `You'll keep ${esc(cap1(B.s.plan))} until <b>${until}</b>, then move to the Free plan. You won't be charged again.`, confirm: "Cancel subscription" }))) return;
  try { await B.refresh(await api("POST", "/billing/cancel")); toast(`Canceled. You keep your plan until ${until}.`); } catch (e) { errToast(e); }
}
async function cancelMkt(B) {
  const m = B.s.marketing_subscription;
  if (!m?.can_manage) return toast("There's no paid marketing plan to cancel.", "info");
  const until = m.next_payment_date ? fmtDate(m.next_payment_date) : "the end of this billing period";
  if (!(await confirmModal({ title: "Cancel marketing", desc: `You'll keep your marketing plan until <b>${until}</b>, then move to Starter (1,000 contacts).`, confirm: "Cancel marketing" }))) return;
  try { await B.refresh(await api("POST", "/billing/cancel", { kind: "marketing" })); toast(`Canceled. You keep marketing until ${until}.`); } catch (e) { errToast(e); }
}

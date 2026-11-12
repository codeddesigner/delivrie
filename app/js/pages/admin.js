// Platform admin: sign-ups, users, teams, revenue, sending health and the support inbox.
// Access is checked in the database (platform_admins + security-definer functions); this page only renders.
import { sb, state } from "../lib/sb.js";
import { esc, icon, num, fmtDate, fmtDateTime, ago, badge, toast, errToast, on, debounce, confirmModal, formModal, emptyState, initials } from "../lib/ui.js";
import { lineChart } from "../lib/chart.js";

const TABS = [["overview", "Overview"], ["users", "Users"], ["teams", "Teams"], ["revenue", "Revenue"], ["inbox", "Inbox"]];
const money = (amount, currency) => new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format((amount || 0) / 100);
const moneyMap = (m) => Object.keys(m || {}).length ? Object.entries(m).map(([c, a]) => money(a, c)).join(" · ") : "—";
const pct = (a, b, d = 1) => b ? `${((a / b) * 100).toFixed(d)}%` : "0%";
const planBadge = (p) => badge(p === "free" ? "Free" : p.replace(/^\w/, (c) => c.toUpperCase()), p === "free" ? "gray" : p === "scale" || p === "enterprise" ? "blue" : "yellow");

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

export default async function admin(ctx) {
  const root = ctx.root;
  const tab = ctx.params.tab || "overview";
  root.innerHTML = `<div class="admin">
    <header class="admin-top"><a href="/emails" class="row-flex" style="gap:10px"><img src="/assets/logo.svg" width="118" height="22" alt="Delivrie"></a>${badge("Admin", "yellow")}<span class="grow"></span><span class="dim" style="font-size:12.5px">${esc(state.user?.email || "")}</span><a class="btn btn-ghost btn-sm" href="/emails">Back to app ${icon("arrow-right", 12)}</a></header>
    <div class="page wide"><div class="ul-tabs">${TABS.map(([k, l]) => `<a class="ul-tab ${k === tab ? "on" : ""}" href="/admin/${k === "overview" ? "" : k}">${l}</a>`).join("")}</div><div data-body><div class="card card-pad row-flex"><span class="spinner"></span><span class="muted">Loading…</span></div></div></div></div>`;
  const body = root.querySelector("[data-body]");

  const ok = await rpc("is_platform_admin").catch(() => false);
  if (!ok) {
    body.innerHTML = `<div class="card">${emptyState({ icon: "shield", title: "Admins only", desc: "This account isn't a Delivrie platform admin. Ask an existing admin to add you." })}</div>`;
    return;
  }
  const fn = { overview, users, teams, revenue, inbox }[tab];
  if (!fn) return ctx.navigate("/admin", { replace: true });
  try { await fn(body, ctx); } catch (e) { errToast(e); body.innerHTML = `<div class="card">${emptyState({ icon: "alert", title: "Couldn't load", desc: esc(e.message) })}</div>`; }
}

// ---------------------------------------------------------------- overview
async function overview(body) {
  let days = 30;
  const [o, daily] = await Promise.all([rpc("admin_overview"), rpc("admin_daily", { p_days: days })]);
  const st = o.status_30d || {};
  const sent = o.emails_30d || 0;
  const delivered = (st.delivered || 0) + (st.opened || 0) + (st.clicked || 0);
  const paid = Object.entries(o.plans || {}).filter(([p]) => p !== "free").reduce((s, [, n]) => s + n, 0);
  const stat = (k, v, sub) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="dim" style="font-size:11.5px;margin-top:4px">${sub}</div>` : ""}</div>`;
  const draw = (rows) => {
    body.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
        ${stat("Users", num(o.users), `+${num(o.users_7d)} this week · +${num(o.users_30d)} in 30 days`)}
        ${stat("Active (7 days)", num(o.active_7d), `${pct(o.users_confirmed, o.users)} confirmed email`)}
        ${stat("Teams", num(o.teams), `${num(paid)} paying`)}
        ${stat("Revenue (30 days)", esc(moneyMap(o.revenue_30d)), `All time ${esc(moneyMap(o.revenue_all))}`)}
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
        ${stat("Emails (30 days)", num(sent), `${num(o.emails_today)} today`)}
        ${stat("Delivered", pct(delivered, sent), `${num(delivered)} emails`)}
        ${stat("Bounce rate", pct(st.bounced || 0, sent), `${num(st.bounced || 0)} bounced · keep under 4%`)}
        ${stat("Complaint rate", pct(st.complained || 0, sent, 2), `${num(st.complained || 0)} complaints · keep under 0.08%`)}
      </div>
      <div class="admin-grid">
        <div class="card card-pad"><div class="row-flex"><h3 class="h3">Sign-ups</h3><span class="grow"></span><div class="seg">${[7, 30, 90].map((d) => `<button class="${d === days ? "on" : ""}" data-days="${d}">${d}d</button>`).join("")}</div></div><div data-chart="signups" style="margin-top:12px"></div></div>
        <div class="card card-pad"><div class="row-flex"><h3 class="h3">Email volume</h3><span class="grow"></span><span class="dim" style="font-size:12px">sent · delivered · bounced</span></div><div data-chart="emails" style="margin-top:12px"></div></div>
      </div>
      <div class="admin-grid three">
        <div class="card card-pad"><h3 class="h3">Plans</h3>${bars(o.plans, o.teams)}</div>
        <div class="card card-pad"><h3 class="h3">Marketing</h3>${bars(o.marketing_plans, o.teams)}</div>
        <div class="card card-pad"><h3 class="h3">Platform</h3><div class="kv" style="margin-top:10px"><span class="k">Domains</span><span>${num(o.domains)} · ${num(o.domains_verified)} verified</span><span class="k">API keys</span><span>${num(o.api_keys)}</span><span class="k">Credits held</span><span>${num(o.credits_outstanding)} emails</span><span class="k">Support (30d)</span><span><a href="/admin/inbox">${num(o.support_30d)} requests · ${num(o.feedback_30d)} feedback</a></span></div></div>
      </div>`;
    const labels = rows.map((r) => new Date(r.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    lineChart(body.querySelector('[data-chart="signups"]'), { labels, height: 200, series: [{ name: "Users", color: "#fad600", values: rows.map((r) => Number(r.signups)) }, { name: "Teams", color: "#4c8df6", values: rows.map((r) => Number(r.teams)) }] });
    lineChart(body.querySelector('[data-chart="emails"]'), { labels, height: 200, series: [{ name: "Sent", color: "#8a8f98", values: rows.map((r) => Number(r.sent)) }, { name: "Delivered", color: "#3fa672", values: rows.map((r) => Number(r.delivered)) }, { name: "Bounced", color: "#e5484d", values: rows.map((r) => Number(r.bounced)) }] });
  };
  draw(daily);
  on(body, "click", "[data-days]", async (_e, b) => {
    days = Number(b.dataset.days);
    try { draw(await rpc("admin_daily", { p_days: days })); } catch (e) { errToast(e); }
  });
}
function bars(map, total) {
  const rows = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return `<p class="dim" style="margin-top:10px">No teams yet.</p>`;
  return `<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">${rows.map(([k, n]) => `<div><div class="row-flex" style="font-size:12.5px"><span>${esc(k.replace(/^\w/, (c) => c.toUpperCase()))}</span><span class="grow"></span><span class="dim">${num(n)} · ${pct(n, total)}</span></div><div class="meter"><i style="width:${total ? (n / total) * 100 : 0}%"></i></div></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- users
async function users(body) {
  let q = "", page = 0;
  const size = 50;
  body.innerHTML = `<div class="row-flex" style="margin-bottom:14px"><div class="input-wrap" style="max-width:320px;flex:1"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search by email" style="padding-left:30px"></div><span class="grow"></span><span class="dim" data-total></span></div><div data-list></div>`;
  const list = body.querySelector("[data-list]");
  const load = async () => {
    const rows = await rpc("admin_users", { p_search: q, p_limit: size, p_offset: page * size });
    const total = rows[0]?.total || 0;
    body.querySelector("[data-total]").textContent = `${num(total)} users`;
    list.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>User</th><th>Sign-in</th><th>Teams</th><th>Signed up</th><th>Last seen</th></tr></thead><tbody>${rows.map((u) => `<tr>
        <td><div class="cell"><span class="avatar" style="width:24px;height:24px;font-size:10.5px">${esc(initials(u.name || u.email))}</span><div><div>${esc(u.name || u.email)}</div>${u.name ? `<div class="dim" style="font-size:12px">${esc(u.email)}</div>` : ""}</div></div></td>
        <td>${badge(u.provider === "email" ? "Email" : u.provider.replace(/^\w/, (c) => c.toUpperCase()), "gray")} ${u.confirmed ? "" : badge("Unconfirmed", "orange")}</td>
        <td>${(u.teams || []).map((t) => `<span class="row-flex" style="gap:6px;font-size:12.5px">${esc(t.name)} ${planBadge(t.plan)}</span>`).join("") || `<span class="dim">—</span>`}</td>
        <td class="muted" title="${esc(fmtDateTime(u.created_at))}">${fmtDate(u.created_at)}</td>
        <td class="muted">${u.last_sign_in_at ? ago(u.last_sign_in_at) : "Never"}</td></tr>`).join("")}</tbody></table></div>${pagerHtml(page, total, size)}` : `<div class="card">${emptyState({ icon: "users", title: "No users found" })}</div>`;
  };
  on(body, "input", "[data-q]", debounce((_e, i) => { q = body.querySelector("[data-q]").value.trim(); page = 0; load().catch(errToast); }, 300));
  on(body, "click", "[data-page]", (_e, b) => { page = Number(b.dataset.page); load().catch(errToast); });
  await load();
}
const pagerHtml = (page, total, size) => total > size ? `<div class="row-flex" style="margin-top:12px;justify-content:flex-end;gap:8px"><span class="dim" style="font-size:12px">${num(page * size + 1)}–${num(Math.min(total, (page + 1) * size))} of ${num(total)}</span><button class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page ? "" : "disabled"}>Previous</button><button class="btn btn-secondary btn-sm" data-page="${page + 1}" ${(page + 1) * size < total ? "" : "disabled"}>Next</button></div>` : "";

// ---------------------------------------------------------------- teams
async function teams(body) {
  let q = "", page = 0, rows = [];
  const size = 50;
  body.innerHTML = `<div class="row-flex" style="margin-bottom:14px"><div class="input-wrap" style="max-width:320px;flex:1"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search teams" style="padding-left:30px"></div><span class="grow"></span><span class="dim" data-total></span></div><div data-list></div>`;
  const list = body.querySelector("[data-list]");
  const load = async () => {
    rows = await rpc("admin_teams", { p_search: q, p_limit: size, p_offset: page * size });
    const total = rows[0]?.total || 0;
    body.querySelector("[data-total]").textContent = `${num(total)} teams`;
    list.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Team</th><th>Plan</th><th class="r">Emails (30d)</th><th class="r">Members</th><th class="r">Domains</th><th class="r">Credits</th><th>Created</th><th></th></tr></thead><tbody>${rows.map((t) => `<tr>
        <td><div>${esc(t.name)}</div><div class="dim" style="font-size:12px">${esc(t.owner_email || "")}</div></td>
        <td>${planBadge(t.plan)} ${t.plan_marketing && t.plan_marketing !== "free" ? badge("Mkt " + t.plan_marketing, "gray") : ""} ${t.billing_status === "past_due" ? badge("Past due", "red") : t.billing_status === "cancelling" ? badge("Cancelling", "orange") : ""}</td>
        <td class="r">${num(t.emails_30d)}</td><td class="r">${num(t.members)}</td><td class="r">${num(t.domains)}</td><td class="r">${num(t.credits)}</td>
        <td class="muted">${fmtDate(t.created_at)}</td>
        <td class="act"><button class="ibtn" data-team="${t.id}" title="Manage">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>${pagerHtml(page, total, size)}` : `<div class="card">${emptyState({ icon: "users", title: "No teams found" })}</div>`;
  };
  on(body, "input", "[data-q]", debounce(() => { q = body.querySelector("[data-q]").value.trim(); page = 0; load().catch(errToast); }, 300));
  on(body, "click", "[data-page]", (_e, b) => { page = Number(b.dataset.page); load().catch(errToast); });
  on(body, "click", "[data-team]", async (_e, b) => {
    const t = rows.find((r) => r.id === b.dataset.team);
    const { menu } = await import("../lib/ui.js");
    menu(b, [
      { header: t.name },
      ...["free", "pro", "scale", "enterprise"].filter((p) => p !== t.plan).map((p) => ({ label: `Set plan: ${p.replace(/^\w/, (c) => c.toUpperCase())}`, icon: "card", onClick: async () => {
        if (!(await confirmModal({ title: "Change plan", desc: `Move <b>${esc(t.name)}</b> to <b>${esc(p)}</b> without charging them? Use this for comps and support fixes.`, confirm: "Change plan", danger: false }))) return;
        try { await rpc("admin_set_plan", { p_team: t.id, p_plan: p }); toast("Plan updated"); load(); } catch (e) { errToast(e); }
      } })),
      { label: "Grant credits", icon: "zap", onClick: () => formModal({ title: "Grant credits", desc: `Add pay-as-you-go email credits to ${esc(t.name)}. Use a negative number to remove.`, fields: [{ name: "n", label: "Emails", placeholder: "10000" }], submit: "Grant", validate: (v) => /^-?\d+$/.test(v.n.trim()),
        async onSubmit(v) { const left = await rpc("admin_grant_credits", { p_team: t.id, p_emails: Number(v.n) }); toast(`${t.name} now has ${num(left)} credits`); load(); } }) },
    ], { align: "right", width: 220 });
  });
  await load();
}

// ---------------------------------------------------------------- revenue
async function revenue(body) {
  const [o, inv] = await Promise.all([rpc("admin_overview"), rpc("admin_invoices", { p_limit: 100 })]);
  const kinds = {};
  for (const i of inv) if (i.status === "success") { const k = `${i.kind}:${i.currency}`; kinds[k] = (kinds[k] || 0) + Number(i.amount); }
  body.innerHTML = `<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><div class="k">Last 30 days</div><div class="v">${esc(moneyMap(o.revenue_30d))}</div></div>
      <div class="stat"><div class="k">All time</div><div class="v">${esc(moneyMap(o.revenue_all))}</div></div>
      <div class="stat"><div class="k">Paying teams</div><div class="v">${num(Object.entries(o.plans || {}).filter(([p]) => p !== "free").reduce((s, [, n]) => s + n, 0))}</div><div class="dim" style="font-size:11.5px;margin-top:4px">${Object.entries(kinds).map(([k, a]) => `${k.split(":")[0]} ${money(a, k.split(":")[1])}`).join(" · ") || "No payments yet"}</div></div>
    </div>
    <h3 class="section-title">Payments</h3>${inv.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Team</th><th>Item</th><th class="r">Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>${inv.map((i) => `<tr><td class="muted">${fmtDateTime(i.created_at)}</td><td>${esc(i.team || "—")}</td><td>${esc(i.kind)}${i.plan ? ` · ${esc(i.plan)}` : ""}</td><td class="r" style="font-variant-numeric:tabular-nums">${money(i.amount, i.currency)}</td><td>${i.status === "success" ? badge("Paid", "green") : badge("Failed", "red")}</td><td class="mono dim" style="font-size:11.5px">${esc(i.reference)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card">${emptyState({ icon: "card", title: "No payments yet", desc: "Paystack payments show up here as they land." })}</div>`}`;
}

// ---------------------------------------------------------------- inbox
async function inbox(body) {
  const rows = await rpc("admin_inbox", { p_limit: 100 });
  const impact = { low: "gray", medium: "yellow", high: "orange", critical: "red" };
  body.innerHTML = rows.length ? `<div style="display:flex;flex-direction:column;gap:10px" class="stagger">${rows.map((r) => `<div class="card card-pad"><div class="row-flex" style="gap:8px">${r.kind === "support" ? badge("Support", "blue") : badge("Feedback", "gray")}${r.impact ? badge(r.impact, impact[r.impact] || "gray") : ""}<b style="font-weight:500">${esc(r.subject || (r.kind === "feedback" ? "Feedback" : ""))}</b><span class="grow"></span><span class="dim" style="font-size:12px" title="${esc(fmtDateTime(r.created_at))}">${ago(r.created_at)}</span></div>
      <p style="margin:10px 0;white-space:pre-wrap;font-size:13px;line-height:1.55">${esc(r.message)}</p>
      <div class="row-flex dim" style="font-size:12px;gap:6px">${icon("users", 12)} ${esc(r.email || "Unknown")}${r.team ? ` · ${esc(r.team)}` : ""}<span class="grow"></span>${r.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent("Re: " + (r.subject || "Your Delivrie feedback"))}" data-native>Reply</a>` : ""}</div></div>`).join("")}</div>` : `<div class="card">${emptyState({ icon: "mail", title: "Inbox zero", desc: "Support requests and feedback from the app land here." })}</div>`;
}

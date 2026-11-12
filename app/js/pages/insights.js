import { sb, state } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, pct, toast, emptyState, skeletonRows, pager, selectHtml, bindSelects, codeBlock, badge, on, debounce } from "../lib/ui.js";
import { lineChart, dayKey } from "../lib/chart.js";

const T = () => state.team.id;

export async function metrics(ctx) {
  ctx.crumb("chart", "Metrics");
  const root = ctx.root;
  const f = { days: ctx.query.days || "30", domain: ctx.query.domain || "", view: "volume" };
  const { data: domains } = await sb.from("domains").select("id,name").eq("team_id", T());
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Metrics</h1><div class="actions"><div style="width:170px">${selectHtml("domain", [{ value: "", label: "All domains" }, ...(domains || []).map((d) => ({ value: d.id, label: d.name }))], f.domain)}</div><div style="width:150px">${selectHtml("days", [["7", "Last 7 days"], ["14", "Last 14 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]].map(([v, l]) => ({ value: v, label: l })), f.days)}</div></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  async function load() {
    history.replaceState({}, "", "/metrics?" + new URLSearchParams(Object.entries({ days: f.days, domain: f.domain }).filter(([, v]) => v)));
    const days = +f.days; const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (days - 1));
    body.innerHTML = `<div class="stat-grid">${Array(4).fill('<div class="stat"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;height:22px;margin-top:10px"></div></div>').join("")}</div>`;
    const { data, error } = await sb.rpc("email_metrics", { p_team: T(), p_since: since.toISOString(), p_domain: f.domain || null });
    if (error) throw error;
    const map = Object.fromEntries((data || []).map((r) => [String(r.day).slice(0, 10), r]));
    const dates = Array.from({ length: days }, (_, i) => { const d = new Date(since); d.setDate(d.getDate() + i); return d; });
    const series = (k) => dates.map((d) => Number(map[dayKey(d)]?.[k] || 0));
    const tot = (k) => (data || []).reduce((a, r) => a + Number(r[k] || 0), 0);
    const sent = tot("sent"), del = tot("delivered"), bounced = tot("bounced"), compl = tot("complained"), opened = tot("opened"), clicked = tot("clicked");
    const br = sent ? bounced / sent : 0, cr = del ? compl / del : 0;
    if (!sent) { body.innerHTML = emptyState({ icon: "chart", title: "No email activity yet", desc: "Once you send email, delivery, bounce and engagement trends show up here.", action: `<a class="btn btn-secondary" href="/onboarding">Send your first email</a>` }); return; }
    body.innerHTML = `<div class="stat-grid">
      <div class="stat"><div class="k">Emails sent</div><div class="v">${num(sent)}</div></div>
      <div class="stat"><div class="k">Delivered</div><div class="v">${pct(sent ? del / sent : 0)}</div><div class="dim" style="font-size:12px">${num(del)} emails</div></div>
      <div class="stat"><div class="k">Bounce rate</div><div class="v" style="${br > 0.04 ? "color:var(--red)" : ""}">${pct(br, 2)}</div><div class="meter ${br > 0.04 ? "red" : ""}"><i style="width:${Math.min(100, (br / 0.08) * 100)}%"></i></div><div class="dim" style="font-size:11.5px;margin-top:4px">Keep under 4%</div></div>
      <div class="stat"><div class="k">Complaint rate</div><div class="v" style="${cr > 0.0008 ? "color:var(--red)" : ""}">${pct(cr, 3)}</div><div class="meter ${cr > 0.0008 ? "red" : ""}"><i style="width:${Math.min(100, (cr / 0.0016) * 100)}%"></i></div><div class="dim" style="font-size:11.5px;margin-top:4px">Keep under 0.08%</div></div></div>
      ${br > 0.04 || cr > 0.0008 ? `<div class="banner warn" style="margin-top:14px">${icon("alert", 14)} Your ${br > 0.04 ? "bounce" : "complaint"} rate is above the safe threshold. Clean your list and check your suppression list — high rates can get sending paused.<a class="btn btn-secondary btn-sm" href="/docs#deliverability">Improve deliverability</a></div>` : ""}
      <div class="card" style="margin-top:18px"><div class="row-flex" style="padding:12px 16px;border-bottom:1px solid var(--border)"><div class="seg-tabs" style="margin:0"><button class="seg-tab on" data-v="volume">Volume</button><button class="seg-tab" data-v="engagement">Engagement</button><button class="seg-tab" data-v="problems">Bounces & complaints</button></div></div><div style="padding:16px" data-chart></div></div>
      <div class="stat-grid" style="margin-top:18px"><div class="stat"><div class="k">Opened</div><div class="v">${num(opened)}</div><div class="dim" style="font-size:12px">${pct(del ? opened / del : 0)} of delivered</div></div><div class="stat"><div class="k">Clicked</div><div class="v">${num(clicked)}</div><div class="dim" style="font-size:12px">${pct(del ? clicked / del : 0)} of delivered</div></div><div class="stat"><div class="k">Bounced</div><div class="v">${num(bounced)}</div></div><div class="stat"><div class="k">Complained</div><div class="v">${num(compl)}</div></div></div>
      <p class="hint" style="margin-top:12px">Open and click numbers only include domains with tracking turned on, and opens are approximate because some mail apps preload images.</p>`;
    const labels = dates.map((d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    const views = {
      volume: [{ name: "Sent", color: "#8a8f98", values: series("sent") }, { name: "Delivered", color: "#fad600", values: series("delivered") }],
      engagement: [{ name: "Opened", color: "#a774f2", values: series("opened") }, { name: "Clicked", color: "#4c8df6", values: series("clicked") }],
      problems: [{ name: "Bounced", color: "#e5484d", values: series("bounced") }, { name: "Complained", color: "#f2994a", values: series("complained") }],
    };
    f.view = "volume";
    drawChart = () => lineChart(body.querySelector("[data-chart]"), { labels, series: views[f.view] });
    drawChart();
  }
  let drawChart = () => {};
  on(body, "click", "[data-v]", (_e, b) => { f.view = b.dataset.v; body.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b)); drawChart(); });
  bindSelects(root, (k, v) => { f[k] = v; load(); });
  await load();
}

const METHOD_C = { GET: "blue", POST: "green", PATCH: "yellow", PUT: "yellow", DELETE: "red" };
const codeBadge = (s) => badge(String(s), s >= 500 ? "red" : s >= 400 ? "orange" : "green");
export async function logs(ctx) {
  ctx.crumb("list", "Logs");
  const root = ctx.root;
  const f = { status: ctx.query.status || "", method: ctx.query.method || "", key: ctx.query.key || "", q: ctx.query.q || "", page: +ctx.query.page || 1 };
  const { data: keys } = await sb.from("api_keys").select("id,name").eq("team_id", T());
  const keyName = Object.fromEntries((keys || []).map((k) => [k.id, k.name]));
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Logs</h1></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search endpoint" value="${esc(f.q)}"></div>
      <div style="width:140px">${selectHtml("status", [{ value: "", label: "All statuses" }, { value: "2", label: "2xx success" }, { value: "4", label: "4xx client error" }, { value: "5", label: "5xx server error" }], f.status)}</div>
      <div style="width:130px">${selectHtml("method", [{ value: "", label: "All methods" }, ...["GET", "POST", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))], f.method)}</div>
      <div style="width:170px">${selectHtml("key", [{ value: "", label: "All sources" }, ...(keys || []).map((k) => ({ value: k.id, label: k.name }))], f.key)}</div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  async function load() {
    history.replaceState({}, "", "/logs" + (() => { const p = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === "page" && v === 1))); return p.toString() ? "?" + p : ""; })());
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(5, 8)}</tbody></table></div>`;
    let q = sb.from("request_logs").select("id,endpoint,method,status,user_agent,api_key_id,created_at", { count: "exact" }).eq("team_id", T()).order("created_at", { ascending: false });
    if (f.status) q = q.gte("status", +f.status * 100).lt("status", +f.status * 100 + 100);
    if (f.method) q = q.eq("method", f.method);
    if (f.key) q = q.eq("api_key_id", f.key);
    if (f.q) q = q.ilike("endpoint", `%${f.q.replace(/[%,]/g, "")}%`);
    const { data, count, error } = await q.range((f.page - 1) * 25, f.page * 25 - 1);
    if (error) throw error;
    if (!count) { body.innerHTML = emptyState({ icon: "list", title: f.q || f.status || f.method || f.key ? "No logs match" : "No API requests yet", desc: "Every API request your team makes is logged here for 30 days, with the request and response bodies." }); return; }
    body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Endpoint</th><th>Status</th><th>Method</th><th>Source</th><th class="r">Created</th></tr></thead><tbody>${data.map((l) => `<tr class="clickable" data-id="${l.id}"><td class="mono" style="font-size:12.5px">${esc(l.endpoint)}</td><td>${codeBadge(l.status)}</td><td>${badge(l.method, METHOD_C[l.method] || "gray")}</td><td class="muted ellipsis" style="max-width:200px">${esc(l.api_key_id ? keyName[l.api_key_id] || "Deleted key" : l.user_agent || "Dashboard")}</td><td class="r muted" title="${esc(fmtDateTime(l.created_at, true))}">${ago(l.created_at)}</td></tr>`).join("")}</tbody></table></div>${pager(f.page, count, 25, "request")}`;
  }
  root.querySelector("[data-q]").addEventListener("input", debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300));
  bindSelects(root, (k, v) => { f[k] = v; f.page = 1; load(); });
  on(root, "click", "[data-page]", (_e, b) => { f.page = +b.dataset.page; load(); });
  on(root, "click", "tr[data-id]", (_e, tr) => ctx.navigate(`/logs/${tr.dataset.id}`));
  await load();
}

export async function log(ctx) {
  const { data: l } = await sb.from("request_logs").select("*").eq("id", ctx.params.id).maybeSingle();
  if (!l) { toast("Log not found", "err"); return ctx.navigate("/logs", { replace: true }); }
  ctx.crumb("list", `${l.method} ${l.endpoint}`, ["Logs", "/logs"]);
  let keyName = "Dashboard";
  if (l.api_key_id) { const { data: k } = await sb.from("api_keys").select("name").eq("id", l.api_key_id).maybeSingle(); keyName = k?.name || "Deleted key"; }
  const json = (o) => o == null ? `<p class="dim">No body</p>` : codeBlock(JSON.stringify(o, null, 2), { lang: "json" });
  const emailId = l.response_body?.id && /^\/emails/.test(l.endpoint) ? l.response_body.id : null;
  ctx.root.innerHTML = `<div class="page wide"><div class="page-head"><div class="row-flex">${badge(l.method, METHOD_C[l.method] || "gray")}<h1 class="mono" style="font-size:18px">${esc(l.endpoint)}</h1></div>${emailId ? `<div class="actions"><a class="btn btn-secondary" href="/emails/${esc(emailId)}">${icon("mail", 13)} View email</a></div>` : ""}</div>
    <div class="facts" style="grid-template-columns:repeat(4,1fr)"><div><div class="k">Status</div><div class="v">${codeBadge(l.status)}</div></div><div><div class="k">Created</div><div class="v">${fmtDateTime(l.created_at, true)}</div></div><div><div class="k">Source</div><div class="v">${esc(keyName)}</div></div><div><div class="k">User agent</div><div class="v ellipsis" title="${esc(l.user_agent || "")}">${esc(l.user_agent || "—")}</div></div></div>
    <h3 class="section-title">Request body</h3>${json(l.request_body)}<h3 class="section-title">Response body</h3>${json(l.response_body)}</div>`;
}

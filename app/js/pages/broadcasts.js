import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, pct, toast, errToast, menu, confirmModal, emptyState, skeletonRows, drawer, codeBlock, badge, on } from "../lib/ui.js";
import { MARK } from "../lib/icons.js";
import { lineChart, dayKey } from "../lib/chart.js";

const STATUS = { draft: ["Draft", "gray"], scheduled: ["Scheduled", "yellow"], sending: ["Sending", "blue"], sent: ["Sent", "green"], canceled: ["Canceled", "gray"], failed: ["Failed", "red"] };
const sBadge = (s) => badge(...(STATUS[s] || [s, "gray"]));

export async function createDraft(navigate, extra = {}) {
  const { data: last } = await sb.from("broadcasts").select("from,reply_to,segment_id").eq("team_id", state.team.id).order("created_at", { ascending: false }).limit(1);
  const prev = last?.[0] || {};
  const { data, error } = await sb.from("broadcasts").insert({
    team_id: state.team.id, name: "Untitled", status: "draft", created_by: state.user.id,
    from: prev.from || null, reply_to: prev.reply_to || null, segment_id: prev.segment_id || null,
    content: { blocks: [{ id: "t1", type: "text", html: "" }, { id: "f1", type: "footer", reason: "You’re receiving this because you subscribed to updates from " + state.team.name + ".", address: "" }] },
    ...extra,
  }).select("id").single();
  if (error) throw error;
  navigate(`/broadcasts/${data.id}/edit`);
}

export async function list(ctx) {
  ctx.crumb("send", "Broadcasts");
  if (ctx.query.new) { history.replaceState({}, "", "/broadcasts"); return createDraft(ctx.navigate); }
  const root = ctx.root;
  let tab = ctx.query.status || "";
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Broadcasts</h1><div class="actions"><button class="ibtn boxed" data-apidrawer title="API">${icon("code", 14)}</button><button class="btn btn-primary" data-new>${icon("plus", 13)} Create broadcast</button></div></div>
    <div class="seg-tabs">${[["", "All"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ["sent", "Sent"]].map(([v, l]) => `<button class="seg-tab" data-tab="${v}">${l}</button>`).join("")}</div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search broadcasts"></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  const { data: segs } = await sb.from("segments").select("id,name").eq("team_id", state.team.id);
  const segName = Object.fromEntries((segs || []).map((s) => [s.id, s.name]));
  let rows = [];
  async function load() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(4, 5)}</tbody></table></div>`;
    let q = sb.from("broadcasts").select("id,name,subject,status,segment_id,scheduled_at,sent_at,created_at,updated_at,recipients").eq("team_id", state.team.id).order("updated_at", { ascending: false });
    if (tab === "sent") q = q.in("status", ["sent", "sending"]); else if (tab) q = q.eq("status", tab);
    const { data, error } = await q; if (error) throw error;
    rows = data; draw();
  }
  function draw() {
    const s = root.querySelector("[data-q]").value.toLowerCase();
    const r = rows.filter((b) => !s || (b.name + " " + (b.subject || "")).toLowerCase().includes(s));
    if (!rows.length && !tab) { body.innerHTML = emptyState({ icon: "send", title: "No broadcasts yet", desc: "Write a newsletter or announcement and send it to a segment of your contacts.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create broadcast</button>` }); return; }
    if (!r.length) { body.innerHTML = emptyState({ icon: "search", title: "Nothing here", desc: "No broadcasts match this view." }); return; }
    body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Status</th><th>Audience</th><th class="r">Updated</th><th></th></tr></thead><tbody>${r.map((b) => `<tr class="clickable" data-id="${b.id}" data-status="${b.status}"><td><div class="cell">${icon("send", 13, "dim")}<span class="ellipsis" style="max-width:380px">${esc(b.name || "Untitled")}</span></div></td><td>${sBadge(b.status)}${b.status === "scheduled" ? ` <span class="dim" style="font-size:12px">${fmtDateTime(b.scheduled_at)}</span>` : ""}</td><td class="muted">${esc(segName[b.segment_id] || "—")}${b.recipients ? ` · ${num(b.recipients)}` : ""}</td><td class="r muted">${ago(b.updated_at || b.created_at)}</td><td class="act"><button class="ibtn" data-row="${b.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`;
  }
  root.querySelector("[data-q]").addEventListener("input", draw);
  on(root, "click", "[data-tab]", (_e, b) => { tab = b.dataset.tab; load(); });
  on(root, "click", "[data-new]", () => createDraft(ctx.navigate).catch(errToast));
  on(root, "click", "[data-apidrawer]", () => drawer({ title: "Broadcasts API", wide: true, body: `<p class="muted">Create and send broadcasts from your code.</p>${codeBlock(`curl -X POST ${location.origin}/api/broadcasts \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "segment_id": "<segment id>",\n    "from": "Acme <news@acme.com>",\n    "subject": "Hello world",\n    "html": "<p>Hi {{{first_name|there}}}</p><p><a href=\\"{{{unsubscribe_url}}}\\">Unsubscribe</a></p>"\n  }'\n\ncurl -X POST ${location.origin}/api/broadcasts/<id>/send \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -d '{ "scheduled_at": "2026-12-01T09:00:00Z" }'`, { lang: "sh" })}` }));
  on(root, "click", "tr[data-id]", (e, tr) => { if (e.target.closest("[data-row]")) return; ctx.navigate(["draft"].includes(tr.dataset.status) ? `/broadcasts/${tr.dataset.id}/edit` : tr.dataset.status === "scheduled" ? `/broadcasts/${tr.dataset.id}/scheduled` : `/broadcasts/${tr.dataset.id}`); });
  on(root, "click", "[data-row]", (e, btn) => {
    e.stopPropagation();
    const b = rows.find((x) => x.id === btn.dataset.row);
    menu(btn, [
      b.status === "draft" ? { label: "Edit", icon: "edit", onClick: () => ctx.navigate(`/broadcasts/${b.id}/edit`) } : { label: "View report", icon: "chart", onClick: () => ctx.navigate(`/broadcasts/${b.id}`) },
      b.status === "scheduled" && { label: "Cancel schedule", icon: "x", onClick: () => cancel(b.id).then(load) },
      { label: "Duplicate", icon: "copy", onClick: () => duplicate(b.id, ctx.navigate) },
      { label: "Save as template", icon: "template", onClick: () => toTemplate(b.id, ctx.navigate) },
      { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(b.id).then(() => toast("ID copied")) },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, disabled: b.status === "sending", onClick: async () => {
        if (!(await confirmModal({ title: "Delete broadcast", desc: `This permanently deletes “${esc(b.name)}”. Sent emails stay in your logs.`, confirm: "Delete", typed: b.name || "Untitled" }))) return;
        const { error } = await sb.from("broadcasts").delete().eq("id", b.id); if (error) return errToast(error);
        toast("Broadcast deleted"); load();
      } },
    ].filter(Boolean), { align: "right" });
  });
  await load();
}

async function cancel(id) { try { await api("POST", `/broadcasts/${id}/cancel`); toast("Schedule canceled — moved back to drafts"); } catch (e) { errToast(e); } }
async function duplicate(id, navigate) {
  const { data: b } = await sb.from("broadcasts").select("*").eq("id", id).single();
  const { data, error } = await sb.from("broadcasts").insert({ team_id: b.team_id, name: `${b.name} (copy)`, status: "draft", from: b.from, reply_to: b.reply_to, segment_id: b.segment_id, topic_id: b.topic_id, subject: b.subject, preview_text: b.preview_text, content: b.content, created_by: state.user.id }).select("id").single();
  if (error) return errToast(error);
  toast("Broadcast duplicated"); navigate(`/broadcasts/${data.id}/edit`);
}
async function toTemplate(id, navigate) {
  const { data: b } = await sb.from("broadcasts").select("*").eq("id", id).single();
  const { data, error } = await sb.from("templates").insert({ team_id: b.team_id, name: b.name, from: b.from, reply_to: b.reply_to, subject: b.subject, content: b.content, status: "draft", variables: [], created_by: state.user.id }).select("id").single();
  if (error) return errToast(error);
  toast("Template created"); navigate(`/templates/${data.id}`);
}

export async function report(ctx) {
  const id = ctx.params.id;
  const b = await api("GET", `/broadcasts/${id}`);
  if (b.status === "draft") return ctx.navigate(`/broadcasts/${id}/edit`, { replace: true });
  ctx.crumb("send", b.name || "Untitled", ["Broadcasts", "/broadcasts"]);
  const s = b.stats || {};
  const [{ data: seg }, { data: dom }] = await Promise.all([
    b.segment_id ? sb.from("segments").select("name").eq("id", b.segment_id).maybeSingle() : { data: null },
    sb.from("domains").select("click_tracking,open_tracking,name").eq("team_id", state.team.id).eq("name", (b.from || "").replace(/.*@/, "").replace(/>.*/, "").trim()).maybeSingle(),
  ]);
  const total = s.total || b.recipients || 0, del = s.delivered || 0;
  const r = (n, d) => (d ? n / d : 0);
  const root = ctx.root;
  root.innerHTML = `<div class="page wide">
    <div class="page-head"><div><div class="eyebrow">${sBadge(b.status)} <span class="dim" style="margin-left:6px">${b.sent_at ? "Sent " + fmtDateTime(b.sent_at) : b.scheduled_at ? "Started " + fmtDateTime(b.scheduled_at) : ""}</span></div><h1 style="margin-top:6px">${esc(b.name || "Untitled")}</h1></div>
      <div class="actions"><button class="btn btn-secondary" data-dup>${icon("copy", 13)} Duplicate</button><button class="ibtn boxed" data-more>${icon("more")}</button></div></div>
    ${dom && !dom.click_tracking ? `<div class="banner">${icon("info", 14)} Click tracking is off for ${esc(dom.name)}, so clicks aren’t counted.<a class="btn btn-secondary btn-sm" href="/domains/${""}" data-domlink>Domain settings</a></div>` : ""}
    <div class="facts" style="grid-template-columns:repeat(4,1fr)"><div><div class="k">From</div><div class="v ellipsis">${esc(b.from || "—")}</div></div><div><div class="k">Audience</div><div class="v">${esc(seg?.name || "—")}</div></div><div><div class="k">Subject</div><div class="v ellipsis">${esc(b.subject || "—")}</div></div><div><div class="k">Recipients</div><div class="v">${num(total)}</div></div></div>
    <h3 class="section-title">Deliverability</h3>
    <div class="stat-grid">${stat("Delivered", pct(r(del, total)), num(del))}${stat("Bounced", pct(r(s.bounced, total)), num(s.bounced), s.bounced / (total || 1) > 0.04)}${stat("Complained", pct(r(s.complained, del), 2), num(s.complained), s.complained / (del || 1) > 0.0008)}${stat("Suppressed", num(s.suppressed), "skipped")}</div>
    <h3 class="section-title">Engagement</h3>
    <div class="stat-grid">${stat("Opened", dom?.open_tracking === false ? "—" : pct(r(s.opened, del)), dom?.open_tracking === false ? "tracking off" : num(s.opened))}${stat("Clicked", dom?.click_tracking === false ? "—" : pct(r(s.clicked, del)), dom?.click_tracking === false ? "tracking off" : num(s.clicked))}${stat("Unsubscribed", pct(r(s.unsubscribed, del)), num(s.unsubscribed))}${stat("Click-to-open", s.opened ? pct(r(s.clicked, s.opened)) : "—", "of opens")}</div>
    <h3 class="section-title">Opens and clicks over time</h3><div class="card card-pad"><div data-chart style="min-height:220px"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="two-col">
      <div><h3 class="section-title">Top clicked links</h3><div data-links class="table-wrap"></div></div>
      <div><h3 class="section-title">Recipients</h3><div data-recips class="table-wrap"></div></div></div>
    <h3 class="section-title">Email</h3><div class="card"><iframe class="preview-frame" sandbox style="height:520px;border-radius:10px"></iframe></div></div>`;
  root.querySelector("iframe").srcdoc = b.html || "<p style='font-family:sans-serif;color:#888;padding:20px'>No content</p>";
  if (dom) { const { data: d2 } = await sb.from("domains").select("id").eq("team_id", state.team.id).eq("name", dom.name).single(); const a = root.querySelector("[data-domlink]"); if (a && d2) a.href = `/domains/${d2.id}?tab=configuration`; }
  root.querySelector("[data-dup]").onclick = () => duplicate(id, ctx.navigate);
  root.querySelector("[data-more]").onclick = (e) => menu(e.currentTarget, [
    b.status === "scheduled" && { label: "Cancel schedule", icon: "x", onClick: () => cancel(id).then(() => ctx.navigate(`/broadcasts/${id}/edit`)) },
    { label: "Save as template", icon: "template", onClick: () => toTemplate(id, ctx.navigate) },
    { label: "View emails", icon: "mail", onClick: () => ctx.navigate(`/emails`) },
    { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(id).then(() => toast("ID copied")) },
  ].filter(Boolean), { align: "right" });

  // events for chart + links
  const { data: emails } = await sb.from("emails").select("id,to,status,created_at").eq("broadcast_id", id).order("created_at").limit(1000);
  const ids = (emails || []).map((e) => e.id);
  let events = [];
  for (let i = 0; i < ids.length && i < 1000; i += 200) {
    const { data } = await sb.from("email_events").select("type,created_at,data").in("email_id", ids.slice(i, i + 200)).in("type", ["opened", "clicked"]);
    events = events.concat(data || []);
  }
  const start = new Date(b.sent_at || b.scheduled_at || b.created_at);
  const hours = Math.min(14 * 24, Math.max(24, Math.ceil((Date.now() - start) / 36e5)));
  const byDay = hours > 72;
  const buckets = byDay ? Math.ceil(hours / 24) : hours;
  const keyOf = (d) => Math.floor((new Date(d) - start) / (byDay ? 864e5 : 36e5));
  const opens = Array(buckets).fill(0), clicks = Array(buckets).fill(0);
  events.forEach((e) => { const k = keyOf(e.created_at); if (k >= 0 && k < buckets) (e.type === "opened" ? opens : clicks)[k]++; });
  const labels = Array.from({ length: buckets }, (_, i) => { const d = new Date(start.getTime() + i * (byDay ? 864e5 : 36e5)); return byDay ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.toLocaleTimeString(undefined, { hour: "numeric" }) + (i % 24 === 0 ? " · " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""); });
  lineChart(root.querySelector("[data-chart]"), { labels, series: [{ name: "Opens", color: "#fad600", values: opens }, { name: "Clicks", color: "#4c8df6", values: clicks }] });
  const links = {};
  events.filter((e) => e.type === "clicked").forEach((e) => { const u = e.data?.link || e.data?.url || "(unknown)"; links[u] = (links[u] || 0) + 1; });
  const top = Object.entries(links).sort((a, b2) => b2[1] - a[1]).slice(0, 8);
  root.querySelector("[data-links]").innerHTML = top.length ? `<table class="t"><thead><tr><th>Link</th><th class="r">Clicks</th></tr></thead><tbody>${top.map(([u, c]) => `<tr><td class="ellipsis" style="max-width:320px"><a href="${esc(u)}" target="_blank" rel="noopener" class="muted">${esc(u)}</a></td><td class="r">${num(c)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty" style="padding:28px">${icon("link", 15, "dim")}<p>No clicks yet</p></div>`;
  const rec = (emails || []).slice(0, 8);
  root.querySelector("[data-recips]").innerHTML = rec.length ? `<table class="t"><thead><tr><th>Recipient</th><th class="r">Status</th></tr></thead><tbody>${rec.map((e) => `<tr class="clickable" onclick="DLV.go('/emails/${e.id}')"><td class="ellipsis">${esc(e.to?.[0])}</td><td class="r">${esc(e.status)}</td></tr>`).join("")}</tbody></table>${emails.length > 8 ? `<div class="pager"><span>${num(emails.length)} recipients</span></div>` : ""}` : `<div class="empty" style="padding:28px"><p>No recipients yet</p></div>`;
  window.DLV.go = ctx.navigate;
}
function stat(k, v, sub, warn) { return `<div class="stat"><div class="k">${k}</div><div class="v" ${warn ? 'style="color:var(--red)"' : ""}>${v}</div><div class="dim" style="font-size:12px;margin-top:2px">${esc(sub ?? "")}</div></div>`; }

export async function scheduled(ctx) {
  const id = ctx.params.id;
  const { data: b } = await sb.from("broadcasts").select("*").eq("id", id).single();
  if (!b) return ctx.navigate("/broadcasts", { replace: true });
  const at = b.scheduled_at ? new Date(b.scheduled_at) : new Date();
  const now = at.getTime() <= Date.now() + 60000;
  ctx.root.innerHTML = `<div class="stamp-page"><div style="max-width:420px;justify-self:end">
      <a href="/broadcasts" class="btn btn-ghost btn-sm" style="margin-left:-9px;margin-bottom:22px">${icon("arrow-left", 13)} Broadcasts</a>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-.02em">${now ? "Your broadcast is on its way" : "Your broadcast is scheduled"}</h1>
      <p class="muted" style="margin-top:10px;font-size:14px">${now ? `We’re sending “${esc(b.name)}” to ${num(b.recipients)} ${b.recipients === 1 ? "contact" : "contacts"} now. Stats fill in as delivery events arrive.` : `“${esc(b.name)}” goes out to ${num(b.recipients)} ${b.recipients === 1 ? "contact" : "contacts"} on ${esc(at.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }))}.`}</p>
      <div class="row-flex" style="margin-top:22px"><a class="btn btn-primary" href="/broadcasts/${id}">View report</a>${!now ? `<button class="btn btn-secondary" data-cancel>Cancel schedule</button>` : ""}</div></div>
    <div class="stamp"><div class="art">${MARK.replace('width="26" height="19"', 'width="92" height="68"').replace(/fill="[^"]*"/g, 'fill="#211F20"')}</div><h4 class="ellipsis">${esc(b.subject || b.name)}</h4><div class="muted ellipsis" style="font-size:12.5px;margin-top:3px">${esc(b.from || "")}</div><div class="meta"><span>NO. ${String(b.stamp_no || 1).padStart(3, "0")}</span><span>${esc(at.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }).toUpperCase())}</span></div></div></div>`;
  ctx.root.querySelector("[data-cancel]")?.addEventListener("click", async () => { await cancel(id); ctx.navigate(`/broadcasts/${id}/edit`); });
}

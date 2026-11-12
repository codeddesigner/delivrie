import { sb, state, api, must, API_BASE } from "../lib/sb.js";
import { receivingIntro, setupModal, received } from "./receiving.js";
import { initials, esc, icon, statusIcon, statusCell, ago, fmtDateTime, num, plural, toast, errToast, menu, modal, drawer, codeBlock, emptyState, skeletonRows, pager, debounce, download, csv, copyText, selectHtml, bindSelects, TZ, on } from "../lib/ui.js";

const RANGES = [["1", "Today"], ["2", "Yesterday"], ["3", "Last 3 days"], ["7", "Last 7 days"], ["15", "Last 15 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];
const STATUSES = ["delivered", "opened", "clicked", "bounced", "complained", "delivery_delayed", "sent", "queued", "scheduled", "failed", "canceled", "suppressed"];
const LABEL = { delivered: "Delivered", opened: "Opened", clicked: "Clicked", bounced: "Bounced", complained: "Complained", delivery_delayed: "Delayed", sent: "Sent", queued: "Queued", scheduled: "Scheduled", failed: "Failed", canceled: "Canceled", suppressed: "Suppressed", received: "Received" };
const PAGE = 20;

function rangeBounds(r) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (r === "2") { const s = new Date(d); s.setDate(s.getDate() - 1); return [s, d]; }
  const s = new Date(d); s.setDate(s.getDate() - (Number(r) - 1)); return [s, null];
}

function buildQuery(f, select = "*", count = true) {
  let q = sb.from("emails").select(select, count ? { count: "exact" } : undefined).eq("team_id", state.team.id).eq("direction", f.tab === "receiving" ? "inbound" : "outbound");
  const [from, to] = rangeBounds(f.range);
  q = q.gte("created_at", from.toISOString());
  if (to) q = q.lt("created_at", to.toISOString());
  if (f.status) q = q.eq("status", f.status);
  if (f.key) q = q.eq("api_key_id", f.key);
  if (f.q) { const s = f.q.replace(/[,%()]/g, " ").trim().toLowerCase(); if (s) q = q.or(`subject.ilike.%${s}%,to_text.ilike.%${s}%,from.ilike.%${s}%`); }
  return q.order("created_at", { ascending: false });
}

export async function list(ctx) {
  ctx.crumb("mail", "Emails");
  const f = { tab: ctx.query.tab || "sending", q: ctx.query.q || "", range: ctx.query.range || "15", status: ctx.query.status || "", key: ctx.query.key || "", page: +ctx.query.page || 1 };
  const { data: keys } = await sb.from("api_keys").select("id,name").eq("team_id", state.team.id);
  const root = ctx.root;
  const sync = () => { const p = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === "page" && v === 1) && !(k === "range" && v === "15") && !(k === "tab" && v === "sending"))); history.replaceState({}, "", "/emails" + (p.toString() ? "?" + p : "")); };
  root.innerHTML = `<div class="page wide">
    <div class="page-head"><h1>Emails</h1><div class="actions"><button class="btn btn-secondary btn-sm" data-recv-setup hidden>${icon("inbox", 13)} Receiving setup</button><button class="ibtn boxed" data-apidrawer title="API">${icon("code", 14)}</button><button class="ibtn boxed" data-more>${icon("more", 14)}</button></div></div>
    <div class="seg-tabs"><button class="seg-tab" data-tab="sending">Sending</button><button class="seg-tab" data-tab="receiving">Receiving</button></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search by recipient or subject" value="${esc(f.q)}"></div>
      <div style="width:170px">${selectHtml("range", RANGES.map(([v, l]) => ({ value: v, label: l })), f.range)}</div>
      <div style="width:150px">${selectHtml("status", [{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: LABEL[s] }))], f.status)}</div>
      <div style="width:170px">${selectHtml("key", [{ value: "", label: "All API keys" }, ...(keys || []).map((k) => ({ value: k.id, label: k.name }))], f.key)}</div></div>
    <div data-body></div></div>`;
  const tabs = () => { root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === f.tab)); root.querySelector(".page-head [data-recv-setup]").hidden = f.tab !== "receiving"; };
  tabs();
  const body = root.querySelector("[data-body]");
  let last = { rows: [], count: 0 };
  async function load() {
    sync();
    const inbound = f.tab === "receiving";
    root.querySelector("[data-q]").placeholder = inbound ? "Search by sender or subject" : "Search by recipient or subject";
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(4, 6)}</tbody></table></div>`;
    const { data, count, error } = await buildQuery(f, "id,from,to,subject,status,created_at,scheduled_at" + (inbound ? ",attachments" : "")).range((f.page - 1) * PAGE, f.page * PAGE - 1);
    if (error) throw error;
    last = { rows: data, count };
    if (!count) {
      const filtered = f.q || f.status || f.key;
      if (inbound && !filtered) {
        const { data: recv } = await sb.from("domains").select("id,name,receiving_subdomain,receiving_verified_at").eq("team_id", state.team.id).eq("receiving_enabled", true);
        if (!recv?.length) { body.innerHTML = receivingIntro(); return; }
        const d = recv[0], h = d.receiving_subdomain ? `${d.receiving_subdomain}.${d.name}` : d.name;
        body.innerHTML = emptyState({ icon: "inbox", title: "No received emails yet", desc: d.receiving_verified_at ? `Send a test to anything@${esc(h)} and it shows up here.` : `Finish adding the MX record for ${esc(h)}, then mail sent to it shows up here.`, action: `<a class="btn btn-secondary" href="/domains/${d.id}/receiving">${d.receiving_verified_at ? "Receiving settings" : "Finish setup"}</a>` });
        return;
      }
      body.innerHTML = filtered ? emptyState({ icon: "search", title: "No emails match", desc: "Try a different search or widen the date range." })
        : emptyState({ icon: "mail", title: inbound ? "No received emails yet" : "No sent emails yet", desc: inbound ? "Turn on receiving for a domain and emails sent to it show up here." : "Send your first email with the API or SMTP and it shows up here with live status.", action: `<a class="btn btn-secondary" href="${inbound ? "/domains" : "/docs#send-email"}">${inbound ? "Go to domains" : "Go to docs"}</a>` });
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr>${inbound ? "<th>From</th><th>To</th>" : "<th>To</th><th>Status</th>"}<th>Subject</th><th class="r">${inbound ? "Received" : "Sent"}</th><th></th></tr></thead><tbody>
      ${data.map((e) => `<tr class="clickable" data-id="${e.id}">${inbound ? `<td><div class="cell"><span class="avatar xs">${esc(initials((e.from || "").replace(/<.*>/, "").replace(/"/g, "").trim() || e.from))}</span><span class="ellipsis">${esc((e.from || "").replace(/\s*<.*>/, "").replace(/"/g, "") || e.from)}</span></div></td><td class="muted mono" style="font-size:12px">${esc((e.to?.[0] || "").replace(/.*<|>.*/g, ""))}</td>` : `<td><div class="cell">${icon("mail", 13, "dim")}<span class="ellipsis">${esc(e.to?.[0] || "")}${e.to?.length > 1 ? ` <span class="dim">+${e.to.length - 1}</span>` : ""}</span></div></td><td>${statusCell(e.status)}</td>`}<td class="ellipsis" style="max-width:420px">${esc(e.subject)}${inbound && e.attachments?.length ? ` <span class="dim" style="margin-left:6px">${icon("paperclip", 11)} ${e.attachments.length}</span>` : ""}</td><td class="r muted" title="${esc(fmtDateTime(e.created_at, true))}">${e.status === "scheduled" ? "Scheduled · " + fmtDateTime(e.scheduled_at) : ago(e.created_at)}</td><td class="act"><button class="ibtn" data-row="${e.id}">${icon("more")}</button></td></tr>`).join("")}
      </tbody></table></div>${pager(f.page, count, PAGE, "email")}`;
  }
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-recv-setup]")) { setupModal(ctx); return; }
    const tab = e.target.closest("[data-tab]"); if (tab) { f.tab = tab.dataset.tab; f.page = 1; tabs(); load(); return; }
    const pg = e.target.closest("[data-page]"); if (pg && !pg.disabled) { f.page = +pg.dataset.page; load(); return; }
    const rowBtn = e.target.closest("[data-row]");
    if (rowBtn) { e.stopPropagation(); const em = last.rows.find((r) => r.id === rowBtn.dataset.row); menu(rowBtn, [
      { label: "View email", icon: "mail", onClick: () => ctx.navigate(`/emails/${em.id}`) },
      { label: "Copy ID", icon: "copy", onClick: () => copyText(em.id, "Email ID copied") },
      ...(em.status === "scheduled" ? [{ sep: true }, { label: "Cancel send", icon: "x-circle", danger: true, onClick: async () => { try { await api("POST", `/emails/${em.id}/cancel`); toast("Scheduled email canceled"); load(); } catch (err) { errToast(err); } } }] : []),
    ], { align: "right" }); return; }
    const tr = e.target.closest("tr[data-id]"); if (tr) ctx.navigate(`/emails/${tr.dataset.id}`);
    if (e.target.closest("[data-apidrawer]")) apiDrawer();
    const more = e.target.closest("[data-more]");
    if (more) menu(more, [{ label: "Export", icon: "download", onClick: () => exportEmails(f, last.count) }], { align: "right" });
  });
  root.querySelector("[data-q]").addEventListener("input", debounce((e) => { f.q = e.target.value; f.page = 1; load(); }, 300));
  bindSelects(root, (name, value) => { f[name] = value; f.page = 1; load(); });
  await load();
  if (ctx.query.setup) setupModal(ctx);
}

function apiDrawer() {
  const send = `curl -X POST '${API_BASE}/emails' \\
  -H 'Authorization: Bearer dlv_your_api_key' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "from": "Acme <orders@yourdomain.com>",
    "to": ["customer@example.com"],
    "subject": "Your order is confirmed",
    "html": "<p>Thanks for your order!</p>",
    "tags": [{ "name": "category", "value": "transactional" }]
  }'`;
  const batch = `curl -X POST '${API_BASE}/emails/batch' \\
  -H 'Authorization: Bearer dlv_your_api_key' \\
  -H 'Content-Type: application/json' \\
  -d '[
    { "from": "Acme <hi@yourdomain.com>", "to": "a@example.com", "subject": "Hi A", "text": "Hello" },
    { "from": "Acme <hi@yourdomain.com>", "to": "b@example.com", "subject": "Hi B", "text": "Hello" }
  ]'`;
  const get = `curl '${API_BASE}/emails/<email_id>' \\
  -H 'Authorization: Bearer dlv_your_api_key'`;
  drawer({ title: "API", wide: true, body: `<p class="muted">Send with one request. Every call shows up here with live status.</p><h4 class="label">Send email</h4>${codeBlock(send, { lang: "sh" })}<h4 class="label">Send batch</h4>${codeBlock(batch, { lang: "sh" })}<h4 class="label">Retrieve email</h4>${codeBlock(get, { lang: "sh" })}<a class="btn btn-secondary" href="/docs#send-email">Read the docs ${icon("arrow-up-right", 12)}</a>` });
}

async function exportEmails(f, count) {
  const ok = await modal({ title: "Export emails", body: `<p class="desc">Export ${plural(count, "email")} matching your current filters (${esc(RANGES.find((r) => r[0] === f.range)?.[1])}${f.status ? ", " + LABEL[f.status] : ""}${f.q ? `, “${esc(f.q)}”` : ""}) as a CSV file.</p>`, foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Export</button>`, onMount(m, close) { m.querySelector("[data-ok]").onclick = () => close(true); } });
  if (!ok) return;
  let done = 0, cancelled = false;
  const rows = [["id", "from", "to", "subject", "status", "created_at", "sent_at"]];
  await modal({
    title: "Exporting emails", dismissable: false,
    body: `<p class="desc" data-p>Preparing… 0 of ${num(count)}</p><div class="meter"><i style="width:0%"></i></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button>`,
    async onMount(m, close) {
      m.querySelector("[data-cancel]").onclick = () => { cancelled = true; close(); };
      try {
        for (let from = 0; from < count && !cancelled; from += 1000) {
          const data = must(await buildQuery(f, "id,from,to,subject,status,created_at,sent_at", false).range(from, from + 999));
          for (const e of data) rows.push([e.id, e.from, (e.to || []).join(";"), e.subject, e.status, e.created_at, e.sent_at]);
          done = Math.min(count, from + data.length);
          m.querySelector("[data-p]").textContent = `Exporting… ${num(done)} of ${num(count)}`;
          m.querySelector(".meter i").style.width = `${Math.round((done / Math.max(1, count)) * 100)}%`;
          if (!data.length) break;
        }
        if (!cancelled) {
          download(`delivrie-emails-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
          m.querySelector(".modal-body").innerHTML = `<div class="row-flex" style="gap:10px"><span style="color:var(--green-2)">${icon("check-circle", 18)}</span><span>Export ready. ${plural(rows.length - 1, "email")} downloaded.</span></div>`;
          m.querySelector(".modal-foot").innerHTML = `<button class="btn btn-secondary" data-cancel>Done</button>`;
          m.querySelector("[data-cancel]").onclick = () => close();
        }
      } catch (e) { errToast(e); close(); }
    },
  });
}

// ---------------------------------------------------------------- detail
const EVENT_INFO = {
  sent: ["Sent", "Delivrie handed the message to Amazon SES, which accepted it for delivery."],
  delivered: ["Delivered", "The recipient’s mail server accepted the message and returned a success response. This confirms delivery to the server, not the inbox."],
  opened: ["Opened", "The recipient’s mail client loaded the tracking pixel. Privacy features in Apple Mail can trigger opens automatically."],
  clicked: ["Clicked", "The recipient clicked a tracked link."],
  bounced: ["Bounced", "The receiving server rejected the message."],
  complained: ["Complained", "The recipient marked this email as spam. The address was suppressed and the contact unsubscribed."],
  delivery_delayed: ["Delayed", "Delivery is being retried. The receiving server temporarily deferred the message."],
  failed: ["Failed", "Delivrie couldn’t send this email."],
  scheduled: ["Scheduled", "The email is queued to send at its scheduled time."],
  canceled: ["Canceled", "The scheduled send was canceled."],
  suppressed: ["Suppressed", "Every recipient is on your suppression list, so nothing was sent."],
  unsubscribed: ["Unsubscribed", "The recipient unsubscribed using this email’s link."],
  received: ["Received", "Delivrie received this message on one of your inbound domains."],
};

export async function detail(ctx) {
  const root = ctx.root;
  const e = must(await sb.from("emails").select("*").eq("team_id", state.team.id).eq("id", ctx.params.id).maybeSingle());
  if (!e) { root.innerHTML = `<div class="page narrow">${emptyState({ icon: "mail", title: "Email not found", desc: "It may belong to another team.", action: '<a class="btn btn-secondary" href="/emails">Back to emails</a>' })}</div>`; return; }
  const events = must(await sb.from("email_events").select("*").eq("email_id", e.id).order("created_at"));
  const domain = e.domain_id ? must(await sb.from("domains").select("*").eq("id", e.domain_id).maybeSingle()) : null;
  const inbound = e.direction === "inbound";
  if (inbound) return received(ctx, e, events);
  const title = inbound ? e.from : e.to?.[0];
  ctx.crumb("mail", title, ["Emails", "/emails" + (inbound ? "?tab=receiving" : "")]);
  let tab = "preview";
  const tlEvents = events.filter((ev) => EVENT_INFO[ev.type]);
  root.innerHTML = `<div class="page wide">
    <div class="page-head"><div class="head-ico">${icon("mail", 16)}</div><div style="min-width:0"><div class="eyebrow">Email</div><h1 class="ellipsis">${esc(title)}</h1></div>
      <div class="actions">${!inbound ? statusCell(e.status) : ""}<button class="btn btn-secondary" data-share>${icon("link", 13)} Share</button><button class="ibtn boxed" data-more>${icon("more")}</button></div></div>
    <div class="facts"><div><div class="k">From</div><div class="v" title="${esc(e.from)}">${esc(e.from)}</div></div><div><div class="k">Subject</div><div class="v" title="${esc(e.subject)}">${esc(e.subject)}</div></div><div><div class="k">To</div><div class="v" title="${esc((e.to || []).join(", "))}">${esc((e.to || []).join(", "))}</div></div><div><div class="k">ID</div><div class="v mono" style="font-size:12px;cursor:pointer" data-copy="${e.id}" data-copy-msg="Email ID copied">${esc(e.id.slice(0, 23))}</div></div></div>
    ${e.error ? `<div class="banner warn">${icon("alert", 14)} ${esc(e.error)}</div>` : ""}
    <div class="card" style="margin-bottom:16px"><div class="row-flex card-pad" style="padding-bottom:6px"><h3>Email events</h3><span class="dim" style="margin-left:auto;font-size:12px">Times in ${esc(TZ)}</span></div>
      <div class="timeline" style="padding:6px 14px 14px">${tlEvents.length ? tlEvents.map((ev, i) => `<div class="tl-item" data-ev="${i}"><div class="tl-dot">${statusIcon(ev.type === "sent" ? "sent" : ev.type, 13)}</div><div class="n">${EVENT_INFO[ev.type][0]}</div><div class="t">${fmtDateTime(ev.created_at, ev.type === "sent" || ev.type === "delivered")}</div></div>`).join("") : `<div class="dim" style="padding:10px">${e.status === "queued" ? "Queued for sending…" : "No events yet."}</div>`}</div></div>
    <div class="card"><div class="row-flex" style="padding:10px 12px;gap:4px">${["Preview", "Plain text", "HTML", ...(inbound ? ["Headers"] : ["Insights"])].map((t) => `<button class="seg-tab" data-view="${t.toLowerCase()}">${t}</button>`).join("")}</div><div data-view-body></div></div>
    ${e.attachments?.length ? `<h3 class="section-title">Attachments</h3><div class="chip-row">${e.attachments.map((a) => `<span class="pill">${icon("download", 12)} ${esc(a.filename)} <span class="dim">${a.size ? Math.ceil(a.size / 1024) + " KB" : ""}</span></span>`).join("")}</div>` : ""}
  </div>`;
  const vb = root.querySelector("[data-view-body]");
  const drawView = () => {
    root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === tab));
    if (tab === "preview") {
      vb.innerHTML = `<div class="preview-stage"><iframe class="preview-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" style="max-width:680px;height:420px"></iframe></div>`;
      const fr = vb.querySelector("iframe");
      fr.srcdoc = e.html || `<pre style="font:14px/1.6 -apple-system,sans-serif;white-space:pre-wrap;padding:20px;margin:0">${esc(e.text || "(no content)")}</pre>`;
      fr.onload = () => { try { fr.style.height = Math.min(1600, Math.max(240, fr.contentDocument.documentElement.scrollHeight + 4)) + "px"; } catch {} };
    } else if (tab === "plain text") vb.innerHTML = `<div style="padding:14px">${codeBlock(e.text || "(no plain-text part)", { lang: "text", lines: false })}</div>`;
    else if (tab === "html") vb.innerHTML = `<div style="padding:14px">${codeBlock(e.html || "(no HTML part)", { lang: "html", max: 560 })}</div>`;
    else if (tab === "headers") vb.innerHTML = `<div style="padding:14px">${codeBlock(Object.entries(e.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)", { lang: "text" })}</div>`;
    else vb.innerHTML = insights(e, domain);
  };
  drawView();
  root.addEventListener("click", (ev) => {
    const v = ev.target.closest("[data-view]"); if (v) { tab = v.dataset.view; drawView(); }
    const it = ev.target.closest("[data-ev]"); if (it) eventDrawer(tlEvents[+it.dataset.ev]);
    if (ev.target.closest("[data-share]")) shareModal(e);
    const more = ev.target.closest("[data-more]");
    if (more) menu(more, [
      { label: "Share email", icon: "link", onClick: () => shareModal(e) },
      { label: "Copy ID", icon: "copy", onClick: () => copyText(e.id, "Email ID copied") },
      ...(e.status === "scheduled" ? [{ label: "Cancel send", icon: "x-circle", danger: true, onClick: async () => { try { await api("POST", `/emails/${e.id}/cancel`); toast("Scheduled email canceled"); ctx.navigate(location.pathname, { replace: true }); } catch (err) { errToast(err); } } }] : []),
    ], { align: "right" });
  });
}

function eventDrawer(ev) {
  const [label, desc] = EVENT_INFO[ev.type] || [ev.type, ""];
  const d = ev.data || {};
  const rows = [["Timestamp", fmtDateTime(ev.created_at, true)]];
  if (d.latency_ms != null) rows.push(["Latency", `${num(d.latency_ms)} ms`]);
  if (d.mx_host) rows.push(["MX host", `<span class="mono">${esc(d.mx_host)}</span>`]);
  if (d.type) rows.push(["Type", esc(d.type + (d.sub_type ? ` · ${d.sub_type}` : ""))]);
  if (d.link) rows.push(["Link", `<a class="link" href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.link)}</a>`]);
  if (d.user_agent) rows.push(["User agent", esc(d.user_agent)]);
  if (d.ip) rows.push(["IP", `<span class="mono">${esc(d.ip)}</span>`]);
  if (d.message_id) rows.push(["Message ID", `<span class="mono" style="font-size:11.5px">${esc(d.message_id)}</span>`]);
  if (d.reason) rows.push(["Reason", esc(d.reason)]);
  const smtp = d.smtp_response || d.message;
  drawer({ title: label, body: `<p class="muted">${esc(desc)}</p><div class="kv" style="grid-template-columns:110px 1fr">${rows.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join("")}</div>${smtp ? `<div><div class="label" style="margin-bottom:6px">SMTP response</div>${codeBlock(smtp, { lang: "text" })}</div>` : ""}` });
}

function insights(e, domain) {
  const need = [], good = [];
  const html = e.html || "";
  (e.text ? good : need).push(["Plain-text version", e.text ? "Included alongside HTML" : "Add a plain-text version. Improves spam scores"]);
  if (domain) {
    const sub = domain.name.split(".").length > 2;
    (sub ? good : need).push(["Sending from a subdomain", sub ? domain.name : `Send from a subdomain, e.g. mail.${domain.name}`]);
    (domain.status === "verified" ? good : need).push(["DKIM, SPF and DMARC", domain.status === "verified" ? "Authenticated for " + domain.name : "Finish verifying " + domain.name]);
    const dmarc = (domain.records || []).find((r) => r.record === "DMARC");
    if (dmarc && dmarc.status !== "verified") need.push(["DMARC record", "Add a _dmarc TXT record. Gmail and Yahoo require it for bulk senders"]);
  }
  const links = (html.match(/<a\s/gi) || []).length;
  (links <= 15 ? good : need).push(["Link count", `${links} link${links === 1 ? "" : "s"}${links > 15 ? ". Fewer links look less spammy" : ""}`]);
  const kb = Math.round(new Blob([html]).size / 1024);
  (kb < 100 ? good : need).push(["Message size", `${kb} KB${kb >= 100 ? ". Gmail clips messages over 102 KB" : ""}`]);
  if (e.broadcast_id) good.push(["One-click unsubscribe", "List-Unsubscribe headers added automatically"]);
  if (/<img[^>]+>/i.test(html) && !/alt=/i.test(html)) need.push(["Image alt text", "Add alt text so images make sense when blocked"]);
  const sec = (title, items, ok) => items.length ? `<div style="padding:14px 18px"><div class="eyebrow" style="letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">${title}</div>${items.map(([t, d]) => `<div class="row-flex" style="padding:8px 0;border-bottom:1px solid var(--border-soft)"><span style="color:${ok ? "var(--green-2)" : "var(--orange)"}">${icon(ok ? "check-circle" : "alert", 14)}</span><span style="font-weight:500">${esc(t)}</span><span class="muted" style="margin-left:auto;font-size:12.5px">${esc(d)}</span></div>`).join("")}</div>` : "";
  return sec("Needs attention", need, false) + sec("Doing great", good, true);
}

async function shareModal(e) {
  await modal({
    title: "Share email",
    body: `<p class="desc">Anyone with the link can view this email’s content and delivery events until it expires. Use it for support or debugging.</p>
      <div class="field"><label>Link expires</label>${selectHtml("exp", [{ value: "1", label: "In 1 hour" }, { value: "24", label: "In 24 hours" }, { value: "48", label: "In 48 hours" }, { value: "168", label: "In 7 days" }], "48")}</div><div data-link></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Close</button><button class="btn btn-primary" data-create>Create link</button>`,
    onMount(m, close) {
      bindSelects(m);
      m.querySelector("[data-create]").onclick = async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true;
        try {
          const hours = +m.querySelector("input[name=exp]").value;
          const s = must(await sb.from("email_shares").insert({ email_id: e.id, team_id: state.team.id, expires_at: new Date(Date.now() + hours * 3600e3).toISOString(), created_by: state.user.id }).select().single());
          const url = `${location.origin}/share/${s.token}`;
          m.querySelector("[data-link]").innerHTML = `<div class="field"><label>Share link</label><div class="input-wrap"><input class="input mono" readonly value="${esc(url)}" style="font-size:12px"><button class="ibtn trail" data-copy="${esc(url)}" data-copy-msg="Share link copied">${icon("copy")}</button></div><div class="hint">Expires ${fmtDateTime(s.expires_at)}</div></div>`;
          btn.textContent = "Copy link"; btn.disabled = false; btn.onclick = () => { copyText(url, "Share link copied"); close(); };
          copyText(url, "Share link copied");
        } catch (err) { errToast(err); btn.disabled = false; }
      };
    },
  });
}

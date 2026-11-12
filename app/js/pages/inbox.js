// Inbox (Figma 12.3): a shared inbox on top of receiving. Threads, labels, replies that keep Message-ID threading.
import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, toast, errToast, menu, modal, formModal, confirmModal, emptyState, initials, on, debounce, EMAIL_RE } from "../lib/ui.js";

const COLORS = ["#4c8df6", "#3fa672", "#e2b400", "#f2994a", "#a774f2", "#e5484d", "#8a8f98"];
const FOLDERS = [["all", "All mail", "inbox"], ["unread", "Unread", "mail"], ["needs", "Needs reply", "reply"], ["sent", "Sent", "send"], ["archived", "Archived", "archive"]];
const needsReply = (t) => t.status === "open" && t.last_inbound_at && (!t.last_outbound_at || new Date(t.last_inbound_at) > new Date(t.last_outbound_at));

export default async function inbox(ctx) {
  ctx.crumb("inbox", "Inbox");
  const T = state.team.id, root = ctx.root;
  let threads = [], labels = [], domains = [], mailbox = null, folder = ctx.query.folder || "all", labelF = null, q = "", openId = ctx.params.id || null, msgs = [];
  let pref = {}; try { pref = JSON.parse(localStorage.getItem("dlv_inbox") || "{}"); } catch {}

  const [{ data: doms }] = await Promise.all([sb.from("domains").select("id,name,status,receiving_enabled").eq("team_id", T)]);
  domains = doms || [];
  const receiving = domains.filter((d) => d.receiving_enabled);
  if (!receiving.length) {
    root.innerHTML = `<div class="page"><div class="page-head"><h1>Inbox</h1></div><div class="card inbox-empty">${emptyState({ icon: "inbox", title: "Receive email to use the Inbox", desc: "Turn on receiving for a domain and add one MX record. Every email sent to that address lands here as a thread you can label and reply to, and your app gets an email.received webhook.", action: `<a class="btn btn-primary" href="/domains">${icon("globe", 13)} Set up receiving</a> <a class="btn btn-secondary" href="/docs/domains">Read the guide</a>` })}
      <div class="inbox-steps">${[["globe", "Add an MX record", "Use a subdomain like in.yourdomain.com so your existing mail keeps working."], ["webhook", "Get email.received", "Parsed headers, text, HTML and attachments in one payload."], ["reply", "Reply in threads", "Answer from here with correct Message-ID threading."]].map(([i, t, d]) => `<div>${icon(i, 15)}<b>${t}</b><span class="muted">${d}</span></div>`).join("")}</div></div></div>`;
    return;
  }

  root.innerHTML = `<div class="inbox">
    <aside class="ib-side"><button class="ib-mbox" data-mbox>${icon("inbox", 14)}<span class="grow ellipsis" data-mbox-name>All inboxes</span>${icon("chevron-down", 12, "dim")}</button>
      <nav data-folders></nav><div class="ib-h"><span>Labels</span><button class="ibtn" data-new-label title="New label">${icon("plus", 12)}</button></div><nav data-labels></nav></aside>
    <section class="ib-list"><div class="ib-search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search mail"><button class="ibtn" data-refresh title="Refresh">${icon("refresh", 13)}</button></div><div data-threads class="ib-threads"></div></section>
    <section class="ib-view" data-view></section></div>`;
  const $ = (s) => root.querySelector(s);

  const load = async () => {
    const [{ data: th, error }, { data: lb }] = await Promise.all([
      sb.from("inbox_threads").select("*").eq("team_id", T).order("last_at", { ascending: false }).limit(500),
      sb.from("inbox_labels").select("*").eq("team_id", T).order("name"),
    ]);
    if (error) throw error;
    threads = th || []; labels = lb || [];
    drawSide(); drawList();
  };
  const mailboxes = () => [...new Set(threads.map((t) => t.mailbox))].sort();
  const inBox = () => threads.filter((t) => !mailbox || t.mailbox === mailbox);
  const visible = () => inBox().filter((t) => {
    if (folder === "archived" ? t.status !== "archived" : t.status === "archived" && folder !== "sent") return false;
    if (folder === "unread" && !t.unread) return false;
    if (folder === "needs" && !needsReply(t)) return false;
    if (folder === "sent" && !t.last_outbound_at) return false;
    if (labelF && !t.labels.includes(labelF)) return false;
    if (q && !`${t.subject} ${t.contact} ${t.contact_name || ""} ${t.snippet}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const labelChip = (id) => { const l = labels.find((x) => x.id === id); return l ? `<span class="ib-label" style="--c:${l.color}"><i></i>${esc(l.name)}</span>` : ""; };

  function drawSide() {
    $("[data-mbox-name]").textContent = mailbox || (mailboxes().length === 1 ? mailboxes()[0] : "All inboxes");
    const box = inBox();
    const count = { all: box.filter((t) => t.status !== "archived").length, unread: box.filter((t) => t.unread && t.status !== "archived").length, needs: box.filter(needsReply).length, sent: box.filter((t) => t.last_outbound_at).length, archived: box.filter((t) => t.status === "archived").length };
    $("[data-folders]").innerHTML = FOLDERS.map(([k, l, i]) => `<button class="ib-f ${folder === k && !labelF ? "on" : ""}" data-folder="${k}">${icon(i, 14)}<span class="grow">${l}</span>${["all", "unread", "needs"].includes(k) && count[k] ? `<span class="${k === "unread" ? "ib-n" : "dim"}">${num(count[k])}</span>` : ""}</button>`).join("");
    $("[data-labels]").innerHTML = labels.length ? labels.map((l) => `<button class="ib-f ${labelF === l.id ? "on" : ""}" data-label="${l.id}"><i class="ib-dot" style="background:${l.color}"></i><span class="grow ellipsis">${esc(l.name)}</span><span class="dim">${box.filter((t) => t.labels.includes(l.id)).length || ""}</span></button>`).join("") : `<p class="dim" style="font-size:12px;padding:4px 10px">No labels yet</p>`;
  }
  function drawList() {
    const list = visible();
    $("[data-threads]").innerHTML = list.length ? list.map((t) => `<button class="ib-t ${t.id === openId ? "on" : ""} ${t.unread ? "unread" : ""}" data-thread="${t.id}">
        <div class="row-flex"><span class="who ellipsis">${esc(t.contact_name || t.contact)}</span>${t.message_count > 1 ? `<span class="dim">${t.message_count}</span>` : ""}<span class="grow"></span><span class="dim when">${ago(t.last_at)}</span></div>
        <div class="subj ellipsis">${esc(t.subject)}</div><div class="snip ellipsis">${esc(t.snippet)}</div>
        ${t.labels.length || needsReply(t) ? `<div class="row-flex" style="gap:4px;margin-top:6px;flex-wrap:wrap">${t.labels.map(labelChip).join("")}${needsReply(t) && folder !== "needs" ? `<span class="ib-needs">Needs reply</span>` : ""}</div>` : ""}</button>`).join("")
      : `<div class="ib-none">${emptyState({ icon: "inbox", title: q ? "No matching mail" : folder === "needs" ? "All caught up" : "Nothing here", desc: q ? "Try another search." : folder === "needs" ? "Every thread has a reply." : "New mail shows up here as it arrives." })}</div>`;
  }

  async function openThread(id, push = true) {
    openId = id;
    if (push) history.replaceState({}, "", `/inbox/${id}${location.search}`);
    drawList();
    const t = threads.find((x) => x.id === id);
    if (!t) { $("[data-view]").innerHTML = `<div class="ib-none">${emptyState({ icon: "mail", title: "Select a conversation", desc: "Pick a thread on the left to read and reply." })}</div>`; return; }
    $("[data-view]").innerHTML = `<div class="ib-load"><span class="spinner"></span></div>`;
    const { data, error } = await sb.from("emails").select("id,direction,from,to,cc,subject,html,text,headers,attachments,created_at,status").eq("thread_id", id).order("created_at");
    if (error) return errToast(error);
    msgs = data || [];
    if (t.unread) { t.unread = false; sb.from("inbox_threads").update({ unread: false }).eq("id", id).then(() => {}); drawSide(); drawList(); }
    drawThread(t);
  }
  function drawThread(t) {
    const fromOptions = [t.mailbox];
    const last = [...msgs].reverse().find((m) => m.direction === "inbound");
    $("[data-view]").innerHTML = `<div class="ib-head"><div class="grow" style="min-width:0"><h2 class="ellipsis">${esc(t.subject)}</h2><div class="row-flex" style="gap:6px;margin-top:6px;flex-wrap:wrap">${t.labels.map(labelChip).join("")}<span class="dim" style="font-size:12px">${num(msgs.length)} message${msgs.length === 1 ? "" : "s"} · ${esc(t.mailbox)}</span></div></div>
        <button class="ibtn" data-act="label" title="Labels">${icon("tag", 14)}</button><button class="ibtn" data-act="unread" title="Mark as unread">${icon("mail", 14)}</button><button class="ibtn" data-act="archive" title="${t.status === "archived" ? "Move to inbox" : "Archive"}">${icon("archive", 14)}</button><button class="ibtn" data-act="more" title="More">${icon("more", 14)}</button></div>
      <div class="ib-msgs">${msgs.map((m, i) => msgHtml(m, i === msgs.length - 1)).join("")}</div>
      <div class="ib-reply"><div class="row-flex dim" style="font-size:12px;gap:6px">${icon("reply", 12)} Reply to ${esc(t.contact_name || t.contact)} <span class="grow"></span>from <span class="mono" style="color:var(--fg-2)">${esc(fromOptions[0])}</span></div>
        <textarea class="textarea" data-reply rows="4" placeholder="Write a reply…"></textarea>
        <div class="row-flex"><span class="dim" style="font-size:12px">Replies keep Message-ID threading, so they land in the same conversation.</span><span class="grow"></span><span class="kbd dim">⌘ Enter</span><button class="btn btn-primary btn-sm" data-send disabled>${icon("send", 12)} Send</button></div></div>`;
    const ta = $("[data-reply]"), send = $("[data-send]");
    ta.addEventListener("input", () => { send.disabled = !ta.value.trim(); });
    ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !send.disabled) send.click(); });
    send.onclick = () => reply(t, last, ta, send);
    root.querySelectorAll("iframe[data-body]").forEach((f) => { f.addEventListener("load", () => { try { f.style.height = Math.min(900, f.contentDocument.body.scrollHeight + 24) + "px"; } catch {} }); });
  }
  function msgHtml(m, open) {
    const out = m.direction !== "inbound";
    const name = out ? "You" : (m.from.replace(/<.*>/, "").replace(/"/g, "").trim() || m.from);
    const atts = (m.attachments || []).filter((a) => a.filename);
    const body = m.html ? `<iframe sandbox="allow-popups" data-body srcdoc="${esc(`<base target="_blank"><style>body{margin:0;font:14px/1.6 -apple-system,Segoe UI,sans-serif;color:#211f20;background:#fff;padding:14px;word-wrap:break-word}img{max-width:100%}</style>${m.html}`)}"></iframe>` : `<div class="ib-text">${esc(m.text || "(no content)")}</div>`;
    return `<article class="ib-m ${out ? "out" : ""}"><div class="row-flex"><span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(name))}</span><div class="grow" style="min-width:0"><b>${esc(name)}</b> <span class="dim" style="font-size:12px">${esc(out ? `to ${(m.to || []).join(", ")}` : m.from.match(/<(.+)>/)?.[1] || "")}</span></div><span class="dim" style="font-size:12px" title="${esc(fmtDateTime(m.created_at))}">${ago(m.created_at)}</span>${out ? `<span class="badge ${m.status === "delivered" || m.status === "opened" || m.status === "clicked" ? "green" : m.status === "bounced" || m.status === "failed" ? "red" : "gray"}" style="margin-left:6px">${esc(m.status)}</span>` : ""}</div>
      <div class="ib-body">${m.html == null && m.text == null && !out ? `<div class="ib-text dim">Content removed after your plan’s retention window.</div>` : body}</div>
      ${atts.length ? `<div class="ib-atts">${atts.map((a) => `<span class="ib-att" title="${esc(a.content_type || "")}">${icon("paperclip", 12)}<span class="ellipsis">${esc(a.filename)}</span><span class="dim">${a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ""}</span></span>`).join("")}</div>` : ""}</article>`;
  }

  async function reply(t, last, ta, btn) {
    const text = ta.value.trim(); if (!text) return;
    const mid = last?.headers?.["message-id"];
    const refs = [last?.headers?.references, mid].filter(Boolean).join(" ").trim();
    const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif">${esc(text).replace(/\n/g, "<br>")}</div>`;
      await api("POST", "/emails", { from: t.mailbox, to: [t.contact], subject, text, html, headers: mid ? { "In-Reply-To": mid, References: refs } : {}, tags: [{ name: "source", value: "inbox" }] });
      toast("Reply sent · threaded with Message-ID");
      await load(); await openThread(t.id, false);
    } catch (e) { errToast(e); btn.disabled = false; btn.innerHTML = `${icon("send", 12)} Send`; }
  }

  const updateThread = async (t, patch, msg) => { const { error } = await sb.from("inbox_threads").update(patch).eq("id", t.id); if (error) return errToast(error); Object.assign(t, patch); drawSide(); drawList(); if (openId === t.id) drawThread(t); if (msg) toast(msg); };
  const labelMenu = (anchor, t) => menu(anchor, [
    { header: "Labels" },
    ...labels.map((l) => ({ html: `<span class="row-flex"><i class="ib-dot" style="background:${l.color}"></i>${esc(l.name)}</span>`, checked: t.labels.includes(l.id), onClick: () => updateThread(t, { labels: t.labels.includes(l.id) ? t.labels.filter((x) => x !== l.id) : [...t.labels, l.id] }) })),
    { sep: true }, { label: "New label", icon: "plus", onClick: () => newLabel(t) },
  ], { align: "right", width: 220 });
  const newLabel = (t) => formModal({ title: "New label", fields: [{ name: "name", label: "Name", placeholder: "Refunds" }], submit: "Create label", validate: (v) => v.name && v.name.length <= 40,
    async onSubmit(v) {
      const { data, error } = await sb.from("inbox_labels").insert({ team_id: T, name: v.name, color: COLORS[labels.length % COLORS.length] }).select().single();
      if (error) throw new Error(/duplicate/.test(error.message) ? "That label already exists" : error.message);
      labels.push(data); labels.sort((a, b) => a.name.localeCompare(b.name));
      if (t) await updateThread(t, { labels: [...t.labels, data.id] }); else drawSide();
      toast(`Label “${v.name}” created`);
    } });
  const forward = (t) => {
    const m = [...msgs].reverse().find((x) => x.direction === "inbound") || msgs[msgs.length - 1];
    formModal({ title: "Forward email", fields: [{ name: "to", label: "To", placeholder: "ops@yourcompany.com", type: "email" }, { name: "note", label: "Note", type: "textarea", placeholder: "Optional" }], desc: "Sends the latest message as a new email from this inbox. Attachments aren’t included.", submit: "Forward", validate: (v) => EMAIL_RE.test(v.to),
      async onSubmit(v) {
        const quoted = `<p>${esc(v.note || "").replace(/\n/g, "<br>")}</p><hr><p style="color:#666;font-size:13px">Forwarded message<br>From: ${esc(m.from)}<br>Subject: ${esc(m.subject)}<br>Date: ${esc(new Date(m.created_at).toUTCString())}</p>${m.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(m.text || "")}</pre>`}`;
        await api("POST", "/emails", { from: t.mailbox, to: [v.to], subject: `Fwd: ${m.subject}`, html: quoted, attachments: (m.attachments || []).filter((a) => a.content).map((a) => ({ filename: a.filename, content: a.content, content_type: a.content_type })) });
        toast(`Forwarded to ${v.to}`);
      } });
  };

  on(root, "click", "[data-folder]", (_e, b) => { folder = b.dataset.folder; labelF = null; drawSide(); drawList(); });
  on(root, "click", "[data-label]", (_e, b) => { labelF = labelF === b.dataset.label ? null : b.dataset.label; folder = "all"; drawSide(); drawList(); });
  on(root, "click", "[data-thread]", (_e, b) => openThread(b.dataset.thread));
  on(root, "click", "[data-new-label]", () => newLabel(null));
  on(root, "click", "[data-refresh]", async () => { await load(); if (openId) openThread(openId, false); });
  on(root, "click", "[data-mbox]", (_e, b) => menu(b, [{ label: "All inboxes", checked: !mailbox, onClick: () => { mailbox = null; pref.mailbox = null; save(); drawSide(); drawList(); } }, ...mailboxes().map((m) => ({ label: m, icon: "inbox", checked: mailbox === m, onClick: () => { mailbox = m; pref.mailbox = m; save(); drawSide(); drawList(); } })), { sep: true }, { label: "Receiving settings", icon: "gear", onClick: () => ctx.navigate("/domains") }], { width: 260 }));
  on(root, "click", "[data-act]", (_e, b) => {
    const t = threads.find((x) => x.id === openId); if (!t) return;
    const a = b.dataset.act;
    if (a === "label") labelMenu(b, t);
    if (a === "unread") updateThread(t, { unread: true }, "Marked as unread");
    if (a === "archive") updateThread(t, { status: t.status === "archived" ? "open" : "archived" }, t.status === "archived" ? "Moved to inbox" : "Archived");
    if (a === "more") menu(b, [{ label: "Forward", icon: "send", onClick: () => forward(t) }, { label: "Copy thread link", icon: "link", onClick: () => navigator.clipboard.writeText(location.origin + "/inbox/" + t.id).then(() => toast("Link copied")) }, { sep: true }, { label: "Delete thread", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete thread", desc: "The conversation is removed from the Inbox. The emails stay in your logs.", confirm: "Delete" }))) return; const { error } = await sb.from("inbox_threads").delete().eq("id", t.id); if (error) return errToast(error); threads = threads.filter((x) => x.id !== t.id); openId = null; history.replaceState({}, "", "/inbox"); drawSide(); drawList(); openThread(null, false); toast("Thread deleted"); } }], { align: "right" });
  });
  $("[data-q]").addEventListener("input", debounce(() => { q = $("[data-q]").value.trim().toLowerCase(); drawList(); }, 120));
  const save = () => { try { localStorage.setItem("dlv_inbox", JSON.stringify(pref)); } catch {} };
  if (pref.mailbox) mailbox = pref.mailbox;

  await load();
  if (mailbox && !mailboxes().includes(mailbox)) { mailbox = null; drawSide(); drawList(); }
  await openThread(openId || visible()[0]?.id || null, false);
  // keep the list fresh while the page is open
  const iv = setInterval(async () => { if (!document.body.contains(root.querySelector(".inbox"))) return clearInterval(iv); if (document.hidden) return; const before = threads[0]?.last_at; await load().catch(() => {}); if (threads[0]?.last_at !== before && threads[0]?.id === openId) openThread(openId, false); }, 30000);
}

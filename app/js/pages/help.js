import { sb, state, api, API_BASE } from "../lib/sb.js";
import { esc, icon, toast, errToast, selectHtml, bindSelects, codeBlock, on, debounce } from "../lib/ui.js";
import { MARK } from "../lib/icons.js";
import { DOCS, searchDocs } from "../lib/docs.js";

// Render plain-text doc bodies: paragraphs, numbered lines, inline code for paths/fields.
function docHtml(body) {
  return body.split(/\n\n+/).map((para) => {
    const lines = para.split("\n");
    if (lines.length > 1 && lines.every((l) => /^\s*(\d+\.|-)\s/.test(l))) return `<ol style="padding-left:20px;margin:0 0 12px;line-height:1.7">${lines.map((l) => `<li>${inline(l.replace(/^\s*(\d+\.|-)\s/, ""))}</li>`).join("")}</ol>`;
    return `<p style="margin:0 0 12px;line-height:1.7">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}
function inline(s) {
  return esc(s).replace(/\b((?:GET|POST|PATCH|PUT|DELETE) \/[\w/:.{}-]*)/g, '<code class="mono" style="color:var(--fg)">$1</code>').replace(/(\{\{\{?[\w|" ]+\}\}\}?|\bdlv_\w*|\bwhsec_\w*|\b[a-z]+_[a-z_]+\b)/g, '<code class="mono" style="color:var(--fg);font-size:12px">$1</code>');
}

export async function help(ctx) {
  ctx.crumb("help", "Help");
  const root = ctx.root;
  root.innerHTML = `<div class="page narrow"><div class="page-head"><h1>Help</h1><div class="actions"><span class="pill" data-status><span class="dot" style="background:var(--fg-3)"></span>Checking status…</span></div></div>
    <div class="card"><div style="padding:16px 18px;border-bottom:1px solid var(--border)" class="row-flex"><span class="avatar sq yellow" style="width:26px;height:26px">${icon("sparkle", 14)}</span><div><div style="font-weight:500">Ask Delivrie</div><div class="dim" style="font-size:12px" data-mode>Answers from the docs</div></div></div>
      <div class="chat" data-chat style="padding:18px;max-height:420px;overflow-y:auto"><div class="msg-bot"><span class="bot">${icon("sparkle", 12)}</span><div>Hi! Ask me anything about sending email, domains, webhooks or the API.<div class="chip-row" style="margin-top:10px">${["Why isn’t my domain verifying?", "How do I verify webhook signatures?", "How do I send with a template?", "What does a bounce mean?"].map((q) => `<button class="pill" data-suggest>${esc(q)}</button>`).join("")}</div></div></div></div>
      <form data-ask class="row-flex" style="padding:12px 14px;border-top:1px solid var(--border)"><input class="input" data-q placeholder="Ask a question…" autocomplete="off"><button class="btn btn-primary" type="submit">${icon("send", 13)}</button></form></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px">
      <a class="card card-pad" href="/docs"><div class="row-flex">${icon("book", 15)}<b style="font-weight:500">Documentation</b></div><p class="muted" style="font-size:12.5px;margin-top:6px">Guides and the API reference.</p></a>
      <a class="card card-pad" href="/docs#deliverability"><div class="row-flex">${icon("shield", 15)}<b style="font-weight:500">Deliverability</b></div><p class="muted" style="font-size:12.5px;margin-top:6px">Stay out of spam folders.</p></a>
      <a class="card card-pad" href="/logs"><div class="row-flex">${icon("list", 15)}<b style="font-weight:500">Logs</b></div><p class="muted" style="font-size:12.5px;margin-top:6px">Debug API requests.</p></a></div>
    <h3 class="section-title" id="contact">Contact support</h3>
    <form class="card card-pad" data-support style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label>Subject</label><input class="input" name="subject" value="${esc(ctx.query.subject || "")}" placeholder="Emails to Outlook are delayed"></div>
      <div class="field"><label>Impact</label>${selectHtml("impact", [{ value: "low", label: "Low — a question or minor issue" }, { value: "normal", label: "Normal — something isn’t working" }, { value: "high", label: "High — production sending is affected" }, { value: "urgent", label: "Urgent — all sending is down" }], "normal")}</div>
      <div class="field"><label>Message</label><textarea class="textarea" name="message" rows="6" placeholder="What happened, what you expected, and any email or request IDs."></textarea></div>
      <div class="row-flex"><span class="hint grow">We reply to ${esc(state.user.email)} within one business day.</span><button class="btn btn-primary" type="submit">Send</button></div></form></div>`;
  bindSelects(root);
  fetch(`${API_BASE}/public/status`).then((r) => r.json()).then((s) => { root.querySelector("[data-status]").innerHTML = `<span class="dot" style="background:${s.sending ? "var(--green-2)" : "var(--orange)"}"></span>${s.sending ? "All systems operational" : "Sending not configured"}`; }).catch(() => { root.querySelector("[data-status]").innerHTML = `<span class="dot" style="background:var(--orange)"></span>Status unavailable`; });
  const chat = root.querySelector("[data-chat]");
  const ask = async (q) => {
    if (!q) return;
    chat.insertAdjacentHTML("beforeend", `<div class="msg-me">${esc(q)}</div><div class="msg-bot" data-pending><span class="bot">${icon("sparkle", 12)}</span><div><span class="spinner" style="width:12px;height:12px"></span></div></div>`);
    chat.scrollTop = chat.scrollHeight;
    const pend = chat.querySelector("[data-pending]");
    try {
      const r = await api("POST", "/dashboard/ask", { question: q });
      root.querySelector("[data-mode]").textContent = r.mode === "ai" ? "AI answers grounded in the docs" : "Answers from the docs";
      pend.removeAttribute("data-pending");
      pend.lastElementChild.innerHTML = `${docHtml(r.answer)}${r.sources?.length ? `<div class="sources">${icon("book", 11)} ${r.sources.map((s) => `<a class="pill" href="/docs#${esc(s.id)}">${esc(s.title)}</a>`).join("")}</div>` : ""}`;
    } catch (e) { pend.removeAttribute("data-pending"); pend.lastElementChild.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
    chat.scrollTop = chat.scrollHeight;
  };
  root.querySelector("[data-ask]").addEventListener("submit", (e) => { e.preventDefault(); const i = root.querySelector("[data-q]"); const q = i.value.trim(); i.value = ""; ask(q); });
  on(root, "click", "[data-suggest]", (_e, b) => ask(b.textContent));
  root.querySelector("[data-support]").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const subject = f.subject.value.trim(), message = f.message.value.trim();
    if (!subject || message.length < 10) return toast("Add a subject and a few words about the problem", "err");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { error } = await sb.from("support_requests").insert({ team_id: state.team.id, user_id: state.user.id, subject, message, impact: f.querySelector("input[name=impact]").value });
    btn.disabled = false;
    if (error) return errToast(error);
    f.reset(); toast("Thanks — we’ve got your request and will reply by email");
  });
  if (ctx.query.contact) setTimeout(() => root.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" }), 50);
}

const REF = [
  ["Emails", [["POST", "/emails", "Send an email"], ["POST", "/emails/batch", "Send up to 100 emails"], ["GET", "/emails/:id", "Retrieve an email"], ["GET", "/emails", "List emails"], ["PATCH", "/emails/:id", "Reschedule"], ["POST", "/emails/:id/cancel", "Cancel a scheduled email"]]],
  ["Domains", [["POST", "/domains", "Add a domain"], ["GET", "/domains", "List domains"], ["GET", "/domains/:id", "Retrieve a domain"], ["POST", "/domains/:id/verify", "Verify DNS"], ["PATCH", "/domains/:id", "Update tracking, TLS, receiving"], ["DELETE", "/domains/:id", "Delete a domain"]]],
  ["API keys", [["POST", "/api-keys", "Create a key"], ["GET", "/api-keys", "List keys"], ["DELETE", "/api-keys/:id", "Delete a key"]]],
  ["Contacts", [["POST", "/contacts", "Create or update a contact"], ["GET", "/contacts", "List contacts"], ["GET", "/contacts/:id", "Retrieve by ID or email"], ["PATCH", "/contacts/:id", "Update a contact"], ["DELETE", "/contacts/:id", "Delete a contact"]]],
  ["Segments", [["POST", "/segments", "Create a segment"], ["GET", "/segments", "List segments"], ["POST", "/segments/:id/contacts", "Add contacts"], ["DELETE", "/segments/:id", "Delete a segment"]]],
  ["Broadcasts", [["POST", "/broadcasts", "Create a broadcast"], ["GET", "/broadcasts", "List broadcasts"], ["GET", "/broadcasts/:id", "Retrieve with stats"], ["POST", "/broadcasts/:id/send", "Send or schedule"], ["POST", "/broadcasts/:id/cancel", "Cancel a schedule"], ["DELETE", "/broadcasts/:id", "Delete"]]],
  ["Templates", [["POST", "/templates", "Create a template"], ["GET", "/templates", "List templates"], ["GET", "/templates/:id", "Retrieve by ID or alias"], ["POST", "/templates/:id/publish", "Publish a version"]]],
  ["Webhooks", [["POST", "/webhooks", "Create a webhook"], ["GET", "/webhooks", "List webhooks"], ["GET", "/webhooks/:id/events", "List deliveries"], ["POST", "/webhooks/:id/test", "Send a test event"]]],
  ["Suppressions", [["GET", "/suppressions", "List"], ["POST", "/suppressions", "Add"], ["DELETE", "/suppressions/:email", "Remove"]]],
];
const MC = { GET: "#4c8df6", POST: "#4cb782", PATCH: "#e2b400", DELETE: "#e5484d" };

export async function docs(ctx) {
  document.title = "Docs · Delivrie";
  const root = ctx.root;
  const base = `${location.origin}/api`;
  root.innerHTML = `<div style="min-height:100vh;background:var(--bg-2)"><header class="auth-head" style="position:sticky;top:0;background:rgba(14,15,17,.85);backdrop-filter:blur(10px);z-index:5;gap:16px"><a href="/" class="row-flex" data-native><img src="/assets/logo.svg" width="118" height="22" alt="Delivrie"></a><span class="dim">Docs</span><span class="grow"></span><div class="input-wrap" style="width:260px"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search docs"></div><a class="btn btn-secondary btn-sm" href="${state.user ? "/emails" : "/login"}">${state.user ? "Dashboard" : "Log in"}</a></header>
    <div style="display:grid;grid-template-columns:220px minmax(0,1fr);max-width:1100px;margin:0 auto;gap:40px;padding:32px 24px 80px" class="docs-grid">
      <nav style="position:sticky;top:96px;align-self:start;display:flex;flex-direction:column;gap:1px" data-nav>${DOCS.map((d) => `<a class="nav-item" href="#${d.id}" data-id="${d.id}">${esc(d.title)}</a>`).join("")}<a class="nav-item" href="#api-reference">API reference</a></nav>
      <main data-main style="min-width:0">${DOCS.map((d) => `<section id="${d.id}" style="scroll-margin-top:90px;padding-bottom:28px;margin-bottom:28px;border-bottom:1px solid var(--border)"><h2 style="font-size:20px;font-weight:600;margin-bottom:12px">${esc(d.title)}</h2><div class="muted" style="font-size:14px">${docHtml(d.body)}</div>${d.id === "send-email" ? codeBlock(`curl -X POST ${base}/emails \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "from": "Acme <onboarding@acme.com>",\n    "to": ["success@simulator.amazonses.com"],\n    "subject": "Hello world",\n    "html": "<strong>It works!</strong>"\n  }'`, { lang: "sh" }) : ""}</section>`).join("")}
        <section id="api-reference" style="scroll-margin-top:90px"><h2 style="font-size:20px;font-weight:600;margin-bottom:6px">API reference</h2><p class="muted" style="margin-bottom:16px">Base URL <code class="mono" style="color:var(--fg)">${esc(base)}</code> · Authenticate with <code class="mono" style="color:var(--fg)">Authorization: Bearer dlv_…</code> · JSON in, JSON out.</p>
          ${REF.map(([g, rows]) => `<h3 class="section-title">${g}</h3><div class="table-wrap"><table class="t"><tbody>${rows.map(([m, p, d]) => `<tr><td style="width:80px"><span class="mono" style="color:${MC[m]};font-size:12px;font-weight:500">${m}</span></td><td class="mono" style="font-size:12.5px">${esc(p)}</td><td class="muted">${esc(d)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
          <h3 class="section-title">MCP server</h3><p class="muted">Connect AI agents to <code class="mono" style="color:var(--fg)">${esc(base)}/mcp</code> with the same bearer token. It exposes tools for sending email, domains, contacts, broadcasts, templates and logs.</p></section></main></div></div>
    <style>@media (max-width: 800px){ .docs-grid{grid-template-columns:1fr !important} .docs-grid nav{display:none !important} }</style>`;
  const q = root.querySelector("[data-q]");
  q.addEventListener("input", debounce(() => {
    const term = q.value.trim();
    const hits = term ? new Set(searchDocs(term, 20).map((d) => d.id)) : null;
    root.querySelectorAll("[data-main] > section").forEach((s) => { s.style.display = !hits || hits.has(s.id) || (s.id === "api-reference" && /api|endpoint|reference/i.test(term)) ? "" : "none"; });
    root.querySelectorAll("[data-nav] [data-id]").forEach((a) => a.style.opacity = !hits || hits.has(a.dataset.id) ? 1 : 0.35);
  }, 150));
  const hash = location.hash.slice(1);
  if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 30);
  const nav = root.querySelectorAll("[data-nav] [data-id]");
  const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) nav.forEach((a) => a.classList.toggle("on", a.dataset.id === en.target.id)); }), { rootMargin: "-90px 0px -70% 0px" });
  root.querySelectorAll("[data-main] > section").forEach((s) => io.observe(s));
}

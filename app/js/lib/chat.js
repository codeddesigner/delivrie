// Support chat for signed-in customers: a button in the bottom-right corner of the dashboard.
// Messages go to the Delivrie team (Admin → Support). Polls every 6s while open, every minute while closed.
import { api, state } from "./sb.js";
import { esc, icon, errToast } from "./ui.js";

const CHAT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9l-5 4z"/></svg>';
let mounted = false, open = false, msgs = [], pollT = null, sending = false, lastCount = -1;

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" }); };
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

export function mountChat() {
  if (mounted || !state.user) return;
  mounted = true;
  const wrap = document.createElement("div");
  wrap.className = "sc";
  wrap.innerHTML = `<button class="sc-fab" aria-label="Chat with support" aria-expanded="false">${CHAT_ICON}<span class="sc-dot" hidden></span></button>
    <section class="sc-panel" role="dialog" aria-label="Support chat" hidden>
      <header class="sc-head"><div><b>Delivrie support</b><span>We usually reply within a few hours, Monday to Friday (WAT).</span></div><button class="ibtn" data-close aria-label="Close">${icon("x", 14)}</button></header>
      <div class="sc-body" aria-live="polite"></div>
      <form class="sc-form"><textarea rows="1" maxlength="5000" placeholder="Write a message…" aria-label="Message"></textarea><button class="btn btn-primary" type="submit" aria-label="Send">${icon("send", 14)}</button></form>
    </section>`;
  document.body.appendChild(wrap);
  // The dashboard is a single-page app; hide the button on admin pages, where the team answers instead.
  const place = () => { wrap.hidden = location.pathname.startsWith("/admin"); };
  place(); setInterval(place, 800);
  const fab = wrap.querySelector(".sc-fab"), panel = wrap.querySelector(".sc-panel"), body = wrap.querySelector(".sc-body"), form = wrap.querySelector(".sc-form"), ta = form.querySelector("textarea"), dot = wrap.querySelector(".sc-dot");

  const draw = () => {
    if (!msgs.length) { body.innerHTML = `<div class="sc-empty"><div class="sc-av">${CHAT_ICON}</div><b>Hi${state.profile?.full_name ? ` ${esc(state.profile.full_name.split(" ")[0])}` : ""}, how can we help?</b><span>Ask about sending, domains, billing or anything else. We'll reply here and by email.</span></div>`; return; }
    let lastDay = "";
    body.innerHTML = msgs.map((m) => {
      const d = day(m.created_at), sep = d !== lastDay ? `<div class="sc-day">${d}</div>` : ""; lastDay = d;
      return `${sep}<div class="sc-m ${m.author === "customer" ? "me" : "them"}">${m.author === "support" ? `<div class="sc-who">${esc(m.author_name || "Delivrie support")}</div>` : ""}<div class="sc-b">${linkify(m.body)}</div><div class="sc-t">${time(m.created_at)}${m.pending ? " · Sending…" : ""}</div></div>`;
    }).join("");
    body.scrollTop = body.scrollHeight;
  };
  const load = async () => {
    try {
      const r = await api("GET", "/support/chat");
      const pending = msgs.filter((m) => m.pending);
      msgs = [...(r.messages || []), ...pending];
      if (msgs.length !== lastCount) { lastCount = msgs.length; draw(); }
      dot.hidden = true;
    } catch { /* offline: try again on the next tick */ }
  };
  const checkUnread = async () => { try { const r = await api("GET", "/support/chat/unread"); dot.hidden = !r.unread; } catch { /* ignore */ } };
  const schedule = () => { clearTimeout(pollT); pollT = setTimeout(async () => { if (document.visibilityState === "visible") await (open ? load() : checkUnread()); schedule(); }, open ? 6000 : 60000); };
  const setOpen = async (v) => {
    open = v; panel.hidden = !v; fab.setAttribute("aria-expanded", String(v)); wrap.classList.toggle("on", v);
    if (v) { lastCount = -1; draw(); await load(); ta.focus(); }
    schedule();
  };

  fab.addEventListener("click", () => setOpen(!open));
  wrap.querySelector("[data-close]").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) setOpen(false); });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text || sending) return;
    sending = true; ta.value = ""; ta.style.height = "auto";
    const temp = { id: "tmp" + Date.now(), author: "customer", body: text, created_at: new Date().toISOString(), pending: true };
    msgs.push(temp); lastCount = -1; draw();
    try { await api("POST", "/support/chat", { body: text }); msgs = msgs.filter((m) => m !== temp); await load(); }
    catch (err) { msgs = msgs.filter((m) => m !== temp); ta.value = text; lastCount = -1; draw(); errToast(err); }
    sending = false;
  });

  if (new URLSearchParams(location.search).get("support") === "1") setOpen(true); else { checkUnread(); schedule(); }
}

// Lets other pages (Help, error states) open the chat.
export function openChat() { if (!mounted) mountChat(); const fab = document.querySelector(".sc-fab"); if (fab && fab.getAttribute("aria-expanded") !== "true") fab.click(); }

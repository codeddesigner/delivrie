import { API_BASE } from "../lib/sb.js";
import { esc, icon, fmtDateTime } from "../lib/ui.js";
import { MARK } from "../lib/icons.js";
import { PAGE_DEFAULT, unsubPreview } from "./settings.js";

async function getJson(path, opts) {
  const r = await fetch(API_BASE + path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Something went wrong");
  return j;
}
const shell = (inner) => `<div style="min-height:100vh;background:#f5f5f5;color:#111;display:grid;place-items:center;padding:24px;font-family:-apple-system,Segoe UI,Inter,sans-serif"><div style="max-width:440px;width:100%;background:#fff;border-radius:14px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center">${inner}</div></div>`;

export async function unsubscribe(ctx) {
  document.title = "Email preferences";
  const root = ctx.root;
  const t = ctx.query.t || "";
  root.innerHTML = shell(`<span class="spinner" style="color:#999"></span>`);
  let d;
  try { d = await getJson(`/public/unsubscribe?t=${encodeURIComponent(t)}`); }
  catch (e) { root.innerHTML = shell(`<h2 style="margin:0 0 8px;font-size:19px">Link not valid</h2><p style="color:#666;margin:0">${esc(e.message)}. If you keep getting emails you don’t want, reply to one and ask to be removed.</p>`); return; }
  const p = { ...PAGE_DEFAULT, ...(d.team.page || {}) };
  document.title = `${d.team.name} · Email preferences`;
  root.innerHTML = `<div style="min-height:100vh;background:${esc(p.background)}">${unsubPreview(d.team, p, d.topics || [], d.email)}</div>`;
  const box = root.firstElementChild;
  box.querySelectorAll("[data-topic]").forEach((cb) => { const tp = d.topics.find((x) => x.id === cb.dataset.topic); cb.checked = !d.unsubscribed && tp?.subscription === "opt_in"; });
  const all = box.querySelector("[data-all]"); all.checked = d.unsubscribed;
  all.addEventListener("change", () => box.querySelectorAll("[data-topic]").forEach((cb) => { if (all.checked) cb.checked = false; }));
  box.querySelectorAll("[data-topic]").forEach((cb) => cb.addEventListener("change", () => { if (cb.checked) all.checked = false; }));
  const btn = box.querySelector("[data-save]");
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const body = all.checked ? { all: true } : { topics: Object.fromEntries([...box.querySelectorAll("[data-topic]")].map((cb) => [cb.dataset.topic, cb.checked ? "opt_in" : "opt_out"])), resubscribe: true };
      await getJson(`/public/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      btn.textContent = all.checked ? p.confirm : "Preferences saved";
      btn.style.background = "#3fa672";
      setTimeout(() => { btn.disabled = false; btn.textContent = "Save preferences"; btn.style.background = p.button; }, 2600);
    } catch (e) { btn.disabled = false; btn.textContent = "Try again"; alert(e.message); }
  });
}

export async function share(ctx) {
  document.title = "Shared email · Delivrie";
  const root = ctx.root;
  root.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center"><span class="spinner" style="color:#62666d"></span></div>`;
  let d;
  try { d = await getJson(`/public/share/${encodeURIComponent(ctx.params.token)}`); }
  catch (e) { root.innerHTML = `<div class="auth"><div class="auth-body"><div class="auth-card"><div class="mark">${MARK}</div><h1>Link expired</h1><p class="sub">${esc(e.message)}. Ask whoever shared it for a new link.</p></div></div></div>`; return; }
  const e = d.email;
  root.innerHTML = `<div style="min-height:100vh;background:var(--bg-2)"><header class="auth-head" style="gap:12px"><a href="/" class="row-flex" data-native><img src="/assets/logo.svg" width="122" height="22" alt="Delivrie"></a><span class="dim">Shared email</span><span class="grow"></span><span class="dim" style="font-size:12px">Link expires ${esc(fmtDateTime(d.expires_at))}</span></header>
    <div class="page" style="max-width:900px;margin:0 auto"><h1 style="font-size:20px;font-weight:600">${esc(e.subject)}</h1>
      <div class="facts" style="grid-template-columns:repeat(3,1fr);margin-top:14px"><div><div class="k">From</div><div class="v ellipsis">${esc(e.from)}</div></div><div><div class="k">To</div><div class="v ellipsis">${esc((e.to || []).join(", "))}</div></div><div><div class="k">Sent</div><div class="v">${esc(fmtDateTime(e.created_at))}</div></div></div>
      <h3 class="section-title">Events</h3><div class="card card-pad"><div class="vtl">${(d.events || []).map((ev) => `<div class="vtl-item"><span class="dot" style="width:8px;height:8px;margin-left:5px;background:var(--fg-3)"></span><span style="text-transform:capitalize">${esc(ev.type.replace(/_/g, " "))}</span><span class="t">${esc(fmtDateTime(ev.created_at, true))}</span></div>`).join("") || '<span class="dim">No events</span>'}</div></div>
      <h3 class="section-title">Preview</h3><div class="card" style="overflow:hidden"><iframe class="preview-frame" sandbox style="height:640px;border-radius:0"></iframe></div></div></div>`;
  root.querySelector("iframe").srcdoc = e.html || `<pre style="font:14px/1.6 -apple-system,sans-serif;white-space:pre-wrap;padding:20px">${esc(e.text || "")}</pre>`;
}

import { icon, statusIcon } from "./icons.js";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); });
}

// ---------------- formatting ----------------
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function ago(d) {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 0) return "in " + until(d);
  if (s < 45) return "just now";
  if (s < 90) return "1 minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 5400) return "1 hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 172800) return "Yesterday";
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return fmtDate(d);
}
function until(d) { const s = (new Date(d).getTime() - Date.now()) / 1000; if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`; if (s < 86400) return `${Math.round(s / 3600)} hours`; return `${Math.round(s / 86400)} days`; }
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(d).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }) : "—";
export const fmtDateTime = (d, secs) => d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(secs ? { second: "2-digit" } : {}) }) : "—";
export const num = (n) => Number(n || 0).toLocaleString();
export const pct = (n, d = 1) => `${(Number(n || 0) * 100).toFixed(d)}%`;
export function initials(s) { const p = String(s || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean); return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase(); }
export const plural = (n, w, pw) => `${num(n)} ${n === 1 ? w : (pw || w + "s")}`;

const STATUS = {
  delivered: ["Delivered", "green"], opened: ["Opened", "yellow"], clicked: ["Clicked", "yellow"], bounced: ["Bounced", "red"], complained: ["Complained", "gray"],
  sent: ["Sent", "gray"], queued: ["Queued", "gray"], scheduled: ["Scheduled", "blue"], delivery_delayed: ["Delayed", "orange"], failed: ["Failed", "red"],
  canceled: ["Canceled", "gray"], suppressed: ["Suppressed", "gray"], received: ["Received", "green"],
};
export function statusCell(s) { const [label] = STATUS[s] || [s]; return `<span class="cell">${statusIcon(s)}<span>${esc(label)}</span></span>`; }
export function badge(text, color = "gray") { return `<span class="badge ${color}">${esc(text)}</span>`; }
export function statusBadge(s) { const map = { verified: ["Verified", "green"], pending: ["Pending", "yellow"], not_started: ["Not started", "gray"], failed: ["Failed", "red"], temporary_failure: ["Temporary failure", "orange"], published: ["Published", "green"], draft: ["Draft", "gray"], scheduled: ["Scheduled", "blue"], sending: ["Sending", "yellow"], sent: ["Sent", "green"], canceled: ["Canceled", "gray"], enabled: ["Enabled", "green"], disabled: ["Disabled", "gray"], subscribed: ["Subscribed", "green"], unsubscribed: ["Unsubscribed", "gray"], optional: ["Optional", "gray"] }; const [t, c] = map[s] || [s, "gray"]; return badge(t, c); }
export const TAG_COLORS = ["#a774f2", "#e2b400", "#3fa672", "#4c8df6", "#f2994a", "#e5484d", "#8a8f98"];
export function hashColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TAG_COLORS[h % TAG_COLORS.length]; }
export function pill(text, color) { return `<span class="pill"><span class="dot" style="background:${color || hashColor(text)}"></span>${esc(text)}</span>`; }

// ---------------- toasts ----------------
let toastHost;
export function toast(msg, kind = "ok", ms = 3200) {
  toastHost ||= document.body.appendChild(el('<div class="toasts"></div>'));
  const ic = kind === "ok" ? "check-circle" : kind === "err" ? "alert" : "info";
  const t = el(`<div class="toast ${kind}">${icon(ic, 15)}<span>${esc(msg)}</span></div>`);
  toastHost.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .2s, transform .2s"; t.style.opacity = "0"; t.style.transform = "translateY(4px)"; setTimeout(() => t.remove(), 200); }, ms);
}
export function errToast(e) { console.error(e); toast(e?.message || String(e), "err", 5000); }

// ---------------- modal ----------------
export function modal({ title, body = "", foot = "", size = "", onMount, dismissable = true }) {
  return new Promise((resolve) => {
    const ov = el(`<div class="overlay"><div class="modal ${size}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-head"><h3>${title}</h3><button class="ibtn" data-x aria-label="Close">${icon("x", 15)}</button></div>` : ""}
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div></div>`);
    const m = ov.querySelector(".modal");
    const close = (v) => { document.removeEventListener("keydown", onKey); ov.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape" && dismissable) close(null); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov && dismissable) close(null); });
    ov.querySelector("[data-x]")?.addEventListener("click", () => close(null));
    on(m, "click", "[data-cancel]", () => close(null));
    document.body.appendChild(ov);
    const first = m.querySelector("input:not([type=hidden]):not([type=checkbox]),textarea");
    if (first) setTimeout(() => first.focus(), 30);
    onMount?.(m, close);
  });
}

/** Simple form modal. fields: [{name,label,type,placeholder,value,hint,options}] */
export function formModal({ title, desc, fields, submit = "Save", danger = false, validate, onSubmit, size }) {
  const body = (desc ? `<p class="desc">${desc}</p>` : "") + fields.map((f) => fieldHtml(f)).join("");
  return modal({
    title, size, body,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-submit>${submit}</button>`,
    onMount(m, close) {
      const btn = m.querySelector("[data-submit]");
      const read = () => Object.fromEntries(fields.map((f) => { const i = m.querySelector(`[name="${f.name}"]`); return [f.name, f.type === "checkbox" || f.type === "toggle" ? i.checked : i?.value?.trim?.() ?? i?.value]; }));
      const check = () => { if (validate) btn.disabled = !validate(read()); };
      m.addEventListener("input", check); check();
      const go = async () => {
        if (btn.disabled) return;
        btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span>`;
        try { const r = await onSubmit(read(), m); close(r ?? true); } catch (e) { errToast(e); btn.disabled = false; btn.innerHTML = label; }
      };
      btn.addEventListener("click", go);
      m.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && e.target.tagName === "INPUT") { e.preventDefault(); go(); } });
      bindSelects(m);
    },
  });
}

export function fieldHtml(f) {
  const id = "f_" + f.name;
  let input;
  if (f.type === "textarea") input = `<textarea class="textarea" id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || "")}" rows="${f.rows || 4}">${esc(f.value || "")}</textarea>`;
  else if (f.type === "select") input = selectHtml(f.name, f.options, f.value, f.placeholder);
  else if (f.type === "toggle") return `<label class="row-flex" style="justify-content:space-between"><span class="label">${f.label}</span><input type="checkbox" class="toggle" name="${f.name}" ${f.value ? "checked" : ""}></label>`;
  else if (f.type === "radios") return `<div class="field"><label>${f.label}</label>${f.options.map((o) => `<label class="radio-card"><input type="radio" name="${f.name}" value="${esc(o.value)}" ${o.value === f.value ? "checked" : ""}><div><div style="font-weight:500">${esc(o.label)}</div>${o.desc ? `<div class="hint">${esc(o.desc)}</div>` : ""}</div></label>`).join("")}</div>`;
  else input = `<input class="input ${f.mono ? "mono" : ""}" id="${id}" name="${f.name}" type="${f.type || "text"}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}>`;
  return `<div class="field">${f.label ? `<label for="${id}">${f.label}${f.optional ? ` <span class="dim">Optional</span>` : ""}</label>` : ""}${input}${f.hint ? `<div class="hint">${f.hint}</div>` : ""}</div>`;
}

export function confirmModal({ title, desc, confirm = "Confirm", danger = true, typed }) {
  return formModal({
    title, desc: desc + (typed ? `<br><br>Type <b class="mono" style="color:var(--fg)">${esc(typed)}</b> to confirm.` : ""),
    fields: typed ? [{ name: "c", placeholder: typed, autocomplete: "off" }] : [],
    submit: confirm, danger, validate: typed ? (v) => v.c === typed : null, onSubmit: async () => true,
  });
}

// ---------------- menus / popovers ----------------
let openMenu = null;
export function closeMenus() { openMenu?.close(); }
export function place(node, anchor, align = "left", gap = 4) {
  const r = anchor.getBoundingClientRect();
  node.style.visibility = "hidden";
  document.body.appendChild(node);
  const w = node.offsetWidth, h = node.offsetHeight;
  let left = align === "right" ? r.right - w : r.left;
  let top = r.bottom + gap;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - gap);
  left = Math.min(Math.max(8, left), innerWidth - w - 8);
  node.style.left = left + "px"; node.style.top = top + "px"; node.style.visibility = "";
}
/** items: [{label, icon, onClick, danger, kbd, checked, sep, header, disabled}] */
export function menu(anchor, items, { align = "left", search = false, width } = {}) {
  closeMenus();
  const m = el(`<div class="menu" role="menu" ${width ? `style="width:${width}px"` : ""}></div>`);
  const render = (q = "") => {
    const ql = q.toLowerCase();
    m.querySelectorAll(".mi,.msep,.mh").forEach((n) => n.remove());
    items.forEach((it, i) => {
      if (it.sep) { if (!q) m.appendChild(el('<div class="msep"></div>')); return; }
      if (it.header) { if (!q) m.appendChild(el(`<div class="mh">${esc(it.header)}</div>`)); return; }
      if (q && !String(it.label).toLowerCase().includes(ql)) return;
      const b = el(`<button class="mi ${it.danger ? "danger" : ""}" role="menuitem" ${it.disabled ? "disabled style='opacity:.45'" : ""}>${it.icon ? (it.icon.startsWith("<") ? it.icon : icon(it.icon)) : ""}<span class="ellipsis">${it.html || esc(it.label)}</span>${it.kbd ? `<span class="r">${it.kbd.split(" ").map((k) => `<span class="kbd">${esc(k)}</span>`).join("")}</span>` : ""}${it.checked ? `<span class="chk">${icon("check")}</span>` : it.right ? `<span class="r">${esc(it.right)}</span>` : ""}</button>`);
      b.addEventListener("click", (e) => { e.stopPropagation(); if (it.disabled) return; if (!it.keepOpen) close(); it.onClick?.(e); });
      m.appendChild(b);
    });
  };
  if (search) { const s = el('<div class="msearch"><input placeholder="Search…"></div>'); m.appendChild(s); s.querySelector("input").addEventListener("input", (e) => render(e.target.value)); }
  render();
  const close = () => { m.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", key); if (openMenu?.m === m) openMenu = null; };
  const outside = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => {
    if (e.key === "Escape") close();
    const btns = $$(".mi:not([disabled])", m); if (!btns.length) return;
    const i = btns.findIndex((b) => b.classList.contains("focus"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); btns.forEach((b) => b.classList.remove("focus")); const n = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length; btns[n].classList.add("focus"); btns[n].scrollIntoView({ block: "nearest" }); }
    if (e.key === "Enter" && i >= 0) { e.preventDefault(); btns[i].click(); }
  };
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", key); }, 0);
  place(m, anchor, align);
  m.querySelector(".msearch input")?.focus();
  openMenu = { m, close };
  return { close, el: m };
}
export function popover(anchor, html, { align = "left", width = 320, onMount } = {}) {
  closeMenus();
  const p = el(`<div class="popover" style="width:${width}px">${html}</div>`);
  const close = () => { p.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", key); };
  const outside = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target) && !e.target.closest(".menu")) close(); };
  const key = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", key); }, 0);
  place(p, anchor, align, 6);
  openMenu = { m: p, close };
  onMount?.(p, close);
  return { close, el: p };
}

// select dropdown driven by a button: <button class="select-btn" data-select="name" data-value="">
export function selectHtml(name, options, value, placeholder = "Select…", extra = "") {
  const cur = options.find((o) => String(o.value) === String(value));
  return `<button type="button" class="select-btn" data-select="${name}" data-value="${esc(value ?? "")}" ${extra}><span class="v ${cur ? "" : "ph"}">${esc(cur?.label ?? placeholder)}</span>${icon("chevron-down", 13)}</button><input type="hidden" name="${name}" value="${esc(value ?? "")}" data-options='${esc(JSON.stringify(options))}'>`;
}
export function bindSelects(root, onChange) {
  on(root, "click", "[data-select]", (e, btn) => {
    const name = btn.dataset.select;
    const hidden = btn.parentElement.querySelector(`input[type=hidden][name="${name}"]`) || root.querySelector(`input[type=hidden][name="${name}"]`);
    const opts = JSON.parse(hidden.dataset.options || "[]");
    menu(btn, opts.map((o) => ({ label: o.label, icon: o.icon, checked: String(o.value) === hidden.value, right: o.right, onClick: () => {
      hidden.value = o.value; btn.dataset.value = o.value;
      const v = btn.querySelector(".v"); v.textContent = o.label; v.classList.remove("ph");
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      onChange?.(name, o.value, o);
    } })), { search: opts.length > 8, width: Math.max(btn.offsetWidth, 180) });
  });
}

// ---------------- drawers ----------------
export function drawer({ title, body, wide, onMount }) {
  return new Promise((resolve) => {
    const ov = el('<div class="drawer-overlay"></div>');
    const d = el(`<aside class="drawer ${wide ? "wide" : ""}"><div class="drawer-head"><h3>${title}</h3><button class="ibtn" data-x>${icon("x", 15)}</button></div><div class="drawer-body">${body}</div></aside>`);
    const close = (v) => { ov.remove(); d.remove(); document.removeEventListener("keydown", k); resolve(v); };
    const k = (e) => { if (e.key === "Escape" && !document.querySelector(".overlay")) close(); };
    ov.addEventListener("click", () => close());
    d.querySelector("[data-x]").addEventListener("click", () => close());
    document.addEventListener("keydown", k);
    document.body.append(ov, d);
    onMount?.(d, close);
  });
}

// ---------------- code blocks ----------------
export function highlight(src, lang = "js") {
  let s = esc(src);
  if (lang === "json") return s.replace(/(&quot;[^&]*?&quot;)(\s*:)?/g, (m, str, colon) => colon ? `<span class="tok-n">${str}</span>${colon}` : `<span class="tok-s">${str}</span>`);
  s = s.replace(/(&#39;[^&#]*?&#39;|&quot;[^&]*?&quot;|`[^`]*?`)/g, '<span class="tok-s">$1</span>');
  s = s.replace(/(^|\s)(#|\/\/)([^\n]*)/g, '$1<span class="tok-c">$2$3</span>');
  s = s.replace(/\b(import|from|const|let|await|async|new|return|def|func|package|use|fn|require|curl|echo|var|public|class|static|using|end|do|if|else|true|false|nil|null)\b/g, '<span class="tok-k">$1</span>');
  return s;
}
export function codeBlock(src, { lang = "js", lines = true, copy = true, max } = {}) {
  const rows = String(src).split("\n");
  const ln = rows.map((_, i) => i + 1).join("\n");
  return `<div class="code" ${max ? `style="max-height:${max}px"` : ""}>${copy ? `<button class="ibtn copy-abs" data-copy="${esc(src)}" title="Copy">${icon("copy")}</button>` : ""}<pre>${lines ? `<span class="ln">${ln}</span>` : "<span></span>"}<span class="src">${highlight(src, lang)}</span></pre></div>`;
}
export async function copyText(t, msg = "Copied to clipboard") {
  try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast("Couldn't access the clipboard", "err"); }
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) { e.preventDefault(); e.stopPropagation(); copyText(b.dataset.copy, b.dataset.copyMsg || "Copied to clipboard"); } });

export function emptyState({ icon: ic = "mail", title, desc, action = "" }) {
  return `<div class="empty"><div class="head-ico">${icon(ic, 16)}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p>${action}</div>`;
}
export function skeletonRows(cols, n = 5) {
  return Array.from({ length: n }, () => `<tr class="loading-row">${Array.from({ length: cols }, () => `<td><div class="skeleton" style="width:${40 + Math.random() * 50}%"></div></td>`).join("")}</tr>`).join("");
}
export function pager(page, total, size, label) {
  const pages = Math.max(1, Math.ceil(total / size));
  return `<div class="pager"><span>Page ${page} of ${pages} · ${plural(total, label)}</span><div class="btns"><button class="ibtn boxed" data-page="${page - 1}" ${page <= 1 ? "disabled style='opacity:.4'" : ""}>${icon("chevron-left")}</button><button class="ibtn boxed" data-page="${page + 1}" ${page >= pages ? "disabled style='opacity:.4'" : ""}>${icon("chevron-right")}</button></div></div>`;
}
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function download(name, content, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el(`<a href="${url}" download="${esc(name)}"></a>`); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function csv(rows) {
  return rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}
export function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
export const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
export { icon, statusIcon };

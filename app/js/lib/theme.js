// System / Light / Dark theme. Stored per browser; "system" follows the OS.
const KEY = "dlv_theme";
const mq = matchMedia("(prefers-color-scheme: light)");
export function getTheme() { try { return localStorage.getItem(KEY) || "dark"; } catch { return "dark"; } }
export function resolved(t = getTheme()) { return t === "system" ? (mq.matches ? "light" : "dark") : t; }
export function applyTheme(t = getTheme(), animate = false) {
  const el = document.documentElement;
  if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) { el.classList.add("theme-anim"); setTimeout(() => el.classList.remove("theme-anim"), 400); }
  el.dataset.theme = resolved(t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved(t) === "light" ? "#ffffff" : "#211f20");
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.classList.toggle("on", b.dataset.themeSet === t));
}
export function setTheme(t) { try { localStorage.setItem(KEY, t); } catch {} applyTheme(t, true); window.dispatchEvent(new CustomEvent("themechange")); }
mq.addEventListener?.("change", () => { if (getTheme() === "system") { applyTheme("system", true); window.dispatchEvent(new CustomEvent("themechange")); } });
export const THEME_ICONS = {
  system: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  light: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
export function themeSwitch() {
  const cur = getTheme();
  return `<div class="theme-sw" role="group" aria-label="Theme">${["system", "light", "dark"].map((t) => `<button data-theme-set="${t}" class="${t === cur ? "on" : ""}" title="${t[0].toUpperCase() + t.slice(1)}" aria-label="${t} theme">${THEME_ICONS[t]}</button>`).join("")}</div>`;
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-theme-set]"); if (b) { setTheme(b.dataset.themeSet); } });

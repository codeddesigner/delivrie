import { sb, state, loadSession, loadTeams, setTeam, api } from "./lib/sb.js";
import { $, $$, el, esc, icon, menu, popover, toast, errToast, initials, on, modal } from "./lib/ui.js";
import { MARK } from "./lib/icons.js";
import { applyTheme, themeSwitch } from "./lib/theme.js";
import { intentFrom, rememberNext, nextAfterAuth } from "./lib/intent.js";
applyTheme();

// ---------------------------------------------------------------- routes
// [pattern, module, export, kind]  kind: public | auth (signed in, no team needed) | app (shell) | full (signed in, team, no shell)
const ROUTES = [
  ["/login", "auth", "login", "public"], ["/signup", "auth", "signup", "public"], ["/reset", "auth", "reset", "public"], ["/reset/new", "auth", "resetNew", "public"],
  ["/confirm", "auth", "confirm", "public"], ["/verify", "auth", "verify", "public"], ["/mfa", "auth", "mfa", "public"],
  ["/new-team", "auth", "newTeam", "auth"], ["/invite/:token", "auth", "invite", "public"],
  ["/unsubscribe", "public", "unsubscribe", "public"], ["/share/:token", "public", "share", "public"], ["/docs", "docs", "default", "public"], ["/docs/:a", "docs", "default", "public"], ["/docs/:a/:b", "docs", "default", "public"],
  ["/onboarding", "onboarding", "default", "app"],
  ["/emails", "emails", "list", "app"], ["/inbox", "inbox", "default", "app"], ["/inbox/:id", "inbox", "default", "app"], ["/emails/:id", "emails", "detail", "app"],
  ["/automations", "automations", "list", "app"], ["/automations/:id", "automations", "editor", "app"], ["/automations/:id/runs", "automations", "runs", "app"], ["/events", "events", "list", "app"], ["/events/:name", "events", "detail", "app"],
  ["/broadcasts", "broadcasts", "list", "app"], ["/broadcasts/:id", "broadcasts", "report", "app"], ["/broadcasts/:id/edit", "broadcast-edit", "default", "full"], ["/broadcasts/:id/scheduled", "broadcasts", "scheduled", "full"],
  ["/templates", "templates", "gallery", "app"], ["/templates/:id", "templates", "editor", "full"],
  ["/contacts", "audience", "contacts", "app"], ["/contacts/import", "audience", "importCsv", "app"], ["/contacts/properties", "audience", "properties", "app"], ["/contacts/topics", "audience", "topics", "app"],
  ["/segments", "audience", "segments", "app"], ["/segments/:id", "audience", "segment", "app"],
  ["/metrics", "insights", "metrics", "app"], ["/logs", "insights", "logs", "app"], ["/logs/:id", "insights", "log", "app"],
  ["/domains", "domains", "list", "app"], ["/domains/new", "domains", "add", "app"], ["/domains/:id", "domains", "detail", "app"], ["/domains/:id/receiving", "receiving", "setup", "app"],
  ["/api-keys", "keys", "apiKeys", "app"], ["/webhooks", "keys", "webhooks", "app"], ["/suppressions", "suppressions", "default", "app"], ["/webhooks/:id", "keys", "webhook", "app"],
  ["/billing", "billing", "default", "app"], ["/billing/:tab", "billing", "default", "app"],
  ["/settings/unsubscribe-page", "settings", "unsubscribeEditor", "full"], ["/settings", "settings", "default", "app"], ["/settings/:tab", "settings", "default", "app"],
  ["/oauth/authorize", "security", "authorize", "full"], ["/profile", "settings", "profile", "app"], ["/help", "help", "help", "app"],
  ["/admin", "admin", "default", "auth"], ["/admin/:tab", "admin", "default", "auth"],
].map(([p, mod, exp, kind]) => {
  const keys = [];
  const re = new RegExp("^" + p.replace(/:([a-z]+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { p, re, keys, mod, exp, kind };
});
const modules = {};
const load = (m) => (modules[m] ||= import(`./pages/${m}.js`));

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search && !replace) return render();
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render();
}
window.addEventListener("popstate", () => render());
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.native !== undefined || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute("href");
  if (!href.startsWith("/") || href.startsWith("/api/") || href.startsWith("//")) return;
  if (href.startsWith("/#") || href === "/") return;
  e.preventDefault();
  navigate(href);
});

// ---------------------------------------------------------------- shell
const NAV = [
  { href: "/emails", label: "Emails", icon: "mail" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/broadcasts", label: "Broadcasts", icon: "send" },
  { href: "/templates", label: "Templates", icon: "template" },
  { href: "/automations", label: "Automations", icon: "zap" },
  { section: "Audience", items: [{ href: "/contacts", label: "Contacts", icon: "users" }, { href: "/segments", label: "Segments", icon: "layers" }] },
  { section: "Insights", items: [{ href: "/metrics", label: "Metrics", icon: "chart" }, { href: "/logs", label: "Logs", icon: "list" }] },
  { section: "Configure", items: [{ href: "/domains", label: "Domains", icon: "globe" }, { href: "/api-keys", label: "API keys", icon: "key" }, { href: "/webhooks", label: "Webhooks", icon: "webhook" }, { href: "/suppressions", label: "Suppressions", icon: "shield" }, { href: "/billing", label: "Billing", icon: "card" }, { href: "/settings", label: "Settings", icon: "gear" }] },
];
function teamAvatar(t, cls = "") {
  return t?.avatar_url ? `<span class="avatar sq ${cls}"><img src="${esc(t.avatar_url)}" alt=""></span>` : `<span class="avatar sq yellow ${cls}">${esc((t?.name || "?")[0].toUpperCase())}</span>`;
}
function navLink(i) { return `<a class="nav-item" href="${i.href}" data-nav="${i.href}">${icon(i.icon, 15)}<span>${i.label}</span></a>`; }
function shellHtml() {
  const closed = JSON.parse(localStorage.getItem("dlv_nav_closed") || "{}");
  return `<div class="shell">
    <nav class="side" id="side">
      <div class="ws">
        <button class="ws-btn grow" id="ws-btn">${teamAvatar(state.team)}<span class="n">${esc(state.team?.name || "")}</span>${icon("chevron-down", 12, "dim")}</button>
        <button class="ibtn" id="nav-search" title="Search (⌘K)">${icon("search", 15)}</button>
        <a class="ibtn boxed" href="/broadcasts?new=1" title="New broadcast" style="border-radius:14px">${icon("edit", 14)}</a>
      </div>
      ${NAV.map((n) => n.section ? `<div class="nav-sec ${closed[n.section] ? "closed" : ""}" data-sec="${n.section}">${n.section}<span class="caret"></span></div><div class="nav-group ${closed[n.section] ? "closed" : ""}" data-group="${n.section}">${n.items.map(navLink).join("")}</div>` : navLink(n)).join("")}
      <div class="side-spacer"></div>
      <a class="whatsnew" href="/changelog" data-native><span class="k">What’s new</span><span class="v">Automations and Inbox are live</span></a>
      <div class="side-foot"><button class="who" id="who-btn"><span class="avatar me">${esc(initials(state.profile?.full_name || state.user?.email || "?"))}</span><span class="who-t"><span>${esc(state.profile?.full_name || state.user?.email?.split("@")[0] || "")}</span><small>${esc(state.user?.email || "")}</small></span></button>${themeSwitch()}</div>
    </nav>
    <div class="main"><section class="panel">
      <header class="topbar"><button class="ibtn mobile-only" id="side-toggle">${icon("sidebar", 15)}</button><div class="crumbs" id="crumbs"></div>
        <div class="top-links"><button class="btn btn-ghost" id="feedback-btn">${icon("edit", 13)} Feedback</button><a class="btn btn-ghost" href="/help">Help</a><a class="btn btn-ghost" href="/docs">Docs</a></div>
      </header>
      <div class="content" id="content"></div>
    </section></div></div>`;
}
function bindShell(root) {
  root.querySelector("#ws-btn").addEventListener("click", (e) => accountMenu(e.currentTarget));
  root.querySelector("#nav-search").addEventListener("click", () => palette());
  root.querySelector("#who-btn")?.addEventListener("click", (e) => accountMenu(e.currentTarget));
  root.querySelector("#feedback-btn").addEventListener("click", (e) => feedback(e.currentTarget));
  // Phones: the sidebar slides in over the page; tap outside, pick a page or press Escape to close it.
  const side = root.querySelector("#side");
  let scrim = root.querySelector(".side-scrim");
  if (!scrim) { scrim = document.createElement("div"); scrim.className = "side-scrim"; side.after(scrim); }
  const setSide = (open) => { side.classList.toggle("open", open); scrim.classList.toggle("on", open); };
  root.querySelector("#side-toggle").addEventListener("click", () => setSide(!side.classList.contains("open")));
  scrim.addEventListener("click", () => setSide(false));
  side.addEventListener("click", (e) => { if (e.target.closest("a.nav-item")) setSide(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) setSide(false); });
  on(root, "click", "[data-sec]", (_e, s) => {
    const name = s.dataset.sec; const closed = JSON.parse(localStorage.getItem("dlv_nav_closed") || "{}");
    closed[name] = !closed[name]; localStorage.setItem("dlv_nav_closed", JSON.stringify(closed));
    s.classList.toggle("closed", closed[name]); root.querySelector(`[data-group="${name}"]`).classList.toggle("closed", closed[name]);
  });
}
function markNav() {
  const p = location.pathname;
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", p === a.dataset.nav || p.startsWith(a.dataset.nav + "/") || (a.dataset.nav === "/contacts" && p.startsWith("/contacts"))));
  $("#side")?.classList.remove("open");
}
export function crumbs(html) { const c = $("#crumbs"); if (c) c.innerHTML = html; }
export function crumb(ic, label, parent) {
  crumbs(parent ? `${icon(ic, 14)}<a href="${parent[1]}">${esc(parent[0])}</a><span class="sep">${icon("chevron-right", 12)}</span><span class="ellipsis">${esc(label)}</span>` : `${icon(ic, 14)}<span>${esc(label)}</span>`);
  document.title = `${label} · Delivrie`;
}

function accountMenu(anchor) {
  const u = state.user;
  const name = state.profile?.full_name || u.email.split("@")[0];
  menu(anchor, [
    { html: `<span class="row-flex" style="gap:8px"><span class="avatar">${esc(initials(name))}</span><span style="display:flex;flex-direction:column;line-height:1.25"><span>${esc(name)}</span><span class="dim" style="font-size:11.5px">${esc(u.email)}</span></span></span>`, onClick: () => navigate("/profile") },
    { sep: true },
    { label: "My profile", icon: "users", kbd: "G P", onClick: () => navigate("/profile") },
    { label: "Team settings", icon: "gear", kbd: "G S", onClick: () => navigate("/settings/team") },
    { html: `<span class="row-flex" style="width:100%"><span class="grow">Theme</span>${themeSwitch()}</span>`, onClick: () => {} },
    { header: "Teams" },
    ...state.teams.map((t) => ({ html: `<span class="row-flex">${teamAvatar(t)}<span>${esc(t.name)}</span></span>`, checked: t.id === state.team?.id, onClick: () => { setTeam(t.id); navigate("/emails"); render(true); } })),
    { label: "Create team", icon: "plus", onClick: () => createTeamModal() },
    { sep: true },
    { label: "Documentation", icon: "book", onClick: () => navigate("/docs") },
    { label: "Changelog", icon: "zap", onClick: () => navigate("/docs") },
    { label: "Onboarding", icon: "terminal", onClick: () => navigate("/onboarding") },
    ...(state.platformAdmin ? [{ sep: true }, { label: "Admin", icon: "shield", onClick: () => navigate("/admin") }] : []),
    { sep: true },
    { label: "Log out", icon: "logout", kbd: "⇧ Q", onClick: logout },
  ], { width: 250 });
}
export async function logout() { await sb.auth.signOut(); state.team = null; state.teams = []; navigate("/login"); }
export function createTeamModal() {
  import("./lib/ui.js").then(({ formModal }) => formModal({
    title: "Create team", fields: [{ name: "name", label: "Team name", placeholder: "Acme" }], submit: "Create team", validate: (v) => v.name.length > 0,
    async onSubmit(v) { const { data, error } = await sb.rpc("create_team", { team_name: v.name }); if (error) throw error; await loadTeams(); setTeam(data); toast("Team created"); navigate("/onboarding"); render(true); },
  }));
}

function feedback(anchor) {
  popover(anchor, `<div style="padding:12px;display:flex;flex-direction:column;gap:10px"><textarea class="textarea" rows="4" placeholder="Have an idea to improve this page? Tell the Delivrie team."></textarea>
    <div class="row-flex"><span class="dim" style="font-size:12px">Need help? <a class="link" href="/help">Contact us</a></span><button class="btn btn-primary btn-sm" style="margin-left:auto" data-send>Send</button></div></div>`, {
    align: "right", width: 340,
    onMount(p, close) {
      const ta = p.querySelector("textarea"); ta.focus();
      p.querySelector("[data-send]").addEventListener("click", async () => {
        if (!ta.value.trim()) return;
        try {
          await api("POST", "/account/feedback", { message: ta.value, page: location.pathname, team_id: state.team?.id });
          p.innerHTML = `<div style="padding:22px;text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center"><span style="color:var(--green-2)">${icon("check-circle", 20)}</span><b style="font-weight:500">Your feedback was sent</b><span class="muted">Thanks. We read every note.</span></div>`;
          setTimeout(close, 2200);
        } catch (e) { errToast(e); }
      });
    },
  });
}

function palette() {
  const items = [
    ...NAV.flatMap((n) => n.items || [n]).map((i) => ({ label: i.label, icon: i.icon, href: i.href })),
    { label: "Create broadcast", icon: "plus", href: "/broadcasts?new=1" }, { label: "Add domain", icon: "plus", href: "/domains/new" }, { label: "Create API key", icon: "plus", href: "/api-keys?new=1" },
    { label: "Add contacts", icon: "plus", href: "/contacts?add=1" }, { label: "Import CSV", icon: "upload", href: "/contacts/import" }, { label: "Profile", icon: "users", href: "/profile" },
    { label: "Help", icon: "help", href: "/help" }, { label: "Docs", icon: "book", href: "/docs" }, { label: "Get started", icon: "terminal", href: "/onboarding" },
  ];
  modal({
    body: `<div class="input-wrap"><span class="lead">${icon("search", 14)}</span><input class="input" placeholder="Search pages and actions…" style="height:38px"></div><div data-list style="display:flex;flex-direction:column;gap:1px;max-height:340px;overflow:auto"></div>`,
    onMount(m, close) {
      const inp = m.querySelector("input"), list = m.querySelector("[data-list]");
      let sel = 0, cur = [];
      const draw = () => {
        const q = inp.value.toLowerCase();
        cur = items.filter((i) => i.label.toLowerCase().includes(q));
        sel = Math.min(sel, Math.max(0, cur.length - 1));
        list.innerHTML = cur.map((i, n) => `<button class="nav-item ${n === sel ? "on" : ""}" data-i="${n}">${icon(i.icon, 14)}<span>${esc(i.label)}</span></button>`).join("") || `<div class="dim" style="padding:12px">No results</div>`;
      };
      const go = (n) => { const i = cur[n]; if (i) { close(); navigate(i.href); } };
      inp.addEventListener("input", draw);
      inp.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { sel = Math.min(sel + 1, cur.length - 1); draw(); e.preventDefault(); } if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } if (e.key === "Enter") go(sel); });
      on(list, "click", "[data-i]", (_e, b) => go(+b.dataset.i));
      draw();
    },
  });
}

// keyboard shortcuts: ⌘K palette, G then key, ⇧Q logout
let gPending = 0;
document.addEventListener("keydown", (e) => {
  if (!state.team || e.target.closest("input,textarea,[contenteditable]")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(); return; }
  if (e.shiftKey && e.key === "Q") { logout(); return; }
  if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) { gPending = Date.now(); return; }
  if (Date.now() - gPending < 1200) {
    const map = { p: "/profile", s: "/settings", $: "/billing", e: "/emails", b: "/broadcasts", t: "/templates", c: "/contacts", d: "/domains", k: "/api-keys", w: "/webhooks", m: "/metrics", l: "/logs" };
    const to = map[e.key.toLowerCase()]; gPending = 0;
    if (to) { e.preventDefault(); navigate(to); }
  }
});

// ---------------------------------------------------------------- render
let shellMounted = false, renderId = 0;
const app = () => document.getElementById("app");

export async function render(forceShell = false) {
  const id = ++renderId;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const r = ROUTES.find((x) => x.re.test(path));
  const query = Object.fromEntries(new URLSearchParams(location.search));
  if (!r) { location.replace("/"); return; }
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(path.match(r.re)[i + 1])]));

  if (r.kind !== "public" || ["/login", "/signup"].includes(path)) {
    await loadSession();
    if (state.user && !state.teams.length) await loadTeams();
    if (state.user && state.platformAdmin === undefined) { state.platformAdmin = false; sb.rpc("is_platform_admin").then(({ data }) => { state.platformAdmin = !!data; }, () => {}); }
  }
  if (r.kind !== "public" && !state.user) { navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); return; }
  // Where to go after signing in (?next=…, or ?plan=pro from the pricing page). Kept through sign-up, the emailed code and team setup.
  if (["/login", "/signup"].includes(path)) rememberNext(intentFrom(query));
  if (["/login", "/signup"].includes(path) && state.user) {
    // a signed-in user with an MFA factor still needs the second step
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") { navigate("/mfa", { replace: true }); return; }
    navigate(nextAfterAuth(), { replace: true }); return;
  }
  if ((r.kind === "app" || r.kind === "full") && !state.team) { rememberNext(location.pathname + location.search); navigate("/new-team", { replace: true }); return; }

  const mod = await load(r.mod);
  if (id !== renderId) return;
  const fn = mod[r.exp];
  const ctx = { params, query, navigate, crumb, crumbs, path };
  if (r.kind === "app") {
    if (!shellMounted || forceShell || !$("#content")) { app().innerHTML = shellHtml(); bindShell(app()); shellMounted = true; }
    import("./lib/chat.js").then((m) => m.mountChat()).catch(() => {});
    markNav();
    const content = $("#content");
    content.innerHTML = "";
    content.scrollTop = 0;
    ctx.root = content;
    await safeRun(fn, ctx, content);
    if (id === renderId) enter(content);
  } else {
    shellMounted = false;
    app().innerHTML = "";
    ctx.root = app();
    await safeRun(fn, ctx, app());
    if (id === renderId) enter(app());
  }
}
// Page entrance: fade/slide the page in, stagger rows and cards, count numbers up.
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function enter(root) {
  if (calm()) return;
  root.classList.remove("enter"); void root.offsetWidth; root.classList.add("enter");
  setTimeout(() => root.classList.remove("enter"), 900);
  countUp(root);
}
export function countUp(root) {
  if (calm()) return;
  root.querySelectorAll(".stat .v, [data-count]").forEach((el) => {
    const target = el.matches("[data-count]") ? el : [...el.childNodes].find((n) => n.nodeType === 1 && /^[\d,.]+%?$/.test(n.textContent.trim())) || (/^[\d,.]+%?$/.test(el.textContent.trim()) ? el : null);
    if (!target || target.dataset.counted) return;
    const raw = target.textContent.trim(), pct = raw.endsWith("%"), dec = (raw.split(".")[1] || "").replace("%", "").length;
    const end = parseFloat(raw.replace(/[,%]/g, ""));
    if (!isFinite(end) || end === 0) return;
    target.dataset.counted = "1";
    const t0 = performance.now(), dur = 700;
    const fmt = (v) => (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US")) + (pct ? "%" : "");
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); target.textContent = fmt(end * e); if (k < 1) requestAnimationFrame(tick); else target.textContent = raw; };
    requestAnimationFrame(tick);
  });
}
async function safeRun(fn, ctx, root) {
  try { await fn(ctx); }
  catch (e) {
    console.error(e);
    root.innerHTML = `<div class="page narrow"><div class="empty"><div class="head-ico">${icon("alert", 16)}</div><h3>Something went wrong</h3><p>${esc(e?.message || e)}</p><button class="btn btn-secondary" onclick="location.reload()">Reload</button></div></div>`;
  }
}

sb.auth.onAuthStateChange((event, session) => {
  state.session = session; state.user = session?.user || null;
  if (event === "PASSWORD_RECOVERY") navigate("/reset/new");
  if (event === "SIGNED_OUT") { state.teams = []; state.team = null; }
});

window.DLV = { MARK };
render();

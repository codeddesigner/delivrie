import { sb, state, api, API_BASE, loadTeams, setTeam } from "../lib/sb.js";
import { sso, connectedApps } from "./security.js";
import { esc, icon, ago, fmtDate, fmtDateTime, num, plural, toast, errToast, menu, modal, formModal, confirmModal, emptyState, badge, selectHtml, bindSelects, codeBlock, initials, EMAIL_RE, on, debounce, csv, download } from "../lib/ui.js";

const T = () => state.team.id;
const TABS = [["usage", "Usage"], ["billing", "Billing"], ["team", "Team"], ["security", "Security"], ["connected-apps", "Connected apps"], ["smtp", "SMTP"], ["integrations", "Integrations"], ["unsubscribe", "Unsubscribe page"], ["documents", "Documents"]];
const isAdmin = () => state.role === "admin";

export default async function settings(ctx) {
  const tab = ctx.params.tab || "usage";
  if (tab === "unsubscribe") return ctx.navigate("/settings/unsubscribe-page", { replace: true });
  if (tab === "suppressions") return ctx.navigate("/suppressions", { replace: true });
  if (tab === "billing") return ctx.navigate("/billing" + location.search, { replace: true });
  ctx.crumb("gear", "Settings");
  const root = ctx.root;
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Settings</h1></div><div class="ul-tabs" style="margin-bottom:22px">${TABS.map(([k, l]) => `<a class="ul-tab ${k === tab ? "on" : ""}" href="${k === "billing" ? "/billing" : `/settings/${k === "unsubscribe" ? "unsubscribe-page" : k}`}">${l}</a>`).join("")}</div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  const fn = { usage, team, suppressions, smtp, integrations, documents, security: sso, "connected-apps": connectedApps }[tab];
  if (!fn) return ctx.navigate("/settings", { replace: true });
  await fn(body, ctx);
}

export { usage as usageTab };
async function usage(body) {
  const [{ data: u, error }, status] = await Promise.all([sb.rpc("team_usage", { p_team: T() }), api("GET", "/dashboard/status").catch(() => null)]);
  if (error) throw error;
  const L = status?.limits || { month: 6000, day: 200, contacts: 1000, segments: 3, domains: 5 };
  const meter = (label, used, limit, sub) => { const p = limit ? Math.min(1, used / limit) : 0; return `<div class="stat"><div class="row-flex"><div class="k">${label}</div><span class="grow"></span><span class="dim" style="font-size:12px">${num(used)} / ${limit ? num(limit) : "∞"}</span></div><div class="meter ${p >= 0.9 ? "red" : ""}"><i style="width:${p * 100}%"></i></div>${sub ? `<div class="dim" style="font-size:11.5px;margin-top:6px">${sub}</div>` : ""}</div>`; };
  const aws = status?.aws;
  body.innerHTML = `<h3 class="section-title" style="margin-top:0">Transactional</h3><div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">${meter("Monthly emails", u.month, L.month, "Resets on the 1st")}${meter("Daily emails", u.day, L.day, "Resets at midnight UTC")}${meter("Domains", u.domains, L.domains)}</div>
    <h3 class="section-title">Marketing</h3><div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">${meter("Contacts", u.contacts, L.contacts)}${meter("Segments", u.segments, L.segments)}${meter("Broadcasts", u.broadcasts, 0)}</div>
    <h3 class="section-title">Team</h3><div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">${meter("Members", u.members, 0)}${meter("API keys", u.api_keys, 0)}${meter("Webhooks", u.webhooks, 0)}</div>
    ${status && !status.limits_enforced ? `<p class="hint" style="margin-top:12px">Limits are shown for reference and aren’t enforced on this workspace.</p>` : ""}
    <h3 class="section-title">Sending infrastructure</h3><div class="card card-pad">${!aws?.configured ? `<div class="row-flex">${icon("alert", 14)} <span>Mail provider not connected. Sending, domains and receiving need AWS credentials on the server.</span></div>` : aws.error ? `<div class="row-flex" style="color:var(--orange)">${icon("alert", 14)} ${esc(aws.error)}</div>` : `<div class="kv"><span class="k">Account</span><span>${aws.production ? badge("Production", "green") : badge("Sandbox — verified recipients only", "yellow")}</span><span class="k">Sending</span><span>${aws.sending ? "Enabled" : "Paused"}</span><span class="k">Rate</span><span>${num(aws.max_send_rate)} emails / second</span><span class="k">24h quota</span><span>${num(aws.sent_24h)} of ${num(aws.max_24h)} used</span></div>`}</div>`;
}

async function team(body, ctx) {
  const [{ data: members }, { data: invites }, { data: t }] = await Promise.all([
    sb.from("team_members").select("user_id,role,created_at").eq("team_id", T()).order("created_at"),
    sb.from("team_invites").select("*").eq("team_id", T()).eq("status", "pending").order("created_at", { ascending: false }),
    sb.from("teams").select("*").eq("id", T()).single(),
  ]);
  const { data: profiles } = await sb.from("profiles").select("id,email,full_name").in("id", (members || []).map((m) => m.user_id));
  const pr = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  const admin = isAdmin();
  body.innerHTML = `<div class="card card-pad" style="margin-bottom:22px"><div class="row-flex" style="gap:16px"><label class="avatar sq yellow" style="width:44px;height:44px;font-size:17px;cursor:${admin ? "pointer" : "default"};overflow:hidden" title="${admin ? "Upload a logo" : ""}">${t.avatar_url ? `<img src="${esc(t.avatar_url)}">` : esc(initials(t.name))}${admin ? '<input type="file" accept="image/*" hidden data-avatar>' : ""}</label>
      <div class="grow"><div class="field"><label>Team name</label><div class="row-flex"><input class="input" data-tname value="${esc(t.name)}" ${admin ? "" : "disabled"} style="max-width:320px">${admin ? `<button class="btn btn-secondary" data-savename>Save</button>` : ""}</div></div></div></div>
      <div class="kv" style="margin-top:14px"><span class="k">Team ID</span><span class="mono dim" style="font-size:12px"><button data-copy="${t.id}">${t.id} ${icon("copy", 11)}</button></span><span class="k">Created</span><span>${fmtDate(t.created_at)}</span></div></div>
    <div class="row-flex"><h3 class="section-title" style="margin:0">Members</h3><span class="grow"></span>${admin ? `<button class="btn btn-primary btn-sm" data-invite>${icon("plus", 12)} Invite</button>` : ""}</div>
    <div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>Member</th><th>Role</th><th class="r">Joined</th><th></th></tr></thead><tbody>${(members || []).map((m) => { const p = pr[m.user_id] || {}; return `<tr><td><div class="cell"><span class="avatar" style="width:24px;height:24px;font-size:10.5px">${esc(initials(p.full_name || p.email))}</span><div><div>${esc(p.full_name || p.email || "Member")}${m.user_id === state.user.id ? ' <span class="dim">(you)</span>' : ""}</div>${p.full_name ? `<div class="dim" style="font-size:12px">${esc(p.email)}</div>` : ""}</div></div></td><td>${m.role === "admin" ? badge("Admin", "yellow") : badge("Member", "gray")}</td><td class="r muted">${fmtDate(m.created_at)}</td><td class="act">${admin || m.user_id === state.user.id ? `<button class="ibtn" data-mem="${m.user_id}">${icon("more")}</button>` : ""}</td></tr>`; }).join("")}
      ${(invites || []).map((i) => `<tr><td><div class="cell"><span class="avatar" style="width:24px;height:24px;font-size:10.5px;opacity:.5">${icon("mail", 11)}</span><span class="muted">${esc(i.email)}</span></div></td><td>${badge("Invited · " + i.role, "blue")}</td><td class="r muted">${ago(i.created_at)}</td><td class="act">${admin ? `<button class="ibtn" data-inv="${i.id}">${icon("more")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    ${admin ? `<h3 class="section-title" style="color:var(--red)">Danger zone</h3><div class="card card-pad row-flex" style="border-color:rgba(229,72,77,.35)"><div class="grow"><div style="font-weight:500">Delete team</div><div class="muted" style="font-size:12.5px">Permanently delete ${esc(t.name)}, its domains, contacts, emails and keys.</div></div><button class="btn btn-danger" data-delteam>Delete team</button></div>` : `<h3 class="section-title">Leave team</h3><div class="card card-pad row-flex"><div class="grow muted">You’ll lose access to ${esc(t.name)} until someone invites you again.</div><button class="btn btn-secondary" data-leave>Leave team</button></div>`}`;
  const reload = () => ctx.navigate("/settings/team", { replace: true });
  on(body, "click", "[data-savename]", async () => { const name = body.querySelector("[data-tname]").value.trim(); if (!name) return; const { error } = await sb.from("teams").update({ name }).eq("id", T()); if (error) return errToast(error); state.team.name = name; toast("Team renamed"); const { render } = await import("../main.js"); render(true); });
  on(body, "change", "[data-avatar]", async (_e, inp) => {
    const f = inp.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) return toast("Logos must be under 2 MB", "err");
    const path = `${T()}/team-avatar-${Date.now()}.${(f.name.split(".").pop() || "png").toLowerCase()}`;
    const { error } = await sb.storage.from("email-assets").upload(path, f, { contentType: f.type }); if (error) return errToast(error);
    const url = `${location.origin}/media/${path}`;
    await sb.from("teams").update({ avatar_url: url }).eq("id", T()); state.team.avatar_url = url; toast("Logo updated"); reload();
  });
  on(body, "click", "[data-invite]", () => formModal({ title: "Invite to team", fields: [{ name: "email", label: "Email", placeholder: "teammate@example.com", type: "email" }, { name: "role", label: "Role", type: "select", value: "member", options: [{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }] }], submit: "Send invite", validate: (v) => EMAIL_RE.test(v.email),
    async onSubmit(v) { const r = await api("POST", "/dashboard/invite", { email: v.email, role: v.role }); setTimeout(() => modal({ title: r.emailed ? "Invite sent" : "Share the invite link", body: `<p class="desc">${r.emailed ? `We emailed ${esc(v.email)}. You can also share this link:` : `Email isn’t set up for system messages yet, so send ${esc(v.email)} this link yourself:`}</p><div class="input-wrap"><input class="input mono" readonly value="${esc(r.link)}" style="padding-right:36px"><span class="trail"><button class="ibtn" data-copy="${esc(r.link)}">${icon("copy")}</button></span></div>`, foot: `<button class="btn btn-primary" data-cancel>Done</button>` }).then(reload), 50); } }));
  on(body, "click", "[data-inv]", (_e, b) => menu(b, [{ label: "Copy invite link", icon: "link", onClick: () => { const i = invites.find((x) => x.id === b.dataset.inv); navigator.clipboard.writeText(`${location.origin}/invite/${i.token}`).then(() => toast("Link copied")); } }, { label: "Revoke", icon: "x", danger: true, onClick: async () => { await sb.from("team_invites").update({ status: "revoked" }).eq("id", b.dataset.inv); toast("Invite revoked"); reload(); } }], { align: "right" }));
  on(body, "click", "[data-mem]", (_e, b) => {
    const uid = b.dataset.mem, m = members.find((x) => x.user_id === uid), self = uid === state.user.id;
    const admins = members.filter((x) => x.role === "admin").length;
    menu(b, [
      admin && !self && { label: m.role === "admin" ? "Make member" : "Make admin", icon: "shield", onClick: async () => { const { error } = await sb.from("team_members").update({ role: m.role === "admin" ? "member" : "admin" }).eq("team_id", T()).eq("user_id", uid); if (error) return errToast(error); toast("Role updated"); reload(); } },
      { label: self ? "Leave team" : "Remove from team", icon: "logout", danger: true, onClick: async () => {
        if (self && m.role === "admin" && admins <= 1) return toast("Make someone else an admin before leaving", "err");
        if (!(await confirmModal({ title: self ? "Leave team" : "Remove member", desc: self ? "You’ll lose access to this team." : `Remove ${esc(pr[uid]?.email || "this member")}?`, confirm: self ? "Leave" : "Remove" }))) return;
        const { error } = await sb.from("team_members").delete().eq("team_id", T()).eq("user_id", uid); if (error) return errToast(error);
        if (self) { localStorage.removeItem("dlv_team"); await loadTeams(); location.href = state.teams.length ? "/emails" : "/new-team"; } else { toast("Member removed"); reload(); }
      } },
    ].filter(Boolean), { align: "right" });
  });
  on(body, "click", "[data-leave]", async () => { if (!(await confirmModal({ title: "Leave team", desc: "You’ll lose access to this team.", confirm: "Leave" }))) return; await sb.from("team_members").delete().eq("team_id", T()).eq("user_id", state.user.id); localStorage.removeItem("dlv_team"); location.href = "/emails"; });
  on(body, "click", "[data-delteam]", async () => {
    if (!(await confirmModal({ title: "Delete team", desc: `This permanently deletes <b>${esc(t.name)}</b> and everything in it, and removes its domains from the mail provider. This can’t be undone.`, confirm: "Delete team", typed: t.name }))) return;
    try { await api("DELETE", "/dashboard/team", { confirm: t.name }); localStorage.removeItem("dlv_team"); toast("Team deleted"); setTimeout(() => location.href = "/emails", 600); } catch (e) { errToast(e); }
  });
}

async function suppressions(body) {
  body.innerHTML = `<p class="muted" style="margin-bottom:14px">We never send to addresses on this list. Hard bounces and spam complaints are added automatically; unsubscribes from broadcasts are tracked on the contact instead.</p>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search email"></div><span class="grow"></span><button class="btn btn-secondary" data-export>${icon("download", 13)} Export</button><button class="btn btn-primary" data-add>${icon("plus", 13)} Add</button></div><div data-list></div>`;
  let rows = [];
  const draw = () => { const q = body.querySelector("[data-q]").value.toLowerCase(); const r = rows.filter((x) => x.email.includes(q)); body.querySelector("[data-list]").innerHTML = r.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Email</th><th>Reason</th><th class="r">Added</th><th></th></tr></thead><tbody>${r.slice(0, 500).map((s) => `<tr><td>${esc(s.email)}</td><td>${badge({ bounce: "Bounced", complaint: "Complained", manual: "Manual", unsubscribe: "Unsubscribed" }[s.reason] || s.reason, s.reason === "complaint" ? "red" : s.reason === "bounce" ? "orange" : "gray")}</td><td class="r muted">${ago(s.created_at)}</td><td class="act"><button class="btn btn-ghost btn-sm" data-rm="${esc(s.email)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : emptyState({ icon: "shield", title: rows.length ? "No matches" : "No suppressed addresses", desc: "Your list is clean." }); };
  const load = async () => { const { data, error } = await sb.from("suppressions").select("*").eq("team_id", T()).order("created_at", { ascending: false }).limit(5000); if (error) throw error; rows = data; draw(); };
  body.querySelector("[data-q]").addEventListener("input", draw);
  on(body, "click", "[data-rm]", async (_e, b) => { if (!(await confirmModal({ title: "Remove from suppression list", desc: `We’ll start sending to ${esc(b.dataset.rm)} again. If it bounced before, it will probably bounce again and hurt your reputation.`, confirm: "Remove", danger: false }))) return; await sb.from("suppressions").delete().eq("team_id", T()).eq("email", b.dataset.rm); toast("Removed"); load(); });
  on(body, "click", "[data-add]", () => formModal({ title: "Suppress addresses", fields: [{ name: "emails", label: "Emails", type: "textarea", placeholder: "one@example.com, two@example.com" }], submit: "Add", validate: (v) => v.emails, async onSubmit(v) { const list = [...new Set(v.emails.split(/[\s,;]+/).map((x) => x.toLowerCase()).filter((x) => EMAIL_RE.test(x)))]; if (!list.length) throw new Error("No valid emails"); const { error } = await sb.from("suppressions").upsert(list.map((email) => ({ team_id: T(), email, reason: "manual" })), { onConflict: "team_id,email", ignoreDuplicates: true }); if (error) throw error; toast(`${plural(list.length, "address", "addresses")} suppressed`); load(); } }));
  on(body, "click", "[data-export]", () => download("suppressions.csv", csv([["email", "reason", "created_at"], ...rows.map((r) => [r.email, r.reason, r.created_at])])));
  await load();
}

async function smtp(body) {
  body.innerHTML = `<div class="banner">${icon("info", 14)} Delivrie’s own SMTP relay isn’t available yet. Use the HTTP API — it’s faster and gives you IDs, statuses and webhooks for every email.</div>
    <div class="card card-pad"><h3>Need SMTP today?</h3><p class="muted" style="margin:6px 0 12px">Delivrie sends through Amazon SES. If a tool only speaks SMTP (WordPress, Supabase Auth, legacy apps), you can point it at SES SMTP with credentials from your AWS console, then verify the same domain here to keep DNS in one place.</p>
      <div class="kv"><span class="k">Host</span><span class="mono">email-smtp.&lt;region&gt;.amazonaws.com</span><span class="k">Port</span><span class="mono">587 (STARTTLS) or 465 (TLS)</span><span class="k">Username / password</span><span>SES SMTP credentials from IAM</span></div></div>
    <h3 class="section-title">Send with the API instead</h3>${codeBlock(`curl -X POST ${location.origin}/api/emails \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{"from":"You <you@yourdomain.com>","to":["them@example.com"],"subject":"Hi","html":"<p>Hello</p>"}'`, { lang: "sh" })}`;
}

async function integrations(body) {
  const mcpUrl = `${API_BASE}/mcp`;
  body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">
    <div class="card card-pad"><div class="row-flex"><span class="avatar sq" style="width:30px;height:30px">${icon("sparkle", 15)}</span><h3>MCP server</h3>${badge("Available", "green")}</div><p class="muted" style="margin:10px 0">Let AI assistants send email, manage contacts and check delivery through 24 tools. Authenticate with an API key.</p>
      <div class="field"><label>Server URL</label><div class="input-wrap"><input class="input mono" readonly value="${esc(mcpUrl)}" style="padding-right:36px"><span class="trail"><button class="ibtn" data-copy="${esc(mcpUrl)}">${icon("copy")}</button></span></div></div>
      <div style="margin-top:12px">${codeBlock(JSON.stringify({ mcpServers: { delivrie: { url: mcpUrl, headers: { Authorization: "Bearer dlv_xxxxxxxxx" } } } }, null, 2), { lang: "json", lines: false })}</div></div>
    <div class="card card-pad"><div class="row-flex"><span class="avatar sq" style="width:30px;height:30px">${icon("globe", 15)}</span><h3>Cloudflare DNS</h3>${badge("Coming soon", "gray")}</div><p class="muted" style="margin:10px 0">One-click DNS setup for domains on Cloudflare. For now, copy the records from the domain page.</p><a class="btn btn-secondary btn-sm" href="/domains">Go to domains</a></div>
    <div class="card card-pad"><div class="row-flex"><span class="avatar sq" style="width:30px;height:30px">${icon("shield", 15)}</span><h3>Supabase Auth</h3>${badge("Via SMTP", "gray")}</div><p class="muted" style="margin:10px 0">Supabase Auth needs SMTP. Use SES SMTP credentials with a domain verified here — see the SMTP tab.</p><a class="btn btn-secondary btn-sm" href="/settings/smtp">SMTP settings</a></div>
    <div class="card card-pad"><div class="row-flex"><span class="avatar sq" style="width:30px;height:30px">${icon("webhook", 15)}</span><h3>Webhooks</h3>${badge("Available", "green")}</div><p class="muted" style="margin:10px 0">Pipe delivery events into Zapier, Make, n8n or your own backend with signed webhooks.</p><a class="btn btn-secondary btn-sm" href="/webhooks">Manage webhooks</a></div></div>`;
}

async function documents(body) {
  const docs = [["Data Processing Agreement", "GDPR-ready DPA covering how we process personal data on your behalf."], ["Subprocessors", "Amazon Web Services (email delivery, us/eu regions), Supabase (database and auth), Vercel (dashboard hosting)."], ["Security overview", "Encryption in transit and at rest, access controls, and incident response."], ["SOC 2 report", "Not yet available."]];
  body.innerHTML = `<p class="muted" style="margin-bottom:14px">Compliance documents for your security and legal reviews.</p><div class="table-wrap"><table class="t"><tbody>${docs.map(([n, d], i) => `<tr><td><div style="font-weight:500">${n}</div><div class="dim" style="font-size:12px">${d}</div></td><td class="r">${i === 1 ? "" : i === 3 ? badge("Unavailable", "gray") : `<a class="btn btn-secondary btn-sm" href="/help?contact=1&subject=${encodeURIComponent("Request: " + n)}">Request</a>`}</td></tr>`).join("")}</tbody></table></div>`;
}

// ------------------------------------------------------------ unsubscribe page editor
export const PAGE_DEFAULT = { heading: "Manage your subscription", message: "Choose which emails you’d like to get from us.", button: "#111111", background: "#f5f5f5", card: "#ffffff", text: "#111111", show_topics: true, show_logo: true, confirm: "You’ve been unsubscribed." };
export function unsubPreview(team, p, topics, email = "ada@example.com") {
  return `<div style="background:${esc(p.background)};padding:40px 16px;min-height:100%;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:${esc(p.text)}"><div style="max-width:440px;margin:0 auto;background:${esc(p.card)};border-radius:14px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    ${p.show_logo ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">${team.avatar_url ? `<img src="${esc(team.avatar_url)}" style="width:32px;height:32px;border-radius:8px;object-fit:cover">` : `<div style="width:32px;height:32px;border-radius:8px;background:${esc(p.button)};color:#fff;display:grid;place-items:center;font-weight:600">${esc((team.name || "?")[0])}</div>`}<b>${esc(team.name)}</b></div>` : ""}
    <h2 style="margin:0 0 6px;font-size:20px">${esc(p.heading)}</h2><p style="margin:0 0 18px;opacity:.7;font-size:14px">${esc(p.message)}<br><span style="opacity:.8">${esc(email)}</span></p>
    ${p.show_topics && topics.length ? topics.map((t) => `<label style="display:flex;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,.08);font-size:14px"><input type="checkbox" checked data-topic="${t.id}"><span><b style="font-weight:500">${esc(t.name)}</b>${t.description ? `<br><span style="opacity:.6;font-size:12.5px">${esc(t.description)}</span>` : ""}</span></label>`).join("") : ""}
    <label style="display:flex;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,.08);font-size:14px"><input type="checkbox" data-all> Unsubscribe from all emails</label>
    <button data-save style="margin-top:14px;width:100%;height:40px;border:0;border-radius:8px;background:${esc(p.button)};color:#fff;font-weight:600;font-size:14px;cursor:pointer">Save preferences</button></div>
    <p style="text-align:center;font-size:12px;opacity:.5;margin-top:16px">Powered by Delivrie</p></div>`;
}
export async function unsubscribeEditor(ctx) {
  const [{ data: t }, { data: topics }] = await Promise.all([sb.from("teams").select("id,name,avatar_url,unsubscribe_page").eq("id", T()).single(), sb.from("topics").select("id,name,description").eq("team_id", T()).eq("visibility", "public")]);
  const p = { ...PAGE_DEFAULT, ...(t.unsubscribe_page || {}) };
  document.title = "Unsubscribe page · Delivrie";
  const root = ctx.root;
  const field = (k, label, type = "text") => `<div class="insp-row"><span>${label}</span>${type === "color" ? `<div class="input-wrap"><input class="input mono" data-k="${k}" value="${esc(p[k])}" style="padding-right:30px"><span class="trail" style="right:9px"><span class="swatch" style="background:${esc(p[k])}"></span></span></div>` : type === "toggle" ? `<input type="checkbox" class="toggle" data-k="${k}" ${p[k] ? "checked" : ""}>` : `<input class="input" data-k="${k}" value="${esc(p[k])}">`}</div>`;
  root.innerHTML = `<div class="editor-shell"><div class="editor-top"><a class="ibtn" href="/settings">${icon("arrow-left", 15)}</a><span class="dim">Settings</span><span class="dim">/</span><span>Unsubscribe page</span><span class="grow"></span><button class="btn btn-ghost btn-sm" data-reset>Reset</button><button class="btn btn-primary btn-sm" data-save ${isAdmin() ? "" : "disabled title='Admins only'"}>Save</button></div>
    <div class="editor-main"><div class="editor-canvas" data-prev style="background:#1c1a1b"></div><aside class="inspector">
      <div class="insp-sec"><h4>Content</h4>${field("heading", "Heading")}${field("message", "Message")}${field("confirm", "Confirmation")}${field("show_logo", "Show logo", "toggle")}${field("show_topics", "Show topics", "toggle")}</div>
      <div class="insp-sec"><h4>Colors</h4>${field("background", "Background", "color")}${field("card", "Card", "color")}${field("text", "Text", "color")}${field("button", "Button", "color")}</div>
      <div class="insp-sec"><p class="hint">Every broadcast footer links here. Topics come from <a class="link" href="/contacts/topics">Audience → Topics</a>; only public topics are shown.</p></div></aside></div></div>`;
  const draw = () => { root.querySelector("[data-prev]").innerHTML = unsubPreview(t, p, topics || []); };
  root.querySelector(".inspector").addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; p[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; const sw = e.target.parentElement.querySelector(".swatch"); if (sw) sw.style.background = e.target.value; draw(); });
  root.querySelector("[data-reset]").onclick = () => { Object.assign(p, PAGE_DEFAULT); ctx.root.querySelectorAll("[data-k]").forEach((i) => { if (i.type === "checkbox") i.checked = !!p[i.dataset.k]; else i.value = p[i.dataset.k]; }); draw(); };
  root.querySelector("[data-save]").onclick = async () => { const { error } = await sb.from("teams").update({ unsubscribe_page: p }).eq("id", T()); if (error) return errToast(error); toast("Unsubscribe page saved"); };
  draw();
}

// ------------------------------------------------------------ profile
export async function profile(ctx) {
  ctx.crumb("users", "Profile");
  const root = ctx.root;
  const u = state.user;
  const [{ data: prof }, { data: factors }, ids] = await Promise.all([sb.from("profiles").select("*").eq("id", u.id).single(), sb.auth.mfa.listFactors(), sb.auth.getUserIdentities().catch(() => ({ data: null }))]);
  const totp = (factors?.totp || []).filter((f) => f.status === "verified");
  const identities = ids?.data?.identities || u.identities || [];
  const has = (p) => identities.some((i) => i.provider === p);
  root.innerHTML = `<div class="page narrow"><div class="page-head"><h1>Profile</h1></div>
    <div class="card card-pad"><div class="row-flex" style="gap:14px;margin-bottom:16px"><span class="avatar" style="width:44px;height:44px;font-size:16px">${esc(initials(prof?.full_name || u.email))}</span><div><div style="font-weight:500">${esc(prof?.full_name || "Add your name")}</div><div class="muted">${esc(u.email)}</div></div></div>
      <div class="field"><label>Full name</label><div class="row-flex"><input class="input" data-fname value="${esc(prof?.full_name || "")}" placeholder="Ada Lovelace"><button class="btn btn-secondary" data-savename>Save</button></div></div>
      <div class="field" style="margin-top:12px"><label>Email</label><div class="row-flex"><input class="input" data-email value="${esc(u.email)}"><button class="btn btn-secondary" data-saveemail>Change</button></div>${u.new_email ? `<span class="hint">Waiting for you to confirm ${esc(u.new_email)}.</span>` : `<span class="hint">We’ll send a confirmation link to the new address.</span>`}</div></div>
    <h3 class="section-title">Password</h3><div class="card card-pad"><div class="row-flex"><div class="grow muted">${has("email") ? "Change the password you use to log in." : "Set a password so you can also log in with email."}</div><button class="btn btn-secondary" data-pw>${has("email") ? "Change password" : "Set password"}</button></div></div>
    <h3 class="section-title">Two-factor authentication</h3><div class="card card-pad">${totp.length ? `<div class="row-flex">${icon("shield", 15)}<div class="grow"><div style="font-weight:500">Authenticator app</div><div class="muted" style="font-size:12.5px">Added ${fmtDate(totp[0].created_at)}</div></div>${badge("Enabled", "green")}<button class="btn btn-ghost btn-sm" data-mfaoff="${totp[0].id}" style="color:var(--red)">Remove</button></div>` : `<div class="row-flex"><div class="grow muted">Protect your account with a code from an authenticator app like 1Password, Authy or Google Authenticator.</div><button class="btn btn-secondary" data-mfa>Enable</button></div>`}</div>
    <h3 class="section-title">Connected accounts</h3><div class="card">${[["google", "Google"], ["github", "GitHub"]].map(([p, l], i) => `<div class="row-flex" style="padding:14px 16px;${i ? "border-top:1px solid var(--border)" : ""}">${icon(p, 16)}<span class="grow">${l}</span>${has(p) ? `${badge("Connected", "green")}${identities.length > 1 ? `<button class="btn btn-ghost btn-sm" data-unlink="${p}">Disconnect</button>` : ""}` : `<button class="btn btn-secondary btn-sm" data-link="${p}">Connect</button>`}</div>`).join("")}</div>
    <h3 class="section-title">Teams</h3><div class="card">${state.teams.map((t, i) => `<div class="row-flex" style="padding:12px 16px;${i ? "border-top:1px solid var(--border)" : ""}"><span class="avatar sq yellow" style="width:24px;height:24px;font-size:11px">${esc(initials(t.name))}</span><span class="grow">${esc(t.name)}</span><span class="dim" style="font-size:12px">${esc(t.role)}</span>${t.id === state.team.id ? badge("Current", "gray") : `<button class="btn btn-ghost btn-sm" data-switch="${t.id}">Switch</button>`}</div>`).join("")}</div>
    <h3 class="section-title" style="color:var(--red)">Delete account</h3><div class="card card-pad row-flex" style="border-color:rgba(229,72,77,.35)"><div class="grow muted">Permanently delete your account. Teams where you’re the only member must be deleted first.</div><button class="btn btn-danger" data-delacct>Delete account</button></div></div>`;
  const reload = () => ctx.navigate("/profile", { replace: true });
  on(root, "click", "[data-savename]", async () => { const v = root.querySelector("[data-fname]").value.trim(); const { error } = await sb.from("profiles").update({ full_name: v || null }).eq("id", u.id); if (error) return errToast(error); await sb.auth.updateUser({ data: { full_name: v } }); toast("Name saved"); reload(); });
  on(root, "click", "[data-saveemail]", async () => {
    const v = root.querySelector("[data-email]").value.trim().toLowerCase(); if (v === u.email) return; if (!EMAIL_RE.test(v)) return toast("Enter a valid email", "err");
    const { error } = await sb.auth.updateUser({ email: v }); if (error) return errToast(error);
    formModal({ title: "Confirm your new email", fields: [{ name: "next", label: `Code sent to ${v}`, placeholder: "123456" }, { name: "current", label: `Code sent to ${u.email} (if you got one)`, placeholder: "Optional" }], submit: "Confirm change", validate: (f) => /^\d{6,10}$/.test(f.next.trim()),
      async onSubmit(f) {
        const a = await sb.auth.verifyOtp({ email: v, token: f.next.trim(), type: "email_change" }); if (a.error) throw new Error("The code for " + v + " didn’t work.");
        if (f.current.trim()) { const b = await sb.auth.verifyOtp({ email: u.email, token: f.current.trim(), type: "email_change" }); if (b.error) throw new Error("The code for " + u.email + " didn’t work."); }
        const { data } = await sb.auth.getUser(); state.user = data.user;
        toast(data.user?.email === v ? "Email address updated" : "Almost done. Enter the code sent to your current address too.", data.user?.email === v ? "ok" : "info", 6000); reload();
      } });
  });
  on(root, "click", "[data-pw]", () => formModal({ title: "Change password", fields: [{ name: "pw", label: "New password", type: "password", autocomplete: "new-password", hint: "At least 10 characters." }, { name: "pw2", label: "Confirm password", type: "password", autocomplete: "new-password" }], submit: "Save password", validate: (v) => v.pw.length >= 10 && v.pw === v.pw2, async onSubmit(v) { const { error } = await sb.auth.updateUser({ password: v.pw }); if (error) throw error; toast("Password updated"); } }));
  on(root, "click", "[data-mfa]", async () => {
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator " + Date.now().toString(36) });
    if (error) return errToast(error);
    modal({ title: "Set up two-factor", dismissable: false, body: `<p class="desc">Scan this QR code with your authenticator app, then enter the 6-digit code.</p><div style="display:grid;place-items:center;background:#fff;border-radius:10px;padding:14px;width:200px;margin:0 auto"><img src="${data.totp.qr_code}" width="172" height="172" alt="QR code"></div><div class="hint" style="text-align:center">Can’t scan? Enter this key: <button class="mono" data-copy="${esc(data.totp.secret)}" style="color:var(--fg)">${esc(data.totp.secret)}</button></div><div class="field"><label>Code</label><input class="input mono" inputmode="numeric" maxlength="6" data-code placeholder="123456" style="letter-spacing:.3em;text-align:center;font-size:16px"></div>`,
      foot: `<button class="btn btn-ghost" data-x2>Cancel</button><button class="btn btn-primary" data-ok>Verify</button>`,
      onMount(m, close) {
        m.querySelector("[data-x2]").onclick = async () => { await sb.auth.mfa.unenroll({ factorId: data.id }); close(); };
        const ok = async () => { const code = m.querySelector("[data-code]").value.trim(); if (!/^\d{6}$/.test(code)) return toast("Enter the 6-digit code", "err"); const { error: e } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code }); if (e) return toast("That code didn’t work — try the next one", "err"); toast("Two-factor enabled"); close(); reload(); };
        m.querySelector("[data-ok]").onclick = ok; m.querySelector("[data-code]").addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      } });
  });
  on(root, "click", "[data-mfaoff]", async (_e, b) => { if (!(await confirmModal({ title: "Remove two-factor", desc: "You’ll only need your password to log in.", confirm: "Remove" }))) return; const { error } = await sb.auth.mfa.unenroll({ factorId: b.dataset.mfaoff }); if (error) return errToast(error.message.includes("AAL2") ? new Error("Log out and back in with your code first, then try again.") : error); toast("Two-factor removed"); reload(); });
  on(root, "click", "[data-link]", async (_e, b) => { const { error } = await sb.auth.linkIdentity({ provider: b.dataset.link, options: { redirectTo: `${location.origin}/profile` } }); const name = b.dataset.link === "google" ? "Google" : "GitHub"; if (error) errToast(/manual linking/i.test(error.message) ? new Error(`Connecting ${name} to an existing login isn’t turned on yet.`) : error.message.includes("disabled") || error.message.includes("not enabled") ? new Error(`${name} sign-in isn’t enabled on this workspace yet.`) : error); });
  on(root, "click", "[data-unlink]", async (_e, b) => { const idn = identities.find((i) => i.provider === b.dataset.unlink); const { error } = await sb.auth.unlinkIdentity(idn); if (error) return errToast(error); toast("Disconnected"); reload(); });
  on(root, "click", "[data-switch]", (_e, b) => { setTeam(b.dataset.switch); location.href = "/emails"; });
  on(root, "click", "[data-delacct]", async () => {
    if (!(await confirmModal({ title: "Delete account", desc: "This permanently deletes your login. It can’t be undone.", confirm: "Delete account", typed: "DELETE" }))) return;
    try { await api("DELETE", "/account"); await sb.auth.signOut(); location.href = "/login?deleted=1"; } catch (e) { errToast(e); }
  });
}

// Settings → Security (Figma 9.9 single sign-on) and Settings → Connected apps (Figma 9.10), plus the OAuth consent page.
import { sb, state, api, must, SUPABASE_URL, setTeam } from "../lib/sb.js";
import { esc, icon, ago, toast, errToast, confirmModal, emptyState, badge, selectHtml, bindSelects, codeBlock, copyText, initials, on } from "../lib/ui.js";

const PROVIDERS = [["okta", "Okta"], ["entra", "Microsoft Entra ID"], ["google", "Google Workspace"], ["onelogin", "OneLogin"], ["jumpcloud", "JumpCloud"], ["saml", "Other SAML 2.0"]];
const ACS = `${SUPABASE_URL}/auth/v1/sso/saml/acs`;
const ENTITY = `${SUPABASE_URL}/auth/v1/sso/saml/metadata`;
const isAdmin = () => state.role === "admin";
const rootDomain = (n) => n.split(".").slice(-2).join(".");

// ---------------------------------------------------------------- 9.9 single sign-on
export async function sso(body) {
  const [cfgR, domsR] = await Promise.all([
    sb.from("sso_configs").select("*").eq("team_id", state.team.id).maybeSingle(),
    sb.from("domains").select("name,status").eq("team_id", state.team.id).eq("status", "verified"),
  ]);
  let cfg = cfgR.data || { provider: "okta", enforce: false, jit: true, status: "draft" };
  const roots = [...new Set((domsR.data || []).flatMap((d) => [rootDomain(d.name), d.name]))];
  const admin = isAdmin();
  const draw = () => {
    const status = cfg.status === "active" ? (cfg.enforce ? badge("Enforced", "green") : badge("Active", "green")) : cfg.status === "requested" ? badge("Waiting for activation", "yellow") : badge("Enterprise", "yellow");
    const copyIn = (v) => `<div class="input-wrap"><input class="input mono" readonly value="${esc(v)}"><button class="ibtn trail" data-copy="${esc(v)}" title="Copy">${icon("copy", 13)}</button></div>`;
    const dis = admin ? "" : "disabled";
    body.innerHTML = `<div class="card sso-card"><div class="row-flex" style="align-items:flex-start"><div><h3>Single sign-on (SAML)</h3><p class="sub">Let members sign in with your identity provider.</p></div><span class="grow"></span>${status}</div>
      ${cfg.status === "requested" ? `<div class="banner" style="margin:14px 0 0">${icon("info", 14)} Saved. Delivrie turns SAML on for ${esc(cfg.domain || "your domain")} within one business day and emails the admins. Test connection works once it’s active.</div>` : ""}
      <div class="sso-grid"><div><div class="eyebrow">1 · Your identity provider</div>
          <div class="field"><label>Provider</label>${selectHtml("provider", PROVIDERS.map(([v, l]) => ({ value: v, label: l })), cfg.provider)}</div>
          <div class="field"><label for="sso_url">SSO URL</label><input class="input mono" id="sso_url" value="${esc(cfg.sso_url || "")}" placeholder="https://yourco.okta.com/app/delivrie/sso/saml" ${dis}></div>
          <div class="field"><label for="entity_id">IdP entity ID</label><input class="input mono" id="entity_id" value="${esc(cfg.entity_id || "")}" placeholder="http://www.okta.com/exk…" ${dis}></div>
          <div class="field"><label for="metadata_url">Metadata URL <span class="dim">or paste the certificate below</span></label><input class="input mono" id="metadata_url" value="${esc(cfg.metadata_url || "")}" placeholder="https://yourco.okta.com/app/…/sso/saml/metadata" ${dis}></div>
          <div class="field"><label for="cert">X.509 certificate</label><textarea class="textarea mono" id="cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----" ${dis}>${esc(cfg.certificate || "")}</textarea></div></div>
        <div><div class="eyebrow">2 · Add Delivrie to your IdP</div>
          <div class="field"><label>ACS URL</label>${copyIn(ACS)}</div>
          <div class="field"><label>SP entity ID</label>${copyIn(ENTITY)}</div>
          <div class="field"><label>Verified domain</label>${roots.length ? selectHtml("domain", roots.map((r) => ({ value: r, label: r })), cfg.domain || roots[0]) : `<div class="hint">Verify a domain first. Members whose email is on that domain sign in with SSO.</div>`}</div>
          <p class="hint">Attributes: send <span class="mono">email</span> (NameID) and optionally <span class="mono">name</span>.</p></div></div>
      <div class="sso-row"><div><b>Require SSO for all members</b><span class="dim">Password and Google sign-in are turned off for @${esc(cfg.domain || roots[0] || "your domain")}</span></div><input type="checkbox" class="toggle" data-enforce ${cfg.enforce ? "checked" : ""} ${dis}></div>
      <div class="sso-row"><div><b>Just-in-time provisioning</b><span class="dim">New people from your identity provider join as members</span></div><input type="checkbox" class="toggle" data-jit ${cfg.jit ? "checked" : ""} ${dis}></div>
      ${admin ? `<div class="row-flex" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-secondary btn-sm" data-test>${icon("play", 12)} Test connection</button><button class="btn btn-primary btn-sm" data-save>${cfg.status === "draft" ? "Enable SSO" : "Save"}</button></div>` : `<p class="hint" style="margin-top:14px">Only team admins can change single sign-on.</p>`}</div>`;
    bindSelects(body);
  };
  draw();
  on(body, "click", "[data-copy]", (_e, b) => copyText(b.dataset.copy, "Copied"));
  on(body, "click", "[data-test]", async () => {
    if (cfg.status !== "active") return toast("Test connection works once SSO is active. Save your setup first.", "info", 5000);
    const { data, error } = await sb.auth.signInWithSSO({ domain: cfg.domain, options: { redirectTo: `${location.origin}/confirm` } });
    if (error) return errToast(error);
    window.open(data.url, "_blank", "noopener");
  });
  on(body, "click", "[data-save]", async (_e, b) => {
    const v = (id) => body.querySelector("#" + id).value.trim();
    const row = { team_id: state.team.id, provider: body.querySelector("input[name=provider]").value, sso_url: v("sso_url") || null, entity_id: v("entity_id") || null, metadata_url: v("metadata_url") || null, certificate: v("cert") || null, domain: body.querySelector("input[name=domain]")?.value || null, enforce: body.querySelector("[data-enforce]").checked, jit: body.querySelector("[data-jit]").checked, status: cfg.status === "active" ? "active" : "requested", updated_by: state.user.id };
    if (!row.domain) return toast("Verify a domain first", "err");
    if (!row.metadata_url && !(row.sso_url && row.entity_id && row.certificate)) return toast("Add a metadata URL, or the SSO URL, entity ID and certificate", "err");
    b.disabled = true;
    try {
      cfg = must(await sb.from("sso_configs").upsert(row).select().single());
      toast(cfg.status === "active" ? (cfg.enforce ? `SSO enforced for ${cfg.domain}` : "SSO settings saved") : "Saved. We’ll turn SSO on and email your admins.");
      draw();
    } catch (e) { errToast(e); b.disabled = false; }
  });
}

// ---------------------------------------------------------------- 9.10 connected apps
const SCOPE_LABEL = { send: "send", read: "read", manage: "manage" };
export async function connectedApps(body) {
  const draw = async () => {
    const rows = must(await sb.rpc("oauth_grants_for_team", { p_team: state.team.id })) || [];
    const live = rows.filter((r) => !r.revoked_at);
    body.innerHTML = `${live.length || rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>App</th><th>Access</th><th>Authorized by</th><th>Last used</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.revoked_at ? "revoked" : ""}"><td><div class="cell"><span class="avatar sq app-av">${esc(initials(r.client_name).slice(0, 2))}</span><span style="display:flex;flex-direction:column;min-width:0"><b style="font-weight:500">${esc(r.client_name)}</b><span class="dim" style="font-size:12px">${esc(r.client_uri ? r.client_uri.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "MCP client")}</span></span></div></td>
        <td>${r.scopes.map((s) => `<span class="scope ${s === "send" || s === "manage" ? "w" : ""}">${SCOPE_LABEL[s] || esc(s)}</span>`).join(" ")}</td><td class="muted">${esc(r.authorized_by || "—")}</td><td class="muted">${r.revoked_at ? `Revoked ${ago(r.revoked_at)}` : r.last_used_at ? ago(r.last_used_at) : "Not used yet"}</td>
        <td class="r">${!r.revoked_at && isAdmin() ? `<button class="btn btn-secondary btn-sm" data-revoke="${r.id}" data-name="${esc(r.client_name)}">Revoke</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="card">${emptyState({ icon: "link", title: "No connected apps yet", desc: "Connect Claude Code, Cursor, v0, Codex or any MCP client with OAuth. You approve what each app can do, and you can revoke it here any time." })}</div>`}
      <p class="dim sm foot-note">${icon("info", 12)} Apps connect with OAuth 2.1 and only get the scopes you approved. API keys are listed separately under API keys.</p>
      <h3 class="section-title">Connect an app</h3><div class="card card-pad"><p class="muted" style="margin:0 0 10px">Point any MCP client at the Delivrie server. It opens a Delivrie page where you choose the team and approve access.</p>${codeBlock("claude mcp add --transport http delivrie https://delivrie.io/api/mcp", { lang: "sh", lines: false })}</div>`;
  };
  await draw();
  on(body, "click", "[data-revoke]", async (_e, b) => {
    const name = b.dataset.name;
    if (!(await confirmModal({ title: `Revoke ${esc(name)}?`, desc: `${esc(name)} loses access to ${esc(state.team.name)} right away. Anything it’s doing stops on its next request. You can connect it again later.`, confirm: "Revoke access" }))) return;
    try { must(await sb.rpc("revoke_oauth_grant", { p_grant: b.dataset.revoke })); toast(`${name} can no longer access ${state.team.name}`); await draw(); } catch (e) { errToast(e); }
  });
}

// ---------------------------------------------------------------- OAuth consent (/oauth/authorize)
const SCOPE_ITEMS = {
  send: [["send", "Send emails from verified domains"]],
  read: [["list", "Read emails, logs and delivery events"], ["globe", "Read domains and DNS status"], ["users", "Read contacts and segments"]],
  manage: [["edit", "Create and change domains, contacts, broadcasts, templates, automations and webhooks"]],
};
export async function authorize(ctx) {
  const q = ctx.query;
  const root = ctx.root;
  document.title = "Authorize app · Delivrie";
  const fail = (msg) => { root.innerHTML = `<div class="consent-wrap"><div class="consent card">${emptyState({ icon: "alert", title: "Can’t connect this app", desc: msg })}</div></div>`; };
  if (!q.client_id || q.response_type !== "code") return fail("The link is missing details. Start the connection again from the app.");
  const { data: client } = await sb.from("oauth_clients").select("id,name,client_uri,redirect_uris").eq("id", q.client_id).maybeSingle();
  if (!client) return fail("This app isn’t registered with Delivrie. Start the connection again from the app.");
  const scopes = String(q.scope || "send read").split(/[\s,]+/).filter((s) => s in SCOPE_ITEMS);
  let use = scopes.length ? scopes : ["send", "read"];
  const askedManage = use.includes("manage");
  const name = client.name;
  const teams = state.teams || [];
  root.innerHTML = `<div class="consent-wrap"><div class="consent card">
    <div class="consent-logos"><span class="avatar sq app-av lg">${esc(initials(name).slice(0, 2))}</span><span class="dots">•••</span><img src="/assets/mark.svg" width="34" height="25" alt="Delivrie"></div>
    <h1>${esc(name)} wants to access your Delivrie team</h1>
    <div class="field"><label>Team</label>${selectHtml("team", teams.map((t) => ({ value: t.id, label: t.name })), state.team?.id)}</div>
    <div class="consent-scopes"><div class="eyebrow">This will allow ${esc(name)} to</div>${use.flatMap((s) => SCOPE_ITEMS[s]).map(([i, t]) => `<div>${icon(i, 13)}<span>${t}</span></div>`).join("")}
      ${askedManage ? "" : `<label class="consent-opt"><input type="checkbox" class="checkbox" data-manage><span>Also let it make changes: domains, contacts, broadcasts, templates, automations and webhooks</span></label>`}</div>
    <p class="dim sm" style="text-align:center" data-limits>${esc(name)} can’t change billing or delete your team${askedManage ? "" : " or data"}. You can revoke access any time in Settings → Connected apps.</p>
    <div class="consent-btns"><button class="btn btn-secondary" data-deny>Cancel</button><button class="btn btn-primary" data-allow>Authorize</button></div>
    <p class="dim sm" style="text-align:center">Signed in as ${esc(state.user?.email || "")} · <a href="#" data-switch>Not you?</a></p>
    ${client.redirect_uris?.[0] ? `<p class="dim sm" style="text-align:center;margin-top:-4px">You’ll be sent back to <span class="mono">${esc(new URL(q.redirect_uri || client.redirect_uris[0]).host || q.redirect_uri)}</span></p>` : ""}</div></div>`;
  bindSelects(root, (n, v) => { if (n === "team") setTeam(v); });
  const go = async (deny, btn) => {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const manage = root.querySelector("[data-manage]")?.checked;
      const scope = [...new Set([...use, ...(manage ? ["manage"] : [])])].join(" ");
      const r = await api("POST", "/dashboard/oauth/authorize", { client_id: q.client_id, redirect_uri: q.redirect_uri, scope, state: q.state, code_challenge: q.code_challenge, code_challenge_method: q.code_challenge_method, deny });
      location.href = r.redirect;
    } catch (e) { errToast(e); btn.disabled = false; btn.textContent = deny ? "Cancel" : "Authorize"; }
  };
  on(root, "click", "[data-allow]", (_e, b) => go(false, b));
  on(root, "click", "[data-deny]", (_e, b) => go(true, b));
  on(root, "click", "[data-switch]", async (e) => { e.preventDefault(); await sb.auth.signOut(); location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; });
}

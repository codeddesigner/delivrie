import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, toast, errToast, menu, confirmModal, emptyState, skeletonRows, statusBadge, selectHtml, bindSelects, on, codeBlock, drawer } from "../lib/ui.js";

const T = () => state.team.id;
const FLAG = { "us-east-1": "🇺🇸", "us-east-2": "🇺🇸", "us-west-2": "🇺🇸", "eu-west-1": "🇮🇪", "eu-west-2": "🇬🇧", "eu-central-1": "🇩🇪", "eu-north-1": "🇸🇪", "ap-south-1": "🇮🇳", "ap-southeast-1": "🇸🇬", "ap-southeast-2": "🇦🇺", "ap-northeast-1": "🇯🇵", "ca-central-1": "🇨🇦", "sa-east-1": "🇧🇷" };

export async function list(ctx) {
  ctx.crumb("globe", "Domains");
  const root = ctx.root;
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Domains</h1><div class="actions"><a class="btn btn-primary" href="/domains/new">${icon("plus", 13)} Add domain</a></div></div><div data-body><div class="table-wrap"><table class="t"><tbody>${skeletonRows(4, 3)}</tbody></table></div></div></div>`;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data, error }, { data: vol }] = await Promise.all([sb.from("domains").select("*").eq("team_id", T()).order("created_at", { ascending: false }), sb.rpc("domain_volume", { p_team: T(), p_since: since })]);
  if (error) throw error;
  const v = Object.fromEntries((vol || []).map((r) => [r.domain_id, r]));
  const body = root.querySelector("[data-body]");
  if (!data.length) { body.innerHTML = emptyState({ icon: "globe", title: "No domains yet", desc: "Add a domain you own to send from your own address with full DKIM, SPF and DMARC alignment.", action: `<a class="btn btn-primary" href="/domains/new">${icon("plus", 13)} Add domain</a>` }); return; }
  body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Domain</th><th>Status</th><th>Region</th><th class="r">Emails · 30d</th><th class="r">Added</th><th></th></tr></thead><tbody>${data.map((d) => `<tr class="clickable" data-id="${d.id}"><td><div class="cell">${icon("globe", 13, "dim")}<span>${esc(d.name)}</span>${d.receiving_enabled ? `<span class="badge gray" style="margin-left:4px">Receiving</span>` : ""}</div></td><td>${statusBadge(d.status)}</td><td class="muted">${FLAG[d.region] || ""} ${esc(d.region)}</td><td class="r">${num(v[d.id]?.emails)}</td><td class="r muted">${ago(d.created_at)}</td><td class="act"><button class="ibtn" data-row="${d.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`;
  on(root, "click", "tr[data-id]", (e, tr) => { if (!e.target.closest("[data-row]")) ctx.navigate(`/domains/${tr.dataset.id}`); });
  on(root, "click", "[data-row]", (e, b) => { e.stopPropagation(); const d = data.find((x) => x.id === b.dataset.row); menu(b, [
    { label: "View DNS records", icon: "list", onClick: () => ctx.navigate(`/domains/${d.id}`) },
    { label: "Verify now", icon: "refresh", onClick: () => verify(d.id).then(() => ctx.navigate("/domains", { replace: true })) },
    { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(d.id).then(() => toast("ID copied")) },
    { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: () => del(d, ctx) }], { align: "right" }); });
}
async function verify(id) { try { const d = await api("POST", `/domains/${id}/verify`); toast(d.status === "verified" ? "Domain verified" : "Checked DNS — some records aren’t visible yet", d.status === "verified" ? "ok" : "info"); return d; } catch (e) { errToast(e); } }
async function del(d, ctx) {
  if (!(await confirmModal({ title: "Delete domain", desc: `You won’t be able to send from <b>${esc(d.name)}</b> anymore and API keys scoped to it stop working. Remove its DNS records afterwards.`, confirm: "Delete domain", typed: d.name }))) return;
  try { await api("DELETE", `/domains/${d.id}`); toast("Domain deleted"); ctx.navigate("/domains"); } catch (e) { errToast(e); }
}

export async function add(ctx) {
  ctx.crumb("globe", "Add domain", ["Domains", "/domains"]);
  const root = ctx.root;
  let status = null;
  try { status = await api("GET", "/dashboard/status"); } catch { }
  const regions = status?.regions?.length ? status.regions : [{ id: "eu-west-1", label: "Ireland (eu-west-1)" }];
  root.innerHTML = `<div class="page narrow"><div class="page-head"><h1>Add domain</h1></div>
    ${status && !status.aws?.configured ? `<div class="banner warn">${icon("alert", 14)} Sending isn’t set up on this workspace yet, so domains can’t be added. Contact support@delivrie.io.</div>` : ""}
    <div class="steps"><div class="step active"><div class="step-num">1</div><div class="step-card"><h3>Domain</h3><p class="sub">We recommend a subdomain like <span class="mono">updates.example.com</span> to keep your sending reputation separate from your main domain.</p>
      <div class="field"><label>Name</label><input class="input" data-name placeholder="updates.example.com" autofocus></div>
      ${regions.length > 1 ? `<div class="field" style="margin-top:12px"><label>Region</label>${selectHtml("region", regions.map((r) => ({ value: r.id, label: `${FLAG[r.id] || ""} ${r.label}` })), regions[0].id)}<span class="hint">Where emails are sent from. Pick the one closest to your users — it can’t be changed later.</span></div>` : `<input type="hidden" name="region" value="${regions[0].id}">`}
      <details style="margin-top:14px"><summary class="muted" style="cursor:pointer">Advanced options</summary><div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
        <div class="field"><label>Custom return path</label><input class="input mono" data-rp value="send"><span class="hint">Subdomain used for SPF and bounces. Defaults to <span class="mono">send</span>.</span></div>
        <label class="row-flex" style="justify-content:space-between"><span>Click tracking</span><input type="checkbox" class="toggle" data-click></label>
        <label class="row-flex" style="justify-content:space-between"><span>Open tracking</span><input type="checkbox" class="toggle" data-open></label>
        <label class="row-flex" style="justify-content:space-between"><span>Receive emails on this domain</span><input type="checkbox" class="toggle" data-recv></label></div></details>
      <div class="row-flex" style="margin-top:16px"><button class="btn btn-primary" data-add>Add domain</button></div></div></div>
      <div class="step disabled"><div class="step-num">2</div><div class="step-card"><h3>Add DNS records</h3><p class="sub">Copy the records into your DNS provider.</p></div></div>
      <div class="step disabled"><div class="step-num">3</div><div class="step-card"><h3>Verify</h3><p class="sub">We check DNS automatically every few minutes for 72 hours.</p></div></div></div></div>`;
  bindSelects(root);
  const go = async (e) => {
    const name = root.querySelector("[data-name]").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) return toast("Enter a valid domain like updates.example.com", "err");
    const btn = root.querySelector("[data-add]"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Adding`;
    try {
      const d = await api("POST", "/domains", { name, region: root.querySelector("input[name=region]").value, return_path: root.querySelector("[data-rp]").value.trim() || "send", click_tracking: root.querySelector("[data-click]").checked, open_tracking: root.querySelector("[data-open]").checked, receiving_enabled: root.querySelector("[data-recv]").checked });
      toast("Domain added — now add the DNS records"); ctx.navigate(`/domains/${d.id}?new=1`);
    } catch (err) {
      btn.disabled = false; btn.textContent = "Add domain";
      if (err.status === 409 && /another Delivrie team/.test(err.message)) return showClaim(name);
      errToast(err);
    }
  };
  // Figma 7.4: the domain is on another team. Offer to claim it by proving DNS control.
  const showClaim = (name) => {
    const input = root.querySelector("[data-name]");
    input.classList.add("error");
    root.querySelector("[data-claim-box]")?.remove();
    input.closest(".field").insertAdjacentHTML("beforeend", `<div class="field-err">${esc(name)} is already added to another Delivrie team.</div><div class="claim-box" data-claim-box>${icon("alert", 15)}<div class="grow"><b>Is this your domain?</b><span>If a former teammate or agency added ${esc(name)} to their own team, you can prove you control its DNS and move it here. The other team loses access to send from it and gets a domain.updated webhook.</span><button class="btn btn-primary btn-sm" data-claim>Claim ${esc(name)}</button></div></div>`);
    root.querySelector("[data-claim]").onclick = () => claimModal(ctx, name, root.querySelector("input[name=region]").value);
    input.addEventListener("input", () => { input.classList.remove("error"); root.querySelector("[data-claim-box]")?.remove(); root.querySelector(".field-err")?.remove(); }, { once: true });
  };
  root.querySelector("[data-add]").onclick = go;
  root.querySelector("[data-name]").addEventListener("keydown", (e) => { if (e.key === "Enter") go(e); });
}

async function claimModal(ctx, name, region) {
  let cl;
  try { cl = await api("POST", "/domains/claims", { name, region }); } catch (e) { return errToast(e); }
  const { modal, copyText } = await import("../lib/ui.js");
  modal({ title: `Claim ${esc(name)}`, body: `<p class="desc">Add this TXT record at your DNS provider to prove you control ${esc(name)}. You can remove it once the claim completes.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th></th></tr></thead><tbody><tr><td class="mono">${cl.record.type}</td><td class="mono">${esc(cl.record.name)}</td><td class="mono">${esc(cl.record.value)}</td><td class="act"><button class="ibtn" data-copyv title="Copy value">${icon("copy", 13)}</button></td></tr></tbody></table></div>
      <p class="hint" style="margin-top:10px">${icon("clock", 12)} Claims expire after 72 hours (${fmtDateTime(cl.expires_at)}). DNS changes can take up to an hour.</p><div data-claim-msg></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Verify and claim</button>`,
    onMount(m, close) {
      m.querySelector("[data-copyv]").onclick = () => copyText(cl.record.value, "Value copied");
      m.querySelector("[data-go]").onclick = async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.innerHTML = `<span class="spinner"></span> Checking DNS`;
        try {
          const r = await api("POST", `/domains/claims/${cl.id}/verify`);
          if (r.claimed) { close(); toast(`${name} moved to ${state.team.name}`); return ctx.navigate(`/domains/${r.domain_id}`); }
          m.querySelector("[data-claim-msg]").innerHTML = `<div class="banner warn" style="margin:10px 0 0">${icon("alert", 14)} ${esc(r.message)}</div>`;
        } catch (e) { errToast(e); }
        b.disabled = false; b.textContent = "Verify and claim";
      };
    } });
}

export const recStatus = (s) => s === "verified" ? `<span class="cell" style="color:var(--green-2)">${icon("check-circle", 12)} Verified</span>` : s === "optional" ? `<span class="dim">Optional</span>` : s === "failed" ? `<span class="cell" style="color:var(--red)">${icon("x-circle", 12)} Not found</span>` : `<span class="cell dim">${icon("clock", 12)} Pending</span>`;
export function recordsTable(d, group) {
  const recs = (d.records || []).filter((r) => group.includes(r.group));
  if (!recs.length) return "";
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Type</th><th>Name</th><th>Content</th><th>TTL</th><th>Priority</th><th>Status</th></tr></thead><tbody>${recs.map((r) => `<tr><td class="mono">${esc(r.type)}</td><td><button class="mono copyable" data-copy="${esc(r.name)}" title="Copy">${esc(r.name)} ${icon("copy", 11, "dim")}</button></td><td style="max-width:320px"><button class="mono copyable ellipsis" style="max-width:300px;display:inline-flex;gap:4px" data-copy="${esc(r.value)}" title="${esc(r.value)}"><span class="ellipsis">${esc(r.value)}</span>${icon("copy", 11, "dim")}</button></td><td class="muted">${esc(r.ttl)}</td><td class="muted">${r.priority ?? ""}</td><td>${recStatus(r.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

export async function detail(ctx) {
  const id = ctx.params.id;
  let d;
  try { d = await api("GET", `/domains/${id}`); } catch (e) { toast(e.message, "err"); return ctx.navigate("/domains", { replace: true }); }
  const { data: raw } = await sb.from("domains").select("verified_at,dns_found_at,last_checked_at,created_at").eq("id", id).single();
  ctx.crumb("globe", d.name, ["Domains", "/domains"]);
  const root = ctx.root;
  let tab = ctx.query.tab === "configuration" ? "configuration" : "records";
  const tl = [["Domain added", raw.created_at, true], ["DNS records found", raw.dns_found_at, !!raw.dns_found_at], ["Domain verified", raw.verified_at, d.status === "verified"]];
  function draw() {
    root.innerHTML = `<div class="page wide"><div class="page-head"><div><div class="eyebrow">${statusBadge(d.status)}<span class="dim" style="margin-left:8px">${FLAG[d.region] || ""} ${esc(d.region_label || d.region)}</span></div><h1 style="margin-top:6px">${esc(d.name)}</h1></div>
      <div class="actions"><button class="btn btn-secondary" data-verify>${icon("refresh", 13)} Verify DNS</button><button class="ibtn boxed" data-more>${icon("more")}</button></div></div>
      ${ctx.query.new && d.status !== "verified" ? `<div class="banner">${icon("info", 14)} Add these records at your DNS provider (Cloudflare, Route 53, GoDaddy…). Names are relative to <b>${esc(d.name)}</b>; some providers want the full name, e.g. <span class="mono">${esc(d.records?.[0]?.name || "")}.${esc(d.name)}</span>.</div>` : ""}
      ${d.status === "failed" ? `<div class="banner warn">${icon("alert", 14)} We couldn’t find your records within 72 hours. Double-check them, then click Verify DNS to start again.<a class="btn btn-secondary btn-sm" href="/docs#domain-not-verifying">Troubleshoot</a></div>` : ""}
      <div class="card card-pad" style="margin-bottom:18px"><div class="timeline">${tl.map(([n, t, ok]) => `<div class="tl-item"><div class="tl-dot" style="${ok ? "border-color:#2e5b45;background:rgba(63,166,114,.12);color:var(--green-2)" : "color:var(--fg-3)"}">${icon(ok ? "check" : "clock", 13)}</div><div class="n">${n}</div><div class="t">${t ? fmtDateTime(t) : d.status === "pending" ? "Checking…" : "—"}</div></div>`).join("")}</div></div>
      <div class="ul-tabs"><button class="ul-tab ${tab === "records" ? "on" : ""}" data-tab="records">DNS records</button><button class="ul-tab ${tab === "configuration" ? "on" : ""}" data-tab="configuration">Configuration</button></div>
      <div style="margin-top:18px">${tab === "records" ? `
        <h3 class="section-title" style="margin-top:0">Domain verification <span class="badge gray">DKIM</span></h3>${recordsTable(d, ["dkim"])}
        <h3 class="section-title">Enable sending <span class="badge gray">SPF</span></h3>${recordsTable(d, ["sending"])}
        <h3 class="section-title">DMARC <span class="dim" style="font-weight:400">Recommended</span></h3>${recordsTable(d, ["dmarc"])}<p class="hint" style="margin-top:8px">Start with <span class="mono">p=none</span>, then move to <span class="mono">quarantine</span> once everything passes. <a class="link" href="/docs#dmarc">Learn more</a></p>
        ${d.receiving_enabled ? `<h3 class="section-title" style="display:flex;align-items:center;gap:8px">Enable receiving <span class="badge gray">MX</span><a class="btn btn-ghost btn-sm" style="margin-left:auto" href="/domains/${d.id}/receiving">Receiving settings ${icon("arrow-right", 12)}</a></h3>${recordsTable(d, ["receiving"])}<p class="hint" style="margin-top:8px">If this domain already receives mail elsewhere, use a subdomain for inbound so you don’t replace your existing MX.</p>` : ""}`
      : `<div class="card"><div style="padding:16px 18px;border-bottom:1px solid var(--border)"><div class="row-flex" style="justify-content:space-between"><div><div style="font-weight:500">Click tracking</div><div class="muted" style="font-size:12.5px">Rewrite links to count clicks on emails from this domain.</div></div><input type="checkbox" class="toggle" data-cfg="click_tracking" ${d.click_tracking ? "checked" : ""}></div></div>
        <div style="padding:16px 18px;border-bottom:1px solid var(--border)"><div class="row-flex" style="justify-content:space-between"><div><div style="font-weight:500">Open tracking</div><div class="muted" style="font-size:12.5px">Add a 1×1 pixel to count opens. Some inboxes preload images, so treat opens as a rough signal.</div></div><input type="checkbox" class="toggle" data-cfg="open_tracking" ${d.open_tracking ? "checked" : ""}></div></div>
        <div style="padding:16px 18px;border-bottom:1px solid var(--border)"><div class="row-flex" style="justify-content:space-between"><div><div style="font-weight:500">TLS</div><div class="muted" style="font-size:12.5px">Opportunistic tries TLS and falls back; Enforced refuses to deliver without it.</div></div><div style="width:170px">${selectHtml("tls", [{ value: "opportunistic", label: "Opportunistic" }, { value: "enforced", label: "Enforced" }], d.tls)}</div></div></div>
        <div style="padding:16px 18px;border-bottom:1px solid var(--border)"><div class="row-flex" style="justify-content:space-between"><div><div style="font-weight:500">Receiving</div><div class="muted" style="font-size:12.5px">Accept email sent to any address @${esc(d.name)} and get it in Emails → Receiving and the <span class="mono">email.received</span> webhook.</div></div><input type="checkbox" class="toggle" data-cfg="receiving_enabled" ${d.receiving_enabled ? "checked" : ""}></div></div>
        <div style="padding:16px 18px"><div class="row-flex" style="justify-content:space-between;gap:16px"><div><div style="font-weight:500">Custom return path</div><div class="muted" style="font-size:12.5px">Subdomain for SPF and bounce handling. Changing it means updating your SPF records.</div></div><div class="row-flex" style="width:260px"><input class="input mono" data-rp value="${esc(d.return_path)}"><span class="dim mono" style="font-size:12px;white-space:nowrap">.${esc(d.name)}</span></div></div><div class="row-flex" style="justify-content:flex-end;margin-top:8px"><button class="btn btn-secondary btn-sm" data-saverp>Save</button></div></div></div>`}</div></div>`;
    bindSelects(root, (k, v) => k === "tls" && patch({ tls: v }));
  }
  async function patch(p) { try { d = await api("PATCH", `/domains/${id}`, p); toast("Saved"); draw(); } catch (e) { errToast(e); draw(); } }
  on(root, "click", "[data-tab]", (_e, b) => { tab = b.dataset.tab; history.replaceState({}, "", `/domains/${id}${tab === "configuration" ? "?tab=configuration" : ""}`); draw(); });
  on(root, "change", "[data-cfg]", (_e, cb) => patch({ [cb.dataset.cfg]: cb.checked }));
  on(root, "click", "[data-saverp]", () => patch({ return_path: root.querySelector("[data-rp]").value.trim().toLowerCase() }));
  on(root, "click", "[data-verify]", async (_e, b) => { b.disabled = true; b.innerHTML = `<span class="spinner"></span> Checking`; const u = await verify(id); if (u) d = u; ctx.query.new = null; draw(); });
  on(root, "click", "[data-more]", (_e, b) => menu(b, [
    { label: "Copy records as text", icon: "copy", onClick: () => navigator.clipboard.writeText((d.records || []).map((r) => `${r.type}\t${r.name}.${d.name}\t${r.priority ? r.priority + " " : ""}${r.value}`).join("\n")).then(() => toast("Records copied")) },
    { label: "Send with this domain", icon: "code", onClick: () => drawer({ title: "Send from " + esc(d.name), wide: true, body: codeBlock(`curl -X POST ${location.origin}/api/emails \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "from": "${state.team.name} <hello@${d.name}>",\n    "to": ["you@example.com"],\n    "subject": "Hello",\n    "html": "<p>It works!</p>"\n  }'`, { lang: "sh" }) }) },
    { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(id).then(() => toast("ID copied")) },
    { sep: true }, { label: "Delete domain", icon: "trash", danger: true, onClick: () => del(d, ctx) }], { align: "right" }));
  draw();
}

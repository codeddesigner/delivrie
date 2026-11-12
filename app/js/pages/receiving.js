// Receiving (Figma 12.1 set up receiving, 12.2 received email + forward).
import { sb, state, api, must } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, toast, errToast, modal, emptyState, codeBlock, copyText, initials, badge, on, selectHtml, bindSelects } from "../lib/ui.js";

const host = (d) => d.receiving_subdomain ? `${d.receiving_subdomain}.${d.name}` : d.name;

// ---------------------------------------------------------------- empty state on Emails → Receiving
export function receivingIntro() {
  return `<div class="card recv-hero"><div class="rh-ico">${icon("inbox", 18)}</div><div class="grow"><h3>Receive emails on your domain</h3>
      <p class="muted">Point an MX record at Delivrie and every email sent to that address is parsed, stored, and delivered to your webhook as <span class="mono">email.received</span>. Use it for support inboxes, reply handling and agents.</p>
      <div class="row-flex" style="gap:8px;margin-top:12px"><button class="btn btn-primary btn-sm" data-recv-setup>Set up receiving</button><a class="btn btn-secondary btn-sm" href="/docs/domains">${icon("book", 12)} Read the guide</a></div></div></div>
    <div class="recv-steps">${[["globe", "Add an MX record", "Use a subdomain like in.yourdomain.com so your existing mail keeps working."], ["webhook", "Get email.received", "Parsed headers, text, HTML and attachment names in one payload."], ["reply", "Reply in threads", "Answer from the Inbox with correct Message-ID threading."]].map(([i, t, d]) => `<div class="card"><span class="rs-ico">${icon(i, 14)}</span><b>${t}</b><span class="muted">${d}</span></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- set up receiving modal
export async function setupModal(ctx) {
  const doms = must(await sb.from("domains").select("id,name,status,receiving_enabled,receiving_subdomain").eq("team_id", state.team.id).order("created_at"));
  if (!doms.length) {
    toast("Add a domain first, then set up receiving on it.", "info");
    return ctx.navigate("/domains/new");
  }
  let pick = doms.find((d) => d.status === "verified") || doms[0];
  let mode = "all";
  return modal({ title: "Set up receiving", body: `<p class="desc" style="margin-top:-4px">Choose where inbound mail should arrive. We recommend a subdomain so mail to your root domain is unaffected.</p>
      <div class="field"><label>Domain</label>${selectHtml("dom", doms.map((d) => ({ value: d.id, label: d.name + (d.status === "verified" ? "" : ` · ${d.status.replace("_", " ")}`) })), pick.id)}</div>
      <div class="field"><label for="rsub">Receiving subdomain</label><input class="input" id="rsub" data-sub value="in.${esc(pick.name)}"><div class="hint" data-sub-hint></div></div>
      <div class="picks"><label class="pick on"><input type="radio" name="rmode" value="all" checked><span class="radio"></span><span class="grow"><b>Accept all addresses</b><span class="dim" data-all-hint></span></span></label>
      <label class="pick"><input type="radio" name="rmode" value="specific"><span class="radio"></span><span class="grow"><b>Only specific addresses</b><span class="dim">Drop mail to addresses you haven’t listed</span></span></label></div>
      <div class="field" data-addrs hidden style="margin-top:10px"><label for="raddr">Addresses</label><textarea class="textarea" id="raddr" rows="2" placeholder="support, orders, billing"></textarea><div class="hint">Comma-separated. A name like support becomes support@<span data-hostname></span>.</div></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Continue</button>`,
    onMount(m, close) {
      const sub = m.querySelector("[data-sub]");
      const hostname = () => { const v = sub.value.trim().toLowerCase(); return v.endsWith(pick.name) ? v : v ? `${v}.${pick.name}` : pick.name; };
      const hint = () => { const h = hostname(); m.querySelector("[data-sub-hint]").textContent = `Anything@${h} will be accepted`; m.querySelector("[data-all-hint]").textContent = `support@, orders@, anything@${h}`; m.querySelector("[data-hostname]").textContent = h; };
      hint();
      sub.addEventListener("input", hint);
      bindSelects(m, (name, v) => { if (name === "dom") { pick = doms.find((d) => d.id === v); sub.value = `in.${pick.name}`; hint(); } });
      on(m, "change", "input[name=rmode]", (_e, i) => { mode = i.value; m.querySelectorAll(".pick").forEach((p) => p.classList.toggle("on", p.querySelector("input").checked)); m.querySelector("[data-addrs]").hidden = mode !== "specific"; });
      m.querySelector("[data-go]").onclick = async (ev) => {
        const btn = ev.currentTarget, h = hostname();
        const subdomain = h === pick.name ? "" : h.slice(0, -(pick.name.length + 1));
        const addrs = m.querySelector("#raddr").value.trim();
        if (mode === "specific" && !addrs) return toast("List at least one address, or accept all addresses", "err");
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
        try {
          await api("PATCH", `/domains/${pick.id}`, { receiving_subdomain: subdomain, receiving_mode: mode, ...(mode === "specific" ? { receiving_addresses: addrs } : {}), ...(pick.receiving_enabled ? {} : { receiving_enabled: true }) });
          close(); ctx.navigate(`/domains/${pick.id}/receiving`);
        } catch (e) { errToast(e); btn.disabled = false; btn.textContent = "Continue"; }
      };
    } });
}

// ---------------------------------------------------------------- /domains/:id/receiving (MX record + webhook)
export async function setup(ctx) {
  let d;
  try { d = await api("GET", `/domains/${ctx.params.id}`); } catch (e) { toast(e.message, "err"); return ctx.navigate("/domains", { replace: true }); }
  ctx.crumb("globe", "Receiving", [d.name, `/domains/${d.id}`]);
  const root = ctx.root;
  const draw = async () => {
    const hooks = must(await sb.from("webhooks").select("id,endpoint,events,status").eq("team_id", state.team.id));
    const listening = hooks.filter((h) => h.status === "enabled" && (h.events || []).some((x) => x === "email.received" || x === "*"));
    const recs = (d.records || []).filter((r) => r.group === "receiving");
    const mx = recs.find((r) => r.type === "MX");
    const ok = mx?.status === "verified";
    const h = host(d);
    const st = (s) => s === "verified" ? badge("Verified", "green") : s === "optional" ? badge("Optional", "gray") : s === "failed" ? badge("Failed", "red") : badge("Pending", "yellow");
    root.innerHTML = `<div class="page wide">
      <div class="page-head"><div><h1>${ok ? `${esc(h)} is receiving email` : "Add this MX record"}</h1><p class="muted" style="margin:4px 0 0">${ok ? `Every email sent to ${d.receiving_mode === "specific" ? "the addresses below" : `anything@${esc(h)}`} arrives in Emails → Receiving and the Inbox.` : `Add it at your DNS provider for ${esc(h)}. Verification usually takes a few minutes.`}</p></div>
        <div class="actions">${ok ? `<a class="btn btn-secondary btn-sm" href="/emails?tab=receiving">${icon("mail", 13)} View received</a>` : ""}<button class="btn ${ok ? "btn-secondary" : "btn-primary"} btn-sm" data-verify>${ok ? "Check again" : "Verify record"}</button></div></div>
      ${!d.receiving_enabled ? `<div class="banner warn">${icon("alert", 14)} Receiving is turned off for ${esc(d.name)}. <button class="btn btn-secondary btn-sm" data-enable>Turn on</button></div>` : ""}
      <div class="table-wrap"><table class="t"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Priority</th><th>TTL</th><th>Status</th></tr></thead><tbody>${recs.map((r) => `<tr><td class="mono">${esc(r.type)}</td><td><button class="mono copyable" data-copy="${esc(r.name)}">${esc(r.name)} ${icon("copy", 11, "dim")}</button></td><td><button class="mono copyable" data-copy="${esc(r.value)}">${esc(r.value)} ${icon("copy", 11, "dim")}</button></td><td class="muted">${r.priority ?? "—"}</td><td class="muted">${esc(r.ttl)}</td><td>${st(r.status)}</td></tr>`).join("")}</tbody></table></div>
      ${d.receiving_subdomain ? `<div class="banner" style="margin-top:14px">${icon("info", 14)} Your root domain ${esc(d.name)} keeps its existing MX records. Only ${esc(h)} is routed to Delivrie.</div>` : `<div class="banner warn" style="margin-top:14px">${icon("alert", 14)} This MX record is on ${esc(d.name)} itself, so it replaces any mail provider there. Use a subdomain if the domain already receives mail.</div>`}
      <div class="grid2" style="margin-top:22px">
        <div><h3 class="section-title">Addresses</h3><div class="card card-pad">${d.receiving_mode === "specific" ? `<div class="chip-row">${(d.receiving_addresses || []).map((a) => `<span class="pill mono">${esc(a)}</span>`).join("")}</div><p class="hint" style="margin:10px 0 0">Mail to any other address at ${esc(h)} is dropped.</p>` : `<div class="row-flex">${icon("check-circle", 14)}<span>Accepting every address at <span class="mono">${esc(h)}</span></span></div>`}
          <button class="btn btn-ghost btn-sm" data-change style="margin-top:10px">Change</button></div></div>
        <div><h3 class="section-title">Webhook</h3>${listening.length ? listening.map((w) => `<div class="card pm-row"><span class="dim">${icon("webhook", 14)}</span><span class="mono grow ellipsis">${esc(w.endpoint)}</span><span class="badge yellow">email.received</span><a class="btn btn-secondary btn-sm" href="/webhooks/${w.id}">Change</a></div>`).join("") : `<div class="card card-pad"><p class="muted" style="margin:0 0 10px">No webhook is listening for <span class="mono">email.received</span> yet. Received mail still shows in Emails and the Inbox.</p><a class="btn btn-secondary btn-sm" href="/webhooks?new=1&event=email.received">${icon("plus", 12)} Add webhook</a></div>`}</div>
      </div></div>`;
  };
  await draw();
  on(root, "click", "[data-copy]", (_e, b) => copyText(b.dataset.copy, "Copied"));
  on(root, "click", "[data-verify]", async (_e, b) => {
    b.disabled = true; b.innerHTML = `<span class="spinner"></span> Checking`;
    try {
      d = await api("POST", `/domains/${d.id}/verify`);
      const mx = (d.records || []).find((r) => r.group === "receiving" && r.type === "MX");
      toast(mx?.status === "verified" ? `${host(d)} is receiving email` : "We can't see the MX record yet. DNS can take a few minutes.", mx?.status === "verified" ? "ok" : "info");
      await draw();
    } catch (e) { errToast(e); b.disabled = false; b.textContent = "Verify record"; }
  });
  on(root, "click", "[data-enable]", async () => { try { d = await api("PATCH", `/domains/${d.id}`, { receiving_enabled: true }); await draw(); } catch (e) { errToast(e); } });
  on(root, "click", "[data-change]", () => setupModal(ctx));
}

// ---------------------------------------------------------------- received email detail (Figma 12.2)
const verdict = (v) => !v ? `<span class="dim">—</span>` : /pass/i.test(v) ? badge("Pass", "green") : /fail/i.test(v) ? badge("Fail", "red") : badge(v.charAt(0) + v.slice(1).toLowerCase(), "gray");

export async function received(ctx, e, events) {
  const root = ctx.root;
  const rec = (events || []).find((x) => x.type === "received")?.data || {};
  const name = (e.from || "").replace(/<.*>/, "").replace(/"/g, "").trim() || e.from;
  ctx.crumb("mail", e.subject || "(no subject)", ["Receiving", "/emails?tab=receiving"]);
  const { data: hook } = await sb.from("webhook_deliveries").select("status_code,delivered,attempts,created_at,updated_at,payload").eq("team_id", state.team.id).eq("event_type", "email.received").eq("payload->data->>email_id", e.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const payload = hook?.payload?.data ? hook.payload : { type: "email.received", created_at: e.created_at, data: { email_id: e.id, from: e.from, to: e.to, subject: e.subject, message_id: e.headers?.["message-id"] || null, attachments: (e.attachments || []).map((a) => ({ filename: a.filename, content_type: a.content_type, size: a.size })) } };
  const spam = rec.spam ? (/pass/i.test(rec.spam) ? "Clean" : /fail/i.test(rec.spam) ? "Flagged as spam" : rec.spam) : null;
  let tab = "preview";
  root.innerHTML = `<div class="page wide recv">
    <div class="page-head" style="align-items:flex-start"><span class="avatar sm yellow" style="margin-top:4px">${esc(initials(name))}</span><div style="min-width:0"><h1 class="ellipsis">${esc(e.subject || "(no subject)")}</h1><p class="dim" style="margin:3px 0 0;font-size:12.5px">${esc(e.from)} → ${esc((e.to || []).join(", "))} · ${fmtDateTime(e.sent_at || e.created_at)}</p></div>
      <div class="actions"><button class="btn btn-secondary btn-sm" data-forward>${icon("arrow-right", 13)} Forward</button>${e.thread_id ? `<a class="btn btn-secondary btn-sm" href="/inbox/${e.thread_id}">${icon("inbox", 13)} Open in Inbox</a><a class="btn btn-primary btn-sm" href="/inbox/${e.thread_id}?reply=1">${icon("reply", 13)} Reply</a>` : ""}</div></div>
    <div class="recv-facts"><div><span class="k">Spam check</span><b>${spam ? esc(spam) : "—"}</b></div><div><span class="k">SPF</span>${verdict(rec.spf)}</div><div><span class="k">DKIM</span>${verdict(rec.dkim)}</div><div><span class="k">Message-ID</span><b class="mono ellipsis" title="${esc(e.headers?.["message-id"] || "")}">${esc(e.headers?.["message-id"] || "—")}</b></div></div>
    <div class="recv-grid"><div style="min-width:0">
      <div class="ul-tabs" style="margin-bottom:12px">${[["preview", "Preview"], ["text", "Plain text"], ["headers", "Headers"], ["raw", "Raw"]].map(([k, l]) => `<button class="ul-tab" data-v="${k}">${l}</button>`).join("")}</div>
      <div data-vb></div>
      <h3 class="section-title">Attachments · ${(e.attachments || []).length}</h3>
      ${(e.attachments || []).length ? `<div class="recv-atts">${e.attachments.map((a) => `<div class="card att">${icon("paperclip", 14)}<span class="grow"><b class="ellipsis">${esc(a.filename)}</b><span class="dim">${a.size ? (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + " MB" : Math.ceil(a.size / 1024) + " KB") : ""} · ${esc(a.content_type || "")}</span></span></div>`).join("")}</div><p class="hint">Delivrie keeps each attachment’s name, type and size. The files themselves aren’t stored.</p>` : `<p class="dim">No attachments.</p>`}
    </div>
    <div style="min-width:0"><h3 class="section-title" style="margin-top:0">Webhook payload</h3>
      <div class="card hook-card"><div class="row-flex hc-head"><span class="dim">${hook ? `${hook.status_code ? hook.status_code + (hook.delivered ? " OK" : "") : "No response"} · ${hook.delivered ? "delivered" : `failed after ${hook.attempts} attempt${hook.attempts === 1 ? "" : "s"}`} ${ago(hook.updated_at || hook.created_at)}` : "No webhook listening for email.received"}</span><span class="grow"></span><button class="ibtn" data-copy-payload title="Copy">${icon("copy", 13)}</button></div>
        ${codeBlock(JSON.stringify(payload, null, 2), { lang: "json", lines: false, copy: false })}</div>
      ${hook ? "" : `<a class="btn btn-secondary btn-sm" style="margin-top:10px" href="/webhooks?new=1&event=email.received">${icon("plus", 12)} Add webhook</a>`}
    </div></div></div>`;
  const vb = root.querySelector("[data-vb]");
  const raw = () => [...Object.entries(e.headers || {}).map(([k, v]) => `${k}: ${v}`), "", e.text || e.html || ""].join("\n");
  const draw = () => {
    root.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === tab));
    if (tab === "preview") {
      vb.innerHTML = `<div class="recv-preview"><iframe sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div>`;
      const fr = vb.querySelector("iframe");
      fr.srcdoc = e.html || `<pre style="font:14px/1.6 -apple-system,sans-serif;white-space:pre-wrap;padding:18px;margin:0;color:#211f20">${esc(e.text || "(no content)")}</pre>`;
      fr.onload = () => { try { fr.style.height = Math.min(1400, Math.max(160, fr.contentDocument.documentElement.scrollHeight + 4)) + "px"; } catch {} };
    } else if (tab === "text") vb.innerHTML = codeBlock(e.text || "(no plain-text part)", { lang: "text", lines: false });
    else if (tab === "headers") vb.innerHTML = codeBlock(Object.entries(e.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none)", { lang: "text", lines: false });
    else vb.innerHTML = `<p class="hint" style="margin:0 0 8px">Rebuilt from the parsed message. Delivrie doesn’t keep the original bytes.</p>${codeBlock(raw(), { lang: "text", lines: false, max: 520 })}`;
  };
  draw();
  on(root, "click", "[data-v]", (_e, b) => { tab = b.dataset.v; draw(); });
  on(root, "click", "[data-copy-payload]", () => copyText(JSON.stringify(payload, null, 2), "Payload copied"));
  on(root, "click", "[data-forward]", () => forwardModal(e));
}

async function forwardModal(e) {
  const doms = must(await sb.from("domains").select("name").eq("team_id", state.team.id).eq("status", "verified"));
  const to0 = (e.to || [])[0] || "";
  const toDomain = to0.replace(/.*@/, "").replace(/>.*/, "");
  const own = doms.find((d) => toDomain === d.name || toDomain.endsWith("." + d.name));
  const fromDefault = own ? `${state.team.name} <${to0.replace(/.*</, "").replace(/>.*/, "")}>` : doms[0] ? `${state.team.name} <hello@${doms[0].name}>` : "";
  return modal({ title: "Forward email", body: `<div class="field"><label for="fwto">To</label><input class="input" id="fwto" placeholder="ops@yourcompany.com"></div>
      <div class="field"><label for="fwfrom">From</label><input class="input" id="fwfrom" value="${esc(fromDefault)}" placeholder="Support <support@yourdomain.com>">${doms.length ? "" : `<div class="hint">Verify a sending domain first.</div>`}</div>
      <div class="field"><label for="fwnote">Note <span class="dim">Optional</span></label><textarea class="textarea" id="fwnote" rows="3" placeholder="Can someone check this?"></textarea></div>
      ${(e.attachments || []).length ? `<p class="hint">${icon("paperclip", 12)} ${esc(e.attachments.map((a) => a.filename).join(", "))} won’t be included. Delivrie doesn’t store attachment files.</p>` : ""}`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Forward</button>`,
    onMount(m, close) {
      m.querySelector("#fwto").focus();
      m.querySelector("[data-go]").onclick = async (ev) => {
        const btn = ev.currentTarget;
        const to = m.querySelector("#fwto").value.split(/[\s,;]+/).filter(Boolean);
        if (!to.length) return toast("Add who to forward it to", "err");
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
        try {
          await api("POST", `/emails/${e.id}/forward`, { to, from: m.querySelector("#fwfrom").value.trim(), note: m.querySelector("#fwnote").value });
          close(); toast(`Forwarded to ${to.join(", ")}`);
        } catch (err) { errToast(err); btn.disabled = false; btn.textContent = "Forward"; }
      };
    } });
}

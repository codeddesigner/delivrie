import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, toast, errToast, menu, modal, formModal, confirmModal, emptyState, skeletonRows, badge, selectHtml, bindSelects, codeBlock, drawer, on } from "../lib/ui.js";

const T = () => state.team.id;

// ------------------------------------------------------------ API keys
export async function apiKeys(ctx) {
  ctx.crumb("key", "API keys");
  const root = ctx.root;
  const { data: domains } = await sb.from("domains").select("id,name").eq("team_id", T());
  const dn = Object.fromEntries((domains || []).map((d) => [d.id, d.name]));
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>API keys</h1><div class="actions"><a class="btn btn-ghost" href="/docs#api-keys">${icon("book", 13)} Docs</a><button class="btn btn-primary" data-new>${icon("plus", 13)} Create API key</button></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  let rows = [];
  async function load() {
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(5, 3)}</tbody></table></div>`;
    const { data, error } = await sb.from("api_keys").select("id,name,prefix,permission,domain_id,last_used_at,created_at").eq("team_id", T()).order("created_at", { ascending: false });
    if (error) throw error; rows = data;
    body.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Token</th><th>Permission</th><th>Last used</th><th class="r">Created</th><th></th></tr></thead><tbody>${rows.map((k) => `<tr><td><div class="cell">${icon("key", 13, "dim")}${esc(k.name)}</div></td><td class="mono dim">${esc(k.prefix)}•••••••••••</td><td>${k.permission === "full" ? badge("Full access", "yellow") : badge("Sending access", "blue")}${k.domain_id ? ` <span class="dim" style="font-size:12px">${esc(dn[k.domain_id] || "deleted domain")}</span>` : ""}</td><td class="muted">${k.last_used_at ? ago(k.last_used_at) : "Never"}</td><td class="r muted">${ago(k.created_at)}</td><td class="act"><button class="ibtn" data-row="${k.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`
      : emptyState({ icon: "key", title: "No API keys yet", desc: "Create a key to send email and manage resources from your code.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create API key</button>` });
  }
  const create = () => {
    modal({ title: "Create API key", body: `<div class="field"><label>Name</label><input class="input" name="name" placeholder="Production"></div>
      <div class="field"><label>Permission</label><label class="radio-card"><input type="radio" name="perm" value="full" checked><div><div style="font-weight:500">Full access</div><div class="hint">Create, read, update and delete everything.</div></div></label><label class="radio-card"><input type="radio" name="perm" value="sending"><div><div style="font-weight:500">Sending access</div><div class="hint">Only send emails. Best for production apps.</div></div></label></div>
      <div class="field hidden" data-domf><label>Domain</label>${selectHtml("domain", [{ value: "", label: "All domains" }, ...(domains || []).map((d) => ({ value: d.id, label: d.name }))], "")}</div>`,
      foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Create</button>`,
      onMount(m, close) {
        bindSelects(m);
        m.querySelectorAll("input[name=perm]").forEach((r) => r.onchange = () => m.querySelector("[data-domf]").classList.toggle("hidden", m.querySelector("input[name=perm]:checked").value !== "sending"));
        const go = async () => {
          const name = m.querySelector("[name=name]").value.trim(); if (!name) return toast("Name your key", "err");
          const perm = m.querySelector("input[name=perm]:checked").value;
          try { const r = await api("POST", "/api-keys", { name, permission: perm, domain_id: perm === "sending" ? m.querySelector("input[name=domain]").value || null : null }); close(true); reveal(name, r.token); load(); }
          catch (e) { errToast(e); }
        };
        m.querySelector("[data-ok]").onclick = go;
        m.querySelector("[name=name]").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      } });
  };
  function reveal(name, token) {
    modal({ title: "View API key", dismissable: false, body: `<p class="desc">Copy <b>${esc(name)}</b> now. For your security you won’t be able to see it again.</p><div class="input-wrap"><input class="input mono" readonly value="${esc(token)}" style="padding-right:36px"><span class="trail"><button class="ibtn" data-copy="${esc(token)}" data-copy-msg="API key copied">${icon("copy")}</button></span></div><div class="banner warn" style="margin:0">${icon("lock", 13)} Store it in an environment variable — never commit it or use it in browser code.</div>`,
      foot: `<button class="btn btn-primary" data-cancel>Done</button>` });
  }
  on(root, "click", "[data-new]", create);
  on(root, "click", "[data-row]", (_e, b) => { const k = rows.find((x) => x.id === b.dataset.row); menu(b, [
    { label: "Rename", icon: "edit", onClick: () => formModal({ title: "Rename API key", fields: [{ name: "name", label: "Name", value: k.name }], validate: (v) => v.name, async onSubmit(v) { const { error } = await sb.from("api_keys").update({ name: v.name }).eq("id", k.id); if (error) throw error; toast("Renamed"); load(); } }) },
    { label: "View logs", icon: "list", onClick: () => ctx.navigate(`/logs?key=${k.id}`) },
    { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(k.id).then(() => toast("ID copied")) },
    { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete API key", desc: `Requests using <b>${esc(k.name)}</b> will fail immediately. This can’t be undone.`, confirm: "Delete key", typed: k.name }))) return; try { await api("DELETE", `/api-keys/${k.id}`); toast("API key deleted"); load(); } catch (e) { errToast(e); } } }], { align: "right" }); });
  if (ctx.query.new) { history.replaceState({}, "", "/api-keys"); create(); }
  await load();
}

// ------------------------------------------------------------ webhooks
export const EVENTS = [
  ["Email", ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.opened", "email.clicked", "email.failed", "email.received"]],
  ["Contact", ["contact.created", "contact.updated", "contact.deleted"]],
  ["Domain", ["domain.created", "domain.updated"]],
];
const ALL = EVENTS.flatMap(([, e]) => e);

export async function webhooks(ctx) {
  ctx.crumb("webhook", "Webhooks");
  const root = ctx.root;
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Webhooks</h1><div class="actions"><a class="btn btn-ghost" href="/docs#webhooks">${icon("book", 13)} Docs</a><button class="btn btn-primary" data-new>${icon("plus", 13)} Add webhook</button></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  async function load() {
    const { data, error } = await sb.from("webhooks").select("id,endpoint,events,status,created_at").eq("team_id", T()).order("created_at", { ascending: false });
    if (error) throw error;
    body.innerHTML = data.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Endpoint</th><th>Status</th><th>Events</th><th class="r">Created</th></tr></thead><tbody>${data.map((w) => `<tr class="clickable" data-id="${w.id}"><td class="mono ellipsis" style="max-width:380px;font-size:12.5px">${esc(w.endpoint)}</td><td>${w.status === "enabled" ? badge("Enabled", "green") : badge("Disabled", "gray")}</td><td class="muted">${w.events.length === ALL.length ? "All events" : w.events.length === 1 ? esc(w.events[0]) : `${w.events.length} events`}</td><td class="r muted">${ago(w.created_at)}</td></tr>`).join("")}</tbody></table></div>`
      : emptyState({ icon: "webhook", title: "No webhooks yet", desc: "Get a signed HTTP POST when emails are delivered, bounce, get opened, and more.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Add webhook</button>` });
  }
  on(root, "click", "tr[data-id]", (_e, tr) => ctx.navigate(`/webhooks/${tr.dataset.id}`));
  on(root, "click", "[data-new]", () => webhookModal(null, (id) => ctx.navigate(`/webhooks/${id}`)));
  if (ctx.query.new) { const ev = ctx.query.event; history.replaceState({}, "", "/webhooks"); webhookModal(ev ? { events: [ev] } : null, (id) => ctx.navigate(`/webhooks/${id}`)); }
  await load();
}

function webhookModal(w, done) {
  const sel = new Set(w?.events || ["email.delivered", "email.bounced", "email.complained"]);
  const editing = !!w?.id;
  modal({ title: editing ? "Edit webhook" : "Add webhook", size: "lg", body: `<div class="field"><label>Endpoint URL</label><input class="input mono" name="endpoint" placeholder="https://example.com/webhooks/delivrie" value="${esc(w?.endpoint || "")}"><span class="hint">Must be HTTPS and respond with a 2xx within 15 seconds.</span></div>
    <div class="field"><div class="row-flex"><label class="label">Events</label><span class="grow"></span><button class="btn btn-ghost btn-sm" data-allev>Select all</button></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;border:1px solid var(--border);border-radius:8px;padding:12px">${EVENTS.map(([g, list]) => `<div><div class="dim" style="font-size:12px;margin-bottom:6px">${g}</div>${list.map((e) => `<label class="row-flex" style="padding:3px 0;font-size:12.5px"><input type="checkbox" class="checkbox" value="${e}" ${sel.has(e) ? "checked" : ""}><span class="mono">${e.split(".")[1]}</span></label>`).join("")}</div>`).join("")}</div></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>${editing ? "Save" : "Add webhook"}</button>`,
    onMount(m, close) {
      m.querySelector("[data-allev]").onclick = () => { const boxes = [...m.querySelectorAll(".checkbox")]; const all = boxes.every((b) => b.checked); boxes.forEach((b) => b.checked = !all); };
      m.querySelector("[data-ok]").onclick = async () => {
        const endpoint = m.querySelector("[name=endpoint]").value.trim(); const events = [...m.querySelectorAll(".checkbox:checked")].map((b) => b.value);
        if (!/^https:\/\/[^\s/]+\.[^\s]+/.test(endpoint)) return toast("Enter an https:// URL", "err");
        if (!events.length) return toast("Choose at least one event", "err");
        try {
          if (editing) { const { error } = await sb.from("webhooks").update({ endpoint, events }).eq("id", w.id); if (error) throw error; toast("Webhook saved"); close(true); done(w.id); }
          else { const r = await api("POST", "/webhooks", { endpoint, events }); toast("Webhook added"); close(true); done(r.id); }
        } catch (e) { errToast(e); }
      };
    } });
}

export async function webhook(ctx) {
  const id = ctx.params.id;
  const { data: w } = await sb.from("webhooks").select("*").eq("id", id).maybeSingle();
  if (!w) return ctx.navigate("/webhooks", { replace: true });
  ctx.crumb("webhook", w.endpoint.replace(/^https:\/\//, ""), ["Webhooks", "/webhooks"]);
  const root = ctx.root;
  let filter = "";
  root.innerHTML = `<div class="page wide"><div class="page-head"><div><div class="eyebrow">${w.status === "enabled" ? badge("Enabled", "green") : badge("Disabled", "gray")}</div><h1 class="mono ellipsis" style="font-size:18px;margin-top:6px;max-width:640px">${esc(w.endpoint)}</h1></div>
    <div class="actions"><button class="btn btn-secondary" data-test>${icon("zap", 13)} Send test event</button><button class="btn btn-secondary" data-edit>${icon("edit", 13)} Edit</button><button class="ibtn boxed" data-more>${icon("more")}</button></div></div>
    <div class="facts" style="grid-template-columns:2fr 1fr 1fr"><div><div class="k">Signing secret</div><div class="v row-flex"><span class="mono" data-secret>whsec_••••••••••••••••</span><button class="ibtn" data-reveal title="Reveal">${icon("eye", 13)}</button><button class="ibtn" data-copy="${esc(w.signing_secret)}" data-copy-msg="Signing secret copied">${icon("copy", 13)}</button></div></div><div><div class="k">Events</div><div class="v">${w.events.length === ALL.length ? "All events" : w.events.length + " events"}</div></div><div><div class="k">Created</div><div class="v">${fmtDateTime(w.created_at)}</div></div></div>
    <div class="row-flex" style="margin:22px 0 10px"><h3 class="section-title" style="margin:0">Deliveries</h3><span class="grow"></span><div class="seg-tabs" style="margin:0"><button class="seg-tab on" data-f="">All</button><button class="seg-tab" data-f="ok">Succeeded</button><button class="seg-tab" data-f="fail">Failed</button></div><button class="ibtn boxed" data-reload title="Refresh">${icon("refresh", 13)}</button></div>
    <div data-body></div>
    <h3 class="section-title">Verifying signatures</h3><p class="muted" style="margin-bottom:10px">Each request carries <span class="mono">webhook-id</span>, <span class="mono">webhook-timestamp</span> and <span class="mono">webhook-signature</span> headers (Standard Webhooks). Verify with the <span class="mono">standardwebhooks</span> or <span class="mono">svix</span> library:</p>
    ${codeBlock(`import { Webhook } from "standardwebhooks";\n\nconst wh = new Webhook(process.env.DELIVRIE_WEBHOOK_SECRET.replace("whsec_", ""));\n\nexport async function POST(req) {\n  const payload = await req.text();\n  const event = wh.verify(payload, Object.fromEntries(req.headers));\n  // event.type === "email.delivered" ...\n  return new Response("ok");\n}`)}</div>`;
  const body = root.querySelector("[data-body]");
  let rows = [];
  async function load() {
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(5, 4)}</tbody></table></div>`;
    let q = sb.from("webhook_deliveries").select("id,event_id,event_type,status_code,attempts,delivered,next_attempt_at,created_at,updated_at").eq("webhook_id", id).order("created_at", { ascending: false }).limit(100);
    if (filter === "ok") q = q.eq("delivered", true); if (filter === "fail") q = q.eq("delivered", false);
    const { data, error } = await q; if (error) throw error; rows = data;
    body.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Event ID</th><th class="r">Created</th></tr></thead><tbody>${rows.map((d) => `<tr class="clickable" data-id="${d.id}"><td class="mono" style="font-size:12.5px">${esc(d.event_type)}</td><td>${d.delivered ? badge(String(d.status_code || 200), "green") : d.next_attempt_at ? badge(d.status_code ? `${d.status_code} · retrying` : "Retrying", "yellow") : badge(d.status_code ? String(d.status_code) : "Failed", "red")}</td><td class="muted">${d.attempts}</td><td class="mono dim" style="font-size:12px">${esc(d.event_id)}</td><td class="r muted">${ago(d.created_at)}</td></tr>`).join("")}</tbody></table></div>`
      : emptyState({ icon: "webhook", title: filter ? "Nothing here" : "No deliveries yet", desc: "Events matching this webhook show up here. Send a test event to try your endpoint." });
  }
  on(root, "click", "[data-f]", (_e, b) => { filter = b.dataset.f; root.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); load(); });
  on(root, "click", "[data-reload]", load);
  on(root, "click", "[data-reveal]", (_e, b) => { const s = root.querySelector("[data-secret]"); const shown = s.textContent.startsWith("whsec_•"); s.textContent = shown ? w.signing_secret : "whsec_••••••••••••••••"; b.innerHTML = icon(shown ? "eye-off" : "eye", 13); });
  on(root, "click", "[data-test]", async (_e, b) => { b.disabled = true; try { const r = await api("POST", `/webhooks/${id}/test`); toast(r.delivered ? `Test delivered (${r.status_code})` : `Your endpoint returned ${r.status_code || "no response"}`, r.delivered ? "ok" : "err"); load(); } catch (e) { errToast(e); } b.disabled = false; });
  on(root, "click", "[data-edit]", () => webhookModal(w, () => ctx.navigate(`/webhooks/${id}`, { replace: true })));
  on(root, "click", "[data-more]", (_e, b) => menu(b, [
    { label: w.status === "enabled" ? "Disable" : "Enable", icon: w.status === "enabled" ? "x-circle" : "check-circle", onClick: async () => { await sb.from("webhooks").update({ status: w.status === "enabled" ? "disabled" : "enabled" }).eq("id", id); toast(w.status === "enabled" ? "Webhook disabled" : "Webhook enabled"); ctx.navigate(`/webhooks/${id}`, { replace: true }); } },
    { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(id).then(() => toast("ID copied")) },
    { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete webhook", desc: "We’ll stop sending events to this endpoint immediately.", confirm: "Delete" }))) return; await sb.from("webhooks").delete().eq("id", id); toast("Webhook deleted"); ctx.navigate("/webhooks"); } }], { align: "right" }));
  on(root, "click", "tr[data-id]", async (_e, tr) => {
    const { data: d } = await sb.from("webhook_deliveries").select("*").eq("id", tr.dataset.id).single();
    drawer({ title: esc(d.event_type), wide: true, body: `<div class="kv"><span class="k">Status</span><span>${d.delivered ? badge("Delivered", "green") : d.next_attempt_at ? badge("Retrying " + ago(d.next_attempt_at).replace(" ago", ""), "yellow") : badge("Failed", "red")}</span><span class="k">Response code</span><span>${d.status_code ?? "—"}</span><span class="k">Attempts</span><span>${d.attempts}</span><span class="k">Last attempt</span><span>${fmtDateTime(d.updated_at, true)}</span><span class="k">Event ID</span><span class="mono" style="font-size:12px">${esc(d.event_id)}</span></div>
      <div><div class="label" style="margin-bottom:6px">Payload</div>${codeBlock(JSON.stringify(d.payload, null, 2), { lang: "json", max: 320 })}</div>
      <div><div class="label" style="margin-bottom:6px">Response</div>${d.response_body ? codeBlock(d.response_body, { lang: "txt", lines: false, max: 200 }) : '<p class="dim">No response body</p>'}</div>
      <div><button class="btn btn-secondary" data-replay>${icon("refresh", 13)} Replay</button></div>`,
      onMount(dr) { dr.querySelector("[data-replay]").onclick = async (e) => { const btn = e.currentTarget; btn.disabled = true; try { const r = await api("POST", `/webhook-deliveries/${d.id}/replay`); toast(r.delivered ? "Replayed successfully" : `Endpoint returned ${r.status_code || "no response"}`, r.delivered ? "ok" : "err"); load(); } catch (err) { errToast(err); } btn.disabled = false; }; } });
  });
  await load();
}

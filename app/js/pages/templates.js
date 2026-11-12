import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, toast, errToast, menu, modal, formModal, confirmModal, emptyState, debounce, drawer, codeBlock, badge, on } from "../lib/ui.js";
import { renderBlocks, renderVars } from "../lib/blocks.js";
import { mountEditor, previewModal, pageStylePopover } from "./editor.js";
import { testModal } from "./broadcast-edit.js";

const STARTERS = [
  { name: "Blank", content: { blocks: [{ id: "t1", type: "text", html: "" }] } },
  { name: "Welcome", subject: "Welcome to {{{company|our team}}}, {{{first_name|there}}}", variables: [{ name: "first_name", type: "string", fallback: "there" }, { name: "company", type: "string", fallback: "our team" }, { name: "cta_url", type: "string", fallback: "https://example.com" }], content: { blocks: [
    { id: "a", type: "title", html: "Welcome aboard, {{{first_name|there}}}" },
    { id: "b", type: "text", html: "Thanks for signing up. Here’s everything you need to get going in the next five minutes." },
    { id: "c", type: "button", text: "Get started", href: "{{{cta_url}}}", fill: "#FAD600", color: "#211F20", radius: 6, width: "Auto" },
    { id: "d", type: "divider" }, { id: "e", type: "text", html: "Questions? Just reply to this email — a real person reads every one.", style: { color: "#6b6e75", fontSize: 13 } }] } },
  { name: "Password reset", subject: "Reset your password", variables: [{ name: "reset_url", type: "string", fallback: "" }, { name: "first_name", type: "string", fallback: "there" }], content: { blocks: [
    { id: "a", type: "heading", html: "Reset your password" },
    { id: "b", type: "text", html: "Hi {{{first_name|there}}}, someone asked to reset the password for your account. If that was you, use the button below. The link expires in 30 minutes." },
    { id: "c", type: "button", text: "Reset password", href: "{{{reset_url}}}", fill: "#111111", color: "#FFFFFF", radius: 6, width: "Auto" },
    { id: "d", type: "text", html: "If you didn’t ask for this, you can ignore this email.", style: { color: "#6b6e75", fontSize: 13 } }] } },
  { name: "Receipt", subject: "Your receipt #{{{order_id}}}", variables: [{ name: "order_id", type: "string", fallback: "" }, { name: "amount", type: "string", fallback: "" }, { name: "date", type: "string", fallback: "" }], content: { blocks: [
    { id: "a", type: "heading", html: "Thanks for your order" },
    { id: "b", type: "text", html: "Order <b>#{{{order_id}}}</b> · {{{date}}}" },
    { id: "c", type: "divider" },
    { id: "d", type: "columns", columns: [{ html: "Total" }, { html: "<b>{{{amount}}}</b>" }] },
    { id: "e", type: "divider" }, { id: "f", type: "text", html: "Keep this email for your records.", style: { color: "#6b6e75", fontSize: 13 } }] } },
  { name: "Magic link", subject: "Your sign-in link", variables: [{ name: "link", type: "string", fallback: "" }, { name: "code", type: "string", fallback: "" }], content: { blocks: [
    { id: "a", type: "heading", html: "Sign in" },
    { id: "b", type: "text", html: "Click the button to sign in. This link works once and expires in 10 minutes." },
    { id: "c", type: "button", text: "Sign in", href: "{{{link}}}", fill: "#FAD600", color: "#211F20", radius: 6, width: "Auto" },
    { id: "d", type: "text", html: "Or enter this code: <b>{{{code}}}</b>" }] } },
];

export async function gallery(ctx) {
  ctx.crumb("template", "Templates");
  const root = ctx.root;
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>Templates</h1><div class="actions"><button class="ibtn boxed" data-api title="API">${icon("code", 14)}</button><button class="btn btn-primary" data-new>${icon("plus", 13)} Create template</button></div></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search templates"></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  let rows = [];
  async function load() {
    const { data, error } = await sb.from("templates").select("id,name,alias,status,published_version,subject,content,updated_at,created_at").eq("team_id", state.team.id).order("updated_at", { ascending: false });
    if (error) throw error; rows = data; draw();
  }
  function draw() {
    const q = root.querySelector("[data-q]").value.toLowerCase();
    const r = rows.filter((t) => !q || `${t.name} ${t.alias || ""}`.toLowerCase().includes(q));
    if (!rows.length) { body.innerHTML = emptyState({ icon: "template", title: "No templates yet", desc: "Design transactional emails once, then send them from your code with variables.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create template</button>` }); return; }
    if (!r.length) { body.innerHTML = emptyState({ icon: "search", title: "No templates match", desc: "Try a different search." }); return; }
    body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">${r.map((t) => `<div class="card clickable tpl-card" data-id="${t.id}" style="overflow:hidden;cursor:pointer">
      <div style="height:170px;overflow:hidden;background:#fff;position:relative;pointer-events:none"><iframe sandbox data-thumb="${t.id}" style="width:640px;height:720px;border:0;transform:scale(.4);transform-origin:0 0;position:absolute;left:calc(50% - 128px);top:0"></iframe></div>
      <div style="padding:12px 14px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border)"><div class="grow"><div class="ellipsis" style="font-weight:500">${esc(t.name)}</div><div class="dim" style="font-size:12px">${t.status === "published" ? `v${t.published_version} · ` : "Draft · "}${ago(t.updated_at)}</div></div><button class="ibtn" data-row="${t.id}">${icon("more")}</button></div></div>`).join("")}</div>`;
    r.forEach((t) => { const f = body.querySelector(`[data-thumb="${t.id}"]`); if (f) f.srcdoc = renderVars(renderBlocks(t.content || { blocks: [] }, { subject: t.subject }), {}, []); });
  }
  root.querySelector("[data-q]").addEventListener("input", draw);
  on(root, "click", "[data-new]", () => createModal(ctx.navigate));
  on(root, "click", "[data-api]", () => drawer({ title: "Send with a template", wide: true, body: `<p class="muted">Publish a template, then reference it by ID or alias. Variables fill <span class="mono">{{{name}}}</span> placeholders.</p>${codeBlock(`curl -X POST ${location.origin}/api/emails \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "from": "Acme <hello@acme.com>",\n    "to": ["ada@example.com"],\n    "template": {\n      "id": "welcome",\n      "variables": { "first_name": "Ada" }\n    }\n  }'`, { lang: "sh" })}` }));
  on(root, "click", ".tpl-card", (e, c) => { if (!e.target.closest("[data-row]")) ctx.navigate(`/templates/${c.dataset.id}`); });
  on(root, "click", "[data-row]", (e, btn) => {
    e.stopPropagation(); const t = rows.find((x) => x.id === btn.dataset.row);
    menu(btn, [
      { label: "Edit", icon: "edit", onClick: () => ctx.navigate(`/templates/${t.id}`) },
      { label: "Rename", icon: "edit", onClick: () => formModal({ title: "Rename template", fields: [{ name: "name", label: "Name", value: t.name }], validate: (v) => v.name, async onSubmit(v) { const { error } = await sb.from("templates").update({ name: v.name }).eq("id", t.id); if (error) throw error; toast("Renamed"); load(); } }) },
      { label: "Duplicate", icon: "copy", onClick: async () => { const { data: full } = await sb.from("templates").select("*").eq("id", t.id).single(); const { error } = await sb.from("templates").insert({ team_id: full.team_id, name: full.name + " (copy)", from: full.from, reply_to: full.reply_to, subject: full.subject, content: full.content, variables: full.variables, status: "draft", created_by: state.user.id }); if (error) return errToast(error); toast("Template duplicated"); load(); } },
      { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(t.id).then(() => toast("ID copied")) },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete template", desc: `Emails sent with “${esc(t.name)}” stay in your logs, but API calls that reference it will fail.`, confirm: "Delete", typed: t.name }))) return; const { error } = await sb.from("templates").delete().eq("id", t.id); if (error) return errToast(error); toast("Template deleted"); load(); } },
    ], { align: "right" });
  });
  if (ctx.query.new) { history.replaceState({}, "", "/templates"); createModal(ctx.navigate); }
  await load();
}

function createModal(navigate) {
  let pick = 0;
  modal({ title: "Create template", size: "lg", body: `<div class="field"><label>Name</label><input class="input" data-name placeholder="Welcome email"></div><div class="field"><label>Start from</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${STARTERS.map((s, i) => `<button class="radio-card ${i === 0 ? "on" : ""}" data-pick="${i}" style="justify-content:center;${i === 0 ? "border-color:var(--yellow)" : ""}">${esc(s.name)}</button>`).join("")}</div></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Create</button>`,
    onMount(m, close) {
      on(m, "click", "[data-pick]", (_e, b) => { pick = +b.dataset.pick; m.querySelectorAll("[data-pick]").forEach((x) => x.style.borderColor = x === b ? "var(--yellow)" : ""); const n = m.querySelector("[data-name]"); if (!n.value || STARTERS.some((s) => s.name === n.value)) n.value = pick ? STARTERS[pick].name : ""; });
      m.querySelector("[data-ok]").onclick = async () => {
        const s = STARTERS[pick]; const name = m.querySelector("[data-name]").value.trim() || s.name;
        const { data, error } = await sb.from("templates").insert({ team_id: state.team.id, name, subject: s.subject || null, content: structuredClone(s.content), variables: s.variables || [], status: "draft", created_by: state.user.id }).select("id").single();
        if (error) return errToast(error);
        close(true); navigate(`/templates/${data.id}`);
      };
    } });
}

export async function editor(ctx) {
  const id = ctx.params.id;
  const [{ data: t, error }, { data: domains }, { data: versions }] = await Promise.all([
    sb.from("templates").select("*").eq("id", id).maybeSingle(),
    sb.from("domains").select("name,status").eq("team_id", state.team.id).eq("status", "verified"),
    sb.from("template_versions").select("id,version,created_at,created_by_name,snapshot").eq("template_id", id).order("version", { ascending: false }),
  ]);
  if (error) throw error;
  if (!t) { toast("Template not found", "err"); return ctx.navigate("/templates", { replace: true }); }
  document.title = `${t.name} · Delivrie`;
  t.variables ||= [];
  const root = ctx.root;
  const latest = versions?.[0];
  const dirty = () => !latest || new Date(t.updated_at) > new Date(latest.created_at);
  root.innerHTML = `<div class="editor-shell">
    <div class="editor-top"><a class="ibtn" href="/templates">${icon("arrow-left", 15)}</a><span class="dim">Templates</span><span class="dim">/</span><input class="name-input" data-name value="${esc(t.name)}" size="${Math.max(8, t.name.length)}"><span data-state></span><span class="dim" data-saved style="font-size:12px"></span>
      <span class="grow"></span><button class="btn btn-ghost btn-sm" data-vars>${icon("code", 13)} Variables</button><button class="btn btn-ghost btn-sm" data-history>${icon("clock", 13)} History</button><button class="btn btn-ghost btn-sm" data-styles>${icon("sparkle", 13)} Styles</button><button class="btn btn-ghost btn-sm" data-preview>${icon("eye", 13)} Preview</button><button class="btn btn-secondary btn-sm" data-test>${icon("send", 13)} Test</button><button class="btn btn-primary btn-sm" data-publish>Publish</button></div>
    <div class="editor-main"><div class="editor-canvas"><div class="editor-doc">
      <div class="hdr-fields">
        <div class="hdr-row"><span>From</span><input data-f="from" placeholder="Acme <hello@${esc(domains?.[0]?.name || "yourdomain.com")}>" value="${esc(t.from || "")}"></div>
        <div class="hdr-row"><span>Reply-to</span><input data-f="reply_to" placeholder="Optional" value="${esc(t.reply_to || "")}"></div>
        <div class="hdr-row"><span>Alias</span><input data-f="alias" class="mono" placeholder="welcome-email — reference the template by this in the API" value="${esc(t.alias || "")}"></div>
      </div>
      <input class="doc-subject" data-f="subject" placeholder="Subject — type {{ to insert a variable" value="${esc(t.subject || "")}">
      <div data-editor></div></div></div><aside class="inspector hidden" data-insp></aside></div></div>`;
  const stateEl = root.querySelector("[data-state]"), saved = root.querySelector("[data-saved]");
  const drawState = () => { stateEl.innerHTML = t.status === "published" ? (dirty() ? badge("Unpublished changes", "yellow") : badge(`Published v${t.published_version}`, "green")) : badge("Draft", "gray"); };
  drawState();
  let patch = {};
  const flush = async () => {
    const p = patch; patch = {}; if (!Object.keys(p).length) return;
    saved.textContent = "Saving…";
    const now = new Date().toISOString();
    const { error: e } = await sb.from("templates").update({ ...p, updated_at: now }).eq("id", id);
    if (e) { saved.textContent = "Not saved"; errToast(e.message.includes("duplicate") ? new Error("That alias is already used by another template") : e); return; }
    t.updated_at = now; saved.textContent = "Saved"; drawState();
  };
  const saveSoon = debounce(flush, 700);
  const set = (k, v) => { t[k] = v; patch[k] = v; saved.textContent = "Editing…"; saveSoon(); };
  const createVariable = () => variableModal().then((v) => { if (!v) return null; t.variables = [...t.variables.filter((x) => x.name !== v.name), v]; set("variables", t.variables); return v; });
  const ed = mountEditor(root.querySelector("[data-editor]"), { doc: t.content, mode: "template", vars: () => t.variables.map((v) => ({ name: v.name, label: v.name, type: v.type })), createVariable, inspectorHost: root.querySelector("[data-insp]"), onChange: (doc) => set("content", doc) });
  root.querySelector("[data-name]").addEventListener("input", (e) => { e.target.size = Math.max(8, e.target.value.length); set("name", e.target.value || "Untitled"); });
  root.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener("input", () => {
    let v = inp.value.trim();
    if (inp.dataset.f === "alias") { v = v.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"); }
    set(inp.dataset.f, v || null);
  }));
  // {{ in subject
  const subj = root.querySelector('[data-f="subject"]');
  subj.addEventListener("input", () => {
    if (!subj.value.slice(0, subj.selectionStart).endsWith("{{")) return;
    menu(subj, [{ header: "Variables" }, ...t.variables.map((v) => ({ label: v.name, icon: "code", right: v.type, onClick: () => ins(v.name) })), { sep: true }, { label: "Create variable", icon: "plus", onClick: async () => { const v = await createVariable(); if (v) ins(v.name); } }], { width: 240 });
    function ins(name) { const p = subj.selectionStart; subj.value = subj.value.slice(0, p - 2) + `{{{${name}}}}` + subj.value.slice(p); set("subject", subj.value); subj.focus(); }
  });
  root.querySelector("[data-styles]").onclick = (e) => pageStylePopover(e.currentTarget, t.content || {}, (p) => ed.setPage(p));
  root.querySelector("[data-preview]").onclick = () => { const sample = Object.fromEntries(t.variables.map((v) => [v.name, v.fallback || `{${v.name}}`])); previewModal(ed.getDoc(), { subject: renderVars(t.subject || "", sample, t.variables), transform: (h) => renderVars(h, sample, t.variables) }); };
  root.querySelector("[data-test]").onclick = async () => { await flush(); testModal(id, "template"); };
  root.querySelector("[data-vars]").onclick = () => variablesDrawer(t, set);
  root.querySelector("[data-history]").onclick = () => historyDrawer(t, versions || [], async (snap, v) => {
    if (!(await confirmModal({ title: `Restore version ${v}`, desc: "This replaces the current draft with that version. Publish afterwards to make it live.", confirm: "Restore", danger: false }))) return;
    Object.assign(patch, { subject: snap.subject, from: snap.from, reply_to: snap.reply_to, content: snap.content, variables: snap.variables || [] });
    Object.assign(t, patch); await flush(); ctx.navigate(`/templates/${id}`, { replace: true }); toast(`Restored version ${v}`);
  });
  root.querySelector("[data-publish]").onclick = async () => {
    await flush();
    const issues = [];
    if (!t.subject) issues.push("Add a subject");
    const used = new Set([...(JSON.stringify(t.content) + (t.subject || "")).matchAll(/\{\{\{?\s*([a-zA-Z_][\w]*)/g)].map((m) => m[1]));
    const undefinedVars = [...used].filter((n) => !t.variables.some((v) => v.name === n) && !["unsubscribe_url", "preferences_url"].includes(n));
    modal({ title: "Publish template", body: `<p class="desc">Publishing creates version ${(latest?.version || 0) + 1}. API calls that use ${t.alias ? `<span class="mono">${esc(t.alias)}</span>` : "this template"} switch to it immediately.</p>
      ${issues.length ? `<div class="banner warn">${icon("alert", 13)} ${issues.join(", ")}</div>` : ""}
      ${undefinedVars.length ? `<div class="banner warn">${icon("alert", 13)} Variables with no definition: ${undefinedVars.map((n) => `<span class="mono">${esc(n)}</span>`).join(", ")}. They’ll render empty unless you pass them.</div>` : ""}
      <div class="kv"><span class="k">Subject</span><span>${esc(t.subject || "—")}</span><span class="k">Variables</span><span>${t.variables.length ? t.variables.map((v) => `<span class="mono">${esc(v.name)}</span>`).join(", ") : "None"}</span></div>`,
      foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok ${issues.length ? "disabled" : ""}>Publish</button>`,
      onMount(m, close) { m.querySelector("[data-ok]").onclick = async (e) => { e.currentTarget.disabled = true; try { const r = await api("POST", `/templates/${id}/publish`); toast(`Published version ${r.version}`); close(true); ctx.navigate(`/templates/${id}`, { replace: true }); } catch (err) { errToast(err); e.currentTarget.disabled = false; } }; } });
  };
  document.addEventListener("keydown", function k(e) {
    if (!document.body.contains(root.querySelector("[data-editor]"))) { document.removeEventListener("keydown", k); ed.destroy(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); flush(); }
  });
}

function variableModal(v = {}) {
  return formModal({ title: v.name ? "Edit variable" : "Create variable", fields: [
    { name: "name", label: "Name", value: v.name, placeholder: "first_name", mono: true, hint: "Letters, numbers and underscores. Used as {{{name}}}." },
    { name: "type", label: "Type", type: "select", value: v.type || "string", options: [{ value: "string", label: "String" }, { value: "number", label: "Number" }] },
    { name: "fallback", label: "Fallback value", value: v.fallback, optional: true, placeholder: "Used when the variable isn’t passed" },
  ], submit: v.name ? "Save" : "Create", validate: (x) => /^[a-zA-Z_][\w]*$/.test(x.name), onSubmit: async (x) => x });
}
function variablesDrawer(t, set) {
  drawer({ title: "Variables", body: `<div data-list></div><button class="btn btn-secondary" data-add>${icon("plus", 13)} Create variable</button>`, onMount(d) {
    const draw = () => { d.querySelector("[data-list]").innerHTML = t.variables.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Type</th><th>Fallback</th><th></th></tr></thead><tbody>${t.variables.map((v, i) => `<tr><td class="mono">${esc(v.name)}</td><td class="muted">${esc(v.type)}</td><td class="muted">${esc(v.fallback || "—")}</td><td class="act"><button class="ibtn" data-ed="${i}">${icon("edit")}</button><button class="ibtn" data-del="${i}">${icon("trash")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No variables yet. Type <span class="mono">{{</span> in the editor to insert one.</p>`; };
    draw();
    d.querySelector("[data-add]").onclick = async () => { const v = await variableModal(); if (v && v !== true) { t.variables = [...t.variables.filter((x) => x.name !== v.name), v]; set("variables", t.variables); draw(); } };
    on(d, "click", "[data-del]", (_e, b) => { t.variables.splice(+b.dataset.del, 1); set("variables", [...t.variables]); draw(); });
    on(d, "click", "[data-ed]", async (_e, b) => { const i = +b.dataset.ed; const v = await variableModal(t.variables[i]); if (v && v !== true) { t.variables[i] = v; set("variables", [...t.variables]); draw(); } });
  } });
}
function historyDrawer(t, versions, onRestore) {
  drawer({ title: "Version history", body: versions.length ? `<div class="vtl">${versions.map((v) => `<div class="vtl-item"><span class="dot" style="background:${v.version === t.published_version ? "var(--green-2)" : "var(--fg-3)"};width:8px;height:8px;margin-left:5px"></span><div><div>Version ${v.version}${v.version === t.published_version ? ` ${badge("Live", "green")}` : ""}</div><div class="t">${esc(v.created_by_name || "")} · ${fmtDateTime(v.created_at)}</div></div><div class="row-flex"><button class="btn btn-ghost btn-sm" data-view="${v.version}">View</button>${v.version !== t.published_version || new Date(t.updated_at) > new Date(v.created_at) ? `<button class="btn btn-secondary btn-sm" data-restore="${v.version}">Restore</button>` : ""}</div></div>`).join("")}</div>` : `<p class="muted">Nothing published yet. Each publish saves a version you can come back to.</p>`,
    onMount(d, close) {
      on(d, "click", "[data-view]", (_e, b) => { const v = versions.find((x) => x.version === +b.dataset.view); previewModal(v.snapshot.content || { blocks: [] }, { subject: v.snapshot.subject }); });
      on(d, "click", "[data-restore]", (_e, b) => { const v = versions.find((x) => x.version === +b.dataset.restore); close(); onRestore(v.snapshot, v.version); });
    } });
}

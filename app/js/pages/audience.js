import { sb, state } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, plural, toast, errToast, menu, modal, formModal, confirmModal, emptyState, skeletonRows, pager, debounce, drawer, codeBlock, badge, pill, selectHtml, bindSelects, download, csv, parseCsv, EMAIL_RE, on, statusCell } from "../lib/ui.js";

const PAGE = 25;
const T = () => state.team.id;
function tabs(active) {
  return `<div class="ul-tabs" style="margin-bottom:18px">${[["/contacts", "Contacts"], ["/segments", "Segments"], ["/contacts/topics", "Topics"], ["/contacts/properties", "Properties"]].map(([h, l]) => `<a class="ul-tab ${h === active ? "on" : ""}" href="${h}">${l}</a>`).join("")}</div>`;
}
const head = (title, actions = "") => `<div class="page-head"><h1>${title}</h1><div class="actions">${actions}</div></div>`;

// ------------------------------------------------------------ contacts
export async function contacts(ctx) {
  ctx.crumb("users", "Audience");
  const root = ctx.root;
  const f = { q: ctx.query.q || "", status: ctx.query.status || "", segment: ctx.query.segment || "", page: +ctx.query.page || 1 };
  const [{ data: segs }, stats] = await Promise.all([
    sb.from("segments").select("id,name").eq("team_id", T()).order("name"),
    Promise.all([
      sb.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", T()),
      sb.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", T()).eq("unsubscribed", true),
      sb.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", T()).gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()),
    ]),
  ]);
  const [total, unsub, recent] = stats.map((r) => r.count || 0);
  root.innerHTML = `<div class="page wide">${head("Audience", `<button class="ibtn boxed" data-api title="API">${icon("code", 14)}</button><button class="btn btn-secondary" data-export>${icon("download", 13)} Export</button><button class="btn btn-primary" data-add>${icon("plus", 13)} Add contacts</button>`)}${tabs("/contacts")}
    <div class="stat-grid" style="margin-bottom:18px"><div class="stat"><div class="k">All contacts</div><div class="v">${num(total)}</div></div><div class="stat"><div class="k">Subscribed</div><div class="v">${num(total - unsub)}</div></div><div class="stat"><div class="k">Unsubscribed</div><div class="v">${num(unsub)}</div></div><div class="stat"><div class="k">New, last 30 days</div><div class="v">${num(recent)}</div></div></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search by email or name" value="${esc(f.q)}"></div>
      <div style="width:160px">${selectHtml("status", [{ value: "", label: "All statuses" }, { value: "subscribed", label: "Subscribed" }, { value: "unsubscribed", label: "Unsubscribed" }], f.status)}</div>
      <div style="width:180px">${selectHtml("segment", [{ value: "", label: "All segments" }, ...(segs || []).map((s) => ({ value: s.id, label: s.name }))], f.segment)}</div></div>
    <div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  let rows = [], selected = new Set();
  const sync = () => { const p = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === "page" && v === 1))); history.replaceState({}, "", "/contacts" + (p.toString() ? "?" + p : "")); };
  function query(sel = "id,email,first_name,last_name,unsubscribed,created_at", count = true) {
    let q = sb.from("contacts").select(f.segment ? sel + ",segment_contacts!inner(segment_id)" : sel, count ? { count: "exact" } : undefined).eq("team_id", T());
    if (f.segment) q = q.eq("segment_contacts.segment_id", f.segment);
    if (f.status) q = q.eq("unsubscribed", f.status === "unsubscribed");
    if (f.q) { const s = f.q.toLowerCase().replace(/[,%()]/g, " ").trim(); if (s) q = q.ilike("search", `%${s}%`); }
    return q.order("created_at", { ascending: false });
  }
  async function load() {
    sync(); selected.clear();
    body.innerHTML = `<div class="table-wrap"><table class="t"><tbody>${skeletonRows(4, 6)}</tbody></table></div>`;
    const { data, count, error } = await query().range((f.page - 1) * PAGE, f.page * PAGE - 1);
    if (error) throw error; rows = data;
    if (!count) {
      body.innerHTML = total ? emptyState({ icon: "search", title: "No contacts match", desc: "Try a different search or filter." })
        : emptyState({ icon: "users", title: "No contacts yet", desc: "Add people manually, import a CSV, or create them from your app with the API.", action: `<div class="row-flex"><button class="btn btn-primary" data-add>${icon("plus", 13)} Add contacts</button><a class="btn btn-secondary" href="/contacts/import">${icon("upload", 13)} Import CSV</a></div>` });
      return;
    }
    body.innerHTML = `<div class="row-flex hidden" data-bulk style="margin-bottom:10px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px"><span data-n></span><span class="grow"></span><button class="btn btn-secondary btn-sm" data-bulkseg>${icon("layers", 12)} Add to segment</button><button class="btn btn-secondary btn-sm" data-bulkunsub>Unsubscribe</button><button class="btn btn-danger btn-sm" data-bulkdel>${icon("trash", 12)} Delete</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th style="width:30px"><input type="checkbox" class="checkbox" data-all></th><th>Email</th><th>Name</th><th>Status</th><th class="r">Added</th><th></th></tr></thead><tbody>${data.map((c) => `<tr class="clickable" data-id="${c.id}"><td><input type="checkbox" class="checkbox" data-sel="${c.id}"></td><td><div class="cell"><span class="avatar" style="width:20px;height:20px;font-size:10px">${esc((c.first_name || c.email)[0].toUpperCase())}</span><span class="ellipsis">${esc(c.email)}</span></div></td><td class="muted">${esc([c.first_name, c.last_name].filter(Boolean).join(" ") || "—")}</td><td>${c.unsubscribed ? badge("Unsubscribed", "gray") : badge("Subscribed", "green")}</td><td class="r muted">${ago(c.created_at)}</td><td class="act"><button class="ibtn" data-row="${c.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>${pager(f.page, count, PAGE, "contact")}`;
  }
  const bulkBar = () => { const b = body.querySelector("[data-bulk]"); if (!b) return; b.classList.toggle("hidden", !selected.size); b.querySelector("[data-n]").textContent = `${plural(selected.size, "contact")} selected`; };
  root.querySelector("[data-q]").addEventListener("input", debounce((e) => { f.q = e.target.value; f.page = 1; load(); }, 300));
  bindSelects(root, (k, v) => { f[k] = v; f.page = 1; load(); });
  on(root, "click", "[data-page]", (_e, b) => { f.page = +b.dataset.page; load(); });
  on(root, "change", "[data-sel]", (_e, cb) => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); bulkBar(); });
  on(root, "change", "[data-all]", (_e, cb) => { body.querySelectorAll("[data-sel]").forEach((x) => { x.checked = cb.checked; cb.checked ? selected.add(x.dataset.sel) : selected.delete(x.dataset.sel); }); bulkBar(); });
  on(root, "click", "tr[data-id]", (e, tr) => { if (e.target.closest("[data-row],[data-sel]")) return; contactDrawer(tr.dataset.id, load); });
  on(root, "click", "[data-add]", () => addModal(segs, () => ctx.navigate("/contacts", { replace: true })));
  on(root, "click", "[data-bulkdel]", async () => { if (!(await confirmModal({ title: `Delete ${plural(selected.size, "contact")}`, desc: "They’ll be removed from every segment. This can’t be undone.", confirm: "Delete" }))) return; const { error } = await sb.from("contacts").delete().in("id", [...selected]); if (error) return errToast(error); toast("Contacts deleted"); load(); });
  on(root, "click", "[data-bulkunsub]", async () => { const { error } = await sb.from("contacts").update({ unsubscribed: true }).in("id", [...selected]); if (error) return errToast(error); toast("Unsubscribed"); load(); });
  on(root, "click", "[data-bulkseg]", (_e, b) => menu(b, (segs || []).length ? segs.map((s) => ({ label: s.name, icon: "layers", onClick: async () => { const { error } = await sb.from("segment_contacts").upsert([...selected].map((id) => ({ segment_id: s.id, contact_id: id, team_id: T() })), { onConflict: "segment_id,contact_id", ignoreDuplicates: true }); if (error) return errToast(error); toast(`Added to ${s.name}`); } })) : [{ label: "No segments yet", disabled: true }]));
  on(root, "click", "[data-row]", (e, b) => {
    e.stopPropagation(); const c = rows.find((x) => x.id === b.dataset.row);
    menu(b, [{ label: "View", icon: "eye", onClick: () => contactDrawer(c.id, load) },
      { label: c.unsubscribed ? "Resubscribe" : "Unsubscribe", icon: "mail", onClick: async () => { await sb.from("contacts").update({ unsubscribed: !c.unsubscribed }).eq("id", c.id); toast(c.unsubscribed ? "Resubscribed" : "Unsubscribed"); load(); } },
      { label: "Copy email", icon: "copy", onClick: () => navigator.clipboard.writeText(c.email).then(() => toast("Copied")) },
      { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete contact", desc: `Delete ${esc(c.email)}?`, confirm: "Delete" }))) return; await sb.from("contacts").delete().eq("id", c.id); toast("Contact deleted"); load(); } }], { align: "right" });
  });
  on(root, "click", "[data-export]", async () => {
    toast("Preparing export…", "info");
    let all = [], from = 0;
    while (true) { const { data, error } = await query("email,first_name,last_name,unsubscribed,properties,created_at", false).range(from, from + 999); if (error) return errToast(error); all = all.concat(data); if (data.length < 1000 || all.length >= 50000) break; from += 1000; }
    const keys = [...new Set(all.flatMap((c) => Object.keys(c.properties || {})))];
    download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, csv([["email", "first_name", "last_name", "unsubscribed", "created_at", ...keys], ...all.map((c) => [c.email, c.first_name, c.last_name, c.unsubscribed, c.created_at, ...keys.map((k) => c.properties?.[k])])]));
  });
  on(root, "click", "[data-api]", () => drawer({ title: "Contacts API", wide: true, body: `<p class="muted">Create or update contacts from your signup flow.</p>${codeBlock(`curl -X POST ${location.origin}/api/contacts \\\n  -H "Authorization: Bearer dlv_xxxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "email": "ada@example.com",\n    "first_name": "Ada",\n    "unsubscribed": false,\n    "segments": ["<segment id>"]\n  }'`, { lang: "sh" })}` }));
  if (ctx.query.add) { history.replaceState({}, "", "/contacts"); addModal(segs, () => ctx.navigate("/contacts", { replace: true })); }
  await load();
}

function addModal(segs, done, preset = "") {
  modal({ title: "Add contacts", size: "lg", body: `<div class="seg-tabs" style="margin:0"><button class="seg-tab on" data-m="one">One</button><button class="seg-tab" data-m="many">Paste a list</button><a class="seg-tab" href="/contacts/import">Import CSV</a></div>
    <div data-one style="display:flex;flex-direction:column;gap:12px"><div class="field"><label>Email</label><input class="input" name="email" placeholder="ada@example.com"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label>First name <span class="dim">Optional</span></label><input class="input" name="first"></div><div class="field"><label>Last name <span class="dim">Optional</span></label><input class="input" name="last"></div></div></div>
    <div data-many class="hidden field"><label>Emails</label><textarea class="textarea mono" rows="6" placeholder="ada@example.com, grace@example.com&#10;linus@example.com"></textarea><span class="hint">Separate with commas, spaces or new lines. Up to 1,000 at a time.</span></div>
    <div class="field"><label>Add to segment <span class="dim">Optional</span></label>${selectHtml("segment", [{ value: "", label: "None" }, ...(segs || []).map((s) => ({ value: s.id, label: s.name }))], preset, "None")}</div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Add</button>`,
    onMount(m, close) {
      let mode = "one"; bindSelects(m);
      on(m, "click", "[data-m]", (_e, b) => { mode = b.dataset.m; m.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b)); m.querySelector("[data-one]").classList.toggle("hidden", mode !== "one"); m.querySelector("[data-many]").classList.toggle("hidden", mode !== "many"); });
      m.querySelector("[data-ok]").onclick = async (e) => {
        let list;
        if (mode === "one") { const em = m.querySelector("[name=email]").value.trim().toLowerCase(); if (!EMAIL_RE.test(em)) return toast("Enter a valid email", "err"); list = [{ email: em, first_name: m.querySelector("[name=first]").value.trim() || null, last_name: m.querySelector("[name=last]").value.trim() || null }]; }
        else { const all = m.querySelector("textarea").value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); const bad = all.filter((x) => !EMAIL_RE.test(x)); if (bad.length) return toast(`Not valid: ${bad.slice(0, 3).join(", ")}`, "err"); list = [...new Set(all)].slice(0, 1000).map((email) => ({ email })); if (!list.length) return toast("Paste at least one email", "err"); }
        e.currentTarget.disabled = true;
        const { data, error } = await sb.from("contacts").upsert(list.map((c) => ({ ...c, team_id: T() })), { onConflict: "team_id,email" }).select("id");
        if (error) { e.currentTarget.disabled = false; return errToast(error); }
        const seg = m.querySelector("input[name=segment]").value;
        if (seg) await sb.from("segment_contacts").upsert(data.map((c) => ({ segment_id: seg, contact_id: c.id, team_id: T() })), { onConflict: "segment_id,contact_id", ignoreDuplicates: true });
        toast(`${plural(data.length, "contact")} added`); close(true); done();
      };
    } });
}

async function contactDrawer(id, reload) {
  const [{ data: c }, { data: segs }, { data: inSegs }, { data: topics }, { data: prefs }, { data: emails }, { data: props }] = await Promise.all([
    sb.from("contacts").select("*").eq("id", id).single(),
    sb.from("segments").select("id,name").eq("team_id", T()),
    sb.from("segment_contacts").select("segment_id").eq("contact_id", id),
    sb.from("topics").select("id,name,default_subscription").eq("team_id", T()),
    sb.from("contact_topics").select("topic_id,subscription").eq("contact_id", id),
    sb.from("emails").select("id,subject,status,created_at").eq("contact_id", id).order("created_at", { ascending: false }).limit(10),
    sb.from("contact_properties").select("key,type").eq("team_id", T()),
  ]);
  const inSet = new Set((inSegs || []).map((s) => s.segment_id));
  const pref = Object.fromEntries((prefs || []).map((p) => [p.topic_id, p.subscription]));
  drawer({ title: esc(c.email), wide: true, body: `
    <div class="kv"><span class="k">Status</span><span>${c.unsubscribed ? badge("Unsubscribed", "gray") : badge("Subscribed", "green")}</span><span class="k">Added</span><span>${fmtDateTime(c.created_at)}</span><span class="k">ID</span><span class="mono dim" style="font-size:12px">${c.id}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label>First name</label><input class="input" data-k="first_name" value="${esc(c.first_name || "")}"></div><div class="field"><label>Last name</label><input class="input" data-k="last_name" value="${esc(c.last_name || "")}"></div></div>
    ${(props || []).length ? `<div class="field"><label>Properties</label>${props.map((p) => `<div class="insp-row"><span class="mono">${esc(p.key)}</span><input class="input" data-prop="${esc(p.key)}" value="${esc(c.properties?.[p.key] ?? "")}" ${p.type === "number" ? 'type="number"' : ""}></div>`).join("")}</div>` : ""}
    <label class="row-flex" style="justify-content:space-between"><span>Subscribed to marketing email</span><input type="checkbox" class="toggle" data-subscribed ${c.unsubscribed ? "" : "checked"}></label>
    <div class="field"><label>Segments</label><div class="chip-row">${(segs || []).map((s) => `<label class="pill" style="cursor:pointer"><input type="checkbox" class="checkbox" data-seg="${s.id}" ${inSet.has(s.id) ? "checked" : ""} style="margin-right:4px">${esc(s.name)}</label>`).join("") || '<span class="dim">No segments yet</span>'}</div></div>
    ${(topics || []).length ? `<div class="field"><label>Topics</label>${topics.map((t) => `<label class="row-flex" style="justify-content:space-between"><span>${esc(t.name)}</span><input type="checkbox" class="toggle" data-topic="${t.id}" ${(pref[t.id] || t.default_subscription) === "opt_in" ? "checked" : ""}></label>`).join("")}</div>` : ""}
    <div class="field"><label>Recent emails</label>${(emails || []).length ? `<div class="table-wrap"><table class="t"><tbody>${emails.map((e) => `<tr class="clickable" onclick="location.href='/emails/${e.id}'"><td class="ellipsis" style="max-width:260px">${esc(e.subject)}</td><td>${statusCell(e.status)}</td><td class="r muted">${ago(e.created_at)}</td></tr>`).join("")}</tbody></table></div>` : '<span class="dim">None yet</span>'}</div>
    <div class="row-flex"><button class="btn btn-primary" data-save>Save</button><span class="grow"></span><button class="btn btn-ghost" data-del style="color:var(--red)">${icon("trash", 13)} Delete contact</button></div>`,
    onMount(d, close) {
      d.querySelector("[data-save]").onclick = async () => {
        const properties = { ...(c.properties || {}) }; d.querySelectorAll("[data-prop]").forEach((i) => { if (i.value === "") delete properties[i.dataset.prop]; else properties[i.dataset.prop] = i.type === "number" ? Number(i.value) : i.value; });
        const { error } = await sb.from("contacts").update({ first_name: d.querySelector('[data-k="first_name"]').value.trim() || null, last_name: d.querySelector('[data-k="last_name"]').value.trim() || null, unsubscribed: !d.querySelector("[data-subscribed]").checked, properties, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) return errToast(error);
        const want = new Set([...d.querySelectorAll("[data-seg]:checked")].map((x) => x.dataset.seg));
        const add = [...want].filter((s) => !inSet.has(s)), rem = [...inSet].filter((s) => !want.has(s));
        if (add.length) await sb.from("segment_contacts").insert(add.map((s) => ({ segment_id: s, contact_id: id, team_id: T() })));
        if (rem.length) await sb.from("segment_contacts").delete().eq("contact_id", id).in("segment_id", rem);
        const tp = [...d.querySelectorAll("[data-topic]")].map((x) => ({ contact_id: id, topic_id: x.dataset.topic, team_id: T(), subscription: x.checked ? "opt_in" : "opt_out", updated_at: new Date().toISOString() }));
        if (tp.length) await sb.from("contact_topics").upsert(tp, { onConflict: "contact_id,topic_id" });
        toast("Contact saved"); close(); reload();
      };
      d.querySelector("[data-del]").onclick = async () => { if (!(await confirmModal({ title: "Delete contact", desc: `Delete ${esc(c.email)}? This can’t be undone.`, confirm: "Delete" }))) return; await sb.from("contacts").delete().eq("id", id); toast("Contact deleted"); close(); reload(); };
    } });
}

// ------------------------------------------------------------ CSV import
export async function importCsv(ctx) {
  ctx.crumb("users", "Import CSV", ["Audience", "/contacts"]);
  const root = ctx.root;
  const { data: segs } = await sb.from("segments").select("id,name").eq("team_id", T()).order("name");
  const { data: props } = await sb.from("contact_properties").select("key").eq("team_id", T());
  let parsed = null, mapping = {}, step = 1;
  const FIELDS = [{ value: "", label: "Don’t import" }, { value: "email", label: "Email" }, { value: "first_name", label: "First name" }, { value: "last_name", label: "Last name" }, { value: "unsubscribed", label: "Unsubscribed" }, ...(props || []).map((p) => ({ value: "prop:" + p.key, label: p.key, right: "property" }))];
  function guess(h) { const x = h.toLowerCase().replace(/[^a-z]/g, ""); if (/email|mail/.test(x)) return "email"; if (/^(first|firstname|fname|given)/.test(x)) return "first_name"; if (/^(last|lastname|lname|surname|family)/.test(x)) return "last_name"; if (/unsub/.test(x)) return "unsubscribed"; const p = (props || []).find((p) => p.key.replace(/_/g, "") === x); return p ? "prop:" + p.key : ""; }
  function draw() {
    root.innerHTML = `<div class="page narrow">${head("Import contacts")}<div class="steps">
      <div class="step ${step === 1 ? "active" : "done"}"><div class="step-num">${step > 1 ? icon("check", 11) : 1}</div><div class="step-card"><h3>Upload a CSV</h3><p class="sub">One contact per row with a header row. Must include an email column.</p>${step === 1 ? `<label class="dropzone" data-drop>${icon("upload", 18, "dim")}<div>Drop a CSV here or <a>browse</a></div><div class="hint">Up to 50,000 rows · 10 MB</div><input type="file" accept=".csv,text/csv" hidden></label>` : `<div class="row-flex">${icon("check-circle", 14)} ${esc(parsed.name)} · ${plural(parsed.rows.length, "row")}<button class="btn btn-ghost btn-sm" data-restart style="margin-left:auto">Change file</button></div>`}</div></div>
      <div class="step ${step === 2 ? "active" : step > 2 ? "done" : "disabled"}"><div class="step-num">${step > 2 ? icon("check", 11) : 2}</div><div class="step-card"><h3>Map columns</h3><p class="sub">Match each column to a contact field.</p>${step === 2 ? `<div class="table-wrap"><table class="t"><thead><tr><th>Column</th><th>Sample</th><th style="width:200px">Import as</th></tr></thead><tbody>${parsed.header.map((h, i) => `<tr><td>${esc(h)}</td><td class="muted ellipsis" style="max-width:180px">${esc(parsed.rows[0]?.[i] ?? "")}</td><td>${selectHtml("col" + i, FIELDS, mapping[i] || "")}</td></tr>`).join("")}</tbody></table></div><div class="row-flex" style="margin-top:12px"><button class="btn btn-primary" data-next>Continue</button></div>` : ""}</div></div>
      <div class="step ${step === 3 ? "active" : "disabled"}"><div class="step-num">3</div><div class="step-card"><h3>Review and import</h3>${step === 3 ? review() : `<p class="sub">Choose a segment and confirm.</p>`}</div></div></div></div>`;
  }
  function rowsOut() {
    const ei = Object.keys(mapping).find((k) => mapping[k] === "email");
    const seen = new Set(), out = [], invalid = [];
    parsed.rows.forEach((r) => {
      const email = String(r[ei] || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { if (email || r.some(Boolean)) invalid.push(email); return; }
      if (seen.has(email)) return; seen.add(email);
      const c = { team_id: T(), email, properties: {} };
      Object.entries(mapping).forEach(([i, fld]) => { const v = (r[i] ?? "").trim(); if (!fld || fld === "email" || v === "") return; if (fld.startsWith("prop:")) c.properties[fld.slice(5)] = v; else if (fld === "unsubscribed") c.unsubscribed = /^(true|yes|1|y)$/i.test(v); else c[fld] = v; });
      out.push(c);
    });
    return { out, invalid };
  }
  function review() {
    const { out, invalid } = rowsOut();
    return `<div class="kv" style="margin:6px 0 12px"><span class="k">Valid contacts</span><span>${num(out.length)}</span><span class="k">Skipped</span><span>${num(parsed.rows.length - out.length)}${invalid.length ? ` <span class="dim">(${num(invalid.length)} invalid emails)</span>` : ""}</span></div>
      <div class="field"><label>Add to segment</label>${selectHtml("segment", [{ value: "", label: "Don’t add to a segment" }, ...(segs || []).map((s) => ({ value: s.id, label: s.name })), { value: "__new", label: "New segment…" }], "")}<input class="input hidden" data-newseg placeholder="Segment name" style="margin-top:6px"></div>
      <label class="row-flex" style="margin:12px 0"><input type="checkbox" class="checkbox" data-overwrite checked> Update existing contacts with values from this file</label>
      <p class="hint" style="margin-bottom:12px">Only import people who agreed to hear from you. Lists bought or scraped get high complaint rates and can get sending paused.</p>
      <div data-prog></div><div class="row-flex"><button class="btn btn-ghost" data-back>Back</button><button class="btn btn-primary" data-import ${out.length ? "" : "disabled"}>Import ${plural(out.length, "contact")}</button></div>`;
  }
  async function readFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast("Files must be under 10 MB", "err");
    const all = parseCsv(await file.text()).filter((r) => r.some((c) => String(c).trim()));
    if (all.length < 2) return toast("That file has no rows under the header", "err");
    if (all.length > 50001) return toast("Split files over 50,000 rows", "err");
    parsed = { name: file.name, header: all[0].map(String), rows: all.slice(1) };
    mapping = {}; parsed.header.forEach((h, i) => { const g = guess(h); if (g && !Object.values(mapping).includes(g)) mapping[i] = g; });
    step = 2; draw();
  }
  on(root, "change", "input[type=file]", (_e, i) => readFile(i.files[0]));
  on(root, "dragover", "[data-drop]", (e, d) => { e.preventDefault(); d.classList.add("over"); });
  on(root, "dragleave", "[data-drop]", (_e, d) => d.classList.remove("over"));
  on(root, "drop", "[data-drop]", (e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
  on(root, "click", "[data-restart]", () => { step = 1; parsed = null; draw(); });
  on(root, "click", "[data-back]", () => { step = 2; draw(); });
  bindSelects(root, (name, v) => { if (name.startsWith("col")) mapping[name.slice(3)] = v; if (name === "segment") root.querySelector("[data-newseg]").classList.toggle("hidden", v !== "__new"); });
  on(root, "click", "[data-next]", () => { if (!Object.values(mapping).includes("email")) return toast("Map one column to Email", "err"); const vals = Object.values(mapping).filter(Boolean); if (new Set(vals).size !== vals.length) return toast("Each field can only be mapped once", "err"); step = 3; draw(); });
  on(root, "click", "[data-import]", async (_e, btn) => {
    const { out } = rowsOut();
    let seg = root.querySelector("input[name=segment]").value;
    btn.disabled = true;
    try {
      if (seg === "__new") { const name = root.querySelector("[data-newseg]").value.trim(); if (!name) { btn.disabled = false; return toast("Name the new segment", "err"); } const { data, error } = await sb.from("segments").insert({ team_id: T(), name }).select("id").single(); if (error) throw error; seg = data.id; }
      const overwrite = root.querySelector("[data-overwrite]").checked;
      const prog = root.querySelector("[data-prog]");
      let done = 0;
      for (let i = 0; i < out.length; i += 500) {
        const chunk = out.slice(i, i + 500);
        const { data, error } = await sb.from("contacts").upsert(chunk, { onConflict: "team_id,email", ignoreDuplicates: !overwrite }).select("id,email");
        if (error) throw error;
        let ids = data.map((x) => x.id);
        if (!overwrite && ids.length < chunk.length) { const { data: ex } = await sb.from("contacts").select("id").eq("team_id", T()).in("email", chunk.map((c) => c.email)); ids = ex.map((x) => x.id); }
        if (seg) { const { error: e2 } = await sb.from("segment_contacts").upsert(ids.map((id) => ({ segment_id: seg, contact_id: id, team_id: T() })), { onConflict: "segment_id,contact_id", ignoreDuplicates: true }); if (e2) throw e2; }
        done += chunk.length;
        prog.innerHTML = `<div class="meter" style="margin:0 0 12px"><i style="width:${(done / out.length) * 100}%"></i></div>`;
      }
      toast(`Imported ${plural(out.length, "contact")}`);
      ctx.navigate(seg ? `/segments/${seg}` : "/contacts");
    } catch (e) { errToast(e); btn.disabled = false; }
  });
  draw();
}

// ------------------------------------------------------------ properties
export async function properties(ctx) {
  ctx.crumb("users", "Properties", ["Audience", "/contacts"]);
  const root = ctx.root;
  let data = [];
  async function load() {
    const r = await sb.from("contact_properties").select("*").eq("team_id", T()).order("key"); if (r.error) throw r.error; data = r.data;
    root.innerHTML = `<div class="page wide">${head("Audience", `<button class="btn btn-primary" data-new>${icon("plus", 13)} Add property</button>`)}${tabs("/contacts/properties")}
      <p class="muted" style="margin-bottom:14px">Custom fields stored on each contact. Use them as variables in broadcasts, like <span class="mono">{{{company}}}</span>.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th>Key</th><th>Type</th><th>Fallback</th><th class="r">Created</th><th></th></tr></thead><tbody>
      <tr><td class="mono">email</td><td class="muted">string</td><td class="dim">—</td><td class="r dim">Built in</td><td></td></tr><tr><td class="mono">first_name</td><td class="muted">string</td><td class="dim">—</td><td class="r dim">Built in</td><td></td></tr><tr><td class="mono">last_name</td><td class="muted">string</td><td class="dim">—</td><td class="r dim">Built in</td><td></td></tr>
      ${data.map((p) => `<tr><td class="mono">${esc(p.key)}</td><td class="muted">${p.type}</td><td class="muted">${esc(p.fallback || "—")}</td><td class="r muted">${ago(p.created_at)}</td><td class="act"><button class="ibtn" data-row="${p.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div></div>`;
  }
  on(root, "click", "[data-row]", (_e, b) => { const p = data.find((x) => x.id === b.dataset.row); menu(b, [
      { label: "Edit fallback", icon: "edit", onClick: () => formModal({ title: `Edit ${esc(p.key)}`, fields: [{ name: "fallback", label: "Fallback value", value: p.fallback, optional: true }], async onSubmit(v) { const { error: e } = await sb.from("contact_properties").update({ fallback: v.fallback || null }).eq("id", p.id); if (e) throw e; toast("Saved"); load(); } }) },
      { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete property", desc: `Values stay on contacts but <span class="mono">${esc(p.key)}</span> won’t show in the dashboard.`, confirm: "Delete" }))) return; await sb.from("contact_properties").delete().eq("id", p.id); toast("Property deleted"); load(); } }], { align: "right" }); });
  on(root, "click", "[data-new]", () => formModal({ title: "Add property", fields: [{ name: "key", label: "Key", placeholder: "company", mono: true, hint: "Lowercase letters, numbers and underscores." }, { name: "type", label: "Type", type: "select", value: "string", options: [{ value: "string", label: "String" }, { value: "number", label: "Number" }] }, { name: "fallback", label: "Fallback value", optional: true }], submit: "Add", validate: (v) => /^[a-z][a-z0-9_]{0,49}$/.test(v.key),
    async onSubmit(v) { const { error } = await sb.from("contact_properties").insert({ team_id: T(), key: v.key, type: v.type, fallback: v.fallback || null }); if (error) throw new Error(error.message.includes("duplicate") ? "That key already exists" : error.message); toast("Property added"); load(); } }));
  await load();
}

// ------------------------------------------------------------ topics
export async function topics(ctx) {
  ctx.crumb("users", "Topics", ["Audience", "/contacts"]);
  const root = ctx.root;
  let data = [];
  async function load() {
    const r = await sb.from("topics").select("*").eq("team_id", T()).order("created_at"); if (r.error) throw r.error; data = r.data;
    root.innerHTML = `<div class="page wide">${head("Audience", `<button class="btn btn-secondary" href="/settings/unsubscribe-page" data-page>${icon("edit", 13)} Customize page</button><button class="btn btn-primary" data-new>${icon("plus", 13)} Create topic</button>`)}${tabs("/contacts/topics")}
      <p class="muted" style="margin-bottom:14px">Topics let people choose what they hear about instead of unsubscribing from everything. Pick a topic when you send a broadcast.</p>
      <div style="display:grid;grid-template-columns:1fr 360px;gap:20px" class="two-col"><div>${data.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Default</th><th>Visibility</th><th></th></tr></thead><tbody>${data.map((t) => `<tr><td><div style="font-weight:500">${esc(t.name)}</div><div class="dim ellipsis" style="font-size:12px;max-width:260px">${esc(t.description || "")}</div></td><td>${t.default_subscription === "opt_in" ? badge("Opt-in", "green") : badge("Opt-out", "gray")}</td><td class="muted">${t.visibility === "public" ? "Public" : "Private"}</td><td class="act"><button class="ibtn" data-row="${t.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>` : emptyState({ icon: "list", title: "No topics yet", desc: "Create topics like Product updates or Weekly digest.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create topic</button>` })}</div>
      <div><div class="label" style="margin-bottom:8px">Preference page preview</div><div class="card" style="background:#fff;color:#111;padding:22px;border-radius:12px"><div style="font-weight:600;font-size:16px">${esc(state.team.name)}</div><div style="color:#666;font-size:13px;margin:4px 0 14px">Choose what you’d like to hear about.</div>${data.filter((t) => t.visibility === "public").map((t) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #eee"><input type="checkbox" ${t.default_subscription === "opt_in" ? "checked" : ""}><span><b style="font-weight:500">${esc(t.name)}</b><br><span style="color:#777;font-size:12px">${esc(t.description || "")}</span></span></label>`).join("") || '<div style="color:#999;font-size:13px">Public topics show here.</div>'}<div style="border-top:1px solid #eee;padding-top:12px;margin-top:4px;font-size:12px;color:#777">Unsubscribe from everything</div></div></div></div></div>`;
  }
  on(root, "click", "[data-row]", (_e, b) => { const t = data.find((x) => x.id === b.dataset.row); menu(b, [{ label: "Edit", icon: "edit", onClick: () => topicModal(t, load) }, { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(t.id).then(() => toast("ID copied")) }, { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete topic", desc: "Preferences for this topic are removed. Broadcasts that used it keep their stats.", confirm: "Delete", typed: t.name }))) return; await sb.from("topics").delete().eq("id", t.id); toast("Topic deleted"); load(); } }], { align: "right" }); });
  on(root, "click", "[data-new]", () => topicModal(null, load));
  on(root, "click", "[data-page]", () => ctx.navigate("/settings/unsubscribe-page"));
  await load();
}
function topicModal(t, done) {
  formModal({ title: t ? "Edit topic" : "Create topic", fields: [
    { name: "name", label: "Name", value: t?.name, placeholder: "Product updates" },
    { name: "description", label: "Description", type: "textarea", rows: 2, value: t?.description, optional: true, placeholder: "New features and improvements, once a month." },
    { name: "default_subscription", label: "Default subscription", type: "radios", value: t?.default_subscription || "opt_in", options: [{ value: "opt_in", label: "Opt-in", desc: "Everyone gets it until they opt out" }, { value: "opt_out", label: "Opt-out", desc: "Only people who opt in get it" }] },
    { name: "visibility", label: "Visibility", type: "radios", value: t?.visibility || "public", options: [{ value: "public", label: "Public", desc: "Shown on the preference page" }, { value: "private", label: "Private", desc: "Hidden; manage through the API" }] },
  ], submit: t ? "Save" : "Create", validate: (v) => v.name, size: "lg",
  async onSubmit(v, m) {
    const row = { name: v.name, description: v.description || null, default_subscription: m.querySelector("input[name=default_subscription]:checked").value, visibility: m.querySelector("input[name=visibility]:checked").value };
    const { error } = t ? await sb.from("topics").update(row).eq("id", t.id) : await sb.from("topics").insert({ ...row, team_id: T() });
    if (error) throw error; toast(t ? "Topic saved" : "Topic created"); done();
  } });
}

// ------------------------------------------------------------ segments
export async function segments(ctx) {
  ctx.crumb("users", "Segments", ["Audience", "/contacts"]);
  const root = ctx.root;
  let data = [];
  async function load() {
    const [r, { data: st }] = await Promise.all([sb.from("segments").select("*").eq("team_id", T()).order("created_at"), sb.rpc("segment_stats", { p_team: T() })]);
    if (r.error) throw r.error; data = r.data;
    const stats = Object.fromEntries((st || []).map((s) => [s.segment_id, s]));
    root.innerHTML = `<div class="page wide">${head("Audience", `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create segment</button>`)}${tabs("/segments")}
      ${data.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th class="r">Contacts</th><th class="r">Unsubscribed</th><th class="r">Created</th><th></th></tr></thead><tbody>${data.map((s) => `<tr class="clickable" data-id="${s.id}"><td><div class="cell">${icon("layers", 13, "dim")}${esc(s.name)}</div></td><td class="r">${num(stats[s.id]?.contacts)}</td><td class="r muted">${num(stats[s.id]?.unsubscribed)}</td><td class="r muted">${ago(s.created_at)}</td><td class="act"><button class="ibtn" data-row="${s.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`
        : emptyState({ icon: "layers", title: "No segments yet", desc: "Segments are lists of contacts you send broadcasts to.", action: `<button class="btn btn-primary" data-new>${icon("plus", 13)} Create segment</button>` })}</div>`;
  }
  on(root, "click", "[data-row]", (e, b) => { e.stopPropagation(); const s = data.find((x) => x.id === b.dataset.row); menu(b, [{ label: "Rename", icon: "edit", onClick: () => formModal({ title: "Rename segment", fields: [{ name: "name", label: "Name", value: s.name }], validate: (v) => v.name, async onSubmit(v) { await sb.from("segments").update({ name: v.name }).eq("id", s.id); toast("Renamed"); load(); } }) }, { label: "Copy ID", icon: "copy", onClick: () => navigator.clipboard.writeText(s.id).then(() => toast("ID copied")) }, { sep: true }, { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete segment", desc: "Contacts stay in your audience; only the list is removed.", confirm: "Delete", typed: s.name }))) return; await sb.from("segments").delete().eq("id", s.id); toast("Segment deleted"); load(); } }], { align: "right" }); });
  on(root, "click", "tr[data-id]", (e, tr) => { if (!e.target.closest("[data-row]")) ctx.navigate(`/segments/${tr.dataset.id}`); });
  on(root, "click", "[data-new]", () => formModal({ title: "Create segment", fields: [{ name: "name", label: "Name", placeholder: "Newsletter" }], submit: "Create", validate: (v) => v.name, async onSubmit(v) { const { data, error } = await sb.from("segments").insert({ team_id: T(), name: v.name }).select("id").single(); if (error) throw error; ctx.navigate(`/segments/${data.id}`); } }));
  await load();
}

export async function segment(ctx) {
  const id = ctx.params.id;
  const { data: s } = await sb.from("segments").select("*").eq("id", id).maybeSingle();
  if (!s) return ctx.navigate("/segments", { replace: true });
  ctx.crumb("layers", s.name, ["Segments", "/segments"]);
  const root = ctx.root;
  let page = 1, q = "";
  root.innerHTML = `<div class="page wide"><div class="page-head"><h1>${esc(s.name)}</h1><div class="actions"><button class="btn btn-secondary" data-addc>${icon("plus", 13)} Add contacts</button><a class="btn btn-secondary" href="/contacts/import">${icon("upload", 13)} Import CSV</a><button class="btn btn-primary" data-send>${icon("send", 13)} Send broadcast</button></div></div>
    <div class="facts" style="grid-template-columns:repeat(3,1fr)" data-facts></div>
    <div class="filters" style="margin-top:18px"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search in segment"></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  async function load() {
    let qq = sb.from("segment_contacts").select("created_at, contacts!inner(id,email,first_name,last_name,unsubscribed,search)", { count: "exact" }).eq("segment_id", id);
    if (q) qq = qq.ilike("contacts.search", `%${q.toLowerCase()}%`);
    const [{ data, count, error }, { count: unsub }] = await Promise.all([qq.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1), sb.from("segment_contacts").select("contact_id, contacts!inner(unsubscribed)", { count: "exact", head: true }).eq("segment_id", id).eq("contacts.unsubscribed", true)]);
    if (error) throw error;
    if (!q) root.querySelector("[data-facts]").innerHTML = `<div><div class="k">Contacts</div><div class="v">${num(count)}</div></div><div><div class="k">Subscribed</div><div class="v">${num(count - (unsub || 0))}</div></div><div><div class="k">ID</div><div class="v mono" style="font-size:12px"><button data-copy="${s.id}" class="dim">${s.id.slice(0, 8)}… ${icon("copy", 11)}</button></div></div>`;
    body.innerHTML = count ? `<div class="table-wrap"><table class="t"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th class="r">Added to segment</th><th></th></tr></thead><tbody>${data.map((r) => { const c = r.contacts; return `<tr><td>${esc(c.email)}</td><td class="muted">${esc([c.first_name, c.last_name].filter(Boolean).join(" ") || "—")}</td><td>${c.unsubscribed ? badge("Unsubscribed", "gray") : badge("Subscribed", "green")}</td><td class="r muted">${ago(r.created_at)}</td><td class="act"><button class="ibtn" title="Remove from segment" data-rm="${c.id}">${icon("x")}</button></td></tr>`; }).join("")}</tbody></table></div>${pager(page, count, PAGE, "contact")}`
      : emptyState({ icon: "users", title: q ? "No matches" : "This segment is empty", desc: q ? "Try another search." : "Add contacts to it, or import a CSV into it.", action: q ? "" : `<button class="btn btn-secondary" data-addc>${icon("plus", 13)} Add contacts</button>` });
  }
  root.querySelector("[data-q]").addEventListener("input", debounce((e) => { q = e.target.value.trim(); page = 1; load(); }, 300));
  on(root, "click", "[data-page]", (_e, b) => { page = +b.dataset.page; load(); });
  on(root, "click", "[data-rm]", async (_e, b) => { await sb.from("segment_contacts").delete().eq("segment_id", id).eq("contact_id", b.dataset.rm); toast("Removed from segment"); load(); });
  on(root, "click", "[data-send]", async () => { const { createDraft } = await import("./broadcasts.js"); createDraft(ctx.navigate, { segment_id: id }).catch(errToast); });
  on(root, "click", "[data-addc]", () => addModal([s], load, s.id));
  await load();
}

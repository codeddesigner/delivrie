import { sb, state, api } from "../lib/sb.js";
import { esc, icon, toast, errToast, menu, modal, debounce, selectHtml, bindSelects, num, fmtDateTime, EMAIL_RE, TZ } from "../lib/ui.js";
import { mountEditor, previewModal, pageStylePopover } from "./editor.js";

export default async function broadcastEdit(ctx) {
  const id = ctx.params.id;
  const [{ data: b, error }, { data: segs }, { data: topics }, { data: domains }, { data: props }] = await Promise.all([
    sb.from("broadcasts").select("*").eq("id", id).maybeSingle(),
    sb.from("segments").select("id,name").eq("team_id", state.team.id).order("name"),
    sb.from("topics").select("id,name,default_subscription").eq("team_id", state.team.id).order("name"),
    sb.from("domains").select("id,name,status").eq("team_id", state.team.id),
    sb.from("contact_properties").select("key,type,fallback").eq("team_id", state.team.id),
  ]);
  if (error) throw error;
  if (!b) { toast("Broadcast not found", "err"); return ctx.navigate("/broadcasts", { replace: true }); }
  if (b.status !== "draft") return ctx.navigate(b.status === "scheduled" ? `/broadcasts/${id}/scheduled` : `/broadcasts/${id}`, { replace: true });
  document.title = `${b.name} · Delivrie`;
  const verified = (domains || []).filter((d) => d.status === "verified");

  const root = ctx.root;
  root.innerHTML = `<div class="editor-shell">
    <div class="editor-top"><a class="ibtn" href="/broadcasts" title="Back">${icon("arrow-left", 15)}</a><span class="dim">Broadcasts</span><span class="dim">/</span><input class="name-input" data-name value="${esc(b.name)}" size="${Math.max(8, b.name.length)}"><span class="dim" data-saved style="font-size:12px">Saved</span>
      <span class="grow"></span><button class="btn btn-ghost btn-sm" data-styles>${icon("sparkle", 13)} Styles</button><button class="btn btn-ghost btn-sm" data-preview>${icon("eye", 13)} Preview</button><button class="btn btn-secondary btn-sm" data-test>${icon("send", 13)} Test email</button><button class="btn btn-primary btn-sm" data-review>Review</button></div>
    <div class="editor-main"><div class="editor-canvas"><div class="editor-doc">
      <div class="hdr-fields">
        <div class="hdr-row"><span>From</span><input data-f="from" placeholder="Acme <news@${esc(verified[0]?.name || "yourdomain.com")}>" value="${esc(b.from || "")}" list="dlv-from"><datalist id="dlv-from">${verified.map((d) => `<option value="${esc(state.team.name)} <hello@${esc(d.name)}>">`).join("")}</datalist></div>
        <div class="hdr-row"><span>Reply-to</span><input data-f="reply_to" placeholder="Optional" value="${esc(b.reply_to || "")}"></div>
        <div class="hdr-row"><span>To</span><div>${selectHtml("segment_id", [...(segs || []).map((s) => ({ value: s.id, label: s.name, icon: "users" })), { value: "__new", label: "Create segment…", icon: "plus" }], b.segment_id || "", "Choose a segment", 'style="border:0;background:transparent;padding:0 6px"')}</div></div>
        <div class="hdr-row"><span>Topic</span><div>${selectHtml("topic_id", [{ value: "", label: "No topic" }, ...(topics || []).map((t) => ({ value: t.id, label: t.name, right: t.default_subscription === "opt_out" ? "opt-in only" : "" }))], b.topic_id || "", "No topic", 'style="border:0;background:transparent;padding:0 6px"')}</div></div>
      </div>
      <input class="doc-subject" data-f="subject" placeholder="Subject" value="${esc(b.subject || "")}">
      <input class="doc-preview" data-f="preview_text" placeholder="Preview text — shown after the subject in most inboxes" value="${esc(b.preview_text || "")}">
      <div data-editor></div>
    </div></div><aside class="inspector hidden" data-insp></aside></div></div>`;

  const saved = root.querySelector("[data-saved]");
  let patch = {};
  const flush = async () => {
    const p = patch; patch = {};
    if (!Object.keys(p).length) return;
    saved.textContent = "Saving…";
    const { error: e } = await sb.from("broadcasts").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (e) { saved.textContent = "Not saved"; errToast(e); Object.assign(patch, p); } else saved.textContent = "Saved";
  };
  const saveSoon = debounce(flush, 700);
  const set = (k, v) => { b[k] = v; patch[k] = v; saved.textContent = "Editing…"; saveSoon(); };
  window.addEventListener("beforeunload", flush);

  const vars = () => [{ name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" }, { name: "email", label: "Email" }, ...(props || []).map((p) => ({ name: p.key, label: p.key, type: p.type })), { name: "unsubscribe_url", label: "Unsubscribe URL" }];
  const ed = mountEditor(root.querySelector("[data-editor]"), { doc: b.content, mode: "broadcast", vars, inspectorHost: root.querySelector("[data-insp]"), onChange: (doc) => set("content", doc) });

  root.querySelector("[data-name]").addEventListener("input", (e) => { e.target.size = Math.max(8, e.target.value.length); set("name", e.target.value || "Untitled"); });
  root.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener("input", () => set(inp.dataset.f, inp.value.trim() || null)));
  bindSelects(root, async (name, value) => {
    if (value === "__new") {
      const { formModal } = await import("../lib/ui.js");
      formModal({ title: "Create segment", fields: [{ name: "name", label: "Name", placeholder: "Newsletter" }], submit: "Create", validate: (v) => v.name, async onSubmit(v) {
        const { data, error: e } = await sb.from("segments").insert({ team_id: state.team.id, name: v.name }).select("id").single(); if (e) throw e;
        set("segment_id", data.id); await flush(); toast("Segment created — add contacts to it from Audience"); ctx.navigate(`/broadcasts/${id}/edit`, { replace: true });
      } });
      return;
    }
    set(name, value || null);
  });
  root.querySelector("[data-styles]").onclick = (e) => pageStylePopover(e.currentTarget, b.content || {}, (p) => ed.setPage(p));
  root.querySelector("[data-preview]").onclick = () => previewModal(ed.getDoc(), { subject: b.subject, previewText: b.preview_text });
  root.querySelector("[data-test]").onclick = async () => { await flush(); testModal(id); };
  root.querySelector("[data-review]").onclick = async () => { await flush(); reviewModal(b, segs, topics, ctx); };
  document.addEventListener("keydown", function k(e) {
    if (!document.body.contains(root.querySelector("[data-editor]"))) { document.removeEventListener("keydown", k); ed.destroy(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); flush(); }
  });
}

export function testModal(id, kind = "broadcast") {
  const me = state.user.email;
  modal({ title: "Send test email", body: `<p class="desc">Send this ${kind} to up to five addresses. Variables use sample values (Ada Lovelace).</p><div class="field"><label>Recipients</label><textarea class="textarea" rows="3" placeholder="you@example.com, teammate@example.com">${esc(me)}</textarea><span class="hint">Separate with commas or new lines.</span></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>${icon("send", 13)} Send test</button>`,
    onMount(m, close) {
      m.querySelector("[data-ok]").onclick = async (e) => {
        const to = m.querySelector("textarea").value.split(/[\s,;]+/).filter(Boolean);
        if (!to.length || to.length > 5) return toast("Add between one and five addresses", "err");
        const bad = to.find((t) => !EMAIL_RE.test(t)); if (bad) return toast(`“${bad}” isn’t a valid email`, "err");
        e.currentTarget.disabled = true;
        try { await api("POST", "/dashboard/test-email", { to, [kind === "broadcast" ? "broadcast_id" : "template_id"]: id }); toast(`Test sent to ${to.length === 1 ? to[0] : to.length + " addresses"}`); close(true); }
        catch (err) { errToast(err); e.currentTarget.disabled = false; }
      };
    } });
}

function reviewModal(b, segs, topics, ctx) {
  const issues = [];
  if (!b.from) issues.push("Add a From address");
  if (!b.subject) issues.push("Add a subject");
  if (!b.segment_id) issues.push("Choose a segment to send to");
  const blocks = b.content?.blocks || [];
  if (!blocks.some((x) => x.type === "footer") && !JSON.stringify(blocks).includes("unsubscribe_url")) issues.push("Add an unsubscribe footer — bulk email must let people opt out");
  const seg = segs.find((s) => s.id === b.segment_id); const topic = topics.find((t) => t.id === b.topic_id);
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setHours(9, 0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  modal({ title: "Review and send", size: "lg", body: `
    <div class="kv"><span class="k">From</span><span>${esc(b.from || "—")}</span><span class="k">Subject</span><span>${esc(b.subject || "—")}</span><span class="k">Audience</span><span>${esc(seg?.name || "—")}${topic ? ` · ${esc(topic.name)}` : ""}</span><span class="k">Recipients</span><span data-count><span class="spinner" style="width:11px;height:11px"></span></span></div>
    ${issues.length ? `<div class="banner warn" style="flex-direction:column;align-items:flex-start;gap:4px">${issues.map((i) => `<div class="row-flex">${icon("alert", 13)} ${esc(i)}</div>`).join("")}</div>` : ""}
    <div class="field"><label>When</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="radio-card"><input type="radio" name="when" value="now" checked> Send now</label><label class="radio-card"><input type="radio" name="when" value="later"> Schedule</label></div>
    <input type="datetime-local" class="input hidden" data-at value="${local(tomorrow)}" min="${local(new Date())}"><span class="hint hidden" data-tz>Times are in ${esc(TZ)}.</span></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Back to editing</button><button class="btn btn-primary" data-ok ${issues.length ? "disabled" : ""}>Send now</button>`,
    async onMount(m, close) {
      const ok = m.querySelector("[data-ok]"), at = m.querySelector("[data-at]");
      m.querySelectorAll("input[name=when]").forEach((r) => r.onchange = () => { const later = r.value === "later" && r.checked; at.classList.toggle("hidden", !later); m.querySelector("[data-tz]").classList.toggle("hidden", !later); ok.textContent = later ? "Schedule" : "Send now"; });
      if (b.segment_id) {
        try { const r = await api("GET", `/broadcasts/${b.id}/recipients`); m.querySelector("[data-count]").innerHTML = `${num(r.recipients)} contacts <span class="dim">${r.total - r.recipients ? `· ${num(r.total - r.recipients)} skipped (unsubscribed${r.topic_opt_out ? ", opted out of topic" : ""} or suppressed)` : ""}</span>`; if (!r.recipients) { ok.disabled = true; m.querySelector("[data-count]").innerHTML += `<div style="color:var(--orange);font-size:12px">This segment has no one to send to yet.</div>`; } }
        catch (e) { m.querySelector("[data-count]").textContent = e.message; }
      } else m.querySelector("[data-count]").textContent = "—";
      ok.onclick = async () => {
        const later = m.querySelector("input[name=when]:checked").value === "later";
        const when = later ? new Date(at.value) : null;
        if (later && (!at.value || when < new Date())) return toast("Pick a time in the future", "err");
        ok.disabled = true; ok.innerHTML = `<span class="spinner"></span>`;
        try { await api("POST", `/broadcasts/${b.id}/send`, { scheduled_at: when ? when.toISOString() : null }); close(true); ctx.navigate(`/broadcasts/${b.id}/scheduled`); }
        catch (e) { errToast(e); ok.disabled = false; ok.textContent = later ? "Schedule" : "Send now"; }
      };
    } });
}

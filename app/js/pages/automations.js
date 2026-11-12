// Automations (Figma 11.1–11.3): list, step editor, runs.
import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, toast, errToast, menu, modal, formModal, confirmModal, emptyState, badge, on, debounce, EMAIL_RE, codeBlock } from "../lib/ui.js";

const STATUS = { live: ["Live", "green"], paused: ["Paused", "yellow"], draft: ["Draft", "gray"] };
const RUN = { running: ["Running", "blue"], completed: ["Completed", "green"], failed: ["Failed", "red"], canceled: ["Canceled", "gray"] };
const STEP_TYPES = [["send", "Send email", "mail"], ["wait", "Wait", "clock"], ["condition", "Condition", "split"], ["update_contact", "Update contact", "users"], ["add_segment", "Add to segment", "layers"], ["webhook", "Call webhook", "webhook"], ["end", "End", "stop"]];
const uid = () => "s" + Math.random().toString(36).slice(2, 8);
const STARTERS = [
  { key: "welcome", name: "Welcome series", desc: "Greet new users, then nudge them to finish setup.", trig: "user.created", trigger: { type: "event", event: "user.created" },
    build: () => { const a = uid(), b = uid(), c = uid(), d = uid(), e = uid(); return { start: a, steps: { [a]: { id: a, type: "send", next: b }, [b]: { id: b, type: "wait", amount: 2, unit: "days", next: c }, [c]: { id: c, type: "condition", kind: "opened", ref: a, within: 2, within_unit: "days", yes: d, no: e }, [d]: { id: d, type: "send" }, [e]: { id: e, type: "send" } } }; } },
  { key: "cart", name: "Abandoned cart", desc: "Remind shoppers about items left in their cart.", trig: "cart.abandoned", trigger: { type: "event", event: "cart.abandoned" },
    build: () => { const a = uid(), b = uid(), c = uid(); return { start: a, steps: { [a]: { id: a, type: "wait", amount: 1, unit: "hours", next: b }, [b]: { id: b, type: "send", next: c }, [c]: { id: c, type: "end" } } }; } },
  { key: "trial", name: "Trial ending", desc: "Warn users before their trial ends.", trig: "trial.ending", trigger: { type: "event", event: "trial.ending" },
    build: () => { const a = uid(); return { start: a, steps: { [a]: { id: a, type: "send" } } }; } },
  { key: "reengage", name: "Re-engagement", desc: "Win back contacts who join an Inactive segment.", trig: "Segment", trigger: { type: "segment", segment_id: "" },
    build: () => { const a = uid(), b = uid(), c = uid(); return { start: a, steps: { [a]: { id: a, type: "send", next: b }, [b]: { id: b, type: "wait", amount: 7, unit: "days", next: c }, [c]: { id: c, type: "send" } } }; } },
];
const trigLabel = (t, segs = []) => t?.type === "event" ? (t.event || "Choose an event") : t?.type === "segment" ? `Segment · ${segs.find((s) => s.id === t.segment_id)?.name || "choose"}` : t?.type === "schedule" ? `${t.every === "week" ? "Weekly" : "Daily"} at ${t.at || "09:00"} UTC` : "—";

async function create(ctx, starter) {
  const s = starter?.build?.() || { start: null, steps: {} };
  const { data, error } = await sb.from("automations").insert({ team_id: state.team.id, name: starter?.name || "Untitled automation", trigger: starter?.trigger || { type: "event", event: "" }, steps: s.steps, start_step: s.start, created_by: state.user.id }).select("id").single();
  if (error) return errToast(error);
  ctx.navigate(`/automations/${data.id}`);
}
function newModal(ctx) {
  return modal({ title: "New automation", size: "lg", body: `<p class="desc">Pick a starting point. You can change everything later.</p><div class="pick-grid">${[{ key: "blank", name: "Start from scratch", desc: "An empty canvas with a trigger", trig: "" }, ...STARTERS].map((s) => `<button class="pick-card" data-starter="${s.key}"><b>${esc(s.name)}</b><span class="muted">${esc(s.desc)}</span>${s.trig ? `<span class="mono dim" style="font-size:11.5px">${esc(s.trig)}</span>` : ""}</button>`).join("")}</div>`,
    onMount(m, close) { on(m, "click", "[data-starter]", (_e, b) => { close(); create(ctx, STARTERS.find((s) => s.key === b.dataset.starter)); }); } });
}

// ---------------------------------------------------------------- list
export async function list(ctx) {
  ctx.crumb("zap", "Automations");
  const root = ctx.root, T = state.team.id;
  const [{ data: autos, error }, { data: runs }, { data: segs }] = await Promise.all([
    sb.from("automations").select("*").eq("team_id", T).order("updated_at", { ascending: false }),
    sb.from("automation_runs").select("automation_id").eq("team_id", T).eq("test", false).gte("started_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(20000),
    sb.from("segments").select("id,name").eq("team_id", T),
  ]);
  if (error) throw error;
  const count = {}; (runs || []).forEach((r) => count[r.automation_id] = (count[r.automation_id] || 0) + 1);
  let rows = autos || [], q = "", st = "all";
  root.innerHTML = `<div class="page wide"><div class="page-head"><div><h1>Automations</h1><p class="muted" style="margin-top:4px">Send emails automatically when something happens in your product.</p></div><div class="actions"><a class="btn btn-secondary" href="/events">${icon("bolt", 13)} Events</a><button class="btn btn-primary" data-new>${icon("plus", 12)} Create automation</button></div></div><div data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  const draw = () => {
    if (!rows.length) {
      body.innerHTML = `<div class="card auto-empty"><div class="ae-top">${emptyState({ icon: "zap", title: "Build your first automation", desc: "Trigger emails from events you send with the API, a schedule, or contacts joining a segment. Add waits, conditions and branches without writing code.", action: `<button class="btn btn-primary" data-new>${icon("plus", 12)} Start from scratch</button>` })}</div>
        <div class="ae-h">Start from a template</div><div class="grid-4">${STARTERS.map((s) => `<button class="pick-card" data-starter="${s.key}"><b>${esc(s.name)}</b><span class="muted">${esc(s.desc)}</span><span class="row-flex" style="gap:6px;margin-top:auto"><span class="mono dim" style="font-size:11.5px">${esc(s.trig)}</span><span class="grow"></span><span class="dim" style="font-size:11.5px">${Object.keys(s.build().steps).length} steps</span></span></button>`).join("")}</div></div>`;
      return;
    }
    const r = rows.filter((a) => (st === "all" || a.status === st) && (!q || a.name.toLowerCase().includes(q)));
    const live = rows.filter((a) => a.status === "live").length;
    body.innerHTML = `<div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search automations" value="${esc(q)}"></div><select class="input" data-st style="width:150px">${[["all", "All statuses"], ["live", "Live"], ["paused", "Paused"], ["draft", "Draft"]].map(([v, l]) => `<option value="${v}" ${v === st ? "selected" : ""}>${l}</option>`).join("")}</select><span class="grow"></span><span class="dim" style="font-size:12.5px">${num(rows.length)} automation${rows.length === 1 ? "" : "s"} · ${num(live)} live</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Trigger</th><th>Status</th><th class="r">Runs · 30d</th><th class="r">Updated</th><th></th></tr></thead><tbody>${r.map((a) => `<tr class="clickable" data-open="${a.id}"><td style="font-weight:500">${esc(a.name)}</td><td><span class="mono" style="font-size:12px">${esc(trigLabel(a.trigger, segs || []))}</span></td><td>${badge(...STATUS[a.status])}</td><td class="r">${a.status === "draft" ? "—" : num(count[a.id] || 0)}</td><td class="r muted">${ago(a.updated_at)}</td><td class="act"><button class="ibtn" data-row="${a.id}">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>`;
    const qi = body.querySelector("[data-q]"); qi?.addEventListener("input", debounce(() => { q = qi.value.trim().toLowerCase(); draw(); body.querySelector("[data-q]").focus(); }, 150));
    body.querySelector("[data-st]")?.addEventListener("change", (e) => { st = e.target.value; draw(); });
  };
  draw();
  on(root, "click", "[data-new]", () => newModal(ctx));
  on(root, "click", "[data-starter]", (_e, b) => create(ctx, STARTERS.find((s) => s.key === b.dataset.starter)));
  on(root, "click", "[data-open]", (e, tr) => { if (!e.target.closest("[data-row]")) ctx.navigate(`/automations/${tr.dataset.open}`); });
  on(root, "click", "[data-row]", (e, b) => {
    e.stopPropagation(); const a = rows.find((x) => x.id === b.dataset.row);
    menu(b, [
      { label: "Open", icon: "edit", onClick: () => ctx.navigate(`/automations/${a.id}`) },
      { label: "Runs", icon: "list", onClick: () => ctx.navigate(`/automations/${a.id}/runs`) },
      { label: "Duplicate", icon: "copy", onClick: async () => { const { data, error: e2 } = await sb.from("automations").insert({ team_id: T, name: `${a.name} (copy)`, trigger: a.trigger, steps: a.steps, start_step: a.start_step, reentry: a.reentry, created_by: state.user.id }).select("*").single(); if (e2) return errToast(e2); rows.unshift(data); draw(); toast("Automation duplicated"); } },
      a.status === "live" ? { label: "Pause", icon: "pause", onClick: async () => { try { await api("POST", `/automations/automations/${a.id}/pause`); a.status = "paused"; draw(); toast("Paused"); } catch (er) { errToast(er); } } } : a.status === "paused" ? { label: "Resume", icon: "play", onClick: async () => { try { await api("POST", `/automations/automations/${a.id}/resume`); a.status = "live"; draw(); toast("Resumed"); } catch (er) { errToast(er); } } } : null,
      { label: "Rename", icon: "edit", onClick: () => formModal({ title: "Rename automation", fields: [{ name: "name", label: "Name", value: a.name }], validate: (v) => v.name, async onSubmit(v) { const { error: e2 } = await sb.from("automations").update({ name: v.name }).eq("id", a.id); if (e2) throw e2; a.name = v.name; draw(); } }) },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await confirmModal({ title: "Delete automation", desc: `“${esc(a.name)}” and its run history will be deleted. Emails already sent stay in your logs.`, confirm: "Delete" }))) return; const { error: e2 } = await sb.from("automations").delete().eq("id", a.id); if (e2) return errToast(e2); rows = rows.filter((x) => x !== a); draw(); toast("Automation deleted"); } },
    ].filter(Boolean), { align: "right" });
  });
  if (ctx.query.new) newModal(ctx);
}

// ---------------------------------------------------------------- editor
function header(a, tab) {
  return `<div class="auto-top"><a class="ibtn" href="/automations" title="Back">${icon("arrow-left", 15)}</a><input class="name-input" data-name value="${esc(a.name)}" size="${Math.max(10, a.name.length)}">${badge(...STATUS[a.status])}
    <div class="ul-tabs mini"><a class="ul-tab ${tab === "editor" ? "on" : ""}" href="/automations/${a.id}">Editor</a><a class="ul-tab ${tab === "runs" ? "on" : ""}" href="/automations/${a.id}/runs">Runs</a></div><span class="grow"></span><span class="dim" data-saved style="font-size:12px"></span>
    ${tab === "editor" ? `<button class="btn btn-secondary btn-sm" data-test>${icon("play", 12)} Test</button>` : ""}${a.status === "live" ? `<button class="btn btn-secondary btn-sm" data-pause>${icon("pause", 12)} Pause</button>` : a.status === "paused" ? `<button class="btn btn-secondary btn-sm" data-resume>${icon("play", 12)} Resume</button>` : ""}${tab === "editor" ? `<button class="btn btn-primary btn-sm" data-publish>${a.status === "draft" ? "Publish" : "Publish changes"}</button>` : ""}</div>`;
}

export async function editor(ctx) {
  const T = state.team.id, root = ctx.root;
  const [{ data: a, error }, { data: tpls }, { data: segs }, { data: evs }, { data: doms }] = await Promise.all([
    sb.from("automations").select("*").eq("id", ctx.params.id).maybeSingle(),
    sb.from("templates").select("id,name,subject,status,from,published_version").eq("team_id", T).order("name"),
    sb.from("segments").select("id,name").eq("team_id", T).order("name"),
    sb.from("event_definitions").select("name,fields,last_seen_at").eq("team_id", T).order("name"),
    sb.from("domains").select("name,status").eq("team_id", T).eq("status", "verified"),
  ]);
  if (error) throw error;
  if (!a) { toast("Automation not found", "err"); return ctx.navigate("/automations", { replace: true }); }
  ctx.crumb("zap", "Automations");
  document.title = `${a.name} · Delivrie`;
  a.steps = a.steps || {};
  let sel = "trigger";
  root.innerHTML = `<div class="auto">${header(a, "editor")}<div class="auto-main"><aside class="auto-palette"><div class="ap-h">Steps</div>${STEP_TYPES.map(([t, l, i]) => `<button class="ap-item" data-add="${t}">${icon(i, 14)}<span>${l}</span></button>`).join("")}<p class="dim" style="font-size:11.5px;padding:10px 8px">Steps are added after the selected step, or on the selected branch.</p></aside>
    <div class="auto-canvas" data-canvas></div><aside class="auto-insp" data-insp></aside></div></div>`;
  const $ = (s) => root.querySelector(s);
  const saved = $("[data-saved]");
  const persist = debounce(async () => {
    saved.textContent = "Saving…";
    const { error: e } = await sb.from("automations").update({ name: a.name, trigger: a.trigger, steps: a.steps, start_step: a.start_step, reentry: a.reentry, updated_at: new Date().toISOString() }).eq("id", a.id);
    saved.textContent = e ? "Not saved" : "Saved"; if (e) errToast(e);
  }, 600);
  const changed = () => { saved.textContent = "Editing…"; persist(); drawCanvas(); };

  // where a new step goes: after the selected step, or on a branch slot "id:yes" / "id:no", or at the start for the trigger
  const insertAt = (type) => {
    const id = uid(), node = { id, type };
    if (type === "wait") Object.assign(node, { amount: 1, unit: "days" });
    if (type === "condition") Object.assign(node, { kind: "opened", within: 2, within_unit: "days" });
    const [sid, slot] = sel.split(":");
    if (sid === "trigger") { node[type === "condition" ? "yes" : "next"] = a.start_step || undefined; a.start_step = id; }
    else { const p = a.steps[sid]; if (!p) return; const key = slot || (p.type === "condition" ? "yes" : "next"); if (type !== "end") node[type === "condition" ? "yes" : "next"] = p[key] || undefined; p[key] = id; }
    if (type === "end") delete node.next;
    a.steps[id] = node; sel = id; changed(); drawInsp();
  };
  const removeStep = (id) => {
    const node = a.steps[id]; if (!node) return;
    const keep = node.type === "condition" ? null : node.next || null;
    const drop = (sid) => { const s = a.steps[sid]; if (!s) return; delete a.steps[sid]; [s.next, s.yes, s.no].forEach((x) => x && drop(x)); };
    if (node.type === "condition") { [node.yes, node.no].forEach((x) => x && drop(x)); }
    if (a.start_step === id) a.start_step = keep;
    for (const s of Object.values(a.steps)) for (const k of ["next", "yes", "no"]) if (s[k] === id) s[k] = keep || undefined;
    delete a.steps[id]; sel = "trigger"; changed(); drawInsp();
  };

  const stepCard = (s) => {
    const t = tpls?.find((x) => x.id === s.template_id);
    const meta = {
      send: [`Send email`, t ? `${esc(t.name)}${t.status !== "published" ? ` <span class="badge yellow">not published</span>` : ""}` : `<span class="warn-t">Choose a template</span>`],
      wait: ["Wait", `${s.amount || 1} ${s.unit || "days"}`],
      condition: ["Condition", s.kind === "opened" ? `Opened ${s.ref && a.steps[s.ref] ? "that email" : "the last email"}? · within ${s.within || 2} ${s.within_unit || "days"}` : s.kind === "clicked" ? `Clicked the last email? · within ${s.within || 2} ${s.within_unit || "days"}` : `${esc(s.field || "field")} ${esc(s.op || "eq")} ${esc(s.value ?? "")}`],
      update_contact: ["Update contact", `Set ${esc(s.field || "a field")} = ${esc(s.value ?? "")}`],
      add_segment: ["Add to segment", esc(segs?.find((x) => x.id === s.segment_id)?.name || "Choose a segment")],
      webhook: ["Call webhook", esc(s.url || "Add a URL")],
      end: ["End", "Run completes"],
    }[s.type] || [s.type, ""];
    const ic = STEP_TYPES.find((x) => x[0] === s.type)?.[2] || "dot";
    return `<button class="node ${sel === s.id ? "on" : ""} n-${s.type}" data-node="${s.id}"><span class="ni">${icon(ic, 13)}</span><span class="nt"><span class="nk">${meta[0]}</span><span class="nv">${meta[1]}</span></span></button>`;
  };
  const plus = (slot) => `<button class="plus ${sel === slot ? "on" : ""}" data-slot="${slot}" title="Add a step here">${icon("plus", 11)}</button>`;
  const chain = (id, seen = new Set()) => {
    let html = "";
    while (id && a.steps[id] && !seen.has(id)) {
      seen.add(id); const s = a.steps[id];
      html += `<div class="conn"></div>${stepCard(s)}`;
      if (s.type === "condition") {
        html += `<div class="branches"><div class="branch"><span class="bl yes">Yes</span>${chain(s.yes, seen)}<div class="conn"></div>${plus(`${s.id}:yes`)}</div><div class="branch"><span class="bl no">No</span>${chain(s.no, seen)}<div class="conn"></div>${plus(`${s.id}:no`)}</div></div>`;
        return html;
      }
      if (s.type === "end") return html;
      id = s.next;
    }
    return html;
  };
  const lastOnMain = () => { let id = a.start_step, last = "trigger", seen = new Set(); while (id && a.steps[id] && !seen.has(id)) { seen.add(id); last = id; if (a.steps[id].type === "condition" || a.steps[id].type === "end") return null; id = a.steps[id].next; } return last; };
  function drawCanvas() {
    const tail = lastOnMain();
    $("[data-canvas]").innerHTML = `<div class="flow"><button class="node trig ${sel === "trigger" ? "on" : ""}" data-node="trigger"><span class="ni">${icon("bolt", 13)}</span><span class="nt"><span class="nk">Trigger</span><span class="nv">${esc(trigLabel(a.trigger, segs || []))}${a.trigger.type === "event" && a.trigger.filter?.field ? ` · when ${esc(a.trigger.filter.field)} ${esc(a.trigger.filter.op || "eq")} ${esc(a.trigger.filter.value ?? "")}` : ""}</span></span><span class="dim" style="font-size:11px;margin-left:auto">${a.reentry === "once" ? "Once per contact" : "Every time"}</span></button>
      ${chain(a.start_step)}${tail ? `<div class="conn"></div>${plus(tail === "trigger" ? "trigger" : tail)}` : ""}</div>`;
  }
  const field = (label, html, hint = "") => `<div class="field"><label>${label}</label>${html}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  function drawInsp() {
    const box = $("[data-insp]");
    if (sel === "trigger") {
      const t = a.trigger, ev = evs?.find((e) => e.name === t.event);
      box.innerHTML = `<div class="insp-h">${icon("bolt", 14)}<b>Trigger</b></div>
        ${field("Trigger type", `<select class="input" data-t="type">${opt([["event", "Event"], ["segment", "Contact joins a segment"], ["schedule", "Schedule"]], t.type)}</select>`)}
        ${t.type === "event" ? field("Event name", `<input class="input mono" data-t="event" list="dlv-evs" value="${esc(t.event || "")}" placeholder="user.created"><datalist id="dlv-evs">${(evs || []).map((e) => `<option value="${esc(e.name)}">`).join("")}</datalist>`, ev?.last_seen_at ? `Last received ${ago(ev.last_seen_at)}` : t.event ? "Not received yet. Send it with the API below." : "")
          + field("Only when <span class='dim'>Optional</span>", `<div class="row-3"><input class="input mono" data-f="field" list="dlv-fields" value="${esc(t.filter?.field || "")}" placeholder="data.country"><datalist id="dlv-fields">${(ev?.fields || []).map((f) => `<option value="${esc(f.name)}">`).join("")}</datalist><select class="input" data-f="op">${opt([["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["exists", "exists"], ["gt", ">"], ["lt", "<"]], t.filter?.op || "eq")}</select><input class="input" data-f="value" value="${esc(t.filter?.value ?? "")}" placeholder="NG"></div>`)
          + `<div class="insp-sub">Send this event</div>${codeBlock(`await fetch('https://delivrie.io/api/events', {\n  method: 'POST',\n  headers: { Authorization: 'Bearer dlv_live_••••', 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    event: '${t.event || "user.created"}',\n    email: 'ada@example.com',\n    data: { country: 'NG' },\n  }),\n});`, { lang: "js", lines: false })}`
        : field("Segment", `<select class="input" data-t="segment_id"><option value="">Choose a segment</option>${opt((segs || []).map((s) => [s.id, s.name]), t.segment_id)}</select>`, t.type === "segment" ? "Runs start when a contact is added to this segment." : "Everyone in the segment enters on each scheduled run.")
          + (t.type === "schedule" ? field("Every", `<div class="row-3"><select class="input" data-t="every">${opt([["day", "Day"], ["week", "Week"]], t.every || "day")}</select>${t.every === "week" ? `<select class="input" data-t="weekday">${opt([[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]], t.weekday ?? 1)}</select>` : ""}<input class="input" type="time" data-t="at" value="${esc(t.at || "09:00")}"></div>`, "Times are UTC.") : "")}
        ${t.type !== "schedule" ? field("Re-entry", `<select class="input" data-reentry>${opt([["once", "Once per contact"], ["always", "Every time it triggers"]], a.reentry)}</select>`) : ""}`;
      box.querySelectorAll("[data-t]").forEach((el) => el.addEventListener("change", () => { const k = el.dataset.t; a.trigger = k === "type" ? { type: el.value, ...(el.value === "event" ? { event: "" } : el.value === "schedule" ? { every: "day", at: "09:00", segment_id: a.trigger.segment_id || "" } : { segment_id: a.trigger.segment_id || "" }) } : { ...a.trigger, [k]: el.value }; changed(); drawInsp(); }));
      box.querySelector("[data-t=event]")?.addEventListener("input", (e) => { a.trigger.event = e.target.value.trim(); saved.textContent = "Editing…"; persist(); });
      box.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => { a.trigger.filter = { ...(a.trigger.filter || {}), [el.dataset.f]: el.value.trim() }; if (!a.trigger.filter.field) delete a.trigger.filter; changed(); }));
      box.querySelector("[data-reentry]")?.addEventListener("change", (e) => { a.reentry = e.target.value; changed(); });
      return;
    }
    const [sid, slot] = sel.split(":");
    const s = a.steps[sid];
    if (!s) { sel = "trigger"; return drawInsp(); }
    if (slot || (sel !== "trigger" && !a.steps[sel])) { box.innerHTML = `<div class="insp-h">${icon("plus", 14)}<b>Add a step</b></div><p class="muted" style="font-size:12.5px">Pick a step on the left to add it to the ${slot === "yes" ? "Yes" : slot === "no" ? "No" : ""} branch.</p>`; return; }
    const [, label, ic] = STEP_TYPES.find((x) => x[0] === s.type) || [s.type, s.type, "dot"];
    let form = "";
    if (s.type === "send") {
      const t = tpls?.find((x) => x.id === s.template_id);
      form = field("Template", `<select class="input" data-s="template_id"><option value="">Choose a template</option>${opt((tpls || []).map((x) => [x.id, `${x.name}${x.status === "published" ? ` · v${x.published_version}` : " · draft"}`]), s.template_id)}</select>`, t && t.status !== "published" ? `<span style="color:var(--orange)">Publish this template before going live.</span> <a href="/templates/${t.id}">Open template</a>` : `Variables like {{{first_name}}} and {{{data.plan}}} are filled from the contact and the event.`)
        + field("From <span class='dim'>Optional</span>", `<input class="input" data-s="from" value="${esc(s.from || "")}" placeholder="${esc(t?.from || `Kora <hello@${doms?.[0]?.name || "yourdomain.com"}>`)}">`, "Leave empty to use the template’s sender.")
        + field("Subject <span class='dim'>Optional</span>", `<input class="input" data-s="subject" value="${esc(s.subject || "")}" placeholder="${esc(t?.subject || "Uses the template subject")}">`)
        + field("Reply-to <span class='dim'>Optional</span>", `<input class="input" data-s="reply_to" value="${esc(s.reply_to || "")}" placeholder="support@yourdomain.com">`)
        + `<label class="row-flex" style="gap:8px;font-size:12.5px;margin-top:4px"><input type="checkbox" class="cb" data-s="marketing" ${s.marketing ? "checked" : ""}> Marketing email: skip contacts who unsubscribed</label>`;
    } else if (s.type === "wait") {
      form = field("Wait for", `<div class="row-3"><input class="input" type="number" min="1" data-s="amount" value="${esc(s.amount || 1)}"><select class="input" data-s="unit">${opt([["minutes", "minutes"], ["hours", "hours"], ["days", "days"], ["weeks", "weeks"]], s.unit || "days")}</select></div>`);
    } else if (s.type === "condition") {
      const sends = Object.values(a.steps).filter((x) => x.type === "send");
      form = field("If contact", `<select class="input" data-s="kind">${opt([["opened", "Opened an email"], ["clicked", "Clicked an email"], ["property", "Contact property"], ["data", "Event data"]], s.kind)}</select>`)
        + (s.kind === "opened" || s.kind === "clicked" ? field("Email", `<select class="input" data-s="ref"><option value="">The most recent email</option>${opt(sends.map((x) => [x.id, tpls?.find((t) => t.id === x.template_id)?.name || "Send email step"]), s.ref)}</select>`) + field("Within", `<div class="row-3"><input class="input" type="number" min="1" data-s="within" value="${esc(s.within || 2)}"><select class="input" data-s="within_unit">${opt([["hours", "hours"], ["days", "days"]], s.within_unit || "days")}</select></div>`, "The run waits up to this long for an open or click, then takes the No branch.")
          : field(s.kind === "data" ? "Event field" : "Property", `<div class="row-3"><input class="input mono" data-s="field" value="${esc(s.field || "")}" placeholder="${s.kind === "data" ? "data.plan" : "plan"}"><select class="input" data-s="op">${opt([["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["exists", "exists"], ["gt", ">"], ["lt", "<"]], s.op || "eq")}</select><input class="input" data-s="value" value="${esc(s.value ?? "")}"></div>`));
    } else if (s.type === "update_contact") {
      form = field("Field", `<input class="input mono" data-s="field" value="${esc(s.field || "")}" placeholder="plan, first_name or unsubscribed">`) + field("Value", `<input class="input" data-s="value" value="${esc(s.value ?? "")}" placeholder="pro or {{{data.plan}}}">`);
    } else if (s.type === "add_segment") {
      form = field("Segment", `<select class="input" data-s="segment_id"><option value="">Choose a segment</option>${opt((segs || []).map((x) => [x.id, x.name]), s.segment_id)}</select>`);
    } else if (s.type === "webhook") {
      form = field("URL", `<input class="input mono" data-s="url" value="${esc(s.url || "")}" placeholder="https://api.yourapp.com/hooks/delivrie">`, "We POST the contact email, event data and run id as JSON. A non-2xx response fails the run so you can retry it.");
    } else if (s.type === "end") form = `<p class="muted" style="font-size:12.5px">The run completes here.</p>`;
    box.innerHTML = `<div class="insp-h">${icon(ic, 14)}<b>${label}</b><span class="grow"></span><button class="ibtn" data-del title="Delete step">${icon("trash", 13)}</button></div>${form}`;
    box.querySelectorAll("[data-s]").forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
      const k = el.dataset.s; s[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value.trim() || undefined;
      saved.textContent = "Editing…"; persist(); drawCanvas(); if (k === "kind" || k === "template_id") drawInsp();
    }));
    box.querySelector("[data-del]").onclick = () => removeStep(s.id);
  }
  drawCanvas(); drawInsp();

  on(root, "click", "[data-node]", (_e, b) => { sel = b.dataset.node; drawCanvas(); drawInsp(); });
  on(root, "click", "[data-slot]", (_e, b) => { sel = b.dataset.slot.includes(":") ? b.dataset.slot : b.dataset.slot; drawCanvas(); drawInsp(); });
  on(root, "click", "[data-add]", (_e, b) => insertAt(b.dataset.add));
  $("[data-name]").addEventListener("input", (e) => { e.target.size = Math.max(10, e.target.value.length); a.name = e.target.value || "Untitled automation"; saved.textContent = "Editing…"; persist(); });
  const flushNow = async () => { await sb.from("automations").update({ name: a.name, trigger: a.trigger, steps: a.steps, start_step: a.start_step, reentry: a.reentry, updated_at: new Date().toISOString() }).eq("id", a.id); };
  on(root, "click", "[data-test]", () => formModal({ title: "Send a test run", desc: "Runs the steps for one address now, with real emails. Waits are real too, so the run picks up again when they end. Test runs show in Runs with a Test badge and don’t count toward “once per contact”.", fields: [{ name: "email", label: "Email", placeholder: state.user?.email || "you@example.com", value: state.user?.email || "", type: "email" }, { name: "data", label: "Event data (JSON)", type: "textarea", placeholder: '{ "country": "NG" }' }], submit: "Start test run", validate: (v) => EMAIL_RE.test(v.email),
    async onSubmit(v) { let data = {}; if (v.data?.trim()) { try { data = JSON.parse(v.data); } catch { throw new Error("Event data must be valid JSON"); } } await flushNow(); const r = await api("POST", `/automations/automations/${a.id}/test`, { email: v.email, data }); toast("Test run started"); if (r.run_id) ctx.navigate(`/automations/${a.id}/runs?run=${r.run_id}`); } }));
  on(root, "click", "[data-publish]", async () => {
    await flushNow();
    const t = a.trigger;
    modal({ title: `Publish “${esc(a.name)}”?`, body: `<p class="desc">${t.type === "event" ? `New <span class="mono">${esc(t.event || "event")}</span> events will start runs right away.` : t.type === "segment" ? "Contacts added to the segment will start runs right away." : `Runs start ${t.every === "week" ? "weekly" : "daily"} at ${esc(t.at || "09:00")} UTC.`} You can pause at any time.</p>
      ${t.type !== "schedule" ? `<label class="row-flex" style="gap:8px;font-size:13px"><input type="checkbox" class="cb" data-enroll> ${t.type === "event" ? "Also enroll contacts who sent this event in the last 7 days" : "Also enroll contacts already in the segment"}</label>` : ""}`,
      foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Publish</button>`,
      onMount(m, close) { m.querySelector("[data-go]").onclick = async (e) => { e.target.disabled = true; try { const r = await api("POST", `/automations/automations/${a.id}/publish`, { enroll_recent: !!m.querySelector("[data-enroll]")?.checked }); close(); toast(`${a.name} is live${r.enrolled ? ` · ${num(r.enrolled)} enrolled` : ""}`); ctx.navigate(`/automations/${a.id}`, { replace: true }); } catch (er) { errToast(er); e.target.disabled = false; } }; } });
  });
  on(root, "click", "[data-pause]", async () => { try { await api("POST", `/automations/automations/${a.id}/pause`); toast("Paused. Runs in progress wait until you resume."); ctx.navigate(`/automations/${a.id}`, { replace: true }); } catch (e) { errToast(e); } });
  on(root, "click", "[data-resume]", async () => { try { await flushNow(); await api("POST", `/automations/automations/${a.id}/resume`); toast("Resumed"); ctx.navigate(`/automations/${a.id}`, { replace: true }); } catch (e) { errToast(e); } });
}

// ---------------------------------------------------------------- runs
export async function runs(ctx) {
  const T = state.team.id, root = ctx.root;
  const { data: a, error } = await sb.from("automations").select("*").eq("id", ctx.params.id).maybeSingle();
  if (error) throw error;
  if (!a) return ctx.navigate("/automations", { replace: true });
  ctx.crumb("zap", "Automations");
  let rows = [], st = "all", q = "";
  root.innerHTML = `<div class="auto">${header(a, "runs")}<div class="page wide" style="padding-top:22px"><div class="stat-grid" data-stats style="grid-template-columns:repeat(4,1fr)"></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search by email"></div><select class="input" data-st style="width:150px">${[["all", "All statuses"], ["running", "Running"], ["completed", "Completed"], ["failed", "Failed"], ["canceled", "Canceled"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div><div data-list></div></div></div>`;
  const $ = (s) => root.querySelector(s);
  const load = async () => { const { data } = await sb.from("automation_runs").select("*").eq("automation_id", a.id).order("started_at", { ascending: false }).limit(1000); rows = data || []; draw(); };
  const dur = (r) => { if (!r.finished_at) return "—"; const s = (new Date(r.finished_at) - new Date(r.started_at)) / 1000; return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.round((s % 86400) / 3600)}h`; };
  const stepName = (r) => { if (r.status === "completed") return "Completed"; const last = r.log?.[r.log.length - 1]; return last?.title || "—"; };
  function draw() {
    const real = rows.filter((r) => !r.test);
    const c = (s) => real.filter((r) => r.status === s).length;
    $("[data-stats]").innerHTML = [["Started", real.length], ["Completed", c("completed")], ["In progress", c("running")], ["Failed", c("failed")]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${num(v)}</div></div>`).join("");
    const list = rows.filter((r) => (st === "all" || r.status === st) && (!q || r.email.includes(q)));
    $("[data-list]").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Contact</th><th>Started</th><th>Current step</th><th>Status</th><th class="r">Duration</th></tr></thead><tbody>${list.map((r) => `<tr class="clickable" data-run="${r.id}"><td><span class="mono" style="font-size:12.5px">${esc(r.email)}</span>${r.test ? ` ${badge("Test", "gray")}` : ""}</td><td class="muted" title="${esc(fmtDateTime(r.started_at))}">${ago(r.started_at)}</td><td>${esc(stepName(r))}</td><td>${badge(...RUN[r.status])}</td><td class="r muted">${dur(r)}</td></tr>`).join("")}</tbody></table></div><p class="dim" style="font-size:12px;margin-top:10px">${num(list.length)} run${list.length === 1 ? "" : "s"}</p>`
      : `<div class="card">${emptyState({ icon: "zap", title: rows.length ? "No runs match" : "No runs yet", desc: rows.length ? "Try another filter." : a.status === "live" ? "Runs appear here when the trigger fires." : "Publish the automation, or send a test run from the editor." })}</div>`;
  }
  const openRun = (id) => {
    const r = rows.find((x) => x.id === id); if (!r) return;
    const failed = r.status === "failed";
    modal({ title: `Run · ${esc(r.email)}`, size: "lg", body: `<p class="dim" style="font-size:12.5px;margin:-6px 0 12px" class="mono">${esc(r.id.slice(0, 8))} · ${r.status === "completed" ? `Completed in ${dur(r)}` : RUN[r.status][0]}${r.test ? " · Test run" : ""}</p>
      ${failed ? `<div class="banner warn" style="flex-direction:column;align-items:flex-start;gap:4px"><b style="font-weight:500">Step failed</b><span>${esc(r.error || "")}</span></div>` : ""}
      <div class="kv" style="margin-bottom:14px"><span class="k">Started</span><span>${esc(fmtDateTime(r.started_at))}</span><span class="k">Trigger</span><span class="mono">${esc(r.trigger || "")}</span>${Object.keys(r.data || {}).length ? `<span class="k">Data</span><span class="mono" style="font-size:12px">${esc(JSON.stringify(r.data))}</span>` : ""}</div>
      <ol class="timeline">${(r.log || []).map((l) => `<li class="${l.status}"><span class="dot"></span><div><b>${esc(l.title || l.type)}</b>${l.status === "waiting" ? `<span class="dim"> · until ${esc(fmtDateTime(l.until))}</span>` : ""}${l.status === "checking" ? `<span class="dim"> · checking until ${esc(fmtDateTime(l.until))}</span>` : ""}${l.error ? `<div style="color:var(--red);font-size:12px">${esc(l.code ? l.code + " · " : "")}${esc(l.error)}</div>` : ""}${l.email_id ? ` <a href="/emails/${l.email_id}" class="dim" style="font-size:12px">View email</a>` : ""}</div><span class="dim" style="font-size:12px">${esc(new Date(l.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span></li>`).join("")}</ol>`,
      foot: failed ? `<button class="btn btn-ghost" data-cancel>Close</button><button class="btn btn-secondary" data-skip>Skip step</button><button class="btn btn-primary" data-retry>Retry step</button>` : r.status === "running" ? `<button class="btn btn-ghost" data-cancel>Close</button><button class="btn btn-secondary" data-stop style="color:var(--red)">Cancel run</button>` : `<button class="btn btn-ghost" data-cancel>Close</button>`,
      onMount(m, close) {
        const act = async (path, msg) => { try { const res = await api("POST", `/automations/runs/${r.id}/${path}`); close(); toast(res.status === "failed" ? `Still failing: ${res.error}` : msg, res.status === "failed" ? "err" : "ok"); await load(); } catch (e) { errToast(e); } };
        m.querySelector("[data-retry]")?.addEventListener("click", () => act("retry", `Retried. Email to ${r.email} queued`));
        m.querySelector("[data-skip]")?.addEventListener("click", () => act("skip", "Step skipped"));
        m.querySelector("[data-stop]")?.addEventListener("click", () => act("cancel", "Run canceled"));
      } });
  };
  $("[data-q]").addEventListener("input", debounce(() => { q = $("[data-q]").value.trim().toLowerCase(); draw(); }, 150));
  $("[data-st]").addEventListener("change", (e) => { st = e.target.value; draw(); });
  on(root, "click", "[data-run]", (_e, tr) => openRun(tr.dataset.run));
  on(root, "click", "[data-pause]", async () => { try { await api("POST", `/automations/automations/${a.id}/pause`); toast("Paused"); ctx.navigate(`/automations/${a.id}/runs`, { replace: true }); } catch (e) { errToast(e); } });
  on(root, "click", "[data-resume]", async () => { try { await api("POST", `/automations/automations/${a.id}/resume`); toast("Resumed"); ctx.navigate(`/automations/${a.id}/runs`, { replace: true }); } catch (e) { errToast(e); } });
  root.querySelector("[data-name]").addEventListener("change", async (e) => { await sb.from("automations").update({ name: e.target.value || a.name }).eq("id", a.id); });
  await load();
  if (ctx.query.run) openRun(ctx.query.run);
}

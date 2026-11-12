// Events (Figma 11.4): custom events your app sends, their payload shape, recent deliveries and code to send one.
import { sb, state, api } from "../lib/sb.js";
import { esc, icon, ago, fmtDateTime, num, toast, errToast, modal, emptyState, on, debounce, codeBlock, EMAIL_RE } from "../lib/ui.js";

const snippet = (name, fields = []) => {
  const data = {};
  for (const f of fields.filter((x) => x.name.startsWith("data.")).slice(0, 6)) { const k = f.name.slice(5).split(".")[0]; if (!(k in data)) data[k] = f.type === "number" ? Number(f.example) || 1 : f.type === "boolean" ? f.example === "true" : f.example || "value"; }
  return `await fetch('https://delivrie.io/api/events', {\n  method: 'POST',\n  headers: {\n    Authorization: \`Bearer \${process.env.DELIVRIE_API_KEY}\`,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify({\n    event: '${name}',\n    email: 'ada@example.com',\n    data: ${JSON.stringify(Object.keys(data).length ? data : { plan: "free" }, null, 2).replace(/\n/g, "\n    ")},\n  }),\n});`;
};

export async function list(ctx) {
  ctx.crumb("bolt", "Events");
  const T = state.team.id, root = ctx.root;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: defs, error }, { data: recent }, { data: autos }] = await Promise.all([
    sb.from("event_definitions").select("*").eq("team_id", T).order("last_seen_at", { ascending: false, nullsFirst: false }),
    sb.from("events").select("name").eq("team_id", T).gte("created_at", since).limit(20000),
    sb.from("automations").select("id,name,trigger").eq("team_id", T),
  ]);
  if (error) throw error;
  const count = {}; (recent || []).forEach((e) => count[e.name] = (count[e.name] || 0) + 1);
  const usedBy = (n) => (autos || []).filter((a) => a.trigger?.type === "event" && a.trigger.event === n);
  let q = "";
  root.innerHTML = `<div class="page wide"><div class="page-head"><div><h1>Events</h1><p class="muted" style="margin-top:4px">Custom events you send from your app. Use them to trigger automations.</p></div><div class="actions"><button class="btn btn-primary" data-create>${icon("plus", 12)} Create event</button></div></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search events"></div><span class="grow"></span><span class="dim" style="font-size:12.5px">Last 7 days</span></div><div data-list></div></div>`;
  const draw = () => {
    const rows = (defs || []).filter((d) => !q || d.name.includes(q));
    root.querySelector("[data-list]").innerHTML = (defs || []).length ? (rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Event</th><th class="r">Received · 7d</th><th>Used by</th><th class="r">Last received</th></tr></thead><tbody>${rows.map((d) => `<tr class="clickable" data-ev="${esc(d.name)}"><td><span class="mono" style="font-size:12.5px">${esc(d.name)}</span>${d.description ? `<div class="dim" style="font-size:12px">${esc(d.description)}</div>` : ""}</td><td class="r">${num(count[d.name] || 0)}</td><td>${usedBy(d.name).map((a) => esc(a.name)).join(", ") || `<span class="dim">—</span>`}</td><td class="r muted">${d.last_seen_at ? ago(d.last_seen_at) : "Never"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card">${emptyState({ icon: "search", title: "No events match" })}</div>`)
      : `<div class="card">${emptyState({ icon: "bolt", title: "No events yet", desc: "Events are created automatically the first time your app sends one. Define one here to build automations before your code ships." })}<div style="padding:0 20px 20px">${codeBlock(snippet("user.created"), { lang: "js" })}</div></div>`;
  };
  draw();
  root.querySelector("[data-q]").addEventListener("input", debounce((e) => { q = root.querySelector("[data-q]").value.trim().toLowerCase(); draw(); }, 120));
  on(root, "click", "[data-ev]", (_e, tr) => ctx.navigate(`/events/${encodeURIComponent(tr.dataset.ev)}`));
  on(root, "click", "[data-create]", () => createModal(ctx));
}

function createModal(ctx) {
  let fields = [{ name: "data.", type: "string" }];
  return modal({ title: "Create event", size: "lg", body: `<p class="desc">Events are created automatically the first time you send them. Define one here to build automations before your code ships.</p>
      <div class="field"><label>Event name</label><input class="input mono" data-name placeholder="subscription.renewed"><div class="hint">Lowercase, dots for namespaces. Cannot be changed later.</div></div>
      <div class="field"><label>Description <span class="dim">Optional</span></label><input class="input" data-desc placeholder="Fires when a paid plan renews successfully."></div>
      <div class="field"><label>Fields</label><div data-fields></div><button class="btn btn-ghost btn-sm" data-addf>${icon("plus", 12)} Add field</button></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Create event</button>`,
    onMount(m, close) {
      const drawF = () => { m.querySelector("[data-fields]").innerHTML = fields.map((f, i) => `<div class="row-flex" style="gap:6px;margin-bottom:6px"><input class="input mono" data-fn="${i}" value="${esc(f.name)}" placeholder="data.amount"><select class="input" data-ft="${i}" style="width:120px">${["string", "number", "boolean", "date"].map((t) => `<option ${t === f.type ? "selected" : ""}>${t}</option>`).join("")}</select><button class="ibtn" data-rm="${i}">${icon("x", 12)}</button></div>`).join(""); };
      drawF();
      on(m, "input", "[data-fn]", (_e, el) => { fields[el.dataset.fn].name = el.value.trim(); });
      on(m, "change", "[data-ft]", (_e, el) => { fields[el.dataset.ft].type = el.value; });
      on(m, "click", "[data-rm]", (_e, b) => { fields.splice(Number(b.dataset.rm), 1); drawF(); });
      m.querySelector("[data-addf]").onclick = () => { fields.push({ name: "data.", type: "string" }); drawF(); };
      m.querySelector("[data-go]").onclick = async (e) => {
        const name = m.querySelector("[data-name]").value.trim();
        if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(name)) return toast("Use lowercase letters, numbers, dots, dashes or underscores", "err");
        e.target.disabled = true;
        const { error } = await sb.from("event_definitions").insert({ team_id: state.team.id, name, description: m.querySelector("[data-desc]").value.trim() || null, fields: fields.filter((f) => f.name && f.name !== "data.").map((f) => ({ name: f.name.startsWith("data.") || f.name === "email" ? f.name : `data.${f.name}`, type: f.type, example: "" })) });
        if (error) { e.target.disabled = false; return errToast(/duplicate/.test(error.message) ? new Error("That event already exists") : error); }
        close(); toast(`Event ${name} created`); ctx.navigate(`/events/${encodeURIComponent(name)}`);
      };
    } });
}

export async function detail(ctx) {
  const T = state.team.id, root = ctx.root, name = decodeURIComponent(ctx.params.name);
  ctx.crumb("bolt", "Events");
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: def }, { data: recent }, { data: week }, { data: autos }] = await Promise.all([
    sb.from("event_definitions").select("*").eq("team_id", T).eq("name", name).maybeSingle(),
    sb.from("events").select("id,email,data,created_at").eq("team_id", T).eq("name", name).order("created_at", { ascending: false }).limit(20),
    sb.from("events").select("email").eq("team_id", T).eq("name", name).gte("created_at", since).limit(20000),
    sb.from("automations").select("id,name,status,trigger").eq("team_id", T),
  ]);
  if (!def) { toast("Event not found", "err"); return ctx.navigate("/events", { replace: true }); }
  const used = (autos || []).filter((a) => a.trigger?.type === "event" && a.trigger.event === name);
  const fields = [{ name: "email", type: "string", example: recent?.[0]?.email || "ada@example.com" }, ...(def.fields || [])];
  root.innerHTML = `<div class="page wide"><div class="page-head"><a class="ibtn" href="/events">${icon("arrow-left", 15)}</a><div><h1 class="mono" style="font-size:19px">${esc(name)}</h1>${def.description ? `<p class="muted" style="margin-top:2px">${esc(def.description)}</p>` : ""}</div><div class="actions"><button class="btn btn-secondary" data-test>${icon("send", 12)} Send test event</button><button class="btn btn-primary" data-auto>${icon("zap", 12)} Create automation</button></div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><div class="k">Received · 7d</div><div class="v">${num((week || []).length)}</div></div><div class="stat"><div class="k">Contacts</div><div class="v">${num(new Set((week || []).map((e) => e.email)).size)}</div></div><div class="stat"><div class="k">Used by</div><div class="v" style="font-size:15px">${used.map((a) => `<a href="/automations/${a.id}">${esc(a.name)}</a>`).join(", ") || "—"}</div></div><div class="stat"><div class="k">First seen</div><div class="v" style="font-size:15px">${def.first_seen_at ? esc(new Date(def.first_seen_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })) : "Not yet"}</div></div></div>
    <div class="ev-grid"><div><h3 class="section-title" style="margin-top:0">Payload fields</h3><div class="table-wrap"><table class="t"><thead><tr><th>Field</th><th>Type</th><th>Example</th></tr></thead><tbody>${fields.map((f) => `<tr><td class="mono" style="font-size:12.5px">${esc(f.name)}</td><td class="muted">${esc(f.type)}</td><td class="muted mono" style="font-size:12px">${esc(f.example || "")}</td></tr>`).join("")}</tbody></table></div>
      <h3 class="section-title">Recent</h3>${recent?.length ? `<div class="table-wrap"><table class="t"><tbody>${recent.map((e) => `<tr><td class="mono" style="font-size:12.5px">${esc(e.email || "")}</td><td class="muted mono ellipsis" style="font-size:12px;max-width:320px">${esc(JSON.stringify(e.data))}</td><td class="r muted" title="${esc(fmtDateTime(e.created_at))}">${ago(e.created_at)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card">${emptyState({ icon: "bolt", title: "Not received yet", desc: "Send it from your app with the code on the right." })}</div>`}</div>
      <div><h3 class="section-title" style="margin-top:0">Send this event</h3>${codeBlock(snippet(name, def.fields), { lang: "js" })}<p class="dim" style="font-size:12px;margin-top:8px">Any API key works. The contact is created if it doesn’t exist yet.</p></div></div></div>`;
  on(root, "click", "[data-auto]", async () => {
    const { data, error } = await sb.from("automations").insert({ team_id: T, name: `When ${name}`, trigger: { type: "event", event: name }, steps: {}, created_by: state.user.id }).select("id").single();
    if (error) return errToast(error); ctx.navigate(`/automations/${data.id}`);
  });
  on(root, "click", "[data-test]", () => modal({ title: "Send test event", body: `<div class="field"><label>Email</label><input class="input" data-email value="${esc(state.user?.email || "")}"></div><div class="field"><label>Data (JSON)</label><textarea class="textarea mono" data-json rows="5" style="font-size:12.5px">${esc(JSON.stringify(recent?.[0]?.data || {}, null, 2))}</textarea></div><p class="hint">This is a real event: live automations listening for it will start a run.</p>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go>Send event</button>`,
    onMount(m, close) { m.querySelector("[data-go]").onclick = async (e) => { const email = m.querySelector("[data-email]").value.trim(); let data; try { data = JSON.parse(m.querySelector("[data-json]").value || "{}"); } catch { return toast("Data must be valid JSON", "err"); } if (!EMAIL_RE.test(email)) return toast("Enter a valid email", "err"); e.target.disabled = true; try { const r = await api("POST", "/automations/events", { event: name, email, data }); close(); toast(`Event sent${r.runs ? ` · started ${r.runs} run${r.runs === 1 ? "" : "s"}` : ""}`); ctx.navigate(`/events/${encodeURIComponent(name)}`, { replace: true }); } catch (er) { errToast(er); e.target.disabled = false; } }; } }));
}

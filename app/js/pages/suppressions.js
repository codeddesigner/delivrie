// Suppressions & bulk actions (Figma 2.5): filter by reason, add addresses, select rows to export or remove.
import { sb, state } from "../lib/sb.js";
import { esc, icon, ago, fmtDate, num, toast, errToast, modal, confirmModal, emptyState, badge, on, debounce, csv, download, EMAIL_RE } from "../lib/ui.js";

const REASONS = { bounce: ["Hard bounce", "orange"], complaint: ["Complaint", "red"], manual: ["Manual", "gray"], unsubscribe: ["Unsubscribed", "blue"] };
const SOURCE = { bounce: "Automatic", complaint: "Automatic", manual: "Added by hand", unsubscribe: "Preference page" };
const TABS = [["all", "All"], ["bounce", "Hard bounces"], ["complaint", "Complaints"], ["manual", "Manual"], ["unsubscribe", "Unsubscribed"]];
const SINCE = [["all", "All time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];

export default async function suppressions(ctx) {
  ctx.crumb("shield", "Suppressions");
  const T = state.team.id, admin = state.role === "admin";
  const root = ctx.root;
  let rows = [], tab = ctx.query.reason || "all", since = "all", q = "", sel = new Set();
  root.innerHTML = `<div class="page wide"><div class="page-head"><div><h1>Suppressions</h1><p class="muted" style="margin-top:4px">Addresses Delivrie will not send to. Bounces and complaints are added automatically to protect your reputation.</p></div>
      <div class="actions"><button class="btn btn-secondary" data-export>${icon("download", 13)} Export</button>${admin ? `<button class="btn btn-primary" data-add>${icon("plus", 12)} Add addresses</button>` : ""}</div></div>
    <div class="seg-tabs" data-tabs></div>
    <div class="filters"><div class="input-wrap search"><span class="lead">${icon("search", 13)}</span><input class="input" data-q placeholder="Search email addresses"></div><span class="grow"></span>
      <select class="input" data-since style="width:150px">${SINCE.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
    <div data-bulk></div><div data-list></div></div>`;
  const $ = (s) => root.querySelector(s);

  const filtered = () => {
    const cutoff = since === "all" ? 0 : Date.now() - Number(since) * 864e5;
    return rows.filter((r) => (tab === "all" || r.reason === tab) && (!q || r.email.includes(q)) && new Date(r.created_at).getTime() >= cutoff);
  };
  const draw = () => {
    const counts = rows.reduce((m, r) => (m[r.reason] = (m[r.reason] || 0) + 1, m), {});
    $("[data-tabs]").innerHTML = TABS.map(([k, l]) => `<button class="seg-tab ${k === tab ? "on" : ""}" data-tab="${k}">${l} · ${num(k === "all" ? rows.length : counts[k] || 0)}</button>`).join("");
    const list = filtered();
    for (const e of [...sel]) if (!list.some((r) => r.email === e)) sel.delete(e);
    $("[data-bulk]").innerHTML = sel.size ? `<div class="bulk-bar"><b>${num(sel.size)} selected</b><span class="grow"></span><button class="btn btn-ghost btn-sm" data-bulk-export>${icon("download", 12)} Export</button>${admin ? `<button class="btn btn-ghost btn-sm" data-bulk-rm style="color:var(--red)">${icon("trash", 12)} Remove from list</button>` : ""}<button class="ibtn" data-clear title="Clear selection">${icon("x", 13)}</button></div>` : "";
    const all = list.length && list.every((r) => sel.has(r.email));
    $("[data-list]").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th style="width:34px"><input type="checkbox" class="cb" data-all ${all ? "checked" : ""} aria-label="Select all"></th><th>Email</th><th>Reason</th><th>Source</th><th class="r">Added</th></tr></thead><tbody>${list.slice(0, 500).map((r) => `<tr class="${sel.has(r.email) ? "sel" : ""}"><td><input type="checkbox" class="cb" data-sel="${esc(r.email)}" ${sel.has(r.email) ? "checked" : ""} aria-label="Select ${esc(r.email)}"></td><td class="mono" style="font-size:12.5px">${esc(r.email)}</td><td>${badge(...(REASONS[r.reason] || [r.reason, "gray"]))}</td><td class="muted">${SOURCE[r.reason] || "—"}</td><td class="r muted" title="${esc(new Date(r.created_at).toLocaleString())}">${fmtDate(r.created_at)}</td></tr>`).join("")}</tbody></table></div>
      <p class="dim" style="font-size:12px;margin-top:10px">${num(list.length)} suppressed address${list.length === 1 ? "" : "es"}${list.length > 500 ? " · showing the first 500, search to narrow" : ""}</p>`
      : `<div class="card">${emptyState({ icon: "shield", title: rows.length ? "No matches" : "No suppressed addresses", desc: rows.length ? "Try another reason or time range." : "Bounces and complaints will appear here automatically." })}</div>`;
  };
  const load = async () => {
    const { data, error } = await sb.from("suppressions").select("email,reason,created_at").eq("team_id", T).order("created_at", { ascending: false }).limit(10000);
    if (error) throw error; rows = data || []; draw();
  };
  const exportRows = (list) => download(`suppressions-${new Date().toISOString().slice(0, 10)}.csv`, csv([["email", "reason", "source", "created_at"], ...list.map((r) => [r.email, r.reason, SOURCE[r.reason] || "", r.created_at])]));

  on(root, "click", "[data-tab]", (_e, b) => { tab = b.dataset.tab; draw(); });
  $("[data-q]").addEventListener("input", debounce(() => { q = $("[data-q]").value.trim().toLowerCase(); draw(); }, 120));
  $("[data-since]").addEventListener("change", (e) => { since = e.target.value; draw(); });
  on(root, "change", "[data-sel]", (_e, c) => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); draw(); });
  on(root, "change", "[data-all]", (_e, c) => { filtered().slice(0, 500).forEach((r) => c.checked ? sel.add(r.email) : sel.delete(r.email)); draw(); });
  on(root, "click", "[data-clear]", () => { sel.clear(); draw(); });
  on(root, "click", "[data-export]", () => exportRows(filtered()));
  on(root, "click", "[data-bulk-export]", () => exportRows(rows.filter((r) => sel.has(r.email))));
  on(root, "click", "[data-bulk-rm]", async () => {
    const n = sel.size;
    if (!(await confirmModal({ title: `Remove ${num(n)} address${n === 1 ? "" : "es"}`, desc: "They will be able to receive email again. Addresses that bounced before will probably bounce again and hurt your reputation.", confirm: "Remove from list" }))) return;
    const { error } = await sb.from("suppressions").delete().eq("team_id", T).in("email", [...sel]);
    if (error) return errToast(error);
    rows = rows.filter((r) => !sel.has(r.email)); sel.clear(); draw();
    toast(`${num(n)} address${n === 1 ? "" : "es"} removed. They can receive email again.`);
  });
  on(root, "click", "[data-add]", () => modal({ title: "Add to suppression list", body: `<p class="desc">Delivrie will skip these addresses for every send, including broadcasts and automations.</p>
      <div class="field"><label>Email addresses</label><textarea class="textarea mono" data-emails rows="5" placeholder="ada@kora.ng\nold-staff@kora.ng" style="font-size:12.5px"></textarea><div class="hint" data-count>One per line or separated by commas. Up to 1,000 at a time.</div></div>
      <div class="field"><label>Reason</label><select class="input" data-reason><option value="manual">Manual</option><option value="bounce">Hard bounce</option><option value="complaint">Complaint</option><option value="unsubscribe">Unsubscribed</option></select></div>`,
    foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-go disabled>Add addresses</button>`,
    onMount(m, close) {
      const ta = m.querySelector("[data-emails]"), go = m.querySelector("[data-go]");
      const parse = () => [...new Set(ta.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
      ta.addEventListener("input", () => { const all = parse(), ok = all.filter((e) => EMAIL_RE.test(e)); go.disabled = !ok.length || ok.length > 1000; go.textContent = ok.length ? `Add ${num(ok.length)} address${ok.length === 1 ? "" : "es"}` : "Add addresses"; m.querySelector("[data-count]").textContent = all.length - ok.length ? `${all.length - ok.length} invalid address${all.length - ok.length === 1 ? "" : "es"} will be skipped.` : "One per line or separated by commas. Up to 1,000 at a time."; });
      go.addEventListener("click", async () => {
        const ok = parse().filter((e) => EMAIL_RE.test(e)), reason = m.querySelector("[data-reason]").value;
        go.disabled = true; go.innerHTML = `<span class="spinner"></span>`;
        const { error } = await sb.from("suppressions").upsert(ok.map((email) => ({ team_id: T, email, reason })), { onConflict: "team_id,email", ignoreDuplicates: true });
        if (error) { errToast(error); go.disabled = false; go.textContent = "Add addresses"; return; }
        close(); toast(`${num(ok.length)} address${ok.length === 1 ? "" : "es"} suppressed`); load().catch(errToast);
      });
    } }));
  await load();
}

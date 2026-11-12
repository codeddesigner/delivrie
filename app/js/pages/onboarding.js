import { api, state, sb, API_BASE } from "../lib/sb.js";
import { esc, icon, toast, errToast, codeBlock, copyText, menu } from "../lib/ui.js";

export function snippets({ key, from, to, base }) {
  const subject = "Hello World", html = "<p>Congrats on sending your <strong>first email</strong>!</p>";
  return {
    "Node.js": [`const res = await fetch('${base}/emails', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ${key}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: '${from}',
    to: '${to}',
    subject: '${subject}',
    html: '${html}',
  }),
});`, "js"],
    PHP: [`<?php
$ch = curl_init('${base}/emails');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Authorization: Bearer ${key}', 'Content-Type: application/json'],
  CURLOPT_POSTFIELDS => json_encode([
    'from' => '${from}',
    'to' => '${to}',
    'subject' => '${subject}',
    'html' => '${html}',
  ]),
]);
echo curl_exec($ch);`, "js"],
    Python: [`import requests

requests.post(
    "${base}/emails",
    headers={"Authorization": "Bearer ${key}"},
    json={
        "from": "${from}",
        "to": "${to}",
        "subject": "${subject}",
        "html": "${html}",
    },
)`, "js"],
    Ruby: [`require "net/http"
require "json"

uri = URI("${base}/emails")
req = Net::HTTP::Post.new(uri, "Authorization" => "Bearer ${key}", "Content-Type" => "application/json")
req.body = { from: "${from}", to: "${to}", subject: "${subject}", html: "${html}" }.to_json
Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| puts http.request(req).body }`, "js"],
    Go: [`body, _ := json.Marshal(map[string]string{
  "from": "${from}", "to": "${to}",
  "subject": "${subject}", "html": "${html}",
})
req, _ := http.NewRequest("POST", "${base}/emails", bytes.NewReader(body))
req.Header.Set("Authorization", "Bearer ${key}")
req.Header.Set("Content-Type", "application/json")
res, err := http.DefaultClient.Do(req)`, "js"],
    Rust: [`let res = reqwest::Client::new()
    .post("${base}/emails")
    .bearer_auth("${key}")
    .json(&serde_json::json!({
        "from": "${from}", "to": "${to}",
        "subject": "${subject}", "html": "${html}"
    }))
    .send().await?;`, "js"],
    Elixir: [`Req.post!("${base}/emails",
  auth: {:bearer, "${key}"},
  json: %{from: "${from}", to: "${to}", subject: "${subject}", html: "${html}"}
)`, "js"],
    Java: [`HttpRequest req = HttpRequest.newBuilder(URI.create("${base}/emails"))
  .header("Authorization", "Bearer ${key}")
  .header("Content-Type", "application/json")
  .POST(HttpRequest.BodyPublishers.ofString("""
    {"from":"${from}","to":"${to}","subject":"${subject}","html":"${html.replace(/"/g, '\\"')}"}"""))
  .build();
HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());`, "js"],
    ".NET": [`using var http = new HttpClient();
http.DefaultRequestHeaders.Authorization = new("Bearer", "${key}");
var res = await http.PostAsJsonAsync("${base}/emails", new {
    from = "${from}", to = "${to}",
    subject = "${subject}", html = "${html}"
});`, "js"],
    cURL: [`curl -X POST '${base}/emails' \\
  -H 'Authorization: Bearer ${key}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "from": "${from}",
    "to": "${to}",
    "subject": "${subject}",
    "html": "${html}"
  }'`, "js"],
  };
}

export default async function onboarding(ctx) {
  ctx.crumb("terminal", "Get started");
  const root = ctx.root;
  root.innerHTML = `<div class="page narrow"><div class="page-head" style="flex-direction:column;align-items:flex-start;gap:4px"><h1 style="font-size:24px">Send your first email</h1><p class="muted">Two steps: create an API key, then call the API from your stack.</p></div><div class="steps" data-steps><div class="skeleton" style="height:120px"></div></div><div data-explore></div></div>`;
  let status = {};
  try { status = await api("GET", "/dashboard/status"); } catch {}
  const { data: doms } = await sb.from("domains").select("name,status").eq("team_id", state.team.id).eq("status", "verified").limit(1);
  const verified = doms?.[0]?.name;
  const from = status.system_from || (verified ? `${state.team.name} <onboarding@${verified}>` : "");
  const to = state.user.email;
  let key = sessionStorage.getItem(`dlv_onb_key_${state.team.id}`) || "";
  let lang = localStorage.getItem("dlv_lang") || "Node.js";
  let reveal = false, sent = false;

  const draw = () => {
    const masked = key ? key.slice(0, 8) + "•".repeat(24) : "";
    const shownKey = key ? (reveal ? key : masked) : "dlv_xxxxxxxx";
    const snips = snippets({ key: key ? (reveal ? key : masked) : "dlv_your_api_key", from: from || "you@yourdomain.com", to, base: API_BASE });
    root.querySelector("[data-steps]").innerHTML = `
      <div class="step ${key ? "done" : "active"}"><div class="step-num">${key ? icon("check", 12) : "1"}</div><div class="step-card">
        <h3>Add an API key</h3><p class="sub">${key ? "Copy it now. You can create more later in API keys." : "We’ll generate a key with full access for this workspace."}</p>
        ${key ? `<div class="input-wrap"><input class="input mono" readonly value="${esc(shownKey)}" style="padding-right:70px"><span class="trail row-flex" style="gap:2px"><button class="ibtn" data-reveal title="Show">${icon(reveal ? "eye-off" : "eye")}</button><button class="ibtn" data-copy="${esc(key)}" data-copy-msg="API key copied">${icon("copy")}</button></span></div>` : `<button class="btn btn-primary" data-addkey>${icon("plus", 13)} Add API key</button>`}
      </div></div>
      <div class="step ${key ? (sent ? "done" : "active") : "disabled"}"><div class="step-num">${sent ? icon("check", 12) : "2"}</div><div class="step-card">
        <h3>Send an email</h3><p class="sub">Run this snippet, or paste it into your agent with Copy for AI.</p>
        ${key ? `<div class="code" style="border-radius:10px"><div class="codebar">${Object.keys(snips).map((l) => `<button class="lang ${l === lang ? "on" : ""}" data-lang="${l}">${l}</button>`).join("")}<span class="grow"></span><button class="btn btn-ghost btn-sm" data-ai>${icon("sparkle", 13)} Copy for AI</button><button class="ibtn" data-copy="${esc(snippets({ key, from: from || "you@yourdomain.com", to, base: API_BASE })[lang][0])}">${icon("copy")}</button></div>${codeBlock(snips[lang][0], { copy: false }).replace('class="code"', 'class="code" style="border:0;border-radius:0"')}</div>
        <div class="row-flex" style="margin-top:12px">${from ? `<button class="btn btn-primary" data-send ${sent ? "disabled" : ""}>${icon("send", 13)} Send email</button><span class="dim" style="font-size:12px">Sends from ${esc(from)} to ${esc(to)}</span>` : `<button class="btn btn-primary" disabled>${icon("send", 13)} Send email</button><span class="dim" style="font-size:12px">${status.aws?.configured === false ? "Sending isn’t configured on this Delivrie install yet." : "Verify a domain to send your first email."} <a class="link" href="/domains/new">Add a domain</a></span>`}</div>` : ""}
      </div></div>`;
    if (sent) root.querySelector("[data-explore]").innerHTML = explore();
  };
  const explore = () => `<h2 class="section-title" style="font-size:16px;margin-top:36px">Explore more</h2><p class="muted" style="margin-bottom:14px">Keep going with the rest of Delivrie.</p>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      ${[["globe", "Add a domain", `Send from your own domain instead of the shared sender and lift deliverability.`, "/domains/new", "Add domain", true],
         ["zap", "Test emails", "Simulate delivered, bounced and complained events with test addresses: delivered@, bounced@ and complained@test.delivrie.io.", "/docs/test-mode", "Learn more"],
         ["webhook", "Webhooks", "Get a signed HTTP callback for every delivery, bounce, open and click.", "/webhooks?new=1", "Add webhook"],
         ["users", "Invite your team", "Add teammates as Admins or Members.", "/settings/team", "Invite"]]
        .map(([ic, t, d, href, cta, rec]) => `<div class="card card-pad" style="display:flex;flex-direction:column;gap:8px"><div class="row-flex"><span class="head-ico" style="width:30px;height:30px">${icon(ic, 14)}</span><b style="font-weight:500">${t}</b>${rec ? '<span class="badge yellow">Recommended</span>' : ""}</div><p class="muted" style="font-size:12.5px">${d}</p><a class="btn btn-secondary btn-sm" style="align-self:flex-start;margin-top:4px" href="${href}">${cta}</a></div>`).join("")}
    </div>`;

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.addkey !== undefined) {
      t.disabled = true; t.innerHTML = '<span class="spinner"></span>';
      try { const r = await api("POST", "/api-keys", { name: "Onboarding", permission: "full_access" }); key = r.token; sessionStorage.setItem(`dlv_onb_key_${state.team.id}`, key); toast("API key created"); draw(); }
      catch (err) { errToast(err); t.disabled = false; t.innerHTML = `${icon("plus", 13)} Add API key`; }
    }
    if (t.dataset.reveal !== undefined) { reveal = !reveal; draw(); }
    if (t.dataset.lang) { lang = t.dataset.lang; localStorage.setItem("dlv_lang", lang); draw(); }
    if (t.dataset.ai !== undefined) {
      const real = snippets({ key, from: from || "you@yourdomain.com", to, base: API_BASE })[lang][0];
      const prompt = `Send an email with the Delivrie REST API (${API_BASE}). Authenticate with the header "Authorization: Bearer <DELIVRIE_API_KEY>" and keep the key in an environment variable, never in client-side code. Example (${lang}):\n\n${real.replaceAll(key, "<DELIVRIE_API_KEY>")}\n\nDocs: ${location.origin}/docs`;
      const mcp = JSON.stringify({ mcpServers: { delivrie: { type: "http", url: `${API_BASE}/mcp`, headers: { Authorization: "Bearer <DELIVRIE_API_KEY>" } } } }, null, 2);
      menu(t, [
        { label: "Copy prompt", icon: "copy", onClick: () => copyText(prompt, "Prompt copied") },
        { label: "Copy MCP config", icon: "terminal", onClick: () => copyText(mcp, "MCP config copied") },
        { sep: true },
        { label: "Open in Claude", icon: "external", onClick: () => { copyText(prompt, "Prompt copied"); window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank"); } },
        { label: "Open in ChatGPT", icon: "external", onClick: () => { copyText(prompt, "Prompt copied"); window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, "_blank"); } },
        { label: "Open in Cursor", icon: "external", onClick: () => { copyText(prompt, "Prompt copied. Paste it into Cursor's chat"); } },
      ], { align: "right" });
    }
    if (t.dataset.send !== undefined) {
      t.disabled = true; t.innerHTML = '<span class="spinner"></span> Sending';
      try {
        const res = await fetch(`${API_BASE}/emails`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to, subject: "Hello World", html: "<p>Congrats on sending your <strong>first email</strong>!</p>" }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.message);
        sent = true; toast("Email sent. Check your inbox"); draw();
        root.querySelector("[data-explore]").scrollIntoView({ behavior: "smooth" });
      } catch (err) { errToast(err); t.disabled = false; t.innerHTML = `${icon("send", 13)} Send email`; }
    }
  });
  draw();
}

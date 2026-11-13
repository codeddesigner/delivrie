// Delivrie docs site: Guides, API reference, MCP server and Changelog (Figma: Docs · MCP server, Docs · API reference).
// Routes: /docs, /docs/:guide, /docs/api, /docs/api/:endpoint, /docs/mcp, /docs/changelog
import { state, api } from "../lib/sb.js";
import { esc, icon, toast, on, copyText } from "../lib/ui.js";
import { DOCS } from "../lib/docs.js";
import { themeSwitch } from "../lib/theme.js";
import { API, ALL_ENDPOINTS, METHOD_COLOR, samples } from "../lib/apiref.js";

const BASE = "https://delivrie.io/api";
const MCP_URL = "https://delivrie.io/api/mcp";
const doc = (id) => DOCS.find((d) => d.id === id);
const GUIDES = [
  ["Get started", [["getting-started", "Introduction"], ["api-keys", "API keys"], ["limits", "Plans and limits"]]],
  ["Sending", [["send-email", "Send an email"], ["test-mode", "Test addresses"], ["email-status", "Statuses and events"], ["templates", "Templates"], ["errors", "Errors"], ["cors", "CORS"], ["smtp", "SMTP"]]],
  ["Platform", [["domains", "Domains and DNS"], ["domain-not-verifying", "Domain not verifying"], ["dmarc", "DMARC"], ["deliverability", "Deliverability"], ["suppressions", "Suppressions"], ["webhooks", "Webhooks"], ["broadcasts", "Broadcasts"], ["contacts", "Contacts and segments"]]],
];
const GUIDE_ORDER = GUIDES.flatMap(([, items]) => items);
const LEGACY = { "api-reference": "/docs/api", mcp: "/docs/mcp", "getting-started": "/docs" };

const logo = (id, n = 14) => `<span class="ab"><img src="/assets/clients/${id}.svg" width="${n}" height="${n}" alt=""></span>`;
const CURSOR_INSTALL = `cursor://anysphere.cursor-deeplink/mcp/install?name=delivrie&config=${btoa(JSON.stringify({ url: MCP_URL }))}`;
const CLIENTS = [
  { id: "claude", ab: "Cl", name: "Claude", sub: "Claude Code, Desktop & claude.ai", how: "Remote · OAuth", lang: "bash", file: "terminal",
    code: `# Claude Code: opens a Delivrie page to approve access\nclaude mcp add --transport http delivrie ${MCP_URL}\n\n# Claude Desktop & claude.ai: Settings → Connectors → Add custom connector\n# URL ${MCP_URL}` },
  { id: "cursor", ab: "Cu", name: "Cursor", sub: "Agent mode & Composer", how: "Remote · OAuth", lang: "json", file: "~/.cursor/mcp.json",
    code: `{\n  "mcpServers": {\n    "delivrie": { "url": "${MCP_URL}" }\n  }\n}` },
  { id: "codex", ab: "Cx", name: "Codex", sub: "OpenAI Codex CLI & IDE", how: "Local bridge", lang: "toml", file: "~/.codex/config.toml",
    code: `[mcp_servers.delivrie]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "${MCP_URL}"]\n# mcp-remote opens the Delivrie approval page on first run` },
  { id: "v0", ab: "v0", name: "v0", sub: "v0 by Vercel", how: "Remote · API key", lang: "text", file: "v0 → Settings → MCP connections",
    code: `# Add a custom MCP connection\nName     Delivrie\nURL      ${MCP_URL}\nHeader   Authorization: Bearer dlv_live_••••` },
  { id: "antigravity", ab: "Ag", name: "Antigravity", sub: "Google Antigravity agents", how: "Remote · OAuth", lang: "json", file: "Settings → Customizations → Open MCP Config, then Refresh and Authenticate",
    code: `{\n  "mcpServers": {\n    "delivrie": { "serverUrl": "${MCP_URL}" }\n  }\n}` },
  { id: "vscode", ab: "VS", name: "VS Code", sub: "GitHub Copilot agent mode", how: "Remote · OAuth", lang: "bash", file: "terminal",
    code: `code --add-mcp '{"name":"delivrie","type":"http","url":"${MCP_URL}"}'` },
];
const TOOLS = [
  ["send_email","Send one email from a verified domain","send"],
  ["send_batch","Send up to 100 emails in one call","send"],
  ["list_emails","Recent sent emails with their latest status (delivered, opened, bounced…)","read"],
  ["get_email","One email (sent or received) with its content and every delivery event","read"],
  ["reschedule_email","Change when a scheduled email goes out","send"],
  ["cancel_email","Cancel an email that is scheduled and not yet sent","send"],
  ["list_received_emails","Emails that arrived on your receiving domains, newest first","read"],
  ["forward_email","Forward an email (usually a received one) to other people, with an optional note","send"],
  ["list_inbox_threads","Conversations in the Inbox","read"],
  ["get_inbox_thread","A conversation with every message as plain text, oldest first","read"],
  ["reply_to_thread","Reply in an Inbox conversation","send"],
  ["update_thread","Archive or reopen a thread, mark it read or unread, or set its labels (labels are created if they don't exist)","send"],
  ["list_inbox_labels","Labels you can put on inbox threads","read"],
  ["list_domains","Sending domains with status, region, tracking and receiving settings","read"],
  ["get_domain","A domain and the DNS records to add, with each record's status","read"],
  ["create_domain","Add a sending domain and get its DNS records","manage"],
  ["verify_domain","Check DNS now and update the domain's verification status","read"],
  ["update_domain","Change tracking, TLS or receiving","manage"],
  ["delete_domain","Remove a domain","manage"],
  ["claim_domain","Start claiming a domain another Delivrie team added","manage"],
  ["verify_domain_claim","Check the claim TXT record and move the domain to this team when it's found","manage"],
  ["list_contacts","Contacts, newest first","read"],
  ["get_contact","A contact by id or email","read"],
  ["create_contact","Create or update a contact by email, optionally adding it to segments","manage"],
  ["update_contact","Change a contact's name, properties or subscription","manage"],
  ["delete_contact","Delete a contact","manage"],
  ["list_contact_properties","Custom contact properties and their fallbacks","read"],
  ["list_segments","Segments used to target broadcasts and automations","read"],
  ["create_segment","Create a segment","manage"],
  ["add_contacts_to_segment","Add contacts (by email) to a segment, creating them if needed","manage"],
  ["delete_segment","Delete a segment (contacts stay)","manage"],
  ["list_topics","Topics people can opt out of on the unsubscribe page","read"],
  ["list_broadcasts","Broadcasts with status and schedule","read"],
  ["get_broadcast","A broadcast with delivery stats","read"],
  ["create_broadcast","Create a broadcast draft for a segment","manage"],
  ["send_broadcast","Send a broadcast now, or schedule it with scheduled_at","manage"],
  ["cancel_broadcast","Cancel a scheduled broadcast (it goes back to draft)","manage"],
  ["list_templates","Templates with alias and published version","read"],
  ["get_template","A template by id or alias, with its content and variables","read"],
  ["create_template","Create a template","manage"],
  ["publish_template","Publish the current draft so API sends and automations use it","manage"],
  ["list_automations","Automations with trigger and status (draft, live, paused)","read"],
  ["get_automation","An automation's trigger, steps and run counts","read"],
  ["create_automation","Create a simple automation: a trigger (an event name or a segment) and a list of send/wait steps","manage"],
  ["publish_automation","Publish (or republish) an automation so it starts running","manage"],
  ["pause_automation","Pause a live automation","manage"],
  ["resume_automation","Resume a paused automation","manage"],
  ["list_automation_runs","Recent runs of an automation, with each step's log","read"],
  ["send_event","Record an event for a contact (e.g","send"],
  ["list_events","Without a name: every event your app has sent, with its fields","read"],
  ["list_webhooks","Webhook endpoints and their events","read"],
  ["create_webhook","Create a webhook endpoint","manage"],
  ["list_webhook_events","Recent delivery attempts for a webhook with status codes","read"],
  ["test_webhook","Send a test event to a webhook and return the response","manage"],
  ["replay_webhook_delivery","Send a past webhook delivery again","manage"],
  ["list_suppressions","Addresses Delivrie won't send to (bounces, complaints, manual)","read"],
  ["add_suppression","Stop sending to one or more addresses","manage"],
  ["remove_suppression","Allow sending to an address again","manage"],
  ["get_metrics","Sent, delivered, opened, clicked, bounced and complained totals and rates","read"],
  ["list_logs","Recent API requests with status codes","read"],
  ["get_log","One API request with its request and response bodies","read"],
  ["get_usage","Plan, emails sent this month and today, the allowance, and pay-as-you-go credits","read"],
  ["list_api_keys","API keys (tokens are never shown)","read"],
  ["create_api_key","Create an API key","manage"],
];
const CHANGELOG = [
  { date: "Nov 13, 2026", title: "SMTP relay on ports 587 and 465", items: ["Send from WordPress, Laravel, Django, Ghost, Supabase Auth and anything else that speaks SMTP: host smtp.delivrie.io, username delivrie, an API key as the password.", "Port 587 with STARTTLS and port 465 with SSL/TLS, plus 2587 and 2465 for hosts that block the usual ports.", "SMTP mail gets the same limits, logs, webhooks and suppressions as the API. Tag messages with an X-Delivrie-Tags header."] },
  { date: "Nov 13, 2026", title: "Support chat", items: ["Chat with the Delivrie team from any page in the dashboard. Replies arrive in the chat and by email."] },
  { date: "Nov 12, 2026", title: "New pricing, credits and billing", items: ["Pro now includes 20,000 emails a month and Scale 100,000, with yearly plans at ten months' price.", "Paid plans keep sending past their allowance and pay overage per 1,000 at month end. Set a spending cap in Billing.", "Pay-as-you-go credits: top up from ₦5,000 or $5, credits never expire.", "Marketing add-on priced by contacts, and billing address and tax ID on invoices."] },
  { date: "Nov 12, 2026", title: "Test addresses and natural-language scheduling", items: ["Send to delivered@, bounced@ and complained@test.delivrie.io to exercise events without touching your reputation.", "scheduled_at accepts phrases like \"in 1 hour\" and \"tomorrow at 9am\" as well as ISO dates."] },
  { date: "Nov 12, 2026", title: "New docs", items: ["An API reference page for every endpoint, with examples in five languages.", "MCP server docs with install steps for Claude, Cursor, Codex, v0, Antigravity and VS Code."] },
  { date: "Nov 12, 2026", title: "Sign in with Google, GitHub or a code", items: ["Google and GitHub sign-in.", "Sign-up, sign-in and password reset now use 6-digit codes instead of magic links."] },
];

// ---------------------------------------------------------------- page
export default async function docs(ctx) {
  const path = location.pathname.replace(/\/+$/, "");
  const hash = location.hash.slice(1);
  if (path === "/docs" && hash) {
    if (LEGACY[hash]) return ctx.navigate(LEGACY[hash], { replace: true });
    if (doc(hash)) return ctx.navigate(`/docs/${hash}`, { replace: true });
  }
  const seg = path.split("/").slice(2);
  const tab = seg[0] === "api" ? "api" : seg[0] === "mcp" ? "mcp" : seg[0] === "changelog" ? "changelog" : "guides";
  const root = ctx.root;
  root.innerHTML = `<div class="docs">
    <header class="d-top"><a href="/" data-native class="d-logo"><img src="/assets/logo.svg" width="118" height="22" alt="Delivrie"></a><span class="d-badge">Docs</span>
      <div class="d-search"><span class="lead">${icon("search", 13)}</span><input data-q placeholder="Search docs, API and MCP tools…" autocomplete="off"><kbd>⌘K</kbd><div class="d-results" data-results hidden></div></div>
      <nav class="d-links"><a href="/status" data-native class="hide-sm">API status</a><a href="/help" class="hide-sm">Support</a>${themeSwitch()}<a class="d-dash" href="${state.user ? "/emails" : "/login"}">${state.user ? "Dashboard" : "Log in"}</a></nav></header>
    <nav class="d-tabs">${[["guides", "/docs", "book", "Guides"], ["api", "/docs/api", "code", "API reference"], ["mcp", "/docs/mcp", "sparkle", "MCP server"], ["changelog", "/docs/changelog", "clock", "Changelog"]].map(([k, h, ic, l]) => `<a href="${h}" class="${k === tab ? "on" : ""}">${icon(ic, 13)}${l}</a>`).join("")}</nav>
    <div class="d-body" data-body></div></div>`;
  const body = root.querySelector("[data-body]");
  if (tab === "api") apiPage(body, seg[1] || "send-email", ctx);
  else if (tab === "mcp") mcpPage(body);
  else if (tab === "changelog") changelogPage(body);
  else guidePage(body, seg[0] || "getting-started", ctx);
  document.title = `${body.querySelector("h1")?.textContent || "Docs"} · Delivrie Docs`;
  bindSearch(root, ctx);
  bindCommon(root);
  window.scrollTo(0, 0);
  if (hash && !LEGACY[hash]) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 40);
}

// ---------------------------------------------------------------- shared bits
function sidebar(groups, active) {
  return `<aside class="d-side">${groups.map(([g, items]) => `<div class="d-grp">${esc(g)}</div>${items.map((i) => `<a href="${i.href}" class="${i.key === active ? "on" : ""}">${i.pre || ""}<span>${esc(i.label)}</span></a>`).join("")}`).join("")}</aside>`;
}
function toc(items, extra = "") {
  return `<aside class="d-toc"><div class="d-grp">On this page</div>${items.map(([id, l]) => `<a href="#${id}" data-toc="${id}">${esc(l)}</a>`).join("")}${extra}</aside>`;
}
function helpful(prev, next) {
  return `<div class="d-helpful"><span class="dim">Was this page helpful?</span><button class="d-chip" data-helpful="yes">${icon("check", 12)} Yes</button><button class="d-chip" data-helpful="no">${icon("x", 12)} No</button><span class="grow"></span><a class="dim" href="mailto:hello@delivrie.io?subject=Docs%20feedback">Suggest an edit</a></div>
    <div class="d-pn">${prev ? `<a href="${prev[0]}"><span class="dim">Previous</span><b>${esc(prev[1])}</b></a>` : "<span></span>"}${next ? `<a href="${next[0]}" class="r"><span class="dim">Next</span><b>${esc(next[1])}</b></a>` : "<span></span>"}</div>`;
}
function inline(s) {
  return esc(s).replace(/\b((?:GET|POST|PATCH|PUT|DELETE) \/[\w/:.{}-]*)/g, "<code>$1</code>")
    .replace(/(\{\{\{?[\w|" ]+\}\}\}?|\bdlv_\w*|\bwhsec_\w*|\b[a-z]+_[a-z_]+\b|\b[\w.+-]+@test\.delivrie\.io\b|https:\/\/delivrie\.io[\w/.-]*)/g, "<code>$1</code>");
}
function prose(text) {
  return text.split(/\n\n+/).map((para) => {
    const lines = para.split("\n");
    if (lines.length > 1 && lines.every((l) => /^\s*(\d+\.|-)\s/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*(\d+\.|-)\s/, ""))}</li>`).join("")}</ol>`;
    if (lines.length > 2) return `<p>${inline(lines[0])}</p><ul class="d-list">${lines.slice(1).map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}
function codeTabs(tabs, { label = "", id = "" } = {}) {
  const keys = Object.keys(tabs);
  let pref = keys[0];
  try { const p = localStorage.getItem("dlv_docs_lang"); if (p && tabs[p]) pref = p; } catch {}
  return `<div class="d-code" data-tabs ${id ? `id="${id}"` : ""}><div class="d-code-h">${keys.map((k) => `<button class="${k === pref ? "on" : ""}" data-lang="${esc(k)}">${tabs[k].logo ? `<img src="/assets/clients/${tabs[k].logo}.svg" width="12" height="12" alt="">` : ""}${esc(k)}</button>`).join("")}<span class="grow"></span>${label ? `<span class="dim mono">${esc(label)}</span>` : ""}<button class="ibtn" data-copy-tab title="Copy">${icon("copy", 13)}</button></div>
    ${keys.map((k) => `<pre class="d-pre" data-pane="${esc(k)}" ${k === pref ? "" : "hidden"}>${numbered(tabs[k].src ?? tabs[k], tabs[k].lang || langOf(k))}</pre>`).join("")}</div>`;
}
function codeCard(src, lang, label) {
  return `<div class="d-code"><div class="d-code-h"><span class="dim mono">${esc(label)}</span><span class="grow"></span><span class="dim mono">${esc(lang)}</span><button class="ibtn" data-copy="${esc(src)}" title="Copy">${icon("copy", 13)}</button></div><pre class="d-pre">${numbered(src, lang)}</pre></div>`;
}
const langOf = (k) => ({ "Node.js": "js", Python: "py", PHP: "php", Go: "go", cURL: "sh" }[k] || "js");
// Tokenises raw source (strings, comments, keywords, JSON keys) and escapes each piece, line by line.
const KW = /\b(import|from|const|let|await|async|new|return|func|package|var|require|true|false|null|nil|print|puts|curl|def|end)\b/g;
function paintLine(line, lang) {
  const re = lang === "json" ? /("(?:[^"\\]|\\.)*")(\s*:)?/g : /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|(?<![:\w])\/\/.*$|(?<![\w$])#(?!\{).*$)/g;
  let out = "", last = 0, m;
  const plain = (t) => lang === "json" ? esc(t).replace(/\b(true|false|null|\d+(\.\d+)?)\b/g, '<span class="tk-n">$1</span>') : esc(t).replace(KW, '<span class="tk-k">$1</span>');
  while ((m = re.exec(line))) {
    out += plain(line.slice(last, m.index));
    const t = m[0];
    if (lang === "json") out += m[2] ? `<span class="tk-p">${esc(m[1])}</span>${esc(m[2])}` : `<span class="tk-s">${esc(t)}</span>`;
    else out += /^(\/\/|#)/.test(t) ? `<span class="tk-c">${esc(t)}</span>` : `<span class="tk-s">${esc(t)}</span>`;
    last = m.index + t.length;
  }
  return out + plain(line.slice(last));
}
function numbered(src, lang) {
  return String(src).split("\n").map((l) => `<span class="l">${paintLine(l, lang) || " "}</span>`).join("");
}
function callout(kind, title, text) {
  return `<div class="d-callout ${kind}">${icon(kind === "warn" ? "alert" : kind === "tip" ? "sparkle" : "info", 14)}<div>${title ? `<b>${esc(title)}</b>` : ""}<p>${text}</p></div></div>`;
}

// ---------------------------------------------------------------- guides
function guidePage(body, id, ctx) {
  const d = doc(id);
  if (!d) return ctx.navigate("/docs", { replace: true });
  const idx = GUIDE_ORDER.findIndex(([k]) => k === id);
  const prev = idx > 0 ? [`/docs/${GUIDE_ORDER[idx - 1][0]}`, GUIDE_ORDER[idx - 1][1]] : null;
  const next = idx >= 0 && idx < GUIDE_ORDER.length - 1 ? [`/docs/${GUIDE_ORDER[idx + 1][0]}`, GUIDE_ORDER[idx + 1][1]] : ["/docs/api", "API reference"];
  const group = GUIDES.find(([, items]) => items.some(([k]) => k === id))?.[0] || "Guides";
  const title = d.title;
  const extra = id === "send-email" ? `<h2 id="example">Example</h2>${codeTabs(samples(ALL_ENDPOINTS[0], BASE))}<p>See the full field list in the <a href="/docs/api/send-email">API reference</a>.</p>`
    : id === "getting-started" ? `<h2 id="next">Next steps</h2><div class="d-cards three">${[["/docs/send-email", "send", "Send your first email", "One POST request with from, to, subject and html."], ["/docs/domains", "globe", "Verify a domain", "Add DKIM and SPF records so mail lands in the inbox."], ["/docs/mcp", "sparkle", "Connect an agent", "Let Claude or Cursor send through the MCP server."]].map(([h, ic, t, p]) => `<a class="d-card" href="${h}"><span class="d-ic">${icon(ic, 14)}</span><b>${t}</b><span class="dim">${p}</span></a>`).join("")}</div>`
    : id === "test-mode" ? codeTabs(samples({ ...ALL_ENDPOINTS[0], example: { from: "Kora <orders@kora.ng>", to: ["bounced@test.delivrie.io"], subject: "Bounce test", html: "<p>Testing</p>" } }, BASE)) : "";
  body.innerHTML = `${sidebar([...GUIDES.map(([g, items]) => [g, items.map(([k, l]) => ({ key: k, label: l, href: `/docs/${k}` }))]), ["Agents", [{ key: "mcp", label: "MCP server", href: "/docs/mcp" }]]], id)}
    <main class="d-main"><article class="d-art">
      <div class="d-crumb">${esc(group)} ${icon("chevron-right", 11)} <span>${esc(title)}</span></div>
      <div class="d-h1"><h1>${esc(title)}</h1><button class="d-chip" data-copy-page>${icon("copy", 12)} Copy page</button></div>
      <div class="d-prose">${prose(d.body)}</div>${extra}
      ${helpful(prev, next)}</article></main>
    ${toc([["top", title], ...(extra ? [[id === "getting-started" ? "next" : "example", id === "getting-started" ? "Next steps" : "Example"]] : [])], `<div class="d-toc-act"><a href="https://claude.ai/new?q=${encodeURIComponent(`Read ${location.origin}/docs/${id} and help me with Delivrie.`)}" target="_blank" rel="noopener" data-native>${icon("sparkle", 12)} Open in Claude</a></div>`)}`;
  body.querySelector(".d-art").id = "top";
  body.dataset.md = `# ${title}\n\n${d.body}`;
}

// ---------------------------------------------------------------- API reference
function apiPage(body, slug, ctx) {
  const e = ALL_ENDPOINTS.find((x) => x.slug === slug);
  if (!e) return ctx.navigate("/docs/api", { replace: true });
  const i = ALL_ENDPOINTS.indexOf(e);
  const url = BASE + e.path;
  const ptable = (title, id, rows) => rows?.length ? `<h2 id="${id}">${title}</h2><div class="d-params">${rows.map(([n, t, req, d, def]) => `<div class="d-param"><div><code class="n">${esc(n)}</code><span class="t">${esc(t)}</span>${req ? `<span class="req">required</span>` : ""}</div><p>${inline(d)}</p>${def ? `<div class="def"><span class="dim">Default</span> <code>${esc(def)}</code></div>` : ""}</div>`).join("")}</div>` : "";
  const errs = e.errors || [["401", "missing_api_key", "No Authorization header was sent."], ["404", "not_found", "Nothing with that id on this team."]];
  const sections = [["headers", "Headers"], ...(e.params ? [["path", "Path parameters"]] : []), ...(e.query ? [["query", "Query parameters"]] : []), ...(e.body ? [["body", "Body parameters"]] : []), ["errors", "Errors"]];
  body.innerHTML = `${sidebar(API.map((g) => [g.group, g.items.map((x) => ({ key: x.slug, label: x.title, href: `/docs/api/${x.slug}`, pre: `<span class="mth" style="color:${METHOD_COLOR[x.m]}">${x.m === "DELETE" ? "DEL" : x.m}</span>` }))]), slug)}
    <main class="d-main api"><article class="d-art">
      <div class="d-crumb">API reference ${icon("chevron-right", 11)} ${esc(e.group)} ${icon("chevron-right", 11)} <span>${esc(e.title)}</span></div>
      <h1>${esc(e.title)}</h1>
      <div class="d-url"><span class="mth" style="color:${METHOD_COLOR[e.m]};border-color:${METHOD_COLOR[e.m]}55;background:${METHOD_COLOR[e.m]}14">${e.m}</span><code>${esc(url)}</code><button class="ibtn" data-copy="${esc(url)}" title="Copy URL">${icon("copy", 13)}</button></div>
      <p class="d-lead">${inline(e.desc)}</p>
      ${ptable("Headers", "headers", e.headers || [["Authorization", "string", true, `Bearer token. ${e.scope}.`]])}
      ${ptable("Path parameters", "path", e.params)}${ptable("Query parameters", "query", e.query)}${ptable("Body parameters", "body", e.body)}
      <h2 id="errors">Errors</h2><div class="d-table"><table><thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead><tbody>${errs.map(([s, c, m]) => `<tr><td class="st">${s}</td><td><code>${esc(c)}</code></td><td>${esc(m)}</td></tr>`).join("")}</tbody></table></div>
      <p class="dim" style="font-size:13px">Every error returns JSON with <code>statusCode</code>, <code>name</code> and <code>message</code>. See <a href="/docs/errors">Errors</a>.</p>
      ${helpful(i > 0 ? [`/docs/api/${ALL_ENDPOINTS[i - 1].slug}`, ALL_ENDPOINTS[i - 1].title] : ["/docs", "Guides"], i < ALL_ENDPOINTS.length - 1 ? [`/docs/api/${ALL_ENDPOINTS[i + 1].slug}`, ALL_ENDPOINTS[i + 1].title] : ["/docs/mcp", "MCP server"])}
    </article>
    <aside class="d-aside">${codeTabs(samples(e, BASE))}
      ${codeCard(JSON.stringify(e.response, null, 2), "json", e.m === "POST" && /create/i.test(e.title) ? "200 OK · Response" : "200 OK · Response")}
      ${codeCard(JSON.stringify({ statusCode: Number(errs.find(([s]) => s === "422")?.[0] || errs[0][0]), name: (errs.find(([s]) => s === "422") || errs[0])[1], message: (errs.find(([s]) => s === "422") || errs[0])[2] }, null, 2), "json", `${(errs.find(([s]) => s === "422") || errs[0])[0]} · Error`)}
      ${e.tool ? `<div class="d-note">${icon("sparkle", 13)}<span>Agents can call this endpoint through the MCP tool <code>${e.tool}</code>. <a href="/docs/mcp">MCP server</a></span></div>` : ""}
    </aside></main>`;
  body.dataset.md = `# ${e.title}\n\n${e.m} ${url}\n\n${e.desc}\n\n${(e.body || []).map(([n, t, r, d]) => `- ${n} (${t}${r ? ", required" : ""}): ${d}`).join("\n")}`;
}

// ---------------------------------------------------------------- MCP server
function mcpPage(body) {
  const tocItems = [["works", "Works with"], ["install", "Install"], ["remote", "Remote server"], ["tools", "Tools"], ["safety", "Scopes & safety"], ["try", "Try it"]];
  const tabs = Object.fromEntries(CLIENTS.map((c) => [c.name === "Claude" ? "Claude Code" : c.name, { src: c.code, lang: c.lang, logo: c.id }]));
  body.innerHTML = `${sidebar([
      ["Get started", [["/docs", "Introduction"], ["/docs/send-email", "Quickstart"], ["/docs/api-keys", "API keys"]].map(([h, l]) => ({ key: h, label: l, href: h }))],
      ["MCP server", [{ key: "ov", label: "Overview", href: "/docs/mcp" }, ...CLIENTS.map((c) => ({ key: c.id, label: c.name === "v0" ? "v0 by Vercel" : c.name, href: `/docs/mcp#c-${c.id}`, pre: logo(c.id, 12) })), { key: "tl", label: "Tools reference", href: "/docs/mcp#tools" }, { key: "sf", label: "Scopes & safety", href: "/docs/mcp#safety" }]],
      ["Sending", [["send-email", "Send an email"], ["send-batch", "Batch sending"]].map(([s, l]) => ({ key: s, label: l, href: `/docs/api/${s}` }))],
    ], "ov")}
    <main class="d-main"><article class="d-art">
      <div class="d-crumb">MCP server ${icon("chevron-right", 11)} <span>Overview</span></div>
      <div class="d-h1"><h1>Delivrie MCP server</h1><button class="d-chip" data-copy-page>${icon("copy", 12)} Copy page</button></div>
      <p class="d-lead">Let AI agents send email, answer the Inbox, run automations, manage domains and contacts, and read delivery logs through the Model Context Protocol. One hosted server works with every major agent.</p>
      <div class="d-pills"><span class="p blue">Remote · HTTP</span><span class="p">OAuth or API key</span><span class="p green">Included on every plan</span></div>
      <h2 id="works">Works with</h2><p>Connect directly where your client supports remote MCP, or through the <code>mcp-remote</code> bridge everywhere else.</p>
      <div class="d-cards three">${CLIENTS.map((c) => `<a class="d-card client" href="#c-${c.id}" data-client="${c.id}"><div class="row-flex">${logo(c.id, 16)}<span class="grow"></span>${icon("arrow-up-right", 12, "dim")}</div><b>${c.name}</b><span class="dim">${c.sub}</span><span class="tagm">${c.how}</span></a>`).join("")}</div>
      <h2 id="install">Install</h2><p>Add the server to your client. Clients that support OAuth open a Delivrie page where you pick the team and approve what the agent can do; it then shows under <a href="/settings/connected-apps">Settings → Connected apps</a>. For other clients, create an API key in <a href="/api-keys">API keys</a> and send it as a header in place of <code>dlv_live_••••</code>.</p>
      ${codeTabs(tabs, { id: "install-tabs" })}
      <p class="dim" id="install-file" style="font-size:12.5px"></p>
      ${CLIENTS.map((c) => `<span id="c-${c.id}" class="anchor"></span>`).join("")}
      <div id="remote">${callout("info", "Remote server", `The server lives at <code>${MCP_URL}</code> and speaks MCP over streamable HTTP. Unauthenticated requests get a 401 that points clients at Delivrie's OAuth server (dynamic client registration and PKCE). With an API key, send <code>Authorization: Bearer dlv_…</code>. Either way the agent acts as one team.`)}</div>
      <h2 id="tools">Tools</h2><p>${TOOLS.length} tools across sending, the Inbox, automations, domains, contacts, broadcasts, templates, webhooks and logs. Each needs one OAuth scope: <b>send</b>, <b>read</b> or <b>manage</b>. Sending-access API keys only reach the send tools.</p>
      <div class="d-table"><table><thead><tr><th>Tool</th><th>Description</th><th class="r">Scope</th></tr></thead><tbody>${TOOLS.map(([n, d, s]) => `<tr><td><code>${n}</code></td><td>${esc(d)}</td><td class="r"><span class="scope ${s === "send" ? "y" : ""}">${s}</span></td></tr>`).join("")}</tbody></table></div>
      <h2 id="safety">Scopes & safety</h2>
      <ul class="d-checks"><li>Connect each agent with OAuth and approve only the scopes it needs. Revoke it any time in Settings → Connected apps.</li><li>If you use API keys, create a separate key per agent so you can revoke one without touching the others.</li><li>Give agents that only send a <b>sending access</b> key. It can't read contacts, change domains or create keys.</li><li>Limit a sending key to one domain when you create it.</li><li><code>create_broadcast</code> only makes a draft. Sending one needs <code>send_broadcast</code> and a full access key.</li><li>Agent sends appear in Emails and Metrics like any other send.</li></ul>
      ${callout("warn", "Sending limits still apply", "Agents share your plan's allowance. Set a spending cap in Billing to stop a runaway loop from running up overage.")}
      <h2 id="try">Try it</h2><div class="d-cards three">${["Reply to every support thread that needs a reply about order status", "Why did emails to gmail.com bounce yesterday?", "Create an automation that sends the welcome template when user.created fires"].map((q) => `<button class="d-card prompt" data-copy="${esc(q)}" data-copy-msg="Prompt copied">${icon("sparkle", 13)}<span>“${esc(q)}”</span></button>`).join("")}</div>
      ${helpful(["/docs/api-keys", "API keys"], ["/docs/api/send-email", "Send email"])}
    </article></main>
    ${toc(tocItems, `<div class="d-toc-act"><button data-copy-page>${icon("copy", 12)} Copy as Markdown</button><a href="https://claude.ai/new?q=${encodeURIComponent(`Help me connect the Delivrie MCP server (${MCP_URL}) to my client. Docs: ${location.origin}/docs/mcp`)}" target="_blank" rel="noopener" data-native>${icon("sparkle", 12)} Open in Claude</a></div>`)}`;
  const file = body.querySelector("#install-file");
  const showFile = (name) => { const c = CLIENTS.find((x) => (x.name === "Claude" ? "Claude Code" : x.name) === name); if (c) file.innerHTML = `Where: <code>${esc(c.file)}</code>${c.id === "codex" ? ` · <code>mcp-remote</code> bridges the hosted server for clients that only run local commands.` : ""}${c.id === "cursor" ? ` · or <a href="${CURSOR_INSTALL}">add to Cursor in one click</a>` : ""}`; };
  showFile(body.querySelector("#install-tabs .d-code-h .on")?.dataset.lang);
  on(body, "click", "#install-tabs [data-lang]", (_e, b) => showFile(b.dataset.lang));
  on(body, "click", "[data-client]", (ev, a) => { ev.preventDefault(); const c = CLIENTS.find((x) => x.id === a.dataset.client); const name = c.name === "Claude" ? "Claude Code" : c.name; body.querySelector(`#install-tabs [data-lang="${name}"]`)?.click(); body.querySelector("#install").scrollIntoView({ behavior: "smooth" }); });
  body.dataset.md = `# Delivrie MCP server\n\nServer: ${MCP_URL} (streamable HTTP; OAuth 2.1 or Authorization: Bearer dlv_…)\n\n${CLIENTS.map((c) => `## ${c.name}\n\n${c.code}`).join("\n\n")}\n\n## Tools\n\n${TOOLS.map(([n, d, s]) => `- ${n}: ${d} (scope: ${s})`).join("\n")}`;
}

// ---------------------------------------------------------------- changelog
function changelogPage(body) {
  body.innerHTML = `<main class="d-main solo"><article class="d-art"><h1>Changelog</h1><p class="d-lead">New features and fixes in Delivrie.</p>
    <div class="d-log">${CHANGELOG.map((c) => `<section><div class="dt dim mono">${c.date}</div><div><h2>${esc(c.title)}</h2><ul class="d-list">${c.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul></div></section>`).join("")}</div></article></main>`;
  body.dataset.md = CHANGELOG.map((c) => `## ${c.title} (${c.date})\n\n${c.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
}

// ---------------------------------------------------------------- behaviour
function bindCommon(root) {
  on(root, "click", "[data-lang]", (_e, b) => {
    const box = b.closest("[data-tabs]"); const k = b.dataset.lang;
    // keep every code group on the page in the same language
    root.querySelectorAll("[data-tabs]").forEach((t) => { if (!t.querySelector(`[data-pane="${CSS.escape(k)}"]`)) return; t.querySelectorAll("[data-lang]").forEach((x) => x.classList.toggle("on", x.dataset.lang === k)); t.querySelectorAll("[data-pane]").forEach((p) => p.hidden = p.dataset.pane !== k); });
    if (box.id !== "install-tabs") try { localStorage.setItem("dlv_docs_lang", k); } catch {}
  });
  on(root, "click", "[data-copy-tab]", (_e, b) => { const pane = b.closest("[data-tabs]").querySelector("[data-pane]:not([hidden])"); copyText(pane.innerText.replace(/\n\n/g, "\n")); });
  on(root, "click", "[data-copy-page]", () => copyText(root.querySelector("[data-body]").dataset.md || document.title, "Page copied as Markdown"));
  on(root, "click", "[data-helpful]", async (_e, b) => {
    const wrap = b.closest(".d-helpful");
    wrap.querySelectorAll("[data-helpful]").forEach((x) => x.disabled = true);
    b.classList.add("on");
    if (state.user) api("POST", "/account/feedback", { page: location.pathname, message: `Docs ${b.dataset.helpful === "yes" ? "👍 helpful" : "👎 not helpful"}: ${location.pathname}`, team_id: state.team?.id }).catch(() => {});
    toast(b.dataset.helpful === "yes" ? "Thanks for the feedback" : "Thanks. Email hello@delivrie.io and tell us what was missing.", "ok");
  });
  // table of contents highlight
  const links = root.querySelectorAll("[data-toc]");
  if (links.length) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.dataset.toc === en.target.id)); }), { rootMargin: "-120px 0px -65% 0px" });
    links.forEach((a) => { const t = document.getElementById(a.dataset.toc); if (t) io.observe(t); });
  }
}

function bindSearch(root, ctx) {
  const q = root.querySelector("[data-q]"), out = root.querySelector("[data-results]");
  const index = [
    ...DOCS.map((d) => ({ kind: "Guide", title: d.title, text: d.body, href: `/docs/${d.id}` })),
    ...ALL_ENDPOINTS.map((e) => ({ kind: e.m, title: e.title, text: `${e.path} ${e.desc} ${(e.body || []).map((b) => b[0]).join(" ")}`, href: `/docs/api/${e.slug}`, sub: e.path })),
    ...TOOLS.map(([n, d]) => ({ kind: "Tool", title: n, text: d, href: "/docs/mcp#tools", sub: d })),
    ...CLIENTS.map((c) => ({ kind: "MCP", title: `Install in ${c.name}`, text: c.sub, href: `/docs/mcp#c-${c.id}` })),
  ];
  let sel = 0, hits = [];
  const render = () => {
    const term = q.value.trim().toLowerCase();
    if (!term) { out.hidden = true; return; }
    const words = term.split(/\s+/);
    hits = index.map((r) => { const t = r.title.toLowerCase(), x = r.text.toLowerCase(); let s = 0; for (const w of words) { if (t.includes(w)) s += 5; if (x.includes(w)) s += 1; else if (!t.includes(w)) s -= 3; } return { r, s }; }).filter((h) => h.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map((h) => h.r);
    sel = 0;
    out.hidden = false;
    out.innerHTML = hits.length ? hits.map((h, i) => `<a href="${h.href}" class="${i === sel ? "on" : ""}"><span class="k" ${METHOD_COLOR[h.kind] ? `style="color:${METHOD_COLOR[h.kind]}"` : ""}>${esc(h.kind)}</span><span class="tt">${esc(h.title)}</span>${h.sub ? `<span class="dim sub">${esc(h.sub)}</span>` : ""}</a>`).join("") : `<div class="dim" style="padding:12px">No results for “${esc(q.value)}”</div>`;
  };
  q.addEventListener("input", render);
  q.addEventListener("focus", render);
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(hits.length, 1); out.querySelectorAll("a").forEach((a, i) => a.classList.toggle("on", i === sel)); }
    if (e.key === "Enter" && hits[sel]) { e.preventDefault(); out.hidden = true; ctx.navigate(hits[sel].href); }
    if (e.key === "Escape") { out.hidden = true; q.blur(); }
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".d-search")) out.hidden = true; });
  const key = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && document.body.contains(q)) { e.preventDefault(); q.focus(); q.select(); } else if (!document.body.contains(q)) document.removeEventListener("keydown", key); };
  document.addEventListener("keydown", key);
}

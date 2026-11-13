// Live check of delivrie.io: every public page, docs page, asset and public API endpoint answers as expected,
// internal files are not served, and the API, OAuth discovery and MCP server respond.
// Run: node tools/site-check.mjs [https://delivrie.io]   (GitHub Actions runs it daily: .github/workflows/site-check.yml)
import fs from "node:fs";

const BASE = (process.argv[2] || "https://delivrie.io").replace(/\/$/, "");
const failures = [];
let passed = 0;

async function check(path, { status = 200, contains = [], type, method = "GET", body, headers } = {}) {
  const t0 = Date.now();
  let res, text = "";
  try {
    res = await fetch(BASE + path, { method, body, headers, redirect: "manual" });
    text = await res.text();
  } catch (e) { failures.push(`${path}: request failed (${e.message})`); return; }
  const ms = Date.now() - t0;
  const want = Array.isArray(status) ? status : [status];
  const problems = [];
  if (!want.includes(res.status)) problems.push(`status ${res.status}, expected ${want.join(" or ")}`);
  for (const c of contains) if (!text.includes(c)) problems.push(`missing "${c}"`);
  if (type && !(res.headers.get("content-type") || "").includes(type)) problems.push(`content-type ${res.headers.get("content-type")}`);
  if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
  else { passed++; console.log(`ok  ${String(res.status).padEnd(3)} ${String(ms).padStart(5)}ms  ${path}`); }
  return { res, text };
}

// Pages that are switched off in Admin → Website return 404 on purpose.
let off = {};
try { off = (await (await fetch(BASE + "/api/public/site?only=pages")).json()).pages || {}; } catch { /* treat all as on */ }
const isOff = (p) => off[p] === false || off["/" + p.split("/")[1]] === false;

// ---------------------------------------------------------------- public pages
const pages = {
  "/": "Delivrie", "/pricing": "Pricing", "/compare": "Resend vs Brevo vs Delivrie", "/resend-alternative": "Resend alternative",
  "/brevo-alternative": "Brevo alternative", "/about": "About", "/careers": "Careers", "/brand": "Brand", "/changelog": "SMTP relay on ports 587 and 465",
  "/blog": "Blog", "/status": "Status", "/contact-sales": "Talk to our team", "/support": "How can we help?", "/terms": "Terms",
  "/privacy": "Privacy", "/dpa": "Data Processing", "/acceptable-use": "Acceptable Use", "/cookies": "Cookie", "/subprocessors": "Subprocessors",
  "/security": "Security", "/customers": "Customers",
};
for (const [p, txt] of Object.entries(pages)) await check(p, isOff(p) ? { status: 404 } : { contains: [txt, "/site-config.js"] });
const posts = fs.readdirSync(new URL("../pages/blog/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => "/blog/" + f.slice(0, -5));
for (const p of posts) await check(p, isOff(p) ? { status: 404 } : { contains: ['"BlogPosting"'] });

// ---------------------------------------------------------------- docs (pre-rendered) and app routes
const docs = fs.readdirSync(new URL("../docs-static/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => f === "index.html" ? "/docs" : "/docs/" + f.slice(0, -5));
const api = fs.readdirSync(new URL("../docs-static/api/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => "/docs/api/" + f.slice(0, -5));
for (const p of [...docs, ...api]) await check(p, { contains: ["Delivrie Docs", "data-prerender", '"TechArticle"'] });
for (const p of ["/docs/changelog", "/login", "/signup", "/emails", "/admin", "/settings"]) await check(p, { contains: ['<div id="app">', "noindex"] });

// ---------------------------------------------------------------- files
await check("/sitemap.xml", { contains: ["<urlset", "/resend-alternative"], type: "xml" });
await check("/robots.txt", { contains: ["Sitemap: https://delivrie.io/sitemap.xml"] });
await check("/changelog.xml", { contains: ["<rss"] });
for (const p of ["/styles.css", "/site.js", "/site-config.js", "/pricing.js", "/script.js", "/app/js/main.js", "/app/css/app.css", "/app/js/lib/chat.js",
  "/assets/logo.svg", "/assets/mark.svg", "/assets/favicon.svg", "/assets/og-image.jpg", "/assets/delivrie-icon.png", "/assets/compare/resend.png", "/assets/compare/brevo.png", "/site.webmanifest"]) await check(p);
// internal files must not be downloadable
for (const p of ["/smtp/fly.toml", "/smtp/server.mjs", "/tools/build_site.py", "/integrations/chatgpt-plugin/plugin.json", "/server.json", "/supabase/functions/delivrie/index.ts", "/.github/workflows/deploy-smtp.yml"]) await check(p, { status: 404 });
// redirects
await check("/vs/resend", { status: [301, 308] });

// ---------------------------------------------------------------- API, OAuth, MCP
const st = await check("/api/public/status", { type: "json" });
if (st?.text) { try { const j = JSON.parse(st.text); if (j.status !== "operational") failures.push(`/api/public/status: status is ${j.status}`); } catch { failures.push("/api/public/status: not JSON"); } }
await check("/api/public/site", { type: "json", contains: ['"pages"'] });
await check("/.well-known/oauth-authorization-server", { contains: ["authorization_endpoint", "code_challenge_methods_supported"] });
await check("/.well-known/oauth-protected-resource", { contains: ["authorization_servers"] });
await check("/.well-known/openai-apps-challenge", { status: [200, 404] });
await check("/api/emails", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, status: 401, contains: ["missing_api_key"] });
await check("/api/emails", { method: "POST", body: "{}", headers: { "content-type": "application/json", authorization: "Bearer dlv_live_not_a_real_key_000" }, status: 401, contains: ["invalid_api_key"] });
const mcp = await check("/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, status: 401 });
if (mcp?.res && !/resource_metadata/.test(mcp.res.headers.get("www-authenticate") || "")) failures.push("/api/mcp: 401 without a www-authenticate resource_metadata header");
await check("/api/public/sales-lead", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, status: 400 });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("\nFailures:\n- " + failures.join("\n- ")); process.exit(1); }

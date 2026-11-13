#!/usr/bin/env python3
"""Search-engine files and tags. Run from the repo root after tools/build_site.py:  python3 tools/build_seo.py

- index.html / pricing.html: titles, descriptions and structured data (JSON-LD)
- compare.html: the Pricing page opened on Compare, with its own title and canonical URL (/compare)
- docs-static/: every docs page pre-rendered with its own title, description and text, so search engines
  don't depend on running the app's JavaScript (the app still takes over in the browser)
- sitemap.xml and robots.txt (middleware.js drops switched-off pages from the sitemap at request time)
- vercel.json: routes for /compare and the pre-rendered docs
"""
import html, json, os, re, subprocess, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://delivrie.io"
E = html.escape
TODAY = date.today().isoformat()

def rd(p): return open(os.path.join(ROOT, p), encoding="utf-8").read()
def wr(p, s):
    full = os.path.join(ROOT, p); os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8").write(s)

def ld(*items):
    return '<script type="application/ld+json" data-seo>' + json.dumps({"@context": "https://schema.org", "@graph": list(items)}, ensure_ascii=False).replace("</", "<\\/") + "</script>"

ORG = {"@type": "Organization", "@id": f"{SITE}/#org", "name": "Delivrie", "legalName": "South Circle", "url": SITE,
       "logo": f"{SITE}/assets/delivrie-icon.png", "email": "support@delivrie.io",
       "address": {"@type": "PostalAddress", "addressLocality": "Lagos", "addressCountry": "NG"}}

def pricing_data():
    js = rd("pricing.js")
    ngn = re.search(r"NGN: \{ sym: '₦', pro: (\d+), scale: (\d+)", js); usd = re.search(r"USD: \{ sym: '\$', pro: (\d+), scale: (\d+)", js)
    faq = re.findall(r"\['([^']+\?)', '((?:[^'\\]|\\.)*)'\]", js[js.index("var FAQ"):js.index("function faq")])
    return {"ngn": (int(ngn[1]), int(ngn[2])), "usd": (int(usd[1]), int(usd[2])), "faq": [(q, a.replace("\\'", "'")) for q, a in faq]}

def app_ld(pd):
    offers = [{"@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "NGN", "description": "6,000 emails a month, 200 a day"}]
    for cur, (pro, scale) in (("NGN", pd["ngn"]), ("USD", pd["usd"])):
        offers += [{"@type": "Offer", "name": "Pro", "price": str(pro), "priceCurrency": cur, "description": "20,000 emails a month",
                    "priceSpecification": {"@type": "UnitPriceSpecification", "price": str(pro), "priceCurrency": cur, "unitCode": "MON"}},
                   {"@type": "Offer", "name": "Scale", "price": str(scale), "priceCurrency": cur, "description": "100,000 emails a month",
                    "priceSpecification": {"@type": "UnitPriceSpecification", "price": str(scale), "priceCurrency": cur, "unitCode": "MON"}}]
    return {"@type": "SoftwareApplication", "@id": f"{SITE}/#app", "name": "Delivrie", "applicationCategory": "DeveloperApplication",
            "operatingSystem": "Web", "url": SITE, "publisher": {"@id": f"{SITE}/#org"},
            "description": "Email API, SMTP relay and MCP server for transactional email, newsletters, automations and a shared inbox, priced in Naira and dollars.",
            "offers": offers}

def set_head(s, title=None, desc=None, canonical=None, extra_ld=None):
    if title:
        s = re.sub(r"<title>.*?</title>", f"<title>{E(title)}</title>", s, count=1)
        s = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m[1] + E(title), s, count=1)
    if desc:
        s = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m[1] + E(desc), s, count=1)
        s = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m[1] + E(desc), s, count=1)
    if canonical:
        s = re.sub(r'(<link rel="canonical" href=")[^"]*', lambda m: m[1] + canonical, s, count=1)
        s = re.sub(r'(<meta property="og:url" content=")[^"]*', lambda m: m[1] + canonical, s, count=1)
    s = re.sub(r'\s*<script type="application/ld\+json" data-seo>.*?</script>', "", s, flags=re.S)
    if extra_ld: s = s.replace("</head>", "  " + extra_ld + "\n</head>", 1)
    return s

def crumbs(*pairs):
    return {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(pairs)]}

# ---------------------------------------------------------------- home, pricing, compare
def marketing():
    pd = pricing_data()
    home = rd("index.html")
    home = set_head(home, title="Delivrie: the Resend alternative at half the price · Email API, SMTP & MCP",
                    desc="A cheaper Resend alternative: email API, SMTP relay and MCP server for transactional email, broadcasts and an inbox. 6,000 free emails a month, Pro from $10 (₦10,000).",
                    extra_ld=ld(ORG, {"@type": "WebSite", "@id": f"{SITE}/#site", "url": SITE, "name": "Delivrie", "publisher": {"@id": f"{SITE}/#org"}}, app_ld(pd)))
    wr("index.html", home)

    faq = {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in pd["faq"]]}
    pr = rd("pricing.html")
    pricing = set_head(pr, title="Pricing: free email API, Pro from $10 a month · Delivrie",
                       desc=f"Delivrie pricing: 6,000 free emails a month, Pro ${pd['usd'][0]} (₦{pd['ngn'][0]:,}) and Scale ${pd['usd'][1]} (₦{pd['ngn'][1]:,}). Half the price of Resend, with API, SMTP and MCP on every plan.",
                       canonical=f"{SITE}/pricing", extra_ld=ld(app_ld(pd), faq, crumbs(("Home", "/"), ("Pricing", "/pricing"))))
    wr("pricing.html", pricing)
    compare = set_head(pricing, title="Resend vs Brevo vs Delivrie: email API pricing compared (2026)",
                       desc="Resend vs Brevo vs Delivrie side by side in dollars or Naira: price at 20,000 and 100,000 emails, free plans, overage, SMTP, branding and MCP. Find the cheapest Resend alternative.",
                       canonical=f"{SITE}/compare", extra_ld=ld(crumbs(("Home", "/"), ("Pricing", "/pricing"), ("Compare", "/compare"))))
    compare = compare.replace('<button role="tab" data-view="plans" class="on">', '<button role="tab" data-view="plans">').replace('<button role="tab" data-view="compare">', '<button role="tab" data-view="compare" class="on">', 1)
    compare = "<!-- Generated by tools/build_seo.py from pricing.html. Edit pricing.html, then rebuild. -->\n" + compare
    wr("compare.html", compare)

# ---------------------------------------------------------------- docs
def docs_data():
    js = r"""
    const [{ DOCS }, { ALL_ENDPOINTS }] = await Promise.all([import('./app/js/lib/docs.js'), import('./app/js/lib/apiref.js')]);
    const src = (await import('fs')).readFileSync('./app/js/pages/docs.js', 'utf8');
    const guides = eval(src.slice(src.indexOf('const GUIDES = ') + 15, src.indexOf('];', src.indexOf('const GUIDES = ')) + 1));
    console.log(JSON.stringify({ DOCS, ALL_ENDPOINTS, guides }));
    """
    out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def para(text):
    out = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [l for l in block.split("\n") if l.strip()]
        out.append("<p>" + "<br>".join(E(l) for l in lines) + "</p>")
    return "".join(out)

def short(text, n=155):
    t = re.sub(r"\s+", " ", text).strip()
    if len(t) <= n: return t
    cut = t[:n].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"

def docs():
    d = docs_data()
    shell = rd("app.html").replace('\n  <meta name="robots" content="noindex">', "")
    pages = []   # (slug_path, title, desc, body_html, crumbs)
    nav = "".join(f'<li><a href="/docs/{gid}">{E(name)}</a></li>' for _, items in d["guides"] for gid, name in items)
    api_nav = "".join(f'<li><a href="/docs/api/{e["slug"]}">{E(e["title"])}</a></li>' for e in d["ALL_ENDPOINTS"])
    by_id = {x["id"]: x for x in d["DOCS"]}
    for _, items in d["guides"]:
        for gid, name in items:
            g = by_id.get(gid)
            if not g: continue
            pages.append((f"/docs/{gid}" if gid != "getting-started" else "/docs", g["title"], short(g["body"]), f"<h1>{E(g['title'])}</h1>{para(g['body'])}", [("Docs", "/docs"), (g["title"], f"/docs/{gid}")]))
    for gid, g in by_id.items():
        if not any(gid == x for _, items in d["guides"] for x, _ in items) and gid not in ("getting-started",):
            pages.append((f"/docs/{gid}", g["title"], short(g["body"]), f"<h1>{E(g['title'])}</h1>{para(g['body'])}", [("Docs", "/docs"), (g["title"], f"/docs/{gid}")]))
    pages.append(("/docs/mcp", "MCP server", "Connect Claude, ChatGPT, Cursor, Codex, Antigravity or VS Code to Delivrie with the remote MCP server at https://delivrie.io/api/mcp: 64 tools, OAuth sign-in and scoped access.",
                  "<h1>Delivrie MCP server</h1><p>Server URL: <code>https://delivrie.io/api/mcp</code> (streamable HTTP). Sign in with OAuth or use an API key. 64 tools for sending email, broadcasts, automations, contacts, domains, metrics and inbox replies.</p>", [("Docs", "/docs"), ("MCP server", "/docs/mcp")]))
    pages.append(("/docs/api", "API reference", f"The Delivrie REST API: {len(d['ALL_ENDPOINTS'])} endpoints for emails, domains, contacts, broadcasts, templates, webhooks and more, with request and response examples.",
                  "<h1>API reference</h1><p>Base URL <code>https://delivrie.io/api</code>. Authenticate with <code>Authorization: Bearer dlv_…</code>.</p><ul>" + api_nav + "</ul>", [("Docs", "/docs"), ("API reference", "/docs/api")]))
    for e in d["ALL_ENDPOINTS"]:
        fields = "".join(f"<tr><td><code>{E(str(f[0]))}</code></td><td>{E(str(f[1]))}</td><td>{'required' if len(f) > 2 and f[2] else ''}</td><td>{E(str(f[3]) if len(f) > 3 else '')}</td></tr>" for f in (e.get("body") or []) if isinstance(f, list))
        body = f"<h1>{E(e['title'])}</h1><p><code>{E(e['m'])} {E(e['path'])}</code></p><p>{E(e.get('desc', ''))}</p>" + (f"<table><thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead><tbody>{fields}</tbody></table>" if fields else "")
        pages.append((f"/docs/api/{e['slug']}", f"{e['title']} API", short(f"{e['m']} {e['path']}: {e.get('desc', '')}"), body, [("Docs", "/docs"), ("API reference", "/docs/api"), (e["title"], f"/docs/api/{e['slug']}")]))

    seen, uniq = set(), []
    for pg in pages:
        if pg[0] not in seen: seen.add(pg[0]); uniq.append(pg)
    pages = uniq
    out_dir = os.path.join(ROOT, "docs-static")
    if os.path.isdir(out_dir):
        for dp, _, fs in os.walk(out_dir):
            for f in fs: os.remove(os.path.join(dp, f))
    style = "max-width:760px;margin:0 auto;padding:56px 24px;font:15px/1.65 Inter,system-ui,sans-serif;color:#d0d6e0"
    for path, title, desc, body, cr in pages:
        full_title = f"{title} · Delivrie Docs"
        doc = set_head(shell, title=full_title, desc=desc)
        canon = SITE + path
        doc = doc.replace('<meta property="og:title"', f'<link rel="canonical" href="{canon}">\n  <meta property="og:url" content="{canon}">\n  <meta property="og:title"', 1)
        tech = {"@type": "TechArticle", "headline": title, "description": desc, "url": canon, "publisher": {"@id": f"{SITE}/#org"}, "dateModified": TODAY}
        doc = doc.replace("</head>", "  " + ld(tech, crumbs(("Home", "/"), *cr), ORG) + "\n</head>", 1)
        pre = f'<div data-prerender style="{style}"><nav aria-label="Breadcrumb"><a href="/docs">Docs</a></nav>{body}<h2>More guides</h2><ul>{nav}</ul></div>'
        doc = re.sub(r'<div id="app">.*?</div></div>', lambda m: f'<div id="app">{pre}</div>', doc, count=1, flags=re.S)
        rel = "index" if path == "/docs" else path[len("/docs/"):]
        wr(f"docs-static/{rel}.html", doc)
        if path == "/docs": wr("docs-static/getting-started.html", doc)  # same guide; canonical stays /docs
    return [p[0] for p in pages]

# ---------------------------------------------------------------- routes, sitemap, robots
def routes(doc_paths):
    vj = json.load(open(os.path.join(ROOT, "vercel.json")))
    # routes this script owns are recognised by their destination, so re-running replaces them
    owned = lambda r: r["destination"].startswith(("/compare.html", "/docs-static/")) or (r["source"] in ("/compare", "/vs/resend", "/vs/brevo"))
    rw = [r for r in vj["rewrites"] if not owned(r)]
    guide = sorted({p[len("/docs/"):] for p in doc_paths if p.count("/") == 2 and p != "/docs/api"} | {"getting-started"})
    api = sorted(p[len("/docs/api/"):] for p in doc_paths if p.startswith("/docs/api/"))
    vj["rewrites"] = [
        {"source": "/compare", "destination": "/compare.html"},
        {"source": "/docs", "destination": "/docs-static/index.html"},
        {"source": "/docs/api", "destination": "/docs-static/api.html"},
        {"source": f"/docs/api/:slug({'|'.join(api)})", "destination": "/docs-static/api/:slug.html"},
        {"source": f"/docs/:slug({'|'.join(guide)})", "destination": "/docs-static/:slug.html"},
    ] + rw
    json.dump(vj, open(os.path.join(ROOT, "vercel.json"), "w"), indent=2); open(os.path.join(ROOT, "vercel.json"), "a").write("\n")

def sitemap(doc_paths):
    pages = [("/", "1.0", "weekly"), ("/pricing", "0.9", "weekly"), ("/compare", "0.9", "monthly")]
    hi = ("resend-alternative", "brevo-alternative")
    for f in sorted(os.listdir(os.path.join(ROOT, "pages"))):
        if f.endswith(".html"): pages.append(("/" + f[:-5], "0.9" if f[:-5] in hi else "0.5" if f[:-5] in ("terms", "privacy", "dpa", "cookies", "subprocessors", "acceptable-use") else "0.7", "monthly"))
    for f in sorted(os.listdir(os.path.join(ROOT, "pages", "blog"))):
        if f.endswith(".html"): pages.append(("/blog/" + f[:-5], "0.7", "yearly"))
    for p in doc_paths: pages.append((p, "0.8" if p.count("/") <= 2 else "0.6", "monthly"))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p, pri, freq in pages:
        xml.append(f"  <url><loc>{SITE}{'' if p == '/' else p}</loc><lastmod>{TODAY}</lastmod><changefreq>{freq}</changefreq><priority>{pri}</priority></url>")
    xml.append("</urlset>")
    wr("sitemap.xml", "\n".join(xml) + "\n")
    wr("robots.txt", "\n".join([
        "User-agent: *", "Allow: /",
        # the dashboard and API aren't for search results
        *[f"Disallow: /{p}" for p in ("api/", "admin", "emails", "broadcasts", "templates", "contacts", "segments", "metrics", "logs", "domains",
                                      "api-keys", "webhooks", "suppressions", "billing", "settings", "profile", "inbox", "automations", "events",
                                      "onboarding", "share/", "unsubscribe", "invite", "oauth", "reset", "confirm", "verify", "mfa", "new-team")],
        "", f"Sitemap: {SITE}/sitemap.xml", ""]))
    return len(pages)

def noindex_app():
    # The app shell (dashboard, sign-in) stays out of search results; docs-static pages are built without this tag.
    s = rd("app.html")
    if 'name="robots"' not in s:
        s = s.replace('<meta name="theme-color" content="#211f20">', '<meta name="theme-color" content="#211f20">\n  <meta name="robots" content="noindex">', 1)
        wr("app.html", s)

if __name__ == "__main__":
    noindex_app()
    marketing()
    paths = docs()
    routes(paths)
    n = sitemap(paths)
    print(f"seo: {len(paths)} docs pages, {n} sitemap URLs")

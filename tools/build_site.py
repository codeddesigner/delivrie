#!/usr/bin/env python3
"""Builds the static Company, Legal and Resources pages into /pages and the 404 page.
Run from the repo root: python3 tools/build_site.py  (also refreshes the nav and footer in index.html and pricing.html)."""
import html, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from site_content import LEGAL, CHANGELOG, POSTS, UPDATED, EFFECTIVE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = html.escape

NAV = """<header class="nav">
  <div class="wrap">
    <a class="logo" href="/" aria-label="Delivrie home"><img src="/assets/logo.svg" width="118" height="22" alt="Delivrie"></a>
    <nav class="nav-links" aria-label="Main">
      <a class="nav-link" href="/#integrate">Product</a>
      <a class="nav-link" href="/docs">Docs</a>
      <a class="nav-link" href="/pricing">Pricing</a>
      <a class="nav-link opt" href="/customers">Customers</a>
      <a class="nav-link opt" href="/changelog">Changelog</a>
      <a class="nav-link opt" href="/blog">Blog</a>
    </nav>
    <div class="spacer"></div>
    <a class="nav-link keep" href="/login">Log in</a>
    <a class="btn-signup" href="/signup">Get started</a>
  </div>
</header>"""

FOOTER = """<footer class="footer">
  <div class="wrap">
    <div class="brand"><img src="/assets/footer-mark.svg" width="27" height="19" alt="Delivrie"></div>
    <nav class="fcol"><h4>Product</h4><a href="/signup">Emails</a><a href="/signup">Broadcasts</a><a href="/signup">Templates</a><a href="/pricing">Pricing</a><a href="/changelog">Changelog</a></nav>
    <nav class="fcol"><h4>Developers</h4><a href="/docs">Docs</a><a href="/docs/api">API reference</a><a href="/docs/mcp">MCP server</a><a href="/status">Status</a></nav>
    <nav class="fcol"><h4>Company</h4><a href="/about">About</a><a href="/customers">Customers</a><a href="/careers">Careers</a><a href="/brand">Brand</a><a href="/contact-sales">Contact sales</a></nav>
    <nav class="fcol"><h4>Legal</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/dpa">DPA</a><a href="/acceptable-use">Acceptable use</a><a href="/security">Security</a></nav>
  </div>
  <div class="wrap fbottom"><span>© 2026 South Circle · Lagos · delivrie.io</span><span class="grow"></span><a class="sys" href="/status" id="sys"><i></i><span>All systems operational</span></a></div>
</footer>"""

CTA = """<section class="cta">
    <div class="wrap reveal">
      <img class="cta-mark" src="/assets/mark.svg" width="72" height="51" alt="">
      <h2>Email for builders.<br> Ready when you are.</h2>
      <p>3,000 free emails every month. No card required.</p>
      <div class="btn-row"><a class="b-primary" href="/signup">Start for free</a><a class="b-secondary" href="/contact-sales">Talk to sales</a></div>
    </div>
  </section>"""

ICON = {
  "check": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5L9.5 17L19 7.5"/></svg>',
  "spark": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/></svg>',
  "info": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  "mail": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  "print": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
  "zap": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 3L4.5 13.5H12L11 21L19.5 10.5H12L13 3Z"/></svg>',
  "shield": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>',
  "globe": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/></svg>',
  "users": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5a3 3 0 0 1 0 6M20.5 19a5 5 0 0 0-3.5-4.8"/></svg>',
  "code": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  "download": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
}

def page(path, title, desc, body, extra_script=""):
    canonical = "https://delivrie.io" + ("" if path == "/" else path)
    doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{E(title)} · Delivrie</title>
  <meta name="description" content="{E(desc)}">
  <meta name="theme-color" content="#211f20">
  <meta property="og:type" content="website"><meta property="og:site_name" content="Delivrie"><meta property="og:url" content="{canonical}">
  <meta property="og:title" content="{E(title)} · Delivrie"><meta property="og:description" content="{E(desc)}"><meta property="og:image" content="https://delivrie.io/assets/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="{canonical}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Delivrie changelog" href="/changelog.xml">
  <style>.nav .logo img{{width:118px;height:22px}}.footer .brand img{{width:27px;height:19px}}.cta-mark{{width:72px;height:51px}}</style>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <script>document.documentElement.classList.add("js")</script>
</head>
<body>

{NAV}

<main class="site">
{body}
</main>

{FOOTER}

<script src="/site.js"></script>{extra_script}
</body>
</html>
"""
    out = os.path.join(ROOT, path.strip("/") + ".html") if path != "/404" else os.path.join(ROOT, "404.html")
    if path.startswith("/") and path != "/404":
        out = os.path.join(ROOT, "pages", path.strip("/") + ".html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write(doc)
    return out

def eyebrow(t):
    return f'<span class="eyebrow"><i></i>{E(t)}</span>'

def rich(t):
    # allow the small set of inline links used in the copy; everything else is plain text
    return t if "<a " in t else E(t).replace("“", "“")

def table(rows):
    head, *body = rows
    return '<div class="lg-table"><table><thead><tr>' + "".join(f"<th>{E(h)}</th>" for h in head) + "</tr></thead><tbody>" + "".join("<tr>" + "".join(f"<td>{E(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table></div>"

def block(b):
    if isinstance(b, str): return f"<p>{rich(b)}</p>"
    if isinstance(b, list): return '<ul class="lg-list">' + "".join(f"<li>{rich(i)}</li>" for i in b) + "</ul>"
    if "table" in b: return table(b["table"])
    if "note" in b: return f'<div class="lg-note">{ICON["info"]}<span>{rich(b["note"])}</span></div>'
    return ""

# ---------------------------------------------------------------- legal
def legal(doc):
    tabs = "".join(f'<a href="/{d["slug"]}" class="{"on" if d is doc else ""}">{E(d["nav"])}</a>' for d in LEGAL)
    secs = doc["sections"]
    toc = "".join(f'<a href="#s{i+1}" data-toc="s{i+1}"><span class="n">{i+1:02d}</span>{E(t)}</a>' for i, (t, _) in enumerate(secs))
    short = ""
    if doc.get("short"):
        short = f'<div class="lg-short">{"".join("")}<div class="h">{ICON["spark"]} The short version</div><ul>' + "".join(f"<li>{ICON['check']}{E(s)}</li>" for s in doc["short"]) + '</ul><p class="dim">This summary is for convenience. The full text below is what applies.</p></div>'
    glance = ""
    if doc.get("glance"):
        glance = '<div class="lg-glance">' + "".join(f"<div><b>{E(a)}</b><span>{E(b)}</span></div>" for a, b in doc["glance"]) + "</div>"
    body = "".join(f'<section id="s{i+1}" class="lg-sec"><h2><span class="n">{i+1:02d}</span>{E(t)}</h2>{"".join(block(b) for b in blocks)}</section>' for i, (t, blocks) in enumerate(secs))
    contact = {"security": "security@delivrie.io", "privacy": "privacy@delivrie.io", "acceptable-use": "abuse@delivrie.io"}.get(doc["slug"], "legal@delivrie.io")
    html_ = f"""  <section class="lg-head"><div class="wrap">
    <div class="crumb"><a href="/terms">Legal</a> › <span>{E(doc["nav"])}</span></div>
    <h1>{E(doc["title"])}</h1>
    <p class="lede">{E(doc["lede"])}</p>
    <div class="lg-meta"><span><em>Last updated</em> {UPDATED}</span><span><em>Effective</em> {EFFECTIVE}</span><span class="grow"></span><button class="b-ghost sm" onclick="print()">{ICON["print"]} Print or save as PDF</button></div>
    <nav class="lg-tabs">{tabs}</nav>
  </div></section>
  <section class="lg-body"><div class="wrap lg-grid">
    <aside class="lg-toc"><div class="h">On this page</div>{toc}</aside>
    <article class="lg-art">{short}{glance}{body}
      <div class="lg-q">{ICON["mail"]}<div><b>Questions about this policy?</b><span>Email <a href="mailto:{contact}">{contact}</a> or write to South Circle, Lagos, Nigeria.</span></div><a class="b-ghost sm" href="mailto:{contact}">Contact us</a></div>
    </article>
  </div></section>"""
    return page("/" + doc["slug"], doc["title"], doc["lede"], html_)

# ---------------------------------------------------------------- company
def hero(eb, h1, lede, buttons, center=False):
    b = "".join(f'<a class="{c}" href="{h}">{E(t)}</a>' for t, h, c in buttons)
    return f'<section class="s-hero{" center" if center else ""}"><div class="wrap reveal in">{eyebrow(eb)}<h1>{h1}</h1><p class="lede">{E(lede)}</p>{('<div class="btn-row">' + b + '</div>') if b else ""}</div></section>'

def head2(eb, h2, lede=""):
    return f'<div class="section-head reveal"><div>{eyebrow(eb)}<h2>{h2}</h2></div><div class="grow"></div>{f"<p class=lede>{E(lede)}</p>" if lede else ""}</div>'

def cards(items, cols=4):
    return f'<div class="grid{cols} reveal-stagger">' + "".join(f'<article class="fcard"><span class="fic">{ICON.get(i, ICON["spark"])}</span><h3>{E(t)}</h3><p>{E(d)}</p></article>' for i, t, d in items) + "</div>"

def about():
    body = hero("About", "Email infrastructure,<br> built for builders.", "Delivrie is built in Lagos by South Circle, because sending a receipt should not need a deliverability team. Developers, and their agents, ship email with us.", [("Start for free", "/signup", "b-primary"), ("Read the docs", "/docs", "b-secondary")])
    body += """<section class="section"><div class="wrap"><div class="stats reveal-stagger">
      <div><b>3,000</b><span>free emails every month</span></div><div><b>₦ and $</b><span>pricing in your currency</span></div><div><b>24</b><span>MCP tools for AI agents</span></div><div><b>1 call</b><span>to send an email</span></div></div></div></section>"""
    body += f"""<section class="section"><div class="wrap split-2">
      <div class="reveal">{eyebrow("Our story")}<h2 class="h2">Why we built it</h2></div>
      <div class="prose reveal"><p>Teams across Africa kept hitting the same wall: emails that never arrived, dashboards that hid the reason, and pricing in dollars that punished growth.</p>
      <p>So we built the email platform we wanted. A clean API, honest logs, templates and an MCP server for agents, priced in Naira with dollars for everyone else.</p>
      <p>We are a small team in Lagos, and we answer support ourselves.</p></div></div></section>"""
    body += f'<section class="section"><div class="wrap">{head2("How we work", "What we care about")}' + cards([("zap", "Fast by default", "We treat latency as a bug, from the API to the dashboard."), ("info", "Nothing hidden", "Every bounce, block and webhook attempt is visible, with the reason."), ("code", "Developers first", "Docs and errors written for the person debugging at 2am."), ("shield", "Earn the inbox", "We say no to spam so your email keeps landing.")]) + "</div></section>"
    body += CTA
    return page("/about", "About", "Delivrie is email infrastructure for builders, made in Lagos by South Circle.", body)

def customers():
    body = hero("Customers", "Built for the emails<br> that matter.", "Receipts, one-time passwords, shipping updates and launches. Here is what teams send with Delivrie.", [("Talk to sales", "/contact-sales", "b-secondary"), ("Start for free", "/signup", "b-primary")])
    body += f'<section class="section"><div class="wrap">{head2("Use cases", "What teams send", "One API and one dashboard for every kind of email your product sends.")}' + cards([
        ("zap", "Commerce", "Order confirmations, receipts, shipping and refund emails, with logs support can read."),
        ("shield", "Fintech", "One-time passwords and statements on dedicated domains, with bounces suppressed automatically."),
        ("spark", "AI agents", "Agents send onboarding and alerts through the MCP server with sending-only keys."),
        ("users", "Marketing", "Broadcasts to segments with topics, a hosted preference page and one-click unsubscribe."),
        ("code", "SaaS", "Sign-up codes, password resets and invites from templates you version and publish."),
        ("globe", "Agencies", "Separate teams for each client, each with its own domains, keys and billing.")], 3) + "</div></section>"
    body += """<section class="section"><div class="wrap"><div class="story-cta reveal"><div><span class="eyebrow"><i></i>Customer stories</span><h2 class="h2">Your story could be here</h2><p class="lede">We are featuring our first customers. If Delivrie made your email better, we would love to tell your story, with your approval on every word.</p></div><a class="b-primary" href="mailto:hello@delivrie.io?subject=Customer%20story">Share your story</a></div></div></section>"""
    body += CTA
    return page("/customers", "Customers", "What teams send with Delivrie: receipts, OTPs, agent emails and broadcasts.", body)

def careers():
    body = hero("Careers", "Help the internet<br> reach the inbox.", "We are a small team in Lagos building email infrastructure for developers and AI agents.", [("See open roles", "#roles", "b-primary")])
    body += f'<section class="section"><div class="wrap">{head2("How we work", "What working here is like")}' + cards([("globe", "Remote-friendly", "Based in Lagos, working with people wherever they do their best work."), ("info", "Written decisions", "Few meetings, clear docs and real focus time."), ("users", "Small team, real ownership", "You ship things customers use the same week.")], 3) + "</div></section>"
    body += """<section class="section" id="roles"><div class="wrap"><div class="story-cta reveal"><div><span class="eyebrow"><i></i>Open roles</span><h2 class="h2">No open roles right now</h2><p class="lede">We are not hiring for specific roles at the moment. If you would love to build email infrastructure, email jobs@delivrie.io and tell us what you would build.</p></div><a class="b-secondary" href="mailto:jobs@delivrie.io">Email jobs@delivrie.io</a></div></div></section>"""
    body += CTA
    return page("/careers", "Careers", "Work on email infrastructure for developers and AI agents at Delivrie.", body)

def brand():
    def asset(name, src, bg, files):
        links = "".join(f'<a href="{h}" download>{ICON["download"]} {E(l)}</a>' for l, h in files)
        return f'<div class="asset"><div class="prev {bg}"><img src="{src}" alt="{E(name)}"></div><div class="meta"><b>{E(name)}</b><span>{links}</span></div></div>'
    body = hero("Brand", "Brand assets", "Logos, colours and type for press, partners and integrations. Please keep the logo intact and give it room to breathe.", [("Contact press", "mailto:hello@delivrie.io?subject=Press", "b-secondary")])
    body += f"""<section class="section"><div class="wrap">{head2("Logo", "Logo", "Use the wordmark by default. Use the mark when space is tight, and the app icon for avatars and integrations.")}
      <div class="grid3 assets reveal-stagger">{asset("Wordmark", "/assets/brand/wordmark.svg", "dark", [("SVG", "/assets/brand/wordmark.svg")])}{asset("Mark", "/assets/brand/mark.svg", "dark", [("SVG", "/assets/brand/mark.svg")])}{asset("App icon", "/assets/brand/app-icon.svg", "dark", [("SVG", "/assets/brand/app-icon.svg")])}
      {asset("Wordmark on light", "/assets/brand/wordmark-on-light.svg", "light", [("SVG", "/assets/brand/wordmark-on-light.svg")])}{asset("Mark on light", "/assets/brand/mark.svg", "light", [("SVG", "/assets/brand/mark.svg")])}{asset("App icon on light", "/assets/brand/app-icon.svg", "light", [("SVG", "/assets/brand/app-icon.svg")])}</div></div></section>"""
    sw = [("Delivrie Yellow", "#FAD600", "Primary accent and buttons", "#211F20"), ("Ink", "#211F20", "Backgrounds and text on yellow", "#F7F8F8"), ("Paper", "#F7F8F8", "Text on dark, light backgrounds", "#211F20"), ("Graphite", "#62666D", "Secondary text and icons", "#F7F8F8")]
    body += f'<section class="section"><div class="wrap">{head2("Colour", "Colour")}<div class="grid4 reveal-stagger">' + "".join(f'<button class="swatch" data-copy="{h}"><span class="chip" style="background:{h};color:{fg}">{h}</span><b>{E(n)}</b><span>{E(u)}</span></button>' for n, h, u, fg in sw) + "</div></div></section>"
    body += f"""<section class="section"><div class="wrap">{head2("Type", "Typography")}<div class="grid2 reveal-stagger">
      <div class="type-card"><span class="big">Aa</span><b>SF Pro</b><span>Display, headings and UI. Inter is the fallback on the web.</span></div>
      <div class="type-card"><span class="big mono">{{ }}</span><b>Geist Mono</b><span>Code, data and labels</span></div></div></div></section>"""
    body += f"""<section class="section"><div class="wrap">{head2("Usage", "Do and don’t")}<div class="grid2 reveal-stagger">
      <div class="do"><h3>Do</h3><ul><li>Use the logo on Ink or Paper backgrounds</li><li>Keep clear space equal to the height of the mark</li><li>Write the name as Delivrie, capital D</li></ul></div>
      <div class="dont"><h3>Don’t</h3><ul><li>Stretch, rotate, outline or recolour the logo</li><li>Place it on busy photos or low-contrast yellow</li><li>Combine it with another logo into a new mark</li></ul></div></div></div></section>"""
    return page("/brand", "Brand", "Delivrie logos, colours and typography for press and partners.", body)

# ---------------------------------------------------------------- resources
def changelog():
    items = "".join(f'<section class="cl-item reveal"><div class="cl-date">{E(d)}</div><div class="cl-body"><h2>{E(t)}</h2><div class="cl-tags">{"".join(f"<span>{E(x)}</span>" for x in tags)}</div><ul>{"".join(f"<li>{E(i)}</li>" for i in lis)}</ul></div></section>' for d, t, tags, lis in CHANGELOG)
    body = f"""<section class="s-hero"><div class="wrap reveal in">{eyebrow("Changelog")}<h1>What’s new in Delivrie</h1><div class="btn-row"><a class="b-secondary" href="/changelog.xml">RSS feed</a><a class="b-ghost" href="/docs/changelog">In the docs</a></div></div></section>
  <section class="section cl"><div class="wrap">{items}</div></section>"""
    page("/changelog", "Changelog", "New features and fixes in Delivrie.", body)
    rss = "".join(f"<item><title>{E(t)}</title><link>https://delivrie.io/changelog</link><guid isPermaLink=\"false\">{E(d)}-{E(t)}</guid><description>{E(' '.join(lis))}</description></item>" for d, t, tags, lis in CHANGELOG)
    open(os.path.join(ROOT, "changelog.xml"), "w").write(f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Delivrie changelog</title><link>https://delivrie.io/changelog</link><description>New features and fixes in Delivrie.</description>{rss}</channel></rss>')

def blog():
    cats = ["All"] + sorted({p["cat"] for p in POSTS})
    first, *rest = POSTS
    feat = f'<a class="featured reveal" href="/blog/{first["slug"]}"><div class="art"><img src="/assets/mark.svg" alt=""></div><div><span class="cat">{E(first["cat"])}</span><h2>{E(first["title"])}</h2><p>{E(first["lede"])}</p><span class="by">Delivrie team · {E(first["date"])} · {first["mins"]} min</span></div></a>'
    grid = '<div class="grid3 posts reveal-stagger">' + "".join(f'<a class="post" href="/blog/{p["slug"]}" data-cat="{E(p["cat"])}"><span class="cat">{E(p["cat"])}</span><h3>{E(p["title"])}</h3><p>{E(p["lede"])}</p><span class="by">Delivrie team · {E(p["date"])}</span></a>' for p in rest) + "</div>"
    body = f"""<section class="s-hero"><div class="wrap reveal in">{eyebrow("Blog")}<h1>Notes on email,<br> infrastructure and agents</h1><div class="cats">{"".join(f'<button class="{"on" if c == "All" else ""}" data-cat="{E(c)}">{E(c)}</button>' for c in cats)}</div></div></section>
  <section class="section blog"><div class="wrap">{feat}{grid}</div></section>
  {CTA}"""
    page("/blog", "Blog", "Notes on email, infrastructure and agents from the Delivrie team.", body)
    for p in POSTS:
        content = ""
        for kind, text in p["body"]:
            content += f"<h2>{E(text)}</h2>" if kind == "h" else f'<pre class="post-code"><code>{E(text)}</code></pre>' if kind == "code" else f"<p>{rich(text)}</p>"
        others = [o for o in POSTS if o is not p]
        more = "".join(f'<a class="post" href="/blog/{o["slug"]}"><span class="cat">{E(o["cat"])}</span><h3>{E(o["title"])}</h3><span class="by">{E(o["date"])}</span></a>' for o in others)
        body = f"""<article class="post-page"><div class="wrap narrow reveal in">
    <div class="crumb"><a href="/blog">Blog</a> › <span>{E(p["cat"])}</span></div>
    <h1>{E(p["title"])}</h1><p class="lede">{E(p["lede"])}</p>
    <div class="author"><img src="/assets/brand/app-icon.svg" width="32" height="32" alt=""><div><b>Delivrie team</b><span>{E(p["date"])} · {p["mins"]} min read</span></div></div>
    <div class="post-body">{content}</div>
    <h3 class="keep-h">Keep reading</h3><div class="grid2 posts">{more}</div>
  </div></article>
  {CTA}"""
        page(f"/blog/{p['slug']}", p["title"], p["lede"], body)

def status():
    comps = ["API", "Email delivery", "Webhooks", "Dashboard", "MCP server"]
    rows = "".join(f'<div class="st-row" data-comp="{E(c)}"><b>{E(c)}</b><span class="grow"></span><span class="st-pill" data-state>Checking…</span></div>' for c in comps)
    body = f"""<section class="s-hero"><div class="wrap narrow reveal in"><h1>System status</h1>
    <div class="st-banner" id="st-banner"><i></i><div><b>Checking systems…</b><span id="st-time" class="dim"></span></div></div>
    <div class="st-list">{rows}</div>
    <h2 class="h2 sm">Past incidents</h2><p class="dim">No incidents have been reported. If something looks wrong, email <a href="mailto:support@delivrie.io">support@delivrie.io</a>.</p>
  </div></section>"""
    page("/status", "Status", "Live status of the Delivrie API, email delivery, webhooks, dashboard and MCP server.", body)

def contact_sales():
    feats = [("zap", "Volume pricing", "Discounts from 1M emails a month, billed in Naira or dollars."), ("shield", "Security review", "Our DPA, security answers and a call with the team."), ("globe", "Dedicated IPs", "Warm-up plans and help with deliverability."), ("users", "Migration help", "We help you move templates, contacts and suppressions.")]
    fl = "".join(f'<div class="cs-f"><span class="fic">{ICON[i]}</span><div><b>{E(t)}</b><span>{E(d)}</span></div></div>' for i, t, d in feats)
    body = f"""<section class="cs"><div class="wrap cs-grid">
    <div class="reveal in">{eyebrow("Sales")}<h1>Talk to our team</h1><p class="lede">High volume, dedicated IPs or a custom contract? Tell us what you are sending and we will reply within one business day.</p>{fl}</div>
    <form class="cs-form reveal in" id="sales-form" novalidate>
      <div class="two"><label>First name<input name="first_name" required maxlength="80" autocomplete="given-name"></label><label>Last name<input name="last_name" required maxlength="80" autocomplete="family-name"></label></div>
      <label>Work email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>Company<input name="company" required maxlength="120" autocomplete="organization"></label>
      <label>Monthly email volume<select name="volume"><option>Under 100k</option><option>100k – 1M</option><option selected>1M – 5M</option><option>5M+</option></select></label>
      <label>Country<select name="country"><option>Nigeria</option><option>Ghana</option><option>Kenya</option><option>South Africa</option><option>United States</option><option>United Kingdom</option><option>Other</option></select></label>
      <label>How can we help?<textarea name="message" rows="4" maxlength="4000" placeholder="We send OTPs and statements and want dedicated IPs…"></textarea></label>
      <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="b-primary" type="submit">Contact sales</button>
      <p class="dim small">By submitting you agree to our <a href="/privacy">Privacy Policy</a>. We reply within one business day.</p>
      <div class="cs-done" hidden><b>Thanks, we got it.</b><span>We will reply to your work email within one business day.</span></div>
    </form></div></section>"""
    page("/contact-sales", "Contact sales", "Talk to the Delivrie team about volume pricing, dedicated IPs and security reviews.", body)

def not_found():
    body = f"""<section class="nf"><div class="wrap reveal in"><span class="code">404</span><h1>This page bounced</h1><p class="lede">The link may be old or mistyped. Even our best deliverability can’t route this one.</p>
    <div class="btn-row"><a class="b-primary" href="/">Back to home</a><a class="b-secondary" href="/docs">Search docs</a></div>
    <div class="links"><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/status">Status</a><a href="mailto:support@delivrie.io">Contact support</a></div></div></section>"""
    page("/404", "Page not found", "This page doesn’t exist.", body)

def refresh_shell(fname):
    p = os.path.join(ROOT, fname); s = open(p).read()
    s = re.sub(r'<header class="nav">.*?</header>', lambda m: NAV, s, count=1, flags=re.S)
    s = re.sub(r'<footer class="footer">.*?</footer>', lambda m: FOOTER, s, count=1, flags=re.S)
    s = s.replace('href="mailto:sales@delivrie.io?subject=Delivrie%20for%20our%20team"', 'href="/contact-sales"')
    open(p, "w").write(s)

if __name__ == "__main__":
    for d in LEGAL: legal(d)
    about(); customers(); careers(); brand(); changelog(); blog(); status(); contact_sales(); not_found()
    for f in ("index.html", "pricing.html"): refresh_shell(f)
    print("built", sum(len(fs) for _, _, fs in os.walk(os.path.join(ROOT, "pages"))), "pages")

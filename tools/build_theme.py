#!/usr/bin/env python3
"""Theme and brand chrome for every built page. Run last (tools/build_seo.py calls it).

- Light is the default theme; a stored choice (System / Light / Dark, key dlv_theme) is applied before first paint.
- Site footers get the Delivrie lockup and the theme switch (site-config.js wires the buttons).
"""
import glob, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from site_content import CHANGELOG
    LATEST = " ".join(CHANGELOG[0][0].split(",")[0].split()[:2])  # "Nov 13"
except Exception:
    LATEST = ""

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOT = ('<script data-theme-boot>try{var t=localStorage.getItem("dlv_theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";'
        'document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}</script>')
ICONS = {
    "system": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    "light": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    "dark": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
}
SWITCH = ('<div class="theme-sw" role="group" aria-label="Theme">' + "".join(
    f'<button type="button" data-theme-set="{t}" title="{t.title()}" aria-label="{t.title()} theme">{ICONS[t]}</button>' for t in ("system", "light", "dark")) + "</div>")
NAV_TOGGLE = ('<div class="nav-theme" role="group" aria-label="Theme">'
              f'<button type="button" data-theme-set="light" title="Light" aria-label="Light theme">{ICONS["light"]}</button>'
              f'<button type="button" data-theme-set="dark" title="Dark" aria-label="Dark theme">{ICONS["dark"]}</button></div>'
              '<span class="divider" aria-hidden="true"></span>')
def svg(body, size=18):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>'
MI = {
    "mail": '<path d="M19 5H5C3.89543 5 3 5.89543 3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V7C21 5.89543 20.1046 5 19 5Z"/><path d="M3.5 6.5L12 13L20.5 6.5"/>',
    "send": '<path d="M21 3L10.5 13.5M10.5 13.5L3 9.5L21 3L14.5 21L10.5 13.5Z"/>',
    "template": '<path d="M18.5 3.5H5.5C4.39543 3.5 3.5 4.39543 3.5 5.5V18.5C3.5 19.6046 4.39543 20.5 5.5 20.5H18.5C19.6046 20.5 20.5 19.6046 20.5 18.5V5.5C20.5 4.39543 19.6046 3.5 18.5 3.5Z"/><path d="M3.5 9H20.5M9 9V20.5"/>',
    "workflow": '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M7 10.5V14C7 15.66 8.34 17 10 17H13.5"/>',
    "inbox": '<path d="M3.5 13.5L6 5.5H18L20.5 13.5V18.5H3.5V13.5Z"/><path d="M3.5 13.5H8.5L9.5 15.5H14.5L15.5 13.5H20.5"/>',
    "x": '<path d="M6 6L18 18M18 6L6 18"/>',
    "right": '<path d="M9.5 6L15.5 12L9.5 18"/>',
    "down": '<path d="M6 9.5L12 15.5L18 9.5"/>',
    "lines": '<path d="M4 8.5H20M10 15.5H20"/>',
}
PRODUCTS = [("mail", "Emails", "Transactional email over API and SMTP", "/docs/send-email"),
            ("send", "Broadcasts", "Newsletters and launches to segments", "/docs/broadcasts"),
            ("template", "Templates", "React and drag-and-drop editors", "/docs/templates"),
            ("workflow", "Automations", "Event-driven flows, no cron jobs", "/docs"),
            ("inbox", "Inbox", "Receive mail and let agents draft replies", "/docs")]
def badge(t): return f'<span class="mm-badge">{t}</span>'
MOBILE_ACTIONS = ('<button type="button" class="m-theme" data-theme-flip aria-label="Switch between light and dark theme">'
                  f'<span class="i-moon">{svg(MI["x"].replace(MI["x"], ICONS["dark"].split(">",1)[1].rsplit("</svg>",1)[0]), 17)}</span>'
                  f'<span class="i-sun">{svg(ICONS["light"].split(">",1)[1].rsplit("</svg>",1)[0], 17)}</span></button>'
                  f'<button type="button" class="m-menu" aria-expanded="false" aria-controls="mmenu" aria-label="Open menu">{svg(MI["lines"], 18)}</button>')
MOBILE_MENU = ('<!--mmenu--><div class="mmenu" id="mmenu" role="dialog" aria-modal="true" aria-label="Menu" hidden>'
  '<div class="mm-top"><a href="/" aria-label="Delivrie home"><img src="/assets/logo.svg" width="121" height="22" alt="Delivrie"></a>'
  f'<button type="button" class="mm-close" aria-label="Close menu">{svg(MI["x"], 18)}</button></div>'
  '<nav class="mm-body" aria-label="Mobile">'
  f'<div class="mm-group open"><button type="button" class="mm-row mm-toggle" aria-expanded="true"><span>Product</span>{svg(MI["down"], 18)}</button>'
  '<div class="mm-items">' + "".join(f'<a class="mm-item" href="{h}"><span class="mm-tile">{svg(MI[i], 18)}</span><span><b>{t}</b><small>{d}</small></span></a>' for i, t, d, h in PRODUCTS) + '</div></div>'
  f'<a class="mm-row" href="/docs"><span>Docs</span>{svg(MI["right"], 18)}</a>'
  f'<a class="mm-row" href="/pricing"><span>Pricing{badge("₦ &amp; $")}</span>{svg(MI["right"], 18)}</a>'
  f'<a class="mm-row" href="/customers"><span>Customers</span>{svg(MI["right"], 18)}</a>'
  f'<a class="mm-row" href="/changelog"><span>Changelog{badge(LATEST) if LATEST else ""}</span>{svg(MI["right"], 18)}</a>'
  f'<a class="mm-row last" href="/blog"><span>Blog</span>{svg(MI["right"], 18)}</a>'
  '</nav><div class="mm-bottom"><div class="mm-btns"><a class="mm-btn sec" href="/login">Log in</a><a class="mm-btn pri" href="/signup">Get started</a></div>'
  '<div class="mm-meta"><a class="mm-status" href="/status"><i></i><span>All systems operational</span></a>' + SWITCH.replace('class="theme-sw"', 'class="theme-sw pill"') + '</div></div></div><!--/mmenu-->')
BRAND_OLD = re.compile(r'<div class="brand">(?:<a [^>]*>)?<img src="/assets/(?:footer-mark|logo|footer-logo)\.svg"[^>]*>(?:</a>)?</div>')
BRAND_NEW = '<div class="brand"><a href="/" aria-label="Delivrie, by South Circle"><img src="/assets/footer-logo.svg" width="188" height="26" alt="Delivrie by South Circle"></a></div>'

def files():
    out = glob.glob(os.path.join(ROOT, "*.html"))
    for d in ("pages", "docs-static"):
        out += glob.glob(os.path.join(ROOT, d, "**", "*.html"), recursive=True)
    return out

def apply(s):
    s = re.sub(r'\s*<script data-theme-boot>.*?</script>', "", s, flags=re.S)
    s = re.sub(r'\s*<script>try\{var t=localStorage\.getItem\("dlv_theme"\).*?</script>', "", s, flags=re.S)  # older app.html boot
    s = re.sub(r'<meta name="theme-color" content="[^"]*">', '<meta name="theme-color" content="#ffffff">', s)
    s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + BOOT, 1)
    s = BRAND_OLD.sub(BRAND_NEW, s)
    s = re.sub(r'<div class="theme-sw" role="group" aria-label="Theme">.*?</div>(?=<a class="sys")', "", s, flags=re.S)
    s = s.replace('<span class="grow"></span><a class="sys"', '<span class="grow"></span>' + SWITCH + '<a class="sys"')
    s = re.sub(r'<div class="nav-theme" role="group".*?</div><span class="divider" aria-hidden="true"></span>', "", s, flags=re.S)
    s = re.sub(r'(<div class="spacer"></div>\s*)(<a class="nav-link keep" href="/login">)', lambda m: m[1] + NAV_TOGGLE + m[2], s, count=1)
    s = re.sub(r'<button type="button" class="m-theme".*?aria-label="Open menu">.*?</button>', "", s, flags=re.S)
    s = re.sub(r'<!--mmenu-->.*?<!--/mmenu-->', "", s, flags=re.S)
    s = re.sub(r'<div class="mmenu" id="mmenu".*?aria-label="Dark theme">.*?</button></div></div></div></div>(?:</div>)*', "", s, flags=re.S)  # pre-marker builds
    if '<header class="nav">' in s:
        s = re.sub(r'(<a class="btn-signup" href="/signup">[^<]*</a>)', lambda m: m[1] + MOBILE_ACTIONS, s, count=1)
        i = s.index('<header class="nav">'); j = s.index("</header>", i) + len("</header>")
        s = s[:j] + MOBILE_MENU + s[j:]
    return s

def main():
    n = 0
    for p in files():
        s = open(p, encoding="utf-8").read()
        t = apply(s)
        if t != s:
            open(p, "w", encoding="utf-8").write(t); n += 1
    print(f"theme: updated {n} pages")

if __name__ == "__main__":
    main()

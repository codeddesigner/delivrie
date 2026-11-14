#!/usr/bin/env python3
"""Theme and brand chrome for every built page. Run last (tools/build_seo.py calls it).

- Light is the default theme; a stored choice (System / Light / Dark, key dlv_theme) is applied before first paint.
- Site footers get the Delivrie lockup and the theme switch (site-config.js wires the buttons).
"""
import glob, os, re

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
BRAND_OLD = re.compile(r'<div class="brand"><img src="/assets/(?:footer-mark|logo)\.svg"[^>]*></div>')
BRAND_NEW = '<div class="brand"><a href="/" aria-label="Delivrie home"><img src="/assets/logo.svg" width="133" height="24" alt="Delivrie"></a></div>'

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

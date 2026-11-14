// Website settings from the admin area (Admin → Website), applied on every public page:
// announcement bar, links to switched-off pages hidden, and text edits.
// Settings come from /api/public/site and are cached in localStorage so repeat visits apply them instantly.
// The admin page editor loads public pages in an iframe and uses window.DelivrieSite to find editable text.
(function () {
  var API = '/api/public/site', CACHE = 'dlv_site_v1';
  var INLINE = { B: 1, I: 1, EM: 1, STRONG: 1, BR: 1, A: 1, CODE: 1, SPAN: 1, SMALL: 1, SUP: 1, SUB: 1, U: 1, MARK: 1 };
  var EDITABLE = 'h1,h2,h3,h4,h5,h6,p,li,a,button,summary,td,th,label,dt,dd,figcaption,blockquote,span,b,strong,em,small,div';
  var SKIP = 'script,style,svg,noscript,select,option,textarea,input,.dlv-banner,[data-dlv-skip]';
  var editing = /[?&]dlv_edit=1/.test(location.search) && window.parent !== window;
  var cfg = null;

  function pagePath(p) {
    p = (p || location.pathname).replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '').replace(/^\/pages\//, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    if (p === '/compare' || /^\/vs\//.test(p)) p = '/pricing'; // same page, two views
    return p || '/';
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // An editable element holds its own text: it has a non-empty text node of its own and only inline children,
  // and it isn't inside another editable element.
  function isEditable(el) {
    if (el.closest(SKIP)) return false;
    var own = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue.trim()) own = true;
      else if (n.nodeType === 1 && (!INLINE[n.tagName] || n.querySelector('div,p,ul,ol,li,h1,h2,h3,h4,h5,h6,table,section,article,img,svg,button'))) return false;
    }
    return own;
  }
  function candidates(root) {
    var all = Array.prototype.slice.call((root || document.body).querySelectorAll(EDITABLE)).filter(isEditable);
    var set = new Set(all);
    return all.filter(function (el) { for (var p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; });
  }
  // Key = tag + hash of the element's original text + its position among elements with the same text.
  function keyed(root) {
    var seen = {}, out = [];
    candidates(root).forEach(function (el) {
      var orig = el.dataset.dlvOrig != null ? el.dataset.dlvOrig : norm(el.textContent);
      var base = el.tagName.toLowerCase() + ':' + hash(orig);
      seen[base] = (seen[base] || 0) + 1;
      out.push({ el: el, key: base + ':' + seen[base], text: orig });
    });
    return out;
  }

  // Edits are written by admins, but still limited to plain inline formatting.
  function clean(html) {
    var t = document.createElement('template'); t.innerHTML = String(html || '');
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 1) {
          if (!INLINE[c.tagName]) { c.replaceWith(document.createTextNode(c.textContent)); return; }
          Array.prototype.slice.call(c.attributes).forEach(function (a) {
            var ok = (c.tagName === 'A' && a.name === 'href' && !/^\s*javascript:/i.test(a.value)) || a.name === 'class';
            if (!ok) c.removeAttribute(a.name);
          });
          walk(c);
        } else if (c.nodeType !== 3) c.remove();
      });
    })(t.content);
    return t.innerHTML;
  }

  var applying = false;
  function applyEdits() {
    var edits = cfg && cfg.edits && cfg.edits[pagePath()];
    if (!edits) return;
    applying = true;
    keyed().forEach(function (k) {
      var e = edits[k.key];
      if (!e) return;
      if (k.el.dataset.dlvOrig == null) k.el.dataset.dlvOrig = k.text;
      var html = clean(e.html);
      if (k.el.innerHTML !== html) k.el.innerHTML = html;
      if (e.href && k.el.tagName === 'A') k.el.setAttribute('href', e.href);
    });
    applying = false;
  }

  function hideOffLinks() {
    var off = cfg && cfg.pages || {};
    Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function (a) {
      var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
      if (u.origin !== location.origin) return;
      var p = pagePath(u.pathname), slug = p.split('/')[1];
      var isOff = off[p] === false || (slug && off['/' + slug] === false);
      a.style.display = isOff ? 'none' : '';
    });
  }

  // Shown until an announcement is set in Admin → Website (Figma: Landing · Announcement).
  var DEFAULT_BANNER = { on: true, text: 'Automations and Inbox are live.', link: '/changelog', link_text: 'Read the changelog' };
  // One look for every announcement, from the Figma file (Landing · Announcement): an inset, rounded warm bar with a
  // yellow dot, the message in medium weight and a grey link. It follows the light/dark theme. Styles live in styles.css.
  function banner() {
    var b = (cfg && cfg.banner) || DEFAULT_BANNER, old = document.querySelector('.dlv-banner');
    if (window.DLV_V) return; // not on the dashboard or docs app
    if (!b || !b.on || !b.text) { if (old) old.remove(); return; }
    var el = old || document.createElement('div');
    el.className = 'dlv-banner';
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Announcement');
    el.innerHTML = '';
    var dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true'); el.appendChild(dot);
    var t = document.createElement('span'); t.className = 'msg'; t.textContent = String(b.text).trim(); el.appendChild(t);
    if (b.link) {
      var label = String(b.link_text || 'Learn more').replace(/[\s→>»]+$/, '');
      var a = document.createElement('a'); a.href = b.link; a.setAttribute('aria-label', label);
      var lt = document.createElement('span'); lt.className = 'lt'; lt.textContent = label + ' ';
      a.appendChild(lt); a.appendChild(document.createTextNode('→')); el.appendChild(a);
    }
    if (!old) document.body.insertBefore(el, document.body.firstChild);
  }

  function applyAll() {
    if (!cfg) { banner(); return; }
    banner(); hideOffLinks(); applyEdits();
    try { window.dispatchEvent(new CustomEvent('dlv:site', { detail: cfg })); } catch (e) {}
  }

  window.DelivrieSite = { pagePath: pagePath, keyed: keyed, clean: clean, norm: norm, get config() { return cfg; }, set: function (c) { cfg = c; applyAll(); }, apply: applyAll, editing: editing };

  try { var c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c) { cfg = c; applyAll(); } } catch (e) {}
  if (!cfg) banner();
  if (!editing && window.fetch) {
    fetch(API, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (fresh) {
      if (!fresh) return;
      cfg = fresh; try { localStorage.setItem(CACHE, JSON.stringify(fresh)); } catch (e) {}
      applyAll();
    }).catch(function () {});
  }
  // Pages that render parts with JavaScript (pricing cards, the comparison) get edits re-applied after they change.
  if ('MutationObserver' in window) {
    var t = null;
    new MutationObserver(function () { if (applying || editing) return; clearTimeout(t); t = setTimeout(function () { applyEdits(); hideOffLinks(); }, 30); })
      .observe(document.body, { childList: true, subtree: true });
  }
})();

// Theme switches on the site: System / Light / Dark in the footer, Light / Dark in the nav. Same storage key as the dashboard.
(function () {
  if (window.DLV_V) return; // the dashboard and docs app handle their own switch (app/js/lib/theme.js)
  var KEY = "dlv_theme", mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
  function get() { try { return localStorage.getItem(KEY) || "light"; } catch (e) { return "light"; } }
  function apply(t, animate) {
    var root = document.documentElement, r = t === "system" ? (mq && mq.matches ? "dark" : "light") : t;
    if (animate && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      root.classList.add("theme-anim"); setTimeout(function () { root.classList.remove("theme-anim"); }, 350);
    }
    root.setAttribute("data-theme", r);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", r === "dark" ? "#1f1d1e" : "#ffffff");
    // Footer shows the stored choice (including System); the nav shows the theme on screen.
    var b = document.querySelectorAll(".theme-sw [data-theme-set]");
    for (var i = 0; i < b.length; i++) b[i].classList.toggle("on", b[i].getAttribute("data-theme-set") === t);
    var n = document.querySelectorAll(".nav-theme [data-theme-set]");
    for (var j = 0; j < n.length; j++) { var on = n[j].getAttribute("data-theme-set") === r; n[j].classList.toggle("on", on); n[j].setAttribute("aria-pressed", on ? "true" : "false"); }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-theme-set]");
    if (!b) return;
    var t = b.getAttribute("data-theme-set");
    try { localStorage.setItem(KEY, t); } catch (err) {}
    apply(t, true);
  });
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(get()); }); // other tabs
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (get() === "system") apply("system", true); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(get()); }); else apply(get());
})();

// Mobile menu (Figma: Mobile · Menu open) and the mobile light/dark button.
(function () {
  if (window.DLV_V) return;
  function $(s) { return document.querySelector(s); }
  function open(on) {
    var m = $("#mmenu"), b = $(".m-menu"); if (!m) return;
    if (on) {
      var sys = document.getElementById("sys"), st = m.querySelector(".mm-status");
      if (sys && st) { st.querySelector("span").textContent = sys.textContent.trim() || "All systems operational"; st.className = "mm-status " + (sys.className.replace(/\bsys\b/, "").trim()); }
      m.hidden = false; document.documentElement.classList.add("mm-open");
      var c = m.querySelector(".mm-close"); if (c) c.focus();
    } else {
      m.hidden = true; document.documentElement.classList.remove("mm-open");
      if (b) b.focus();
    }
    if (b) b.setAttribute("aria-expanded", on ? "true" : "false");
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    if (t.closest(".m-menu")) { open(true); return; }
    if (t.closest(".mm-close")) { open(false); return; }
    var g = t.closest(".mm-toggle");
    if (g) { var grp = g.parentNode; var on = !grp.classList.contains("open"); grp.classList.toggle("open", on); g.setAttribute("aria-expanded", on ? "true" : "false"); return; }
    if (t.closest(".mmenu a")) { open(false); return; }
    var f = t.closest("[data-theme-flip]");
    if (f) { var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; var btn = document.querySelector('.theme-sw [data-theme-set="' + next + '"]'); if (btn) btn.click(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("#mmenu") && !$("#mmenu").hidden) open(false); });
  window.addEventListener("resize", function () { if (window.innerWidth > 900 && $("#mmenu") && !$("#mmenu").hidden) open(false); });
})();

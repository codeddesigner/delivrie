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

  function banner() {
    var b = cfg && cfg.banner, old = document.querySelector('.dlv-banner');
    if (!b || !b.on || !b.text) { if (old) old.remove(); return; }
    var id = hash(b.text + (b.link || ''));
    try { if (localStorage.getItem('dlv_banner_closed') === id) { if (old) old.remove(); return; } } catch (e) {}
    if (!document.getElementById('dlv-banner-css')) {
      var st = document.createElement('style'); st.id = 'dlv-banner-css';
      st.textContent = '.dlv-banner{position:relative;z-index:60;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 44px;font:500 13.5px/1.4 Inter,system-ui,sans-serif;text-align:center}' +
        '.dlv-banner.yellow{background:#fad600;color:#1b1a1a}.dlv-banner.dark{background:#2a2829;color:#f4f2f0;border-bottom:1px solid rgba(255,255,255,.08)}' +
        '.dlv-banner a{color:inherit;text-decoration:underline;text-underline-offset:3px;font-weight:600}' +
        '.dlv-banner button{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.7;cursor:pointer;font-size:18px;line-height:1}.dlv-banner button:hover{opacity:1}';
      document.head.appendChild(st);
    }
    var el = old || document.createElement('div');
    el.className = 'dlv-banner ' + (b.tone === 'dark' ? 'dark' : 'yellow');
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Announcement');
    var t = document.createElement('span'); t.textContent = b.text;
    el.innerHTML = ''; el.appendChild(t);
    if (b.link) { var a = document.createElement('a'); a.href = b.link; a.textContent = (b.link_text || 'Learn more') + ' →'; el.appendChild(a); }
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
    x.onclick = function () { try { localStorage.setItem('dlv_banner_closed', id); } catch (e) {} el.remove(); };
    el.appendChild(x);
    if (!old) document.body.insertBefore(el, document.body.firstChild);
  }

  function applyAll() {
    if (!cfg) return;
    banner(); hideOffLinks(); applyEdits();
    try { window.dispatchEvent(new CustomEvent('dlv:site', { detail: cfg })); } catch (e) {}
  }

  window.DelivrieSite = { pagePath: pagePath, keyed: keyed, clean: clean, norm: norm, get config() { return cfg; }, set: function (c) { cfg = c; applyAll(); }, apply: applyAll, editing: editing };

  try { var c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c) { cfg = c; applyAll(); } } catch (e) {}
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

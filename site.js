// Shared behaviour for the Company, Legal and Resources pages.
(function () {
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // reveal on scroll
  var targets = $$('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && !calm) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    targets.forEach(function (t) { io.observe(t); });
  } else targets.forEach(function (t) { t.classList.add('in'); });

  // legal: highlight the section in view
  var toc = $$('[data-toc]');
  if (toc.length && 'IntersectionObserver' in window) {
    var tio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) toc.forEach(function (a) { a.classList.toggle('on', a.dataset.toc === e.target.id); }); }); }, { rootMargin: '-120px 0px -70% 0px' });
    toc.forEach(function (a) { var t = document.getElementById(a.dataset.toc); if (t) tio.observe(t); });
  }

  // copy (brand colours)
  $$('[data-copy]').forEach(function (b) { b.addEventListener('click', function () {
    try { navigator.clipboard.writeText(b.dataset.copy); } catch (e) {}
    b.classList.add('copied'); setTimeout(function () { b.classList.remove('copied'); }, 1200);
  }); });

  // blog category filter
  $$('.cats [data-cat]').forEach(function (b) { b.addEventListener('click', function () {
    var c = b.dataset.cat;
    $$('.cats [data-cat]').forEach(function (x) { x.classList.toggle('on', x === b); });
    $$('.posts .post[data-cat]').forEach(function (p) { p.style.display = c === 'All' || p.dataset.cat === c ? '' : 'none'; });
    var f = $('.featured'); if (f) f.style.display = c === 'All' || f.querySelector('.cat').textContent === c ? '' : 'none';
  }); });

  // live status (footer everywhere, full list on /status)
  var sys = $('#sys'), banner = $('#st-banner');
  if (window.fetch && (sys || banner)) {
    var setRow = function (name, ok, label) { var r = $('[data-comp="' + name + '"] [data-state]'); if (r) { r.textContent = label || (ok ? 'Operational' : 'Degraded'); r.className = 'st-pill ' + (ok ? 'ok' : 'warn'); } };
    fetch('/api/public/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      var apiOk = s.status === 'operational', send = s.sending !== false;
      if (sys && (!apiOk || !send)) { sys.classList.add('down'); sys.querySelector('span').textContent = 'Sending degraded'; }
      if (banner) {
        ['API', 'Webhooks', 'Dashboard', 'MCP server'].forEach(function (c) { setRow(c, apiOk); });
        setRow('Email delivery', apiOk && send, apiOk && send ? 'Operational' : 'Paused');
        var all = apiOk && send;
        banner.className = 'st-banner ' + (all ? 'ok' : 'warn');
        banner.querySelector('b').textContent = all ? 'All systems operational' : 'Some systems are degraded';
        $('#st-time').textContent = 'Checked ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }).catch(function () {
      if (banner) { banner.className = 'st-banner warn'; banner.querySelector('b').textContent = 'We could not reach the API'; ['API', 'Email delivery', 'Webhooks', 'Dashboard', 'MCP server'].forEach(function (c) { setRow(c, false, 'Unknown'); }); }
    });
  }

  // contact sales: sent to Delivrie's API
  var form = $('#sales-form');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = {}; new FormData(form).forEach(function (v, k) { d[k] = String(v).trim(); });
    if (d.website) return; // bot trap
    var bad = !d.first_name || !d.last_name || !d.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '');
    form.classList.toggle('invalid', bad);
    if (bad) { var first = form.querySelector('input:invalid, input[name=email]'); if (first) first.focus(); return; }
    delete d.website;
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/public/sales-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(d)
    }).then(function (r) {
      if (!r.ok) throw new Error('failed');
      $$('label, .two, button[type=submit], .small', form).forEach(function (x) { x.hidden = true; });
      form.querySelector('.cs-done').hidden = false;
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Contact sales';
      alert('Something went wrong. Email sales@delivrie.io and we will reply within one business day.');
    });
  });
})();

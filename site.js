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

  // live status: the footer badge on every page, and the full page at /status
  var sys = $('#sys'), banner = $('#st-banner');
  var LABEL = { operational: 'Operational', degraded: 'Degraded', down: 'Outage' };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ago = function (iso) { var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  var when = function (iso) { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var dur = function (a, b) { var m = Math.max(1, Math.round((new Date(b || Date.now()) - new Date(a)) / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : ''); };
  function renderStatus(s) {
    var overall = s.status === 'operational' ? 'ok' : s.status === 'degraded' ? 'warn' : 'bad';
    if (sys) { sys.classList.toggle('down', overall !== 'ok'); sys.querySelector('span').textContent = overall === 'ok' ? 'All systems operational' : overall === 'warn' ? 'Some systems degraded' : 'Service disruption'; }
    if (!banner) return;
    banner.className = 'st-banner ' + overall;
    banner.querySelector('b').textContent = overall === 'ok' ? 'All systems operational' : overall === 'warn' ? 'Some systems are degraded' : 'We’re having a service disruption';
    $('#st-time').textContent = (s.checked_at ? 'Last checked ' + ago(s.checked_at) : 'Waiting for the first check') + ' · refreshes every minute';
    var comps = s.components || [];
    var ups = comps.map(function (c) { return c.uptime_90d; }).filter(function (u) { return u != null; });
    var avg = ups.length ? ups.reduce(function (a, b) { return a + b; }, 0) / ups.length : null;
    var api = comps.filter(function (c) { return c.id === 'api'; })[0];
    var open = (s.incidents || []).filter(function (i) { return !i.resolved_at; }).length;
    $('#st-stats').innerHTML = [
      ['Uptime, last 90 days', avg == null ? '—' : (Math.floor(avg * 100) / 100).toFixed(2) + '%'],
      ['API response time', api && api.latency_ms != null ? api.latency_ms + ' ms' : '—'],
      ['Components monitored', comps.length || '—'],
      ['Open incidents', open]
    ].map(function (x) { return '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('');
    var today = new Date(); today.setUTCHours(0, 0, 0, 0);
    $('#st-list').innerHTML = comps.map(function (c) {
      var byDay = {}; (c.days || []).forEach(function (d) { byDay[String(d.day).slice(0, 10)] = d; });
      var bars = '';
      for (var i = 89; i >= 0; i--) {
        var d = new Date(today.getTime() - i * 86400000), k = d.toISOString().slice(0, 10), v = byDay[k];
        var cls = !v ? 'none' : v.worst === 'operational' ? 'ok' : v.worst;
        var tip = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + ': ' + (v ? v.uptime + '% uptime' + (v.worst !== 'operational' ? ', ' + LABEL[v.worst].toLowerCase() + ' at times' : '') : 'no data');
        bars += '<i class="b ' + cls + '" title="' + esc(tip) + '"></i>';
      }
      return '<div class="st-row"><div class="st-top"><div class="st-name"><b>' + esc(c.name) + '</b><span>' + esc(c.about) + '</span></div><span class="st-pill ' + c.state + '">' + LABEL[c.state] + '</span></div>' +
        (c.detail ? '<p class="st-detail">' + esc(c.detail) + '</p>' : '') +
        '<div class="st-bars" aria-label="Daily status for the last 90 days">' + bars + '</div>' +
        '<div class="st-axis"><span>90 days ago</span><span>' + (c.uptime_90d == null ? 'No data yet' : c.uptime_90d.toFixed(2) + '% uptime') + '</span><span>Today</span></div></div>';
    }).join('') || '<div class="st-row"><span class="dim">No checks yet. The first one runs within five minutes.</span></div>';
    var inc = s.incidents || [];
    $('#st-inc').innerHTML = inc.length ? inc.map(function (i) {
      return '<div class="st-i"><span class="st-pill ' + i.severity + '">' + (i.resolved_at ? 'Resolved' : LABEL[i.severity]) + '</span><div><b>' + esc(i.component_name) + (i.detail ? ': ' + esc(i.detail) : '') + '</b><span class="dim">' + when(i.started_at) + (i.resolved_at ? ' · lasted ' + dur(i.started_at, i.resolved_at) : ' · ongoing for ' + dur(i.started_at)) + '</span></div></div>';
    }).join('') : '<p class="dim">No incidents in the last 90 days.</p>';
  }
  function loadStatus() {
    fetch('/api/public/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(renderStatus).catch(function () {
      if (banner) { banner.className = 'st-banner warn'; banner.querySelector('b').textContent = 'We couldn’t load the status right now'; $('#st-time').textContent = 'Trying again shortly'; }
    });
  }
  if (window.fetch && (sys || banner)) { loadStatus(); if (banner) setInterval(loadStatus, 60000); }


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

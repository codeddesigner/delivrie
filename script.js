(function () {
  // ---- Product shot: email list ----
  var groups = [
    { label: 'Opened', icon: 'st-opened', rows: [
      ['a91c2e', 'st-opened', 'Reset your password', 'tunde.b@outlook.com', 'security', 'T', 'Mar 31'],
      ['77d0b1', 'st-opened-2', 'Welcome to Kora', 'amina@kora.ng', 'onboarding', 'A', 'Mar 31'],
      ['c03f88', 'st-opened', 'Your receipt from Kora', 'kelechi@yahoo.com', 'transactional', 'K', 'Mar 30']
    ]},
    { label: 'Delivered', icon: 'st-delivered', rows: [
      ['4ef9a4', 'st-delivered', 'Your order is confirmed', 'chiamaka@gmail.com', 'transactional', 'C', 'Mar 31'],
      ['b8e211', 'st-delivered', 'Verify your email address', 'ibrahim.m@gmail.com', 'security', 'I', 'Mar 31'],
      ['19aa07', 'st-delivered', 'New sign-in from Chrome on macOS', 'emeka@okafor.dev', 'security', 'E', 'Mar 30'],
      ['e6f450', 'st-delivered', 'Your order has shipped', 'folake@gmail.com', 'transactional', 'F', 'Mar 30'],
      ['2d93cc', 'st-delivered', 'March product update', 'bola@ahmed.io', 'broadcast', 'B', 'Mar 30']
    ]},
    { label: 'Bounced', icon: 'st-bounced', rows: [
      ['f1c7a0', 'st-bounced', 'Your order is confirmed', 'zainab@bello.co', 'transactional', 'Z', 'Mar 29'],
      ['0b5e3d', 'st-other', 'October newsletter', 'ngozi@eze.ng', 'broadcast', 'N', 'Mar 28']
    ]}
  ];

  var list = document.getElementById('email-list');
  if (list) {
    var html = '';
    groups.forEach(function (g) {
      html += '<div class="grp"><img class="chev" src="assets/grp-chevron.svg" alt="">' +
        '<img class="st" src="assets/' + g.icon + '.svg" alt="">' +
        '<span class="label">' + g.label + '</span><span class="count">' + g.rows.length + '</span>' +
        '<span class="grow"></span><img class="ico13" src="assets/grp-plus.svg" alt=""></div>';
      g.rows.forEach(function (r) {
        html += '<div class="row"><span class="id">' + r[0] + '</span>' +
          '<img class="st" src="assets/' + r[1] + '.svg" alt="">' +
          '<span class="subj">' + r[2] + '</span><span class="to">' + r[3] + '</span>' +
          '<span class="grow"></span>' +
          '<span class="pill"><img class="tdot" src="assets/tag-' + r[4] + '.svg" alt="">' + r[4] + '</span>' +
          '<span class="pill"><img class="ico11" src="assets/globe.svg" alt="">kora.ng</span>' +
          '<span class="ava">' + r[5] + '</span><span class="date">' + r[6] + '</span></div>';
      });
    });
    list.innerHTML = html;
  }

  // Scale the 1252px-wide app mock to fit its window
  var win = document.getElementById('window');
  var app = document.getElementById('app');
  function fit() {
    if (!win || !app) return;
    var s = win.clientWidth / 1250;
    app.style.transform = 'scale(' + s + ')';
  }
  fit();
  window.addEventListener('resize', fit);
  if ('ResizeObserver' in window && win) new ResizeObserver(fit).observe(win);

  // ---- MCP install tabs ----
  var key = 'dlv_••••';
  var url = location.origin + '/api/mcp';
  var clients = {
    claude: {
      title: 'Add the server',
      html: '<span class="p">$</span> <span class="y">claude</span> mcp add --transport http delivrie \\\n    <span class="g">' + url + '</span> \\\n    --header <span class="b">"Authorization: Bearer ' + key + '"</span>',
      text: 'claude mcp add --transport http delivrie \\\n    ' + url + ' \\\n    --header "Authorization: Bearer <your-key>"'
    },
    cursor: { title: 'Add to ~/.cursor/mcp.json', json: true },
    vscode: {
      title: 'Add the server',
      html: '<span class="p">$</span> <span class="y">code</span> --add-mcp \\\n    \'{"name":"delivrie","type":"http",\n      "url":"<span class="g">' + url + '</span>",\n      "headers":{"Authorization":"Bearer ' + key + '"}}\'',
      text: 'code --add-mcp \'{"name":"delivrie","type":"http","url":"' + url + '","headers":{"Authorization":"Bearer <your-key>"}}\''
    },
    windsurf: { title: 'Add to mcp_config.json', json: true },
    json: { title: 'Any MCP client', json: true }
  };
  function jsonHtml() {
    return '{\n  <span class="w">"mcpServers"</span>: {\n    <span class="w">"delivrie"</span>: {\n      "url": "<span class="g">' + url + '</span>",\n      "headers": { <span class="b">"Authorization"</span>: "<span class="w">Bearer ' + key + '</span>" }\n    }\n  }\n}';
  }
  var jsonText = '{\n  "mcpServers": {\n    "delivrie": {\n      "url": "' + url + '",\n      "headers": { "Authorization": "Bearer <your-key>" }\n    }\n  }\n}';

  var step2 = document.getElementById('step2');
  var step2Title = document.getElementById('step2-title');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var current = 'claude';
  function select(id) {
    current = id;
    var c = clients[id];
    step2Title.textContent = c.title;
    step2.innerHTML = c.json ? jsonHtml() : c.html;
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.client === id)); });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { select(t.dataset.client); }); });
  if (step2) select('claude');

  var copyBtn = document.getElementById('copy');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var c = clients[current];
    var text = c.json ? jsonText : c.text;
    var done = function () {
      copyBtn.classList.add('copied');
      setTimeout(function () { copyBtn.classList.remove('copied'); }, 1400);
    };
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
      else done();
    } catch (e) { done(); }
  });
})();

// ---------------------------------------------------------------- Redesign: code samples, motion, pricing
(function () {
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  function copy(text, el) {
    var done = function () { el.classList.add('copied'); setTimeout(function () { el.classList.remove('copied'); }, 1400); };
    try { navigator.clipboard.writeText(text).then(done, done); } catch (e) { done(); }
  }

  // ---- Integrate: real REST calls in each language (no SDK needed)
  var API = 'https://delivrie.io/api/emails';
  var SAMPLES = {
    node: "const res = await fetch('" + API + "', {\n  method: 'POST',\n  headers: {\n    Authorization: `Bearer ${process.env.DELIVRIE_API_KEY}`,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify({\n    from: 'Kora <orders@kora.ng>',\n    to: ['chiamaka@gmail.com'],\n    subject: 'Your order is confirmed',\n    html: '<p>Order KR-20931 is on its way.</p>',\n    tags: [{ name: 'category', value: 'transactional' }],\n  }),\n});\n\nconst { id } = await res.json(); // 4ef9a417-02e9-4c1b-9d0f",
    python: "import os, requests\n\nres = requests.post(\n    '" + API + "',\n    headers={'Authorization': f\"Bearer {os.environ['DELIVRIE_API_KEY']}\"},\n    json={\n        'from': 'Kora <orders@kora.ng>',\n        'to': ['chiamaka@gmail.com'],\n        'subject': 'Your order is confirmed',\n        'html': '<p>Order KR-20931 is on its way.</p>',\n    },\n)\n\nprint(res.json()['id'])  # 4ef9a417-02e9-4c1b-9d0f",
    php: "$ch = curl_init('" + API + "');\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => [\n    'Authorization: Bearer ' . getenv('DELIVRIE_API_KEY'),\n    'Content-Type: application/json',\n  ],\n  CURLOPT_POSTFIELDS => json_encode([\n    'from' => 'Kora <orders@kora.ng>',\n    'to' => ['chiamaka@gmail.com'],\n    'subject' => 'Your order is confirmed',\n    'html' => '<p>Order KR-20931 is on its way.</p>',\n  ]),\n]);\n$email = json_decode(curl_exec($ch), true);",
    go: "body, _ := json.Marshal(map[string]any{\n\t\"from\":    \"Kora <orders@kora.ng>\",\n\t\"to\":      []string{\"chiamaka@gmail.com\"},\n\t\"subject\": \"Your order is confirmed\",\n\t\"html\":    \"<p>Order KR-20931 is on its way.</p>\",\n})\n\nreq, _ := http.NewRequest(\"POST\", \"" + API + "\", bytes.NewReader(body))\nreq.Header.Set(\"Authorization\", \"Bearer \"+os.Getenv(\"DELIVRIE_API_KEY\"))\nreq.Header.Set(\"Content-Type\", \"application/json\")\n\nres, err := http.DefaultClient.Do(req)",
    ruby: "require 'net/http'\nrequire 'json'\n\nuri = URI('" + API + "')\nres = Net::HTTP.post(uri, {\n  from: 'Kora <orders@kora.ng>',\n  to: ['chiamaka@gmail.com'],\n  subject: 'Your order is confirmed',\n  html: '<p>Order KR-20931 is on its way.</p>'\n}.to_json,\n  'Authorization' => \"Bearer #{ENV['DELIVRIE_API_KEY']}\",\n  'Content-Type' => 'application/json')\n\nputs JSON.parse(res.body)['id']",
    curl: "curl -X POST '" + API + "' \\\n  -H \"Authorization: Bearer $DELIVRIE_API_KEY\" \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: order-KR-20931' \\\n  -d '{\n    \"from\": \"Kora <orders@kora.ng>\",\n    \"to\": [\"chiamaka@gmail.com\"],\n    \"subject\": \"Your order is confirmed\",\n    \"html\": \"<p>Order KR-20931 is on its way.</p>\",\n    \"scheduled_at\": \"in 1 hour\"\n  }'"
  };
  var KW = /\b(const|await|import|require|from|new|return|func|package|var|let|true|puts|print|def|end|nil)\b/g;
  function paint(src) {
    // strings → yellow, comments → dim, keywords → purple (applied to escaped text, outside strings)
    return src.split('\n').map(function (line, i) {
      var out = '', re = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|\/\/.*$|#(?![{]).*$)/g, last = 0, m;
      while ((m = re.exec(line))) {
        out += esc(line.slice(last, m.index)).replace(KW, '<span class="k">$1</span>');
        var t = m[0];
        out += /^(\/\/|#)/.test(t) ? '<span class="c">' + esc(t) + '</span>' : '<span class="s">' + esc(t) + '</span>';
        last = m.index + t.length;
      }
      out += esc(line.slice(last)).replace(KW, '<span class="k">$1</span>');
      return '<span class="ln" style="animation-delay:' + (calm ? 0 : i * 18) + 'ms">' + (out || ' ') + '</span>';
    }).join('');
  }
  var codeBody = $('#code-body'), lang = 'node';
  function showLang(l) {
    lang = l;
    if (codeBody) codeBody.innerHTML = paint(SAMPLES[l]);
    $$('.ctab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.lang === l)); });
  }
  $$('.ctab').forEach(function (t) { t.addEventListener('click', function () { showLang(t.dataset.lang); }); });
  if (codeBody) showLang('node');
  var cc = $('#code-copy'); if (cc) cc.addEventListener('click', function () { copy(SAMPLES[lang], cc); });
  $$('[data-copy]').forEach(function (b) { b.addEventListener('click', function () { copy(b.dataset.copy, b); }); });

  // ---- Count-ups
  function countUp(el) {
    var raw = el.textContent.trim(), end = parseFloat(el.dataset.count || el.dataset.countTo || raw.replace(/[^\d.]/g, ''));
    var dec = ((el.dataset.count || '').split('.')[1] || '').length, suf = el.dataset.suffix || '';
    if (!isFinite(end) || calm) return;
    var t0 = performance.now(), dur = 1100;
    (function tick(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = end * e;
      el.textContent = (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US')) + suf;
      if (k < 1) requestAnimationFrame(tick); else el.textContent = raw;
    })(t0);
  }

  // ---- Typing headline in the editor
  function typeIt(el) {
    if (calm) return;
    var text = el.dataset.type, i = 0;
    el.textContent = ''; el.classList.add('on');
    var iv = setInterval(function () { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(iv); setTimeout(function () { el.classList.remove('on'); }, 1600); } }, 38);
  }

  // ---- MCP chat plays in sequence
  function playChat(chat) {
    if (calm) return;
    var steps = $$('.bubble-row, .call, .reply', chat);
    chat.classList.remove('wait');
    steps.forEach(function (s) { s.style.opacity = '0'; s.style.transform = 'translateY(8px)'; });
    steps.forEach(function (s, i) {
      setTimeout(function () {
        s.style.opacity = ''; s.style.transform = '';
        if (s.classList.contains('call')) { s.classList.add('run'); setTimeout(function () { s.classList.remove('run'); }, 650); }
      }, 250 + i * 700);
    });
  }

  // ---- Live webhook stream
  function streamHooks(box) {
    if (calm || !box) return;
    var evts = [['g', 'email.delivered'], ['y', 'email.opened'], ['y', 'email.clicked'], ['g', 'email.delivered'], ['g', 'email.sent'], ['r', 'email.bounced'], ['g', 'email.delivered'], ['y', 'email.opened']];
    var n = 0;
    setInterval(function () {
      if (document.hidden) return;
      var e = evts[n++ % evts.length];
      $$('.hook em', box).forEach(function (em) { em.textContent = bump(em.textContent); });
      var d = document.createElement('div');
      d.className = 'hook new'; d.innerHTML = '<i class="' + e[0] + '"></i><span>' + e[1] + '</span><em>just now</em>';
      box.insertBefore(d, box.firstChild);
      while (box.children.length > 5) box.removeChild(box.lastChild);
    }, 2600);
  }
  function bump(t) {
    if (t === 'just now') return '3s ago';
    var m = t.match(/(\d+)(s|m) ago/); if (!m) return t;
    var v = +m[1] + (m[2] === 's' ? 3 : 0);
    return m[2] === 's' && v >= 60 ? '1m ago' : v + m[2] + ' ago';
  }

  // ---- Product shot: a new email arrives every few seconds
  function liveInbox() {
    var list = $('#email-list'); if (!list || calm) return;
    var subjects = [['Your OTP is 482 019', 'tobi@kora.ng', 'security', 'T'], ['Payment received', 'ada@gmail.com', 'transactional', 'A'], ['Welcome to Kora', 'musa@yahoo.com', 'onboarding', 'M'], ['Your order has shipped', 'ife@gmail.com', 'transactional', 'I']];
    var k = 0;
    setInterval(function () {
      if (document.hidden) return;
      var grp = list.querySelectorAll('.grp')[1]; if (!grp) return;
      var s = subjects[k++ % subjects.length];
      var id = Math.random().toString(16).slice(2, 8);
      var row = document.createElement('div');
      row.className = 'row fresh';
      row.innerHTML = '<span class="id">' + id + '</span><img class="st" src="assets/st-delivered.svg" alt=""><span class="subj">' + s[0] + '</span><span class="to">' + s[1] + '</span><span class="grow"></span><span class="pill"><img class="tdot" src="assets/tag-' + s[2] + '.svg" alt="">' + s[2] + '</span><span class="pill"><img class="ico11" src="assets/globe.svg" alt="">kora.ng</span><span class="ava">' + s[3] + '</span><span class="date">Mar 31</span>';
      grp.parentNode.insertBefore(row, grp.nextSibling);
      var cnt = grp.querySelector('.count'); if (cnt) cnt.textContent = String(+cnt.textContent + 1);
      setTimeout(function () { var sj = row.querySelector('.subj'); if (sj) sj.style.color = 'inherit'; }, 60);
      // keep the list from growing: drop the last row of the group
      var rows = [], n = grp.nextElementSibling;
      while (n && n.classList.contains('row')) { rows.push(n); n = n.nextElementSibling; }
      if (rows.length > 6) rows[rows.length - 1].remove();
    }, 4200);
  }

  // ---- Scroll reveal
  var seen = function (el) {
    el.classList.add('in');
    $$('[data-count], [data-count-to]', el).forEach(countUp);
    $$('.bars i', el).forEach(function (b, i) { b.style.setProperty('--i', i); });
    var ty = $('.typing', el); if (ty) typeIt(ty);
    if (el.classList.contains('mcp-grid')) playChat($('#chat', el));
    var hooks = $('#hooks', el); if (hooks && !hooks.dataset.live) { hooks.dataset.live = 1; streamHooks(hooks); }
  };
  var targets = $$('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && !calm) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { seen(e.target); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    targets.forEach(function (t) { io.observe(t); });
  } else targets.forEach(seen);
  liveInbox();

  // ---- Pricing teaser currency
  var PRICES = { NGN: { free: '₦0', pro: '₦10,000', scale: '₦45,000', payg: '₦600' }, USD: { free: '$0', pro: '$10', scale: '$45', payg: '$0.60' } };
  var cur;
  try { cur = localStorage.getItem('dlv_currency'); } catch (e) {}
  if (!cur) cur = /Lagos|Africa\//.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '') ? 'NGN' : 'USD';
  function setCur(c, animate) {
    cur = c; try { localStorage.setItem('dlv_currency', c); } catch (e) {}
    $$('.cur-toggle button').forEach(function (b) { b.classList.toggle('on', b.dataset.cur === c); });
    $$('[data-price]').forEach(function (b) {
      if (!animate || calm) { b.textContent = PRICES[c][b.dataset.price]; return; }
      b.classList.add('swap');
      setTimeout(function () { b.textContent = PRICES[c][b.dataset.price]; b.classList.remove('swap'); }, 180);
    });
  }
  $$('.cur-toggle button').forEach(function (b) { b.addEventListener('click', function () { setCur(b.dataset.cur, true); }); });
  if ($('.cur-toggle')) setCur(cur, false);

  // ---- Status in the footer
  var sys = $('#sys');
  if (sys && window.fetch) fetch('/api/public/status').then(function (r) { return r.json(); }).then(function (s) {
    if (s.status !== 'operational' || s.sending === false) { sys.classList.add('down'); sys.querySelector('span').textContent = 'Sending degraded'; }
  }).catch(function () {});
})();

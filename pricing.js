// Pricing page: plans, pay-as-you-go packs, calculator, marketing add-on, comparison and FAQ.
// Amounts match the billing function (supabase/functions/billing/index.ts) in major units.
(function () {
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var P = {
    NGN: { sym: '₦', pro: 10000, scale: 45000, proY: 100000, scaleY: 450000, proOver: 450, scaleOver: 400, payg: 600, growth: 20000, mktPro: 40000, extraContacts: 3500, packs: [[5000, 8300, 'Minimum', 600], [25000, 41600, '', 600], [100000, 172400, 'Save 3%', 580], [500000, 925900, 'Save 10%', 540]] },
    USD: { sym: '$', pro: 10, scale: 45, proY: 100, scaleY: 450, proOver: 0.45, scaleOver: 0.40, payg: 0.60, growth: 20, mktPro: 40, extraContacts: 3.5, packs: [[5, 8300, 'Minimum', 0.60], [25, 41600, '', 0.60], [100, 172400, 'Save 3%', 0.58], [500, 925900, 'Save 10%', 0.54]] }
  };
  var cur, mode = 'monthly';
  try { cur = localStorage.getItem('dlv_currency'); } catch (e) {}
  if (!cur) cur = /Lagos|Africa\//.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '') ? 'NGN' : 'USD';
  if (/yearly/.test(location.hash)) mode = 'yearly'; else if (/payg|credits/.test(location.hash)) mode = 'payg';

  var m = function (v, exact) {
    var p = P[cur], dec = exact && v % 1 ? 2 : 0;
    return p.sym + Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  var check = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5L9.5 17L19 7.5"/></svg>';
  var dash = '<span class="dash">—</span>';

  function plans() {
    var p = P[cur], y = mode === 'yearly';
    var cards = [
      { id: 'free', name: 'Free', tag: 'For side projects and testing.', price: m(0), sub: y ? 'Free forever' : '', cta: ['Start for free', '/signup', ''], head: 'Includes', feats: ['6,000 emails / month', '200 emails / day', '1 custom domain', '1-day data retention', 'REST API & MCP server', 'Community support'] },
      { id: 'pro', name: 'Pro', pop: true, tag: 'For products with real users.', price: y ? m(Math.round(p.proY / 12 * 100) / 100, true) : m(p.pro), sub: y ? m(p.proY) + ' billed yearly · save ' + m(p.pro * 12 - p.proY) : '', cta: ['Get Pro', '/signup?plan=pro' + (y ? '&interval=yearly' : ''), 'y'], head: 'Everything in Free, plus', feats: ['20,000 emails / month', 'No daily limit', '10 custom domains', '3-day data retention', m(p.proOver, true) + ' per extra 1,000 emails', 'Webhooks & batch sending', 'Email support'] },
      { id: 'scale', name: 'Scale', tag: 'For teams sending at volume.', price: y ? m(Math.round(p.scaleY / 12 * 100) / 100, true) : m(p.scale), sub: y ? m(p.scaleY) + ' billed yearly · save ' + m(p.scale * 12 - p.scaleY) : '', cta: ['Get Scale', '/signup?plan=scale' + (y ? '&interval=yearly' : ''), ''], head: 'Everything in Pro, plus', feats: ['100,000 emails / month', 'No daily limit', '1,000 custom domains', '7-day data retention', m(p.scaleOver, true) + ' per extra 1,000 emails', 'Dedicated IP on request', 'Multiple team members', 'Priority support'] },
      { id: 'ent', name: 'Enterprise', tag: 'For high volume and compliance.', price: 'Custom', sub: y ? 'Annual contracts' : '', cta: ['Talk to sales', 'mailto:sales@delivrie.io?subject=Delivrie%20Enterprise', ''], head: 'Everything in Scale, plus', feats: ['Custom volume & pricing', 'Dedicated IPs included', 'Unlimited domains', 'Custom data retention', 'SSO / SAML & audit logs', 'Uptime SLA', 'Dedicated account manager'] }
    ];
    $('#plan-grid').innerHTML = cards.map(function (c) {
      return '<div class="plan' + (c.pop ? ' pop' : '') + '"><div class="ph"><h3>' + c.name + '</h3>' + (c.pop ? '<span class="mp y">Most popular</span>' : '') + '</div><p class="tag">' + c.tag + '</p>' +
        '<div class="pp"><b>' + c.price + '</b>' + (c.id === 'ent' ? '' : '<span>/month</span>') + '</div><div class="psub">' + (c.sub || '&nbsp;') + '</div>' +
        '<a class="' + (c.cta[2] ? 'b-primary' : 'b-secondary') + ' block" href="' + c.cta[1] + '">' + c.cta[0] + '</a>' +
        '<div class="fh">' + c.head + '</div><ul>' + c.feats.map(function (f) { return '<li>' + check + f + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    $('#plan-note').textContent = (cur === 'NGN' ? 'Prices in Naira, exclusive of VAT. ' : 'Prices in US dollars, exclusive of taxes. ') + (y ? 'Yearly plans are billed upfront and renew annually.' : 'Billed monthly, cancel anytime.');
    $('#plans').style.display = mode === 'payg' ? 'none' : '';
  }

  function payg() {
    var p = P[cur];
    $('#payg').innerHTML = '<div class="pg-l"><h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fad600" stroke-width="1.8" stroke-linejoin="round"><path d="M13 3L4.5 13.5H12L11 21L19.5 10.5H12L13 3Z"/></svg>Pay as you go</h3><div class="pp"><b>' + m(p.payg, true) + '</b><span>/ 1,000 emails</span></div><p>No subscription. Top up credits and send whenever you need to. Good for seasonal campaigns, low-volume OTPs and agents that send in bursts.</p><div class="row"><a class="b-primary" href="/signup?plan=payg">Buy credits</a><a class="b-secondary" href="#faq" data-open="credits">How credits work</a></div></div>' +
      '<div class="pg-r"><div class="mono-h dim">Credit packs</div><table class="packs"><thead><tr><th>Top-up</th><th>Emails</th><th>Effective rate</th><th></th></tr></thead><tbody>' +
      p.packs.map(function (k) { return '<tr><td>' + m(k[0]) + '</td><td>' + k[1].toLocaleString('en-US') + '</td><td>' + m(Math.round(k[0] / k[1] * 1000 * 100) / 100, true) + ' / 1k</td><td>' + (k[2] ? '<span class="note">' + k[2] + '</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table><div class="pg-f"><span>' + check + 'Credits never expire</span><span>' + check + 'No daily limit</span><span>' + check + 'Same API as every plan</span></div></div>';
  }

  // calculator: slider position 0..1000 maps to 1k..1M on a log scale
  var slider = $('#calc');
  var toVol = function (x) { var v = Math.pow(10, 3 + (x / 1000) * 3); return v < 10000 ? Math.round(v / 100) * 100 : v < 100000 ? Math.round(v / 1000) * 1000 : Math.round(v / 5000) * 5000; };
  var toPos = function (v) { return Math.round((Math.log10(v) - 3) / 3 * 1000); };
  function calc() {
    var p = P[cur], v = toVol(+slider.value), k = Math.ceil(v / 1000);
    $('#calc-out').textContent = v >= 1000000 ? '1,000,000+' : v.toLocaleString('en-US');
    slider.style.setProperty('--p', (slider.value / 10) + '%');
    var proOver = Math.max(0, Math.ceil((v - 20000) / 1000)), scaleOver = Math.max(0, Math.ceil((v - 100000) / 1000));
    var opts = [
      { n: 'Pro', d: proOver ? m(p.pro) + ' + ' + proOver.toLocaleString('en-US') + ' × ' + m(p.proOver, true) + ' overage' : 'Includes 20,000 emails', c: p.pro + proOver * p.proOver },
      { n: 'Pay as you go', d: k.toLocaleString('en-US') + ' × ' + m(p.payg, true), c: k * p.payg },
      { n: 'Scale', d: scaleOver ? m(p.scale) + ' + ' + scaleOver.toLocaleString('en-US') + ' × ' + m(p.scaleOver, true) + ' overage' : 'Includes 100,000 emails', c: p.scale + scaleOver * p.scaleOver }
    ];
    if (v <= 6000) opts.unshift({ n: 'Free', d: 'Up to 6,000 emails a month (200 a day)', c: 0 });
    var best = opts.reduce(function (a, b) { return b.c < a.c ? b : a; });
    opts.sort(function (a, b) { return a.c - b.c; });
    $('#calc-opts').innerHTML = opts.map(function (o) {
      return '<div class="copt' + (o === best ? ' best' : '') + '"><div><div class="cn">' + o.n + (o === best ? ' <span class="bv">Best value</span>' : '') + '</div><div class="od">' + o.d + '</div></div><div class="oc"><b>' + m(Math.round(o.c * 100) / 100, true) + '</b><span>/mo</span></div></div>';
    }).join('');
    $('#calc-foot').innerHTML = v > 1000000 ? 'Sending more than a million a month? <a href="mailto:sales@delivrie.io">Talk to sales</a> for volume pricing.' : 'On yearly Pro you would pay ' + m(Math.round(p.proY / 12 * 100) / 100, true) + '/mo before overage.';
    $$('.presets button').forEach(function (b) { b.classList.toggle('on', +b.dataset.v === v); });
  }

  function marketing() {
    var p = P[cur];
    var tiers = [
      ['Starter', m(0), ['Up to 1,000 contacts', 'Unlimited broadcasts', 'Visual editor', '1 audience'], ''],
      ['Growth', m(p.growth), ['Up to 5,000 contacts', 'Everything in Starter', 'Unlimited audiences', 'Topics & preferences page', 'Open & click analytics'], 'Popular'],
      ['Pro marketing', m(p.mktPro), ['Up to 10,000 contacts', 'Everything in Growth', 'Remove Delivrie branding', '+' + m(p.extraContacts, true) + ' per extra 1,000 contacts'], '']
    ];
    $('#mkt').innerHTML = tiers.map(function (t) {
      return '<div class="plan sm' + (t[3] ? ' pop2' : '') + '"><div class="ph"><h3>' + t[0] + '</h3>' + (t[3] ? '<span class="mp">' + t[3] + '</span>' : '') + '</div><div class="pp"><b>' + t[1] + '</b><span>/month</span></div><ul>' + t[2].map(function (f) { return '<li>' + check + f + '</li>'; }).join('') + '</ul></div>';
    }).join('');
  }

  function compare() {
    var p = P[cur], Y = check, N = dash;
    var rows = [
      ['Sending'],
      ['Emails / month', '6,000', '20,000', '100,000', 'Custom'],
      ['Daily limit', '200', 'None', 'None', 'None'],
      ['Overage per 1,000', N, m(p.proOver, true), m(p.scaleOver, true), 'Custom'],
      ['Custom domains', '1', '10', '1,000', 'Unlimited'],
      ['Data retention', '1 day', '3 days', '7 days', 'Custom'],
      ['Dedicated IP', N, N, 'On request', Y],
      ['Developer'],
      ['REST API', Y, Y, Y, Y],
      ['MCP server', Y, Y, Y, Y],
      ['Webhooks', '1 endpoint', '10 endpoints', 'Unlimited', 'Unlimited'],
      ['Batch sending (100 / call)', Y, Y, Y, Y],
      ['Scheduled sends', Y, Y, Y, Y],
      ['Test addresses', Y, Y, Y, Y],
      ['Team & security'],
      ['Team members', '1', '5', 'Unlimited', 'Unlimited'],
      ['Scoped API keys', Y, Y, Y, Y],
      ['Two-factor sign-in', Y, Y, Y, Y],
      ['SSO / SAML', N, N, N, Y],
      ['Uptime SLA', N, N, N, 'Custom'],
      ['Support'],
      ['Support', 'Community', 'Email', 'Priority', 'Dedicated manager']
    ];
    $('#cmp').innerHTML = '<thead><tr><th></th><th>Free<a class="b-secondary sm" href="/signup">Start free</a></th><th>Pro <span class="mp y">Popular</span><a class="b-primary sm" href="/signup?plan=pro">Get Pro</a></th><th>Scale<a class="b-secondary sm" href="/signup?plan=scale">Get Scale</a></th><th>Enterprise<a class="b-secondary sm" href="mailto:sales@delivrie.io?subject=Delivrie%20Enterprise">Talk to sales</a></th></tr></thead><tbody>' +
      rows.map(function (r) { return r.length === 1 ? '<tr class="cg"><td colspan="5">' + r[0] + '</td></tr>' : '<tr>' + r.map(function (c, i) { return i ? '<td>' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
  }

  // Delivrie vs Resend vs Brevo. Competitor prices are their published US-dollar prices (checked 13 Nov 2026);
  // in Naira mode they are converted at the official NFEM rate below. Delivrie Naira prices are our own.
  var FX = 1350, FX_DATE = '13 November 2026';
  function vs() {
    var p = P[cur], Y = check, N = dash;
    var usd = function (v) { return cur === 'NGN' ? '₦' + (Math.round(v * FX / 100) * 100).toLocaleString('en-US') : '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
    var cell = function (price, plan) { return '<b>' + price + '</b><span class="vs-sub">' + plan + '</span>'; };
    var rows = [
      ['Monthly cost at the same volume'],
      ['3,000 emails / month', cell(m(0), 'Free'), cell(usd(0), 'Free'), cell(usd(0), 'Free, 300 / day')],
      ['20,000 emails / month', cell(m(p.pro), 'Pro'), cell(usd(20), 'Pro'), cell(usd(32), 'Starter')],
      ['100,000 emails / month', cell(m(p.scale), 'Scale'), cell(usd(65), 'Pro + 50,000 extra'), cell(usd(82), 'Starter')],
      ['Plans and limits'],
      ['Free emails', '6,000 / month', '3,000 / month', '300 / day'],
      ['Free daily limit', '200', '100', '300'],
      ['Extra emails, per 1,000', m(p.scaleOver, true) + ' to ' + m(p.proOver, true), usd(0.9), 'Move up a tier'],
      ['Pay in Naira', Y + ' Paystack', N + ' Dollar card', N + ' Foreign currency'],
      ['Email content kept', '1 to 7 days', '30 days', 'Not published'],
      ['Dedicated IP', 'On request (Scale)', usd(30) + ' / month add-on', 'Professional plan and up'],
      ['Features'],
      ['Transactional email API', Y, Y, Y],
      ['SMTP relay', N, Y, Y],
      ['Marketing broadcasts', Y + ' Free up to 1,000 contacts', Y, Y],
      ['Shared inbox for replies', Y, Y, Y],
      ['MCP server for AI agents', Y + ' 64 tools, OAuth', Y, Y],
      ['SMS & WhatsApp', N, N, Y]
    ];
    $('#vs-table').innerHTML = '<thead><tr><th></th><th class="us">Delivrie</th><th>Resend</th><th>Brevo</th></tr></thead><tbody>' +
      rows.map(function (r) { return r.length === 1 ? '<tr class="cg"><td colspan="4">' + r[0] + '</td></tr>' : '<tr>' + r.map(function (c, i) { return i ? '<td' + (i === 1 ? ' class="us"' : '') + '>' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
    $('#vs-note').textContent = 'Resend and Brevo prices are from their websites on ' + FX_DATE + ' and can change. ' +
      (cur === 'NGN' ? 'Their dollar prices are shown in Naira at ₦' + FX.toLocaleString('en-US') + ' to $1 (official rate); dollar cards often cost more. ' : '') +
      'Brevo prices are for its Starter marketing plan, billed monthly. Each column shows the cheapest plan that covers the volume.';
  }

  var FAQ = [
    ['What counts as an email?', 'Each recipient is one email. Sending one message to a To, a CC and a BCC address counts as three. Bounced emails count; emails blocked by your suppression list do not.'],
    ['How do yearly plans work?', 'You pay for ten months and get twelve. Yearly plans are billed upfront and renew each year. Overage, if any, is still billed at the end of each month.'],
    ['Can I pay in dollars?', 'Yes. Choose US dollars or Naira at checkout. Payments are handled by Paystack, and you can pay by card in either currency.'],
    ['Is the MCP server extra?', 'No. The MCP server is included on every plan, including Free. It uses the same API keys and limits as the REST API.'],
    ['What happens if I go over my plan?', 'On Pro and Scale we keep sending and bill overage per 1,000 at the end of the month. On Free, sending pauses until the next day or month, unless you have pay-as-you-go credits. You can set a spending cap in Billing.'],
    ['Do pay-as-you-go credits expire?', 'No. Credits never expire. One credit sends one email, and credits are used after your plan’s free allowance runs out.', 'credits'],
    ['Can I change plans anytime?', 'Yes. Upgrades start as soon as payment goes through. If you cancel or downgrade, you keep your current plan until the end of the period you paid for.'],
    ['Do you offer discounts for startups or NGOs?', 'Yes. Email billing@delivrie.io with a little about what you’re building and we’ll work something out.']
  ];
  function faq() {
    $('#faq-list').innerHTML = FAQ.map(function (f, i) { return '<details' + (i === 0 || i === 4 ? ' open' : '') + (f[2] ? ' id="faq-' + f[2] + '"' : '') + '><summary>' + f[0] + '<span class="pm"></span></summary><div class="ans"><p>' + f[1] + '</p></div></details>'; }).join('');
  }

  function render(animate) {
    $$('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
    $$('[data-cur]').forEach(function (b) { b.classList.toggle('on', b.dataset.cur === cur); });
    plans(); payg(); calc(); marketing(); vs(); compare();
    if (animate && !calm) $$('#plan-grid .plan, #payg').forEach(function (el, i) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'rise .5s ' + (i * 50) + 'ms cubic-bezier(.2,.8,.2,1) both'; });
  }
  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.mode; render(true); if (mode === 'payg') $('#payg').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' }); }); });
  $$('[data-cur]').forEach(function (b) { b.addEventListener('click', function () { cur = b.dataset.cur; try { localStorage.setItem('dlv_currency', cur); } catch (e) {} render(true); }); });
  slider.addEventListener('input', calc);
  $$('.presets button').forEach(function (b) { b.addEventListener('click', function () { var to = toPos(+b.dataset.v), from = +slider.value, t0 = performance.now(); if (calm) { slider.value = to; return calc(); } (function step(t) { var k = Math.min(1, (t - t0) / 380), e = 1 - Math.pow(1 - k, 3); slider.value = from + (to - from) * e; calc(); if (k < 1) requestAnimationFrame(step); else { slider.value = to; calc(); } })(t0); }); });
  document.addEventListener('click', function (e) { var a = e.target.closest('[data-open]'); if (!a) return; var d = $('#faq-' + a.dataset.open); if (d) { e.preventDefault(); d.open = true; d.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' }); } });
  faq(); render(false);

  // scroll reveal (same behaviour as the home page)
  var targets = $$('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && !calm) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
    targets.forEach(function (t) { io.observe(t); });
  } else targets.forEach(function (t) { t.classList.add('in'); });
  var sys = $('#sys');
  if (sys && window.fetch) fetch('/api/public/status').then(function (r) { return r.json(); }).then(function (s) { if (s.status !== 'operational' || s.sending === false) { sys.classList.add('down'); sys.querySelector('span').textContent = 'Sending degraded'; } }).catch(function () {});
})();

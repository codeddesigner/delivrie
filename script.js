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

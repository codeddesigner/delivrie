// Live check of smtp.delivrie.io: verifies the TLS certificate, the SMTP greeting, that bad keys are refused,
// and (when SMTP_TEST_KEY is set) sends a real email to the delivered@ test address.
// Usage: node smtp/smoke.mjs [host]
import tls from "node:tls";

const HOST = process.argv[2] || "smtp.delivrie.io";
const KEY = process.env.SMTP_TEST_KEY || "";
const FROM = process.env.SMTP_TEST_FROM || "Delivrie SMTP check <hello@delivrie.io>";

function connect(port) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: HOST, port, servername: HOST, timeout: 15000 }, () => resolve(s));
    s.on("error", reject); s.on("timeout", () => reject(new Error(`timeout on ${port}`)));
  });
}
function reader(s) {
  let buf = "", waiters = [];
  s.on("data", (d) => { buf += d; flush(); });
  function flush() { while (waiters.length) { const m = buf.match(/^((?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n)/); if (!m) return; buf = buf.slice(m[0].length); waiters.shift()(m[0].trim()); } }
  const read = () => new Promise((r) => { waiters.push(r); flush(); });
  return { read, cmd: (l) => { s.write(l + "\r\n"); return read(); } };
}
const expect = (r, code, what) => { if (!r.startsWith(String(code))) throw new Error(`${what}: expected ${code}, got ${r}`); console.log(`ok  ${what}: ${r.split("\r\n").pop()}`); };
const b64 = (x) => Buffer.from(x).toString("base64");

for (const port of [465, 2465]) {
  const s = await connect(port);
  const cert = s.getPeerCertificate();
  console.log(`ok  TLS on ${port}: ${cert.subject?.CN} (issuer ${cert.issuer?.O}, valid to ${cert.valid_to})`);
  const c = reader(s);
  expect(await c.read(), 220, `greeting on ${port}`);
  expect(await c.cmd("EHLO smoke.test"), 250, "EHLO");
  expect(await c.cmd("AUTH PLAIN " + b64("\0delivrie\0dlv_live_not_a_real_key_000")), 535, "bad key refused");
  await c.cmd("QUIT"); s.end();
}

if (KEY) {
  const s = await connect(465); const c = reader(s);
  await c.read(); await c.cmd("EHLO smoke.test");
  expect(await c.cmd("AUTH PLAIN " + b64("\0delivrie\0" + KEY)), 235, "real key accepted");
  expect(await c.cmd(`MAIL FROM:<${FROM.match(/<([^>]+)>/)?.[1] || FROM}>`), 250, "MAIL FROM");
  expect(await c.cmd("RCPT TO:<delivered@test.delivrie.io>"), 250, "RCPT TO");
  expect(await c.cmd("DATA"), 354, "DATA");
  const id = Date.now();
  s.write(`From: ${FROM}\r\nTo: delivered@test.delivrie.io\r\nSubject: SMTP relay check ${id}\r\nMessage-ID: <smoke-${id}@delivrie.io>\r\nX-Delivrie-Tags: source=smtp-smoke\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSent through smtp.delivrie.io by the deploy check.\r\n.\r\n`);
  expect(await c.read(), 250, "message accepted");
  await c.cmd("QUIT"); s.end();
} else console.log("--  SMTP_TEST_KEY not set: skipped the real send");
console.log("smoke test passed");
process.exit(0);

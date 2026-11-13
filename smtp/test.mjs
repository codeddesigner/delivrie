// End-to-end test: runs the relay against a fake Delivrie API and talks raw SMTP to it.
// Run with: node smtp/test.mjs
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const GOOD = "dlv_live_goodkey12345", SEND_ONLY = "dlv_live_sendonly1234";
const sent = [];
let nextStatus = 200;
const api = http.createServer((req, res) => {
  const key = (req.headers.authorization || "").replace("Bearer ", "");
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (key !== GOOD && key !== SEND_ONLY) { res.statusCode = 401; return res.end(JSON.stringify({ message: "API key is invalid" })); }
    if (req.method === "GET") { res.statusCode = key === GOOD ? 404 : 403; return res.end("{}"); }
    if (nextStatus !== 200) { res.statusCode = nextStatus; nextStatus = 200; return res.end(JSON.stringify({ message: "Daily sending limit reached" })); }
    const j = JSON.parse(body); j._idem = req.headers["idempotency-key"]; j._ua = req.headers["user-agent"]; sent.push(j);
    res.end(JSON.stringify({ id: "em_" + sent.length }));
  });
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiPort = api.address().port, port = 30000 + Math.floor(Math.random() * 20000);
const relay = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { env: { ...process.env, PORT: String(port), DELIVRIE_API: `http://127.0.0.1:${apiPort}`, PROXY_PROTOCOL: process.env.TEST_PROXY || "0" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => relay.stdout.once("data", r));
process.on("exit", () => relay.kill());
process.on("uncaughtException", (e) => { console.error(e); relay.kill(); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); relay.kill(); process.exit(1); });

function client() {
  const s = net.connect(port, "127.0.0.1");
  let buf = "", waiters = [];
  s.on("data", (d) => { buf += d; flush(); });
  function flush() {
    while (waiters.length) {
      const m = buf.match(/^((?:\d{3}-[^\r\n]*\r\n)*\d{3}[ ][^\r\n]*\r\n)/);
      if (!m) return; buf = buf.slice(m[0].length); waiters.shift()(m[0].trim());
    }
  }
  const read = () => new Promise((r) => { waiters.push(r); flush(); });
  const cmd = async (line) => { s.write(line + "\r\n"); return read(); };
  return { s, read, cmd, write: (x) => s.write(x) };
}
const b64 = (s) => Buffer.from(s).toString("base64");
const ok = (r, code) => assert.ok(r.startsWith(String(code)), `expected ${code}, got: ${r}`);

// 1. auth required, bad key rejected, good key accepted
{
  const c = client(); ok(await c.read(), 220);
  const ehlo = await c.cmd("EHLO test"); assert.match(ehlo, /AUTH PLAIN LOGIN/); assert.match(ehlo, /SIZE/);
  ok(await c.cmd("MAIL FROM:<a@delivrie.io>"), 530);
  ok(await c.cmd("AUTH PLAIN " + b64("\0delivrie\0dlv_live_wrongkey123")), 535);
  ok(await c.cmd("AUTH PLAIN " + b64("\0delivrie\0" + GOOD)), 235);
  ok(await c.cmd("QUIT"), 221);
}
// 2. AUTH LOGIN with a sending-only key, multipart message with attachment, cc/bcc split, UTF-8 subject, dot-stuffing
{
  const c = client(); await c.read(); await c.cmd("EHLO wp.example");
  ok(await c.cmd("AUTH LOGIN"), 334); ok(await c.cmd(b64("delivrie")), 334); ok(await c.cmd(b64(SEND_ONLY)), 235);
  ok(await c.cmd("MAIL FROM:<bounce@delivrie.io> SIZE=2000"), 250);
  for (const r of ["ada@example.com", "bola@example.com", "hidden@example.com"]) ok(await c.cmd(`RCPT TO:<${r}>`), 250);
  ok(await c.cmd("DATA"), 354);
  const msg = [
    "From: \"Ada's Shop\" <hello@delivrie.io>", "To: Ada <ada@example.com>", "Cc: bola@example.com", "Reply-To: support@delivrie.io",
    "Subject: =?UTF-8?B?" + b64("Ọjà rẹ ti dé 🎉") + "?=", "Message-ID: <abc123@wp.example>", "X-Order-Id: 991", "List-Unsubscribe: <https://x.example/u>",
    "X-Delivrie-Tags: source=wordpress, order", "MIME-Version: 1.0", "Content-Type: multipart/mixed; boundary=\"OUTER\"", "",
    "--OUTER", "Content-Type: multipart/alternative; boundary=INNER", "",
    "--INNER", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Hello =E1=BB=8C",
    "..this line started with a dot", "--INNER", "Content-Type: text/html; charset=utf-8", "", "<p>Hello</p>", "--INNER--",
    "--OUTER", "Content-Type: application/pdf; name=\"invoice.pdf\"", "Content-Transfer-Encoding: base64", "Content-Disposition: attachment; filename=\"invoice.pdf\"", "",
    b64("%PDF-1.4 fake"), "--OUTER--", "",
  ].join("\r\n");
  c.write(msg + ".\r\n");
  const r = await c.read(); ok(r, 250); assert.match(r, /em_1/);
  const e = sent[0];
  assert.equal(e.from, "\"Ada's Shop\" <hello@delivrie.io>");
  assert.deepEqual(e.to, ["Ada <ada@example.com>"]); assert.deepEqual(e.cc, ["bola@example.com"]); assert.deepEqual(e.bcc, ["hidden@example.com"]);
  assert.deepEqual(e.reply_to, ["support@delivrie.io"]);
  assert.equal(e.subject, "Ọjà rẹ ti dé 🎉");
  assert.equal(e.text, "Hello Ọ\r\n.this line started with a dot"); assert.equal(e.html, "<p>Hello</p>");
  assert.equal(e.attachments.length, 1); assert.equal(e.attachments[0].filename, "invoice.pdf");
  assert.equal(Buffer.from(e.attachments[0].content, "base64").toString(), "%PDF-1.4 fake");
  assert.equal(e.headers["X-Order-Id"], "991"); assert.equal(e.headers["List-Unsubscribe"], "<https://x.example/u>"); assert.equal(e.headers["Message-ID"], undefined);
  assert.deepEqual(e.tags, [{ name: "source", value: "wordpress" }, { name: "order", value: "true" }]);
  assert.match(e._idem, /^smtp-[0-9a-f]{40}$/); assert.equal(e._ua, "Delivrie-SMTP/1.0");
  // second message on the same connection, sent one byte at a time; API answers 429
  nextStatus = 429;
  await c.cmd("MAIL FROM:<x@delivrie.io>"); await c.cmd("RCPT TO:<z@example.com>"); await c.cmd("DATA");
  const m2 = "From: hello@delivrie.io\r\nTo: z@example.com\r\nSubject: hi\r\n\r\nplain body\r\n.\r\n";
  for (const ch of m2) c.write(ch);
  ok(await c.read(), 452);
  // third: plain message, pipelined commands in one write
  c.write("MAIL FROM:<x@delivrie.io>\r\nRCPT TO:<z@example.com>\r\nDATA\r\n");
  ok(await c.read(), 250); ok(await c.read(), 250); ok(await c.read(), 354);
  c.write("From: hello@delivrie.io\r\nTo: z@example.com\r\nSubject: piped\r\n\r\nbody\r\n.\r\nQUIT\r\n");
  ok(await c.read(), 250); ok(await c.read(), 221);
  assert.equal(sent[1].subject, "piped"); assert.equal(sent[1].text, "body\r\n");
}
// 3. brute force: five bad logins, then the IP is locked out
{
  const c = client(); await c.read(); await c.cmd("EHLO x");
  // test 1 already used one failed login from this address, so four more reach the limit of five
  for (let i = 0; i < 4; i++) ok(await c.cmd("AUTH PLAIN " + b64("\0u\0dlv_live_bad_" + i + "xxxxxx")), 535);
  ok(await c.cmd("AUTH PLAIN " + b64("\0u\0" + GOOD)), 421);
}
relay.kill(); api.close();
console.log("all SMTP relay tests passed");
process.exit(0);

// Delivrie SMTP relay.
// Accepts mail over SMTP, authenticates with a Delivrie API key, and sends it through POST /emails,
// so plan limits, logs, webhooks, suppressions and domain checks all apply exactly as for the API.
//
// TLS is terminated by Fly (ports 465 and 2465, implicit TLS); this process speaks plain SMTP behind it.
// Set ALLOW_INSECURE_AUTH=1 only for local testing.
import net from "node:net";
import crypto from "node:crypto";
import { parseMessage, bareEmail } from "./mime.mjs";

const PORT = +(process.env.PORT || 2525);
const HOST = process.env.SMTP_HOSTNAME || "smtp.delivrie.io";
const API = (process.env.DELIVRIE_API || "https://delivrie.io/api").replace(/\/$/, "");
const MAX_SIZE = +(process.env.MAX_MESSAGE_BYTES || 40 * 1024 * 1024); // matches the API's 40 MB attachment limit
const MAX_RCPT = 50; // the API accepts up to 50 recipients per email
const IDLE_MS = 5 * 60 * 1000;
const PROXY = process.env.PROXY_PROTOCOL !== "0"; // Fly's proxy_proto handler sends the client IP first

const TERM = Buffer.from("\r\n.\r\n");
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

// ---- auth cache and brute-force protection (in memory, per machine)
const keyCache = new Map(); // sha256(key) -> { ok, until }
const fails = new Map(); // ip -> { n, until }
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function blocked(ip) { const f = fails.get(ip); return f && f.n >= 5 && f.until > Date.now(); }
function failed(ip) { const f = fails.get(ip) || { n: 0, until: 0 }; if (f.until < Date.now()) f.n = 0; f.n++; f.until = Date.now() + 15 * 60 * 1000; fails.set(ip, f); }
setInterval(() => { const now = Date.now(); for (const [k, v] of fails) if (v.until < now) fails.delete(k); for (const [k, v] of keyCache) if (v.until < now) keyCache.delete(k); }, 60_000).unref();

async function checkKey(key) {
  if (!/^dlv_[A-Za-z0-9_-]{8,}$/.test(key)) return false;
  const h = sha(key), c = keyCache.get(h);
  if (c && c.until > Date.now()) return c.ok;
  // Any authenticated request that isn't 401 proves the key exists. Sending-only keys get 403 here, full keys 404.
  const r = await fetch(`${API}/emails/00000000-0000-0000-0000-000000000000`, { headers: { authorization: `Bearer ${key}`, "user-agent": "Delivrie-SMTP/1.0" } });
  if (r.status >= 500) throw new Error(`auth check ${r.status}`);
  const ok = r.status !== 401;
  keyCache.set(h, { ok, until: Date.now() + (ok ? 5 : 1) * 60 * 1000 });
  return ok;
}

// ---- build the API request from the envelope and the parsed message
export function toApi(raw, envFrom, rcpts) {
  const m = parseMessage(raw);
  const want = new Set(rcpts.map((r) => r.toLowerCase()));
  const used = new Set();
  const pick = (list) => list.filter((a) => { const e = bareEmail(a); if (!want.has(e) || used.has(e)) return false; used.add(e); return true; });
  const to = pick(m.to), cc = pick(m.cc);
  const bcc = rcpts.filter((r) => !used.has(r.toLowerCase()));
  const body = { from: m.from || envFrom, to: to.length ? to : bcc.splice(0, 1), subject: m.subject || "(no subject)" };
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;
  if (m.reply_to.length) body.reply_to = m.reply_to;
  if (m.html !== null) body.html = m.html;
  if (m.text !== null) body.text = m.text;
  if (body.html == null && body.text == null) body.text = "";
  if (Object.keys(m.headers).length) body.headers = m.headers;
  if (m.attachments.length) body.attachments = m.attachments;
  if (m.tags.length) body.tags = m.tags;
  return { body, messageId: m.message_id };
}

async function send(key, raw, envFrom, rcpts) {
  const { body, messageId } = toApi(raw, envFrom, rcpts);
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "Delivrie-SMTP/1.0" };
  if (messageId) headers["idempotency-key"] = "smtp-" + sha(messageId + "|" + rcpts.join(",")).slice(0, 40);
  const r = await fetch(`${API}/emails`, { method: "POST", headers, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, id: j.id, message: j.message || j.error?.message || j.name || "" };
}

// ---- SMTP session
function session(sock, ip) {
  let state = { helo: false, key: null, from: null, rcpt: [] };
  let tail = Buffer.from("\r\n"), mode = "cmd", authStep = null, authUser = "", data = [], dataLen = 0, tooBig = false, busy = false, buf = Buffer.alloc(0), proxyDone = !PROXY;
  const reply = (s) => { if (!sock.destroyed) sock.write(s + "\r\n"); };
  const reset = () => { state.from = null; state.rcpt = []; data = []; dataLen = 0; tooBig = false; tail = Buffer.from("\r\n"); };
  sock.setTimeout(IDLE_MS, () => { reply("421 4.4.2 Idle timeout, closing connection"); sock.end(); });

  const greet = () => { if (blocked(ip)) { reply("421 4.7.0 Too many failed logins, try again later"); return sock.end(); } reply(`220 ${HOST} ESMTP Delivrie`); };
  if (proxyDone) greet();

  async function finishAuth(user, pass) {
    if (blocked(ip)) { reply("421 4.7.0 Too many failed logins, try again later"); return sock.end(); }
    let ok = false;
    try { ok = await checkKey(pass); } catch (e) { log({ ev: "auth_error", ip, err: String(e) }); return reply("454 4.7.0 Temporary authentication failure, try again"); }
    if (!ok) { failed(ip); log({ ev: "auth_fail", ip, user }); return reply("535 5.7.8 Authentication failed. Use username \"delivrie\" and a Delivrie API key as the password."); }
    state.key = pass; log({ ev: "auth_ok", ip, key: pass.slice(0, 8) });
    reply("235 2.7.0 Authentication successful");
  }

  async function command(line) {
    const [verbRaw, ...rest] = line.split(" ");
    const verb = verbRaw.toUpperCase(), arg = rest.join(" ").trim();
    if (authStep) {
      const v = line.trim();
      if (v === "*") { authStep = null; return reply("501 5.7.0 Authentication cancelled"); }
      let dec; try { dec = Buffer.from(v, "base64").toString("utf8"); } catch { authStep = null; return reply("501 5.5.2 Invalid base64"); }
      if (authStep === "plain") { authStep = null; const [, u = "", p = ""] = dec.split("\0"); return finishAuth(u, p); }
      if (authStep === "login-user") { authUser = dec; authStep = "login-pass"; return reply("334 UGFzc3dvcmQ6"); }
      if (authStep === "login-pass") { authStep = null; return finishAuth(authUser, dec); }
    }
    switch (verb) {
      case "EHLO": case "HELO":
        state.helo = true; reset();
        if (verb === "HELO") return reply(`250 ${HOST}`);
        return reply([`250-${HOST} Hello`, `250-SIZE ${MAX_SIZE}`, "250-8BITMIME", "250-ENHANCEDSTATUSCODES", "250-AUTH PLAIN LOGIN", "250 SMTPUTF8"].join("\r\n"));
      case "AUTH": {
        if (!state.helo) return reply("503 5.5.1 Send EHLO first");
        if (state.key) return reply("503 5.5.1 Already authenticated");
        const [mech, initial] = arg.split(/\s+/);
        if (/^PLAIN$/i.test(mech)) {
          if (initial) { const [, u = "", p = ""] = Buffer.from(initial, "base64").toString("utf8").split("\0"); return finishAuth(u, p); }
          authStep = "plain"; return reply("334 ");
        }
        if (/^LOGIN$/i.test(mech)) {
          if (initial) { authUser = Buffer.from(initial, "base64").toString("utf8"); authStep = "login-pass"; return reply("334 UGFzc3dvcmQ6"); }
          authStep = "login-user"; return reply("334 VXNlcm5hbWU6");
        }
        return reply("504 5.5.4 Use AUTH PLAIN or AUTH LOGIN");
      }
      case "MAIL": {
        if (!state.key) return reply("530 5.7.0 Authentication required");
        const m = arg.match(/^FROM:\s*<([^>]*)>(.*)$/i);
        if (!m) return reply("501 5.5.4 Syntax: MAIL FROM:<address>");
        const size = (m[2].match(/SIZE=(\d+)/i) || [])[1];
        if (size && +size > MAX_SIZE) return reply(`552 5.3.4 Message too big, the limit is ${Math.floor(MAX_SIZE / 1048576)} MB`);
        reset(); state.from = m[1]; return reply("250 2.1.0 OK");
      }
      case "RCPT": {
        if (state.from === null) return reply("503 5.5.1 Send MAIL FROM first");
        const m = arg.match(/^TO:\s*<([^>]+)>/i);
        if (!m || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m[1])) return reply("501 5.1.3 Bad recipient address");
        if (state.rcpt.length >= MAX_RCPT) return reply(`452 4.5.3 Too many recipients, at most ${MAX_RCPT} per message`);
        state.rcpt.push(m[1]); return reply("250 2.1.5 OK");
      }
      case "DATA":
        if (!state.rcpt.length) return reply("503 5.5.1 Send RCPT TO first");
        mode = "data"; return reply("354 End data with <CR><LF>.<CR><LF>");
      case "RSET": reset(); return reply("250 2.0.0 OK");
      case "NOOP": return reply("250 2.0.0 OK");
      case "QUIT": reply("221 2.0.0 Bye"); return sock.end();
      case "STARTTLS": return reply("454 4.7.0 Connect with TLS on port 465 or 2465 instead");
      case "VRFY": return reply("252 2.5.2 Cannot verify, but will try to deliver");
      case "HELP": return reply("214 2.0.0 See https://delivrie.io/docs/smtp");
      default: return reply("502 5.5.2 Command not recognised");
    }
  }

  async function message() {
    const raw = Buffer.concat(data).toString("latin1").replace(/(^|\r\n)\./g, "$1"); // undo dot-stuffing
    const rc = state.rcpt.slice(), from = state.from, key = state.key;
    reset();
    if (tooBig) return reply(`552 5.3.4 Message too big, the limit is ${Math.floor(MAX_SIZE / 1048576)} MB`);
    try {
      const r = await send(key, raw, from, rc);
      log({ ev: "send", ip, key: key.slice(0, 8), status: r.status, id: r.id, rcpt: rc.length, bytes: raw.length });
      if (r.status >= 200 && r.status < 300) return reply(`250 2.0.0 OK queued as ${r.id || "unknown"}`);
      const msg = (r.message || "Rejected").replace(/[\r\n]+/g, " ").slice(0, 400);
      if (r.status === 401) return reply("535 5.7.8 API key is no longer valid");
      if (r.status === 429) return reply(`452 4.3.1 ${msg}`);
      if (r.status >= 500) return reply("451 4.3.0 Temporary problem sending, please retry");
      return reply(`550 5.7.1 ${msg}`);
    } catch (e) {
      log({ ev: "send_error", ip, err: String(e) });
      return reply("451 4.3.0 Temporary problem sending, please retry");
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        if (!proxyDone) {
          const i = buf.indexOf("\r\n"); if (i === -1) { if (buf.length > 200) return sock.destroy(); break; }
          const line = buf.subarray(0, i).toString("latin1"); buf = buf.subarray(i + 2);
          const p = line.match(/^PROXY (?:TCP4|TCP6) (\S+) /); if (p) ip = p[1];
          else if (!/^PROXY UNKNOWN/.test(line)) return sock.destroy();
          proxyDone = true; greet(); continue;
        }
        if (mode === "data") {
          if (!buf.length) break;
          const b = buf; buf = Buffer.alloc(0);
          const search = Buffer.concat([tail, b]);
          const j = search.indexOf(TERM);
          if (j === -1) {
            dataLen += b.length;
            if (dataLen > MAX_SIZE * 1.4) { tooBig = true; data = []; }
            if (!tooBig) data.push(b);
            tail = Buffer.from(search.subarray(-4));
            break;
          }
          const endB = j + 2 - tail.length; // keep the CRLF before the final dot
          if (endB >= 0) { if (!tooBig) data.push(b.subarray(0, endB)); }
          else if (!tooBig) { let cut = -endB; while (cut > 0 && data.length) { const last = data.pop(); if (last.length > cut) { data.push(last.subarray(0, last.length - cut)); cut = 0; } else cut -= last.length; } }
          buf = Buffer.from(b.subarray(j + TERM.length - tail.length));
          mode = "cmd";
          await message();
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i === -1) { if (buf.length > 8192) { reply("500 5.5.6 Line too long"); return sock.end(); } break; }
        const line = buf.subarray(0, i).toString("utf8"); buf = buf.subarray(i + 2);
        await command(line);
        if (sock.destroyed) return;
      }
    } finally { busy = false; }
  }

  sock.on("data", (d) => { buf = Buffer.concat([buf, d]); pump().catch((e) => { log({ ev: "session_error", ip, err: String(e) }); sock.destroy(); }); });
  sock.on("error", () => {});
}

let open = 0;
const server = net.createServer((sock) => {
  if (open >= 500) { sock.end("421 4.3.2 Busy, try again later\r\n"); return; }
  open++; sock.on("close", () => open--);
  session(sock, sock.remoteAddress || "unknown");
});
if (process.env.SMTP_NO_LISTEN !== "1") server.listen(PORT, () => log({ ev: "listening", port: PORT, api: API, proxy: PROXY }));
process.on("SIGTERM", () => { server.close(); setTimeout(() => process.exit(0), 10_000).unref(); });
export { server };

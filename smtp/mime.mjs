// Minimal MIME parser for the SMTP relay. Turns a raw RFC 5322 message into the
// fields POST /emails accepts. No dependencies.
// The raw message is held as a "binary" (latin1) string so 8-bit bytes survive untouched.

const bytesOf = (s) => Buffer.from(s, "latin1");

function decodeQP(s) {
  const src = s.replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(src.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

function decodeText(buf, charset) {
  const cs = (charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

/** RFC 2047 encoded-words in headers ("=?UTF-8?B?...?="). Header bytes outside them are read as UTF-8. */
export function decodeWords(s) {
  const plain = decodeText(bytesOf(s), "utf-8");
  return plain.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs, e, t) => {
    try {
      const b = e.toUpperCase() === "B" ? Buffer.from(t, "base64") : decodeQP(t.replace(/_/g, " "));
      return decodeText(b, cs);
    } catch { return t; }
  });
}

function splitHeaders(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const idx = m ? m.index : -1;
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx + m[0].length);
  const headers = {}, all = [];
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    all.push([line.slice(0, i).trim(), v]);
    if (!(k in headers)) headers[k] = v;
  }
  return { headers, all, body };
}

function param(h, name) {
  const m = h.match(new RegExp(`(?:^|;)\\s*${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  if (!m) return null;
  let v = m[1] ?? m[2];
  const star = v.match(/^([^']*)'[^']*'(.*)$/); // RFC 2231: utf-8''na%C3%AFve.pdf
  if (star) { try { v = decodeText(Buffer.from(decodeURIComponent(star[2]).split("").map((c) => c.charCodeAt(0) & 0xff)), star[1] || "utf-8"); } catch { v = star[2]; } }
  return v;
}

/** Split an address-list header on commas that are outside quotes and angle brackets. */
export function addressList(v) {
  if (!v) return [];
  const out = []; let cur = "", q = false, a = 0;
  for (const ch of v) {
    if (ch === '"') q = !q;
    else if (!q && ch === "<") a++;
    else if (!q && ch === ">") a = Math.max(0, a - 1);
    if (ch === "," && !q && !a) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export const bareEmail = (s) => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim().toLowerCase(); };

// Headers we pass through to the API. Everything else (Received, Date, MIME plumbing, DKIM…) is rebuilt by Delivrie.
const PASS = /^(x-|list-unsubscribe|list-id|in-reply-to|references|precedence|auto-submitted|importance|priority)/i;
const NEVER = /^(x-delivrie-tags|x-mailer-recptid)$/i;

export function parseMessage(raw) {
  const out = { from: "", to: [], cc: [], reply_to: [], subject: "", html: null, text: null, headers: {}, attachments: [], message_id: null, tags: [] };
  const walk = (part, depth) => {
    if (depth > 20) return;
    const { headers, body } = splitHeaders(part);
    const ct = headers["content-type"] || "text/plain";
    const cte = (headers["content-transfer-encoding"] || "7bit").toLowerCase();
    if (/^multipart\//i.test(ct)) {
      const b = param(ct, "boundary");
      if (!b) return;
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pieces = body.split(new RegExp(`(?:^|\\r?\\n)--${esc}(?:--)?[ \\t]*(?=\\r?\\n|$)`));
      pieces.shift(); // preamble
      for (const p of pieces) if (p.replace(/^\r?\n/, "").trim()) walk(p.replace(/^\r?\n/, ""), depth + 1);
      return;
    }
    // Non-text parts (images, PDFs, forwarded message/rfc822…) become attachments so nothing is lost.
    const disp = headers["content-disposition"] || "";
    const filename = param(disp, "filename") || param(ct, "name");
    const buf = cte === "base64" ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64") : cte === "quoted-printable" ? decodeQP(body) : bytesOf(body);
    const isText = /^text\/(plain|html)/i.test(ct);
    if (filename || /^attachment/i.test(disp) || !isText) {
      const cid = (headers["content-id"] || "").replace(/^<|>$/g, "").trim();
      const fname = filename ? decodeWords(filename) : (/^message\/rfc822/i.test(ct) ? "message.eml" : "attachment");
      out.attachments.push({ filename: fname, content: buf.toString("base64"), content_type: ct.split(";")[0].trim().toLowerCase(), ...(cid ? { content_id: cid } : {}) });
      return;
    }
    const text = decodeText(buf, param(ct, "charset"));
    if (/^text\/html/i.test(ct)) { if (out.html === null) out.html = text; }
    else if (out.text === null) out.text = text;
  };
  const { headers, all } = splitHeaders(raw);
  const h = (k) => (headers[k] ? decodeWords(headers[k]) : "");
  out.from = h("from");
  out.to = addressList(h("to"));
  out.cc = addressList(h("cc"));
  out.reply_to = addressList(h("reply-to"));
  out.subject = h("subject");
  out.message_id = (headers["message-id"] || "").replace(/^<|>$/g, "").trim() || null;
  for (const [k, v] of all) if (PASS.test(k) && !NEVER.test(k)) out.headers[k] = decodeWords(v);
  if (headers["x-delivrie-tags"]) {
    out.tags = decodeWords(headers["x-delivrie-tags"]).split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf("="); return i > 0 ? { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() } : { name: s, value: "true" }; });
  }
  walk(raw, 0);
  return out;
}

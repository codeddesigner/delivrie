// RFC 5322 / MIME message builder and a small parser for inbound mail.
const enc = new TextEncoder();

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function wrap76(s: string): string { return s.replace(/(.{76})/g, "$1\r\n"); }
function isAscii(s: string) { return /^[\x20-\x7e]*$/.test(s); }

/** RFC 2047 encode a header value if it contains non-ASCII. */
export function encodeWord(s: string): string {
  if (isAscii(s)) return s;
  const bytes = enc.encode(s);
  // split into chunks so each encoded-word stays under 75 chars
  const words: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(bytes.length, i + 42);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split UTF-8 sequences
    words.push(`=?UTF-8?B?${b64(bytes.subarray(i, end))}?=`);
    i = end;
  }
  return words.join("\r\n ");
}

/** Parse "Name <addr@x>" or "addr@x" */
export function parseAddress(s: string): { name: string | null; email: string } {
  const m = s.trim().match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2].trim() };
  return { name: null, email: s.trim() };
}
export function formatAddress(s: string): string {
  const { name, email } = parseAddress(s);
  if (!name) return email;
  const needsQuote = /[()<>\[\]:;@\\,."]/.test(name);
  return `${isAscii(name) ? (needsQuote ? `"${name.replace(/"/g, '\\"')}"` : name) : encodeWord(name)} <${email}>`;
}
export const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function qpEncode(text: string): string {
  // quoted-printable for text parts (keeps HTML readable in raw view)
  const bytes = enc.encode(text.replace(/\r?\n/g, "\r\n"));
  let line = "", out = "";
  const push = (chunk: string) => {
    if (line.length + chunk.length > 75) { out += line + "=\r\n"; line = ""; }
    line += chunk;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      // encode trailing whitespace before line break
      if (line.endsWith(" ") || line.endsWith("\t")) { const last = line.slice(-1); line = line.slice(0, -1) + "=" + last.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"); }
      out += line + "\r\n"; line = ""; i++; continue;
    }
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9) push(String.fromCharCode(b));
    else push("=" + b.toString(16).toUpperCase().padStart(2, "0"));
  }
  return out + line;
}

export interface Attachment { filename: string; content: string /* base64 */; content_type?: string; content_id?: string }

export interface BuildInput {
  from: string; to: string[]; cc?: string[]; bcc?: string[]; replyTo?: string[];
  subject: string; html?: string | null; text?: string | null;
  headers?: Record<string, string>; attachments?: Attachment[]; messageIdDomain?: string;
}

function boundary() { return "dlv_" + crypto.randomUUID().replace(/-/g, ""); }

export function buildMime(m: BuildInput): string {
  const lines: string[] = [];
  const h = (k: string, v: string) => lines.push(`${k}: ${v}`);
  h("From", formatAddress(m.from));
  h("To", m.to.map(formatAddress).join(", "));
  if (m.cc?.length) h("Cc", m.cc.map(formatAddress).join(", "));
  if (m.replyTo?.length) h("Reply-To", m.replyTo.map(formatAddress).join(", "));
  h("Subject", encodeWord(m.subject || ""));
  h("Date", new Date().toUTCString().replace("GMT", "+0000"));
  h("MIME-Version", "1.0");
  for (const [k, v] of Object.entries(m.headers ?? {})) {
    if (/^(from|to|cc|bcc|subject|date|mime-version|content-type|content-transfer-encoding)$/i.test(k)) continue;
    if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) continue; // header injection guard
    h(k, isAscii(v) ? v : encodeWord(v));
  }
  const text = m.text ?? (m.html ? htmlToText(m.html) : "");
  const textPart = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpEncode(text)}`;
  const htmlPart = m.html ? `Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpEncode(m.html)}` : null;
  let body: string;
  let bodyHeaders: string;
  const alt = htmlPart ? (() => { const b = boundary(); return { b, part: `--${b}\r\n${textPart}\r\n--${b}\r\n${htmlPart}\r\n--${b}--` }; })() : null;
  if (m.attachments?.length) {
    const mb = boundary();
    const parts: string[] = [];
    parts.push(alt ? `Content-Type: multipart/alternative; boundary="${alt.b}"\r\n\r\n${alt.part}` : textPart);
    for (const a of m.attachments) {
      const ct = a.content_type || guessType(a.filename);
      const fname = encodeWord(a.filename).replace(/"/g, "");
      parts.push(`Content-Type: ${ct}; name="${fname}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ${a.content_id ? "inline" : "attachment"}; filename="${fname}"` + (a.content_id ? `\r\nContent-ID: <${a.content_id}>` : "") + `\r\n\r\n${wrap76(a.content.replace(/\s+/g, ""))}`);
    }
    bodyHeaders = `Content-Type: multipart/mixed; boundary="${mb}"`;
    body = parts.map((p) => `--${mb}\r\n${p}`).join("\r\n") + `\r\n--${mb}--`;
  } else if (alt) {
    bodyHeaders = `Content-Type: multipart/alternative; boundary="${alt.b}"`;
    body = alt.part;
  } else {
    bodyHeaders = "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable";
    body = qpEncode(text);
  }
  return lines.join("\r\n") + "\r\n" + bodyHeaders + "\r\n\r\n" + body + "\r\n";
}

export function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", txt: "text/plain", csv: "text/csv", html: "text/html", json: "application/json", zip: "application/zip", ics: "text/calendar", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", mp4: "video/mp4" } as Record<string, string>)[ext] || "application/octet-stream";
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => { const label = t.replace(/<[^>]+>/g, "").trim(); return label && label !== href ? `${label}: ${href}` : href; })
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/li|hr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------- Parser (inbound) ----------------
function decodeQP(s: string): Uint8Array {
  const src = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else { const b = enc.encode(c); out.push(...b); }
  }
  return new Uint8Array(out);
}
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs, e, t) => {
    try {
      const bytes = e.toUpperCase() === "B" ? b64ToBytes(t) : decodeQP(t.replace(/_/g, " "));
      return new TextDecoder(cs.toLowerCase()).decode(bytes);
    } catch { return t; }
  });
}
function splitHeaders(raw: string): { headers: Record<string, string>; body: string } {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx).replace(/^\r?\n\r?\n/, "");
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in headers)) headers[k] = line.slice(i + 1).trim(); }
  }
  return { headers, body };
}
function param(h: string, name: string): string | null {
  const m = h.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m ? (m[1] ?? m[2]) : null;
}

export interface ParsedMail { headers: Record<string, string>; subject: string; from: string; to: string[]; cc: string[]; html: string | null; text: string | null; attachments: { filename: string; content_type: string; size: number }[] }

export function parseMime(raw: string): ParsedMail {
  const out: ParsedMail = { headers: {}, subject: "", from: "", to: [], cc: [], html: null, text: null, attachments: [] };
  const walk = (part: string) => {
    const { headers, body } = splitHeaders(part);
    const ct = headers["content-type"] || "text/plain";
    const cte = (headers["content-transfer-encoding"] || "7bit").toLowerCase();
    if (/^multipart\//i.test(ct)) {
      const b = param(ct, "boundary");
      if (!b) return;
      const pieces = body.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*`));
      for (const p of pieces) if (p.trim()) walk(p);
      return;
    }
    const disp = headers["content-disposition"] || "";
    const filename = param(disp, "filename") || param(ct, "name");
    const bytes = cte === "base64" ? b64ToBytes(body) : cte === "quoted-printable" ? decodeQP(body) : enc.encode(body);
    if (filename || /attachment/i.test(disp)) { out.attachments.push({ filename: decodeWords(filename || "attachment"), content_type: ct.split(";")[0], size: bytes.length }); return; }
    const charset = (param(ct, "charset") || "utf-8").toLowerCase();
    let text: string;
    try { text = new TextDecoder(charset).decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
    if (/^text\/html/i.test(ct) && out.html === null) out.html = text;
    else if (/^text\/plain/i.test(ct) && out.text === null) out.text = text;
  };
  const { headers } = splitHeaders(raw);
  out.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, decodeWords(v)]));
  out.subject = out.headers["subject"] || "";
  out.from = out.headers["from"] || "";
  const list = (v?: string) => (v ? v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean) : []);
  out.to = list(out.headers["to"]);
  out.cc = list(out.headers["cc"]);
  walk(raw);
  return out;
}

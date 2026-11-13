// Shared by the browser editor and the sending backend: email blocks -> email-safe HTML,
// and {{variable}} substitution. Plain JS, no dependencies.

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Inline HTML allowed in text blocks (from the editor): b, strong, i, em, u, s, a, br, span, code.
export function sanitizeInline(html) {
  const s = String(html ?? "");
  return s
    .replace(/<\s*(script|style|iframe|object|embed|form|input|textarea|select|button|meta|link)[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (m, close, tag, attrs) => {
      tag = tag.toLowerCase();
      if (!["b", "strong", "i", "em", "u", "s", "strike", "a", "br", "span", "code"].includes(tag)) return "";
      if (close) return `</${tag}>`;
      if (tag === "a") {
        const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || attrs.match(/href\s*=\s*'([^']*)'/i) || [])[1] || "";
        if (!/^(https?:|mailto:|tel:|\{\{)/i.test(href.trim())) return "<a>";
        return `<a href="${esc(href)}">`;
      }
      return `<${tag}>`;
    })
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export const DEFAULT_STYLE = {
  page: { background: "#ffffff", text: "#211f20", muted: "#6b6f76", accent: "#fad600", font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", width: 600 },
};

function boxStyle(st = {}, defaults = {}) {
  const s = { ...defaults, ...st };
  const parts = [];
  if (s.color) parts.push(`color:${s.color}`);
  if (s.fontSize) parts.push(`font-size:${parseInt(s.fontSize)}px`);
  if (s.lineHeight) parts.push(`line-height:${s.lineHeight}`);
  if (s.weight) parts.push(`font-weight:${s.weight === "Bold" ? 700 : s.weight === "Medium" ? 500 : s.weight === "Semibold" ? 600 : 400}`);
  if (s.align) parts.push(`text-align:${s.align}`);
  if (s.padding) parts.push(`padding:${String(s.padding).trim().split(/\s+/).map((v) => parseInt(v) + "px").join(" ")}`);
  if (s.background && s.background !== "None") parts.push(`background:${s.background}`);
  if (s.radius) parts.push(`border-radius:${parseInt(s.radius)}px`);
  if (s.borderColor) parts.push(`border:1px solid ${s.borderColor}`);
  return parts.join(";");
}

function row(inner, st, defaults) {
  const margin = st?.margin ? parseInt(st.margin) : 0;
  return `<tr><td style="${boxStyle(st, defaults)}${margin ? `;padding-bottom:${margin}px` : ""}">${inner}</td></tr>`;
}

/** Render blocks to a full HTML document. vars: substituted later by renderVars. */
export function renderBlocks(doc, opts = {}) {
  const page = { ...DEFAULT_STYLE.page, ...(doc?.page || {}) };
  const blocks = doc?.blocks || [];
  const body = blocks.map((b) => renderBlock(b, page, opts)).join("");
  const preview = opts.previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.previewText)}${"&#8204;&nbsp;".repeat(60)}</div>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.subject || "")}</title></head>` +
    `<body style="margin:0;padding:0;background:${page.background};font-family:${page.font};color:${page.text}">${preview}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${page.background}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${page.width}px;font-family:${page.font};color:${page.text}">${body}</table>` +
    `</td></tr></table></body></html>`;
}

export function renderBlock(b, page, opts = {}) {
  const st = b.style || {};
  const t = page.text;
  switch (b.type) {
    case "title": return row(`<h1 style="margin:0;font-size:${st.fontSize ? parseInt(st.fontSize) : 28}px;line-height:1.2;font-weight:700;color:${st.color || t}">${sanitizeInline(b.html ?? esc(b.text))}</h1>`, { padding: "0 0 12 0", ...st, fontSize: null, color: null });
    case "heading": return row(`<h2 style="margin:0;font-size:${st.fontSize ? parseInt(st.fontSize) : 20}px;line-height:1.3;font-weight:600;color:${st.color || t}">${sanitizeInline(b.html ?? esc(b.text))}</h2>`, { padding: "8 0 8 0", ...st, fontSize: null, color: null });
    case "text": return row(sanitizeInline(b.html ?? esc(b.text)), st, { fontSize: 16, lineHeight: 1.6, color: t, padding: "0 0 12 0" });
    case "bulleted":
    case "numbered": {
      const tag = b.type === "bulleted" ? "ul" : "ol";
      const items = (b.items || []).map((i) => `<li style="margin:0 0 6px">${sanitizeInline(i)}</li>`).join("");
      return row(`<${tag} style="margin:0;padding-left:22px">${items}</${tag}>`, st, { fontSize: 16, lineHeight: 1.6, color: t, padding: "0 0 12 0" });
    }
    case "image": {
      if (!b.src) return "";
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt || "")}" width="${b.width ? parseInt(b.width) : page.width}" style="display:block;max-width:100%;height:auto;border:0;${st.radius ? `border-radius:${parseInt(st.radius)}px` : ""}">`;
      return row(b.href ? `<a href="${esc(b.href)}">${img}</a>` : img, { ...st, radius: null }, { padding: "0 0 12 0", align: b.align || "left" });
    }
    case "button": {
      const pad = String(st.padding || "10 18 10 18").trim().split(/\s+/).map((v) => parseInt(v) + "px").join(" ");
      const w = b.width === "Full" ? "display:block;text-align:center" : "display:inline-block";
      return row(`<a href="${esc(b.href || "#")}" style="${w};background:${b.fill || page.accent};color:${b.color || "#211f20"};padding:${pad};border-radius:${b.radius != null ? parseInt(b.radius) : 6}px;font-weight:600;font-size:15px;text-decoration:none">${esc(b.text || "Button")}</a>`, { padding: "4 0 16 0", align: b.align || "left" });
    }
    case "divider": return row(`<div style="height:1px;background:${st.color || "#e6e6e6"};line-height:1px;font-size:1px">&nbsp;</div>`, { padding: "12 0 12 0" });
    case "spacer": return `<tr><td style="height:${parseInt(b.height || 24)}px;line-height:1px;font-size:1px">&nbsp;</td></tr>`;
    case "columns": {
      const cols = (b.columns || []).map((c) => `<td valign="top" style="width:${Math.floor(100 / (b.columns.length || 1))}%;padding:0 8px;font-size:15px;line-height:1.6;color:${t}">${sanitizeInline(c.html || "")}</td>`).join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>`, st, { padding: "0 0 12 0" });
    }
    case "social": {
      const links = (b.links || []).filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" style="color:${page.muted};text-decoration:none;margin-right:12px;font-size:13px">${esc(l.label || l.network)}</a>`).join("");
      return links ? row(links, st, { padding: "8 0 8 0", align: b.align || "left" }) : "";
    }
    case "footer": {
      const reason = b.reason ? `<div>${esc(b.reason)}</div>` : "";
      const links = `<div style="margin-top:4px"><a href="{{{unsubscribe_url}}}" style="color:${page.muted}">Unsubscribe</a> or <a href="{{{preferences_url}}}" style="color:${page.muted}">manage preferences</a></div>`;
      const addr = b.address ? `<div style="margin-top:8px">${esc(b.address)}</div>` : "";
      return row(`${reason}${links}${addr}`, st, { fontSize: 12, lineHeight: 1.5, color: page.muted, padding: "24 0 0 0" });
    }
    case "html": return `<tr><td>${b.html || ""}</td></tr>`;
    case "code": return row(`<pre style="margin:0;white-space:pre-wrap;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;background:#0f1011;color:#e6e6e6;padding:${parseInt(st.padding ?? 16)}px;border-radius:${parseInt(st.radius ?? 8)}px">${esc(b.code || "")}</pre>`, { padding: "0 0 12 0" });
    default: return "";
  }
}

/**
 * Replace {{{var}}} (raw) and {{var}} (escaped) with values.
 * definitions: [{name, fallback}] - fallback used when value is missing/empty.
 */
export function renderVars(str, vars = {}, definitions = []) {
  if (str == null) return str;
  const fb = Object.fromEntries((definitions || []).map((d) => [d.name ?? d.key, d.fallback ?? d.fallback_value]));
  const get = (name) => {
    const key = name.trim();
    const [k, inlineFallback] = key.split("|").map((x) => x.trim());
    let v = vars[k];
    if (v === undefined || v === null || v === "") v = fb[k];
    if ((v === undefined || v === null || v === "") && inlineFallback !== undefined) v = inlineFallback.replace(/^["']|["']$/g, "");
    return v === undefined || v === null ? "" : String(v);
  };
  return String(str)
    .replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_m, n) => get(n))
    .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, n) => esc(get(n)));
}

export function blocksToText(doc) {
  return (doc?.blocks || []).map((b) => {
    const strip = (h) => String(h ?? "").replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    switch (b.type) {
      case "title": case "heading": case "text": return strip(b.html ?? b.text);
      case "bulleted": return (b.items || []).map((i) => "• " + strip(i)).join("\n");
      case "numbered": return (b.items || []).map((i, n) => `${n + 1}. ${strip(i)}`).join("\n");
      case "button": return `${b.text}: ${b.href}`;
      case "divider": return "---";
      case "columns": return (b.columns || []).map((c) => strip(c.html)).join("\n");
      case "footer": return [b.reason, "Unsubscribe: {{{unsubscribe_url}}}", b.address].filter(Boolean).join("\n");
      case "code": return b.code || "";
      case "image": return b.alt ? `[${b.alt}]` : "";
      default: return "";
    }
  }).filter(Boolean).join("\n\n");
}

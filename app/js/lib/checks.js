// Link & compatibility checks before a broadcast or template goes out (Figma 3.7). Runs in the browser on the rendered HTML.
const isVar = (s) => /\{\{\{?\s*[\w.|" ]+\}\}\}?/.test(s);
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|test\.com|yourdomain\.com|domain\.com|localhost)$/i;
const BAD_CSS = [[/display\s*:\s*grid/i, "CSS grid"], [/display\s*:\s*flex/i, "Flexbox"], [/position\s*:\s*(absolute|fixed|sticky)/i, "Positioned elements"], [/@media\s*\(prefers-color-scheme/i, "Dark-mode media queries"]];

export function runChecks(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const out = [];
  // links
  const links = [...doc.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href").trim(), text: a.textContent.trim().slice(0, 40) || "Image link" }));
  const broken = [], placeholders = [], insecure = [];
  for (const l of links) {
    if (isVar(l.href) || /^(mailto|tel):/i.test(l.href)) continue;
    if (!l.href || l.href === "#" || /^javascript:/i.test(l.href)) { placeholders.push(`“${l.text}” points to ${l.href || "nothing"}`); continue; }
    let u; try { u = new URL(l.href); } catch { broken.push(`“${l.text}” has an invalid address: ${l.href}`); continue; }
    if (!/^https?:$/.test(u.protocol)) broken.push(`“${l.text}” uses ${u.protocol} links`);
    else if (PLACEHOLDER_HOSTS.test(u.hostname)) placeholders.push(`“${l.text}” points to ${u.hostname}`);
    else if (u.protocol === "http:") insecure.push(`“${l.text}” uses http instead of https`);
  }
  out.push({ key: "links", title: "Links", ok: !broken.length && !insecure.length, sev: broken.length ? "error" : "warn", items: [...broken, ...insecure], pass: `${links.length} link${links.length === 1 ? "" : "s"} checked · all valid` });
  out.push({ key: "placeholders", title: "Placeholders", ok: !placeholders.length, sev: "warn", items: placeholders, pass: "No “#” or example.com links" });
  // compatibility
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n") + "\n" + [...doc.querySelectorAll("[style]")].map((e) => e.getAttribute("style")).join("\n");
  const compat = BAD_CSS.filter(([re]) => re.test(css)).map(([, n]) => `${n} aren’t supported in Outlook 2016–2021. Use tables or columns instead.`);
  for (const [sel, n] of [["script", "Scripts are removed by every inbox"], ["form", "Forms don’t work in most inboxes"], ["video", "Video doesn’t play in most inboxes. Link to it with an image instead"], ["svg", "Inline SVG doesn’t show in Gmail or Outlook. Use PNG"], ["iframe", "Embedded frames are blocked by inboxes"]]) if (doc.querySelector(sel)) compat.push(n + ".");
  out.push({ key: "compat", title: "Compatibility", ok: !compat.length, sev: "warn", items: compat, pass: "Renders in Gmail, Outlook, Apple Mail" });
  // images
  const imgs = [...doc.querySelectorAll("img")];
  const imgIssues = [];
  imgs.forEach((i) => {
    const src = i.getAttribute("src") || "";
    if (!i.hasAttribute("alt")) imgIssues.push(`An image has no alt text (${src.split("/").pop().slice(0, 30) || "inline image"})`);
    if (/^http:/i.test(src)) imgIssues.push(`An image loads over http: ${src.slice(0, 50)}`);
    if (/^data:/i.test(src) && src.length > 140000) imgIssues.push("An embedded image is over 100 KB. Upload it instead so it loads from a link");
  });
  out.push({ key: "images", title: "Images", ok: !imgIssues.length, sev: "warn", items: imgIssues, pass: imgs.length ? `${imgs.length} image${imgs.length === 1 ? "" : "s"} · all have alt text and load over https` : "No images" });
  return out;
}

export function checksHtml(results, icon, esc) {
  const bad = results.filter((r) => !r.ok);
  const n = bad.reduce((s, r) => s + r.items.length, 0);
  return `<div class="checks ${bad.length ? "has" : "pass"}"><div class="checks-h">${icon(bad.length ? "alert" : "check-circle", 14)}<b>${bad.length ? `${n} thing${n === 1 ? "" : "s"} to look at before sending` : "All checks passed"}</b></div>
    ${results.map((r) => `<div class="chk ${r.ok ? "ok" : r.sev}">${icon(r.ok ? "check-circle" : r.sev === "error" ? "x-circle" : "alert", 13)}<div><b>${r.title}</b>${r.ok ? `<span>${esc(r.pass)}</span>` : r.items.slice(0, 4).map((i) => `<span>${esc(i)}</span>`).join("") + (r.items.length > 4 ? `<span>+${r.items.length - 4} more</span>` : "")}</div></div>`).join("")}</div>`;
}

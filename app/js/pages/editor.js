// Shared document-style email editor used by Broadcasts and Templates.
import { esc, icon, menu, popover, modal, formModal, toast, errToast, selectHtml, bindSelects, codeBlock, el, $ } from "../lib/ui.js";
import { renderBlocks, sanitizeInline, blocksToText, DEFAULT_STYLE } from "../lib/blocks.js";
import { sb, state } from "../lib/sb.js";

const uid = () => Math.random().toString(36).slice(2, 9);
const TEXTY = ["text", "title", "heading"];
const LISTY = ["bulleted", "numbered"];
export const BLOCK_MENU = [
  { header: "Text" },
  { type: "text", label: "Text", icon: "list" }, { type: "title", label: "Title", icon: "edit" }, { type: "heading", label: "Heading", icon: "edit" },
  { type: "bulleted", label: "Bulleted list", icon: "list" }, { type: "numbered", label: "Numbered list", icon: "list" },
  { header: "Blocks" },
  { type: "image", label: "Image", icon: "image" }, { type: "button", label: "Button", icon: "arrow-up-right" }, { type: "divider", label: "Divider", icon: "chevron-right" },
  { type: "columns", label: "Columns", icon: "sidebar" }, { type: "social", label: "Social links", icon: "globe" }, { type: "footer", label: "Unsubscribe footer", icon: "mail" },
  { type: "spacer", label: "Spacer", icon: "plus" }, { type: "html", label: "HTML", icon: "code" }, { type: "code", label: "Code block", icon: "terminal" },
];
export function newBlock(type) {
  const b = { id: uid(), type };
  if (TEXTY.includes(type)) b.html = "";
  if (LISTY.includes(type)) b.items = [""];
  if (type === "button") Object.assign(b, { text: "Click here", href: "https://", fill: "#FAD600", color: "#211F20", radius: 6, width: "Auto" });
  if (type === "image") Object.assign(b, { src: "", alt: "", width: 600 });
  if (type === "columns") b.columns = [{ html: "Left column" }, { html: "Right column" }];
  if (type === "social") b.links = [{ network: "X", label: "X", url: "" }, { network: "LinkedIn", label: "LinkedIn", url: "" }, { network: "Instagram", label: "Instagram", url: "" }];
  if (type === "footer") Object.assign(b, { reason: "You’re receiving this because you subscribed.", address: "" });
  if (type === "html") b.html = '<table role="presentation" width="100%"><tr><td style="padding:16px">Your HTML</td></tr></table>';
  if (type === "code") Object.assign(b, { code: "", language: "JavaScript", style: { padding: 16, radius: 8 } });
  if (type === "spacer") b.height = 24;
  return b;
}
const chipVars = (html) => String(html || "").replace(/(\{\{\{?\s*[a-zA-Z_][\w|"' ]*\}\}\}?)/g, '<span class="var-chip" contenteditable="false">$1</span>');
const unchip = (html) => sanitizeInline(String(html || "").replace(/<span class="var-chip"[^>]*>(.*?)<\/span>/g, "$1").replace(/&nbsp;/g, " "));

/**
 * mountEditor(container, { doc, mode, vars, onChange, inspectorHost })
 * vars(): [{name, label}] available for {{ insertion
 */
export function mountEditor(container, opts) {
  let doc = structuredClone(opts.doc && opts.doc.blocks ? opts.doc : { blocks: [] });
  if (!doc.blocks.length) doc.blocks.push(newBlock("text"));
  let selected = null;
  const triple = opts.mode === "template";
  const changed = () => opts.onChange?.(getDoc());

  container.innerHTML = `<div class="blocks" data-blocks></div><button class="btn btn-ghost btn-sm" data-add style="margin-top:10px">${icon("plus", 13)} Add block</button>`;
  const host = container.querySelector("[data-blocks]");

  function blockInner(b) {
    switch (b.type) {
      case "title": return `<h1 contenteditable="true" data-f="html" data-ph="Title">${chipVars(b.html)}</h1>`;
      case "heading": return `<h2 contenteditable="true" data-f="html" data-ph="Heading">${chipVars(b.html)}</h2>`;
      case "text": return `<div contenteditable="true" data-f="html" data-ph="Press / for blocks, or start writing">${chipVars(b.html)}</div>`;
      case "bulleted": return `<ul contenteditable="true" data-f="items">${(b.items || [""]).map((i) => `<li>${chipVars(i) || "<br>"}</li>`).join("")}</ul>`;
      case "numbered": return `<ol contenteditable="true" data-f="items">${(b.items || [""]).map((i) => `<li>${chipVars(i) || "<br>"}</li>`).join("")}</ol>`;
      case "button": return `<div style="text-align:${b.align || "left"}"><span class="btn-blk" style="background:${esc(b.fill)};color:${esc(b.color)};border-radius:${+b.radius}px;${b.width === "Full" ? "display:block;text-align:center" : ""}">${esc(b.text)}</span></div>`;
      case "divider": return `<div class="div-blk" style="background:${esc(b.style?.color || "#2a2c31")}"></div>`;
      case "spacer": return `<div style="height:${+b.height || 24}px;border:1px dashed #23252a;border-radius:4px"></div>`;
      case "image": return `<div class="img-blk" style="text-align:${b.align || "left"}">${b.src ? `<img src="${esc(b.src)}" alt="${esc(b.alt)}" style="width:${Math.min(+b.width || 600, 600)}px">` : `<div class="ph-img">${icon("image", 16)}&nbsp; Select to add an image</div>`}</div>`;
      case "columns": return `<div style="display:grid;grid-template-columns:repeat(${b.columns.length},1fr);gap:14px">${b.columns.map((c, i) => `<div contenteditable="true" data-f="col" data-col="${i}" style="font-size:14px">${chipVars(c.html)}</div>`).join("")}</div>`;
      case "social": return `<div class="row-flex" style="gap:14px;font-size:13px;color:var(--fg-2)">${(b.links || []).map((l) => `<span style="${l.url ? "" : "opacity:.45"}">${esc(l.label || l.network)}</span>`).join("")}</div>`;
      case "footer": return `<div class="footer-blk">${b.reason ? `<div>${esc(b.reason)}</div>` : ""}<div><a>Unsubscribe</a> or <a>manage preferences</a></div>${b.address ? `<div style="margin-top:6px">${esc(b.address)}</div>` : '<div style="margin-top:6px;color:var(--orange)">Add your postal address (required for bulk email)</div>'}</div>`;
      case "html": return `<div class="html-blk">${esc(b.html)}</div>`;
      case "code": return `<pre class="code-blk" contenteditable="true" data-f="code" data-ph="Write code">${esc(b.code)}</pre>`;
      default: return "";
    }
  }
  function styleFor(b) {
    const s = b.style || {};
    const css = [];
    if (s.color && (TEXTY.includes(b.type) || LISTY.includes(b.type))) css.push(`color:${s.color}`);
    if (s.fontSize && (b.type === "text" || LISTY.includes(b.type))) css.push(`font-size:${parseInt(s.fontSize)}px`);
    if (s.lineHeight) css.push(`line-height:${s.lineHeight}`);
    if (s.align) css.push(`text-align:${s.align}`);
    if (s.background && s.background !== "None") css.push(`background:${s.background}`);
    return css.join(";");
  }
  function renderAll(focusId, atEnd) {
    host.innerHTML = doc.blocks.map((b) => `<div class="blk ${b.id === selected ? "sel" : ""}" data-id="${b.id}" style="${styleFor(b)}">${blockInner(b)}</div>`).join("");
    if (focusId) focusBlock(focusId, atEnd);
  }
  function focusBlock(id, atEnd = true) {
    const ce = host.querySelector(`[data-id="${id}"] [contenteditable="true"]`);
    if (!ce) return;
    ce.focus();
    const r = document.createRange(); r.selectNodeContents(ce); r.collapse(!atEnd);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  const find = (id) => doc.blocks.find((b) => b.id === id);
  const idx = (id) => doc.blocks.findIndex((b) => b.id === id);
  function readBlock(node) {
    const b = find(node.dataset.id); if (!b) return;
    const ce = node.querySelector("[data-f]");
    if (!ce) return;
    if (ce.dataset.f === "html") b.html = unchip(ce.innerHTML);
    if (ce.dataset.f === "items") b.items = [...ce.querySelectorAll("li")].map((li) => unchip(li.innerHTML.replace(/<br>$/, "")));
    if (ce.dataset.f === "code") b.code = ce.innerText;
    if (b.type === "columns") node.querySelectorAll("[data-col]").forEach((c) => { b.columns[+c.dataset.col].html = unchip(c.innerHTML); });
  }
  host.addEventListener("input", (e) => { const n = e.target.closest(".blk"); if (n) { readBlock(n); checkTriggers(e.target, n); changed(); } });

  function insertAfter(id, b) { const i = id ? idx(id) : doc.blocks.length - 1; doc.blocks.splice(i + 1, 0, b); renderAll(TEXTY.includes(b.type) || LISTY.includes(b.type) || b.type === "code" ? b.id : null); if (!TEXTY.includes(b.type) && !LISTY.includes(b.type)) select(b.id); changed(); }
  function replaceBlock(id, type) {
    const i = idx(id); const old = doc.blocks[i];
    const b = newBlock(type);
    if (TEXTY.includes(type) && TEXTY.includes(old.type)) b.html = (old.html || "").replace(/^\/\S*/, "");
    doc.blocks[i] = b; renderAll(TEXTY.includes(type) || LISTY.includes(type) || type === "code" ? b.id : null);
    if (!TEXTY.includes(type) && !LISTY.includes(type)) select(b.id);
    changed();
  }

  // slash and {{ triggers
  function caretRect() { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).cloneRange(); const rects = r.getClientRects(); return rects[0] || r.startContainer.parentElement?.getBoundingClientRect(); }
  function anchorAtCaret() { const rc = caretRect(); const a = el('<span style="position:fixed;width:1px;height:1px"></span>'); document.body.appendChild(a); if (rc) { a.style.left = rc.left + "px"; a.style.top = rc.bottom + "px"; } setTimeout(() => a.remove(), 50); return a; }
  function checkTriggers(ce, node) {
    const b = find(node.dataset.id);
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0); const t = r.startContainer.textContent?.slice(0, r.startOffset) || "";
    if (TEXTY.includes(b.type) && ce.textContent.trim() === "/") {
      const a = anchorAtCaret();
      menu(a, BLOCK_MENU.map((m) => m.header ? m : { label: m.label, icon: m.icon, onClick: () => replaceBlock(b.id, m.type) }), { search: false, width: 220 });
    } else if (t.endsWith("{{")) {
      const vars = opts.vars?.() || [];
      const a = anchorAtCaret();
      const insert = (name) => {
        const s2 = getSelection(); if (!s2.rangeCount) return; const rr = s2.getRangeAt(0);
        // remove the typed "{{"
        rr.setStart(rr.startContainer, Math.max(0, rr.startOffset - 2)); rr.deleteContents();
        const chip = el(`<span class="var-chip" contenteditable="false">${triple ? `{{{${name}}}}` : `{{${name}}}`}</span>`);
        rr.insertNode(chip); rr.setStartAfter(chip); rr.insertNode(document.createTextNode(" ")); rr.collapse(false); s2.removeAllRanges(); s2.addRange(rr);
        readBlock(node); changed();
      };
      menu(a, [{ header: "Variables" }, ...(vars.length ? vars.map((v) => ({ label: v.label || v.name, icon: "code", right: v.type, onClick: () => insert(v.name) })) : [{ label: "No variables yet", disabled: true }]), ...(opts.createVariable ? [{ sep: true }, { label: "Create variable", icon: "plus", onClick: async () => { const v = await opts.createVariable(); if (v) insert(v.name); } }] : [])], { width: 240 });
    }
  }

  // keyboard: Enter splits, Backspace merges
  host.addEventListener("keydown", (e) => {
    const node = e.target.closest(".blk"); if (!node) return;
    const b = find(node.dataset.id);
    const ce = e.target.closest("[contenteditable=true]");
    if (e.key === "Enter" && !e.shiftKey && TEXTY.includes(b.type) && !document.querySelector(".menu")) {
      e.preventDefault();
      const s = getSelection(); const r = s.getRangeAt(0);
      const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEndAfter(ce.lastChild || ce);
      const frag = tail.extractContents(); const tmp = document.createElement("div"); tmp.appendChild(frag);
      readBlock(node);
      const nb = newBlock("text"); nb.html = unchip(tmp.innerHTML);
      doc.blocks.splice(idx(b.id) + 1, 0, nb); renderAll(nb.id, false); changed();
    }
    if (e.key === "Enter" && !e.shiftKey && LISTY.includes(b.type)) {
      const li = getSelection().anchorNode?.parentElement?.closest("li") || getSelection().anchorNode?.closest?.("li");
      if (li && !li.textContent.trim() && li === ce.lastElementChild) { e.preventDefault(); li.remove(); readBlock(node); insertAfter(b.id, newBlock("text")); }
    }
    if (e.key === "Backspace" && ce && !ce.textContent.length && TEXTY.concat(LISTY).includes(b.type) && doc.blocks.length > 1) {
      e.preventDefault(); const i = idx(b.id); doc.blocks.splice(i, 1); const prev = doc.blocks[Math.max(0, i - 1)]; renderAll(prev.id, true); changed();
    }
  });
  host.addEventListener("paste", (e) => {
    if (!e.target.closest("[contenteditable]")) return;
    if (e.target.closest(".code-blk")) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  // selection toolbar
  let bar = null;
  document.addEventListener("selectionchange", onSel);
  function onSel() {
    const s = getSelection();
    const inside = s.rangeCount && !s.isCollapsed && host.contains(s.anchorNode) && s.anchorNode.parentElement?.closest("[contenteditable=true]:not(.code-blk)");
    if (!inside) { bar?.remove(); bar = null; return; }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (!bar) {
      bar = el(`<div class="fmt-bar"><button data-c="bold"><b>B</b></button><button data-c="italic"><i>I</i></button><button data-c="underline"><u>U</u></button><button data-c="strikeThrough"><s>S</s></button><button data-c="link">${icon("link", 13)}</button></div>`);
      bar.addEventListener("mousedown", (e) => e.preventDefault());
      bar.addEventListener("click", (e) => {
        const c = e.target.closest("[data-c]")?.dataset.c; if (!c) return;
        if (c === "link") {
          const range = getSelection().getRangeAt(0).cloneRange();
          popover(bar, `<div class="row-flex" style="padding:6px;gap:4px">${icon("link", 13, "dim")}<input class="input" placeholder="https://" style="height:28px;border:0;background:transparent"><button class="ibtn" data-ok>${icon("check")}</button></div>`, { width: 320, onMount(p, close) {
            const inp = p.querySelector("input"); inp.focus();
            const ok = () => { let u = inp.value.trim(); if (u && !/^(https?:|mailto:|\{\{)/.test(u)) u = "https://" + u; const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(range); if (u) document.execCommand("createLink", false, u); else document.execCommand("unlink"); const n = range.startContainer.parentElement.closest(".blk"); if (n) { readBlock(n); changed(); } close(); };
            p.querySelector("[data-ok]").onclick = ok; inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ok(); });
          } });
          return;
        }
        document.execCommand(c);
        const n = getSelection().anchorNode?.parentElement?.closest(".blk"); if (n) { readBlock(n); changed(); }
      });
      document.body.appendChild(bar);
    }
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - 70) + "px";
    bar.style.top = Math.max(8, rect.top - 40) + "px";
  }

  // block selection & inspector
  host.addEventListener("mousedown", (e) => { const n = e.target.closest(".blk"); if (n && n.dataset.id !== selected) select(n.dataset.id); });
  function select(id) {
    selected = id;
    host.querySelectorAll(".blk").forEach((n) => n.classList.toggle("sel", n.dataset.id === id));
    opts.inspectorHost && renderInspector();
  }
  function deselect() { selected = null; host.querySelectorAll(".blk.sel").forEach((n) => n.classList.remove("sel")); opts.inspectorHost && renderInspector(); }
  container.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) menu(e.target.closest("[data-add]"), BLOCK_MENU.map((m) => m.header ? m : { label: m.label, icon: m.icon, onClick: () => insertAfter(selected || doc.blocks.at(-1)?.id, newBlock(m.type)) }), { width: 220 });
    if (e.target.closest(".html-blk")) editHtml(find(e.target.closest(".blk").dataset.id));
  });

  function row(label, inner) { return `<div class="insp-row"><span>${label}</span><div>${inner}</div></div>`; }
  function inp(key, val, ph = "", extra = "") { return `<input class="input" data-k="${key}" value="${esc(val ?? "")}" placeholder="${esc(ph)}" ${extra}>`; }
  function color(key, val) { return `<div class="input-wrap"><input class="input mono" data-k="${key}" value="${esc(val || "")}" placeholder="#211F20" style="padding-right:30px"><span class="trail" style="right:9px"><span class="swatch" style="background:${esc(val || "transparent")}"></span></span></div>`; }
  function sel(key, val, options) { return selectHtml(key, options.map((o) => typeof o === "string" ? { value: o, label: o } : o), val); }
  const TYPE_LABEL = Object.fromEntries(BLOCK_MENU.filter((m) => m.type).map((m) => [m.type, m.label]));
  function renderInspector() {
    const h = opts.inspectorHost;
    if (!selected) { h.classList.add("hidden"); return; }
    const b = find(selected); if (!b) { h.classList.add("hidden"); return; }
    h.classList.remove("hidden");
    const st = b.style || {};
    let s = `<div class="insp-head">Section ${icon("chevron-right", 11)} <b>${TYPE_LABEL[b.type] || b.type}</b><span class="acts"><button class="ibtn" data-act="up" title="Move up">${icon("arrow-up", 13)}</button><button class="ibtn" data-act="down" title="Move down" style="transform:rotate(180deg)">${icon("arrow-up", 13)}</button><button class="ibtn" data-act="dup" title="Duplicate">${icon("copy", 13)}</button><button class="ibtn" data-act="del" title="Delete">${icon("trash", 13)}</button></span></div>`;
    if (TEXTY.includes(b.type) || LISTY.includes(b.type) || b.type === "columns") {
      s += `<div class="insp-sec"><h4>Typography</h4>${row("Color", color("style.color", st.color))}${b.type !== "title" && b.type !== "heading" ? row("Font size", inp("style.fontSize", st.fontSize ?? 16, "16")) : ""}${row("Line height", inp("style.lineHeight", st.lineHeight ?? 1.6))}${row("Weight", sel("style.weight", st.weight || "Regular", ["Regular", "Medium", "Semibold", "Bold"]))}${row("Align", sel("style.align", st.align || "left", ["left", "center", "right"]))}</div>`;
    }
    if (b.type === "button") s += `<div class="insp-sec"><h4>Button</h4>${row("Text", inp("text", b.text))}${row("Fill", color("fill", b.fill))}${row("Text", color("color", b.color))}${row("Radius", inp("radius", b.radius, "6"))}${row("Width", sel("width", b.width || "Auto", ["Auto", "Full"]))}${row("Align", sel("align", b.align || "left", ["left", "center", "right"]))}</div><div class="insp-sec"><h4>Link</h4>${row("URL", inp("href", b.href, "https://"))}</div>`;
    if (b.type === "image") s += `<div class="insp-sec"><h4>Image</h4><button class="btn btn-secondary btn-sm" data-act="upload">${icon("upload", 12)} Upload image</button>${row("URL", inp("src", b.src, "https://"))}${row("Alt text", inp("alt", b.alt))}${row("Width", inp("width", b.width, "600"))}${row("Link", inp("href", b.href, "https://"))}${row("Align", sel("align", b.align || "left", ["left", "center", "right"]))}${row("Radius", inp("style.radius", st.radius ?? 0, "0"))}</div>`;
    if (b.type === "divider") s += `<div class="insp-sec"><h4>Divider</h4>${row("Color", color("style.color", st.color || "#E6E6E6"))}</div>`;
    if (b.type === "spacer") s += `<div class="insp-sec"><h4>Spacer</h4>${row("Height", inp("height", b.height, "24"))}</div>`;
    if (b.type === "columns") s += `<div class="insp-sec"><h4>Columns</h4>${row("Count", sel("columnsCount", String(b.columns.length), ["2", "3"]))}</div>`;
    if (b.type === "social") s += `<div class="insp-sec"><h4>Social links</h4>${(b.links || []).map((l, i) => row(esc(l.network), inp(`links.${i}.url`, l.url, "https://"))).join("")}<button class="btn btn-ghost btn-sm" data-act="addsocial">${icon("plus", 12)} Add link</button></div>`;
    if (b.type === "footer") s += `<div class="insp-sec"><h4>Unsubscribe footer</h4>${row("Content", inp("reason", b.reason))}${row("Links", `<span class="dim" style="font-size:12px">Unsubscribe, Preferences</span>`)}${row("Address", inp("address", b.address, "Company · Street, City"))}<p class="hint">Bulk email must include a postal address and an unsubscribe link.</p></div>`;
    if (b.type === "html") s += `<div class="insp-sec"><h4>HTML block</h4><p class="hint">Write or paste raw HTML. It’s inserted as-is, so test it in the clients you care about.</p><button class="btn btn-secondary btn-sm" data-act="html">${icon("code", 12)} Edit HTML</button></div>`;
    if (b.type === "code") s += `<div class="insp-sec"><h4>Attributes</h4>${row("Language", sel("language", b.language || "JavaScript", ["JavaScript", "TypeScript", "Python", "Go", "Ruby", "PHP", "JSON", "HTML", "Shell"]))}${row("Theme", `<span class="dim" style="font-size:12px">Delivrie Dark</span>`)}</div>`;
    s += `<div class="insp-sec"><h4>Spacing</h4>${row("Padding", inp("style.padding", st.padding ?? "", "0 0 12 0"))}${row("Margin", inp("style.margin", st.margin ?? "", "0"))}</div>`;
    if (!["divider", "spacer", "html"].includes(b.type)) s += `<div class="insp-sec"><h4>Background</h4>${row("Color", color("style.background", st.background && st.background !== "None" ? st.background : ""))}</div><div class="insp-sec"><h4>Border</h4>${row("Radius", inp("style.radius", st.radius ?? 0, "0"))}</div>`;
    h.innerHTML = s;
    bindSelects(h, (key, value) => apply(key, value));
  }
  function apply(key, value) {
    const b = find(selected); if (!b) return;
    if (key === "columnsCount") { const n = +value; while (b.columns.length < n) b.columns.push({ html: "Column" }); b.columns.length = n; }
    else if (key.startsWith("style.")) { b.style = { ...(b.style || {}), [key.slice(6)]: value }; }
    else if (key.startsWith("links.")) { const [, i, f] = key.split("."); b.links[+i][f] = value; }
    else b[key] = ["radius", "width", "height"].includes(key) ? (value === "" ? "" : Number(value) || 0) : value;
    const node = host.querySelector(`[data-id="${b.id}"]`);
    if (node && !node.contains(document.activeElement)) { node.outerHTML = `<div class="blk sel" data-id="${b.id}" style="${styleFor(b)}">${blockInner(b)}</div>`; }
    else if (node) node.setAttribute("style", styleFor(b));
    changed();
  }
  if (opts.inspectorHost) {
    opts.inspectorHost.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k) { apply(k, e.target.value); const sw = e.target.parentElement.querySelector(".swatch"); if (sw) sw.style.background = e.target.value; } });
    opts.inspectorHost.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
      const b = find(selected); const i = idx(selected);
      if (a === "del") { doc.blocks.splice(i, 1); if (!doc.blocks.length) doc.blocks.push(newBlock("text")); selected = null; renderAll(); renderInspector(); changed(); }
      if (a === "dup") { const c = structuredClone(b); c.id = uid(); doc.blocks.splice(i + 1, 0, c); selected = c.id; renderAll(); renderInspector(); changed(); }
      if (a === "up" && i > 0) { [doc.blocks[i - 1], doc.blocks[i]] = [doc.blocks[i], doc.blocks[i - 1]]; renderAll(); changed(); }
      if (a === "down" && i < doc.blocks.length - 1) { [doc.blocks[i + 1], doc.blocks[i]] = [doc.blocks[i], doc.blocks[i + 1]]; renderAll(); changed(); }
      if (a === "html") editHtml(b);
      if (a === "addsocial") { const net = prompt("Network name (e.g. YouTube, Website)"); if (net) { b.links.push({ network: net, label: net, url: "" }); renderInspector(); changed(); } }
      if (a === "upload") uploadImage(b);
    });
  }
  async function uploadImage(b) {
    const f = el('<input type="file" accept="image/png,image/jpeg,image/gif,image/webp">');
    f.onchange = async () => {
      const file = f.files[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast("Images must be under 5 MB", "err");
      try {
        const path = `${state.team.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error } = await sb.storage.from("email-assets").upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        b.src = sb.storage.from("email-assets").getPublicUrl(path).data.publicUrl;
        b.alt ||= file.name.replace(/\.\w+$/, "");
        apply("src", b.src); renderInspector(); toast("Image uploaded");
      } catch (e) { errToast(e); }
    };
    f.click();
  }
  async function editHtml(b) {
    await modal({ title: "Edit HTML", size: "xl", body: `<p class="desc">Write or paste raw HTML. It’s inserted as-is, so test it in the clients you care about.</p><textarea class="textarea mono" rows="16" style="font-size:12.5px">${esc(b.html)}</textarea>`, foot: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`, onMount(m, close) { m.querySelector("[data-ok]").onclick = () => { b.html = m.querySelector("textarea").value; renderAll(); select(b.id); changed(); close(true); }; } });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".overlay,.menu")) deselect(); });

  function getDoc() { return { ...doc, blocks: doc.blocks.map((b) => ({ ...b })) }; }
  renderAll();
  return {
    getDoc, select, deselect,
    setDoc(d) { doc = structuredClone(d); if (!doc.blocks?.length) doc.blocks = [newBlock("text")]; selected = null; renderAll(); opts.inspectorHost && renderInspector(); },
    setPage(p) { doc.page = { ...(doc.page || {}), ...p }; changed(); },
    addBlock(type) { insertAfter(selected || doc.blocks.at(-1)?.id, newBlock(type)); },
    destroy() { document.removeEventListener("selectionchange", onSel); bar?.remove(); },
  };
}

export function previewModal(doc, opts = {}) {
  const raw = renderBlocks(doc, { subject: opts.subject, previewText: opts.previewText });
  const html = opts.transform ? opts.transform(raw) : raw;
  return modal({ title: "Preview", size: "xl", body: `<div class="row-flex"><div class="seg-tabs" style="margin:0"><button class="seg-tab on" data-w="680">Desktop</button><button class="seg-tab" data-w="375">Mobile</button></div><span class="grow"></span><button class="btn btn-ghost btn-sm" data-copy="${esc(html)}" data-copy-msg="HTML copied">${icon("copy", 12)} Copy HTML</button></div><div style="background:#0a0b0c;padding:16px;border-radius:10px;display:flex;justify-content:center"><iframe class="preview-frame" style="width:680px;height:60vh" sandbox></iframe></div>`, onMount(m) {
    const fr = m.querySelector("iframe"); fr.srcdoc = html;
    m.querySelectorAll("[data-w]").forEach((b) => b.onclick = () => { m.querySelectorAll("[data-w]").forEach((x) => x.classList.toggle("on", x === b)); fr.style.width = b.dataset.w + "px"; });
  } });
}

export function pageStylePopover(anchor, doc, onChange) {
  const p = { ...DEFAULT_STYLE.page, ...(doc.page || {}) };
  popover(anchor, `<div class="insp-sec" style="border:0"><h4>Email styles</h4>
    <div class="insp-row"><span>Background</span><input class="input mono" data-p="background" value="${esc(p.background)}"></div>
    <div class="insp-row"><span>Text</span><input class="input mono" data-p="text" value="${esc(p.text)}"></div>
    <div class="insp-row"><span>Muted</span><input class="input mono" data-p="muted" value="${esc(p.muted)}"></div>
    <div class="insp-row"><span>Accent</span><input class="input mono" data-p="accent" value="${esc(p.accent)}"></div>
    <div class="insp-row"><span>Width</span><input class="input" data-p="width" value="${esc(p.width)}"></div></div>`, { width: 300, onMount(el2) { el2.addEventListener("input", (e) => { const k = e.target.dataset.p; if (k) onChange({ [k]: k === "width" ? Number(e.target.value) || 600 : e.target.value }); }); } });
}

export { renderBlocks, blocksToText };

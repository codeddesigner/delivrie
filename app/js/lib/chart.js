// Tiny SVG line/area chart with hover tooltip.
import { esc, num } from "./ui.js";

/**
 * lineChart(host, { labels: [], series: [{name, color, values: []}], height, fmt })
 */
export function lineChart(host, { labels, series, height = 220, fmt = num, area = true }) {
  const css = getComputedStyle(document.documentElement), gridC = css.getPropertyValue("--border").trim() || "#3d3a3b", dotC = css.getPropertyValue("--panel").trim() || "#262425", txtC = css.getPropertyValue("--fg-3").trim() || "#62666d";
  const W = Math.max(320, host.clientWidth || 720), H = height, P = { l: 36, r: 12, t: 12, b: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = niceMax(max);
  const n = labels.length;
  const x = (i) => P.l + (n <= 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / nice);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = nice * f; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="${gridC}" /><text x="${P.l - 8}" y="${y(v) + 4}" fill="${txtC}" font-size="10.5" text-anchor="end">${short(v)}</text>`; }).join("");
  const step = Math.max(1, Math.ceil(n / 7));
  const xl = labels.map((l, i) => (i % step === 0 || i === n - 1) ? `<text x="${x(i)}" y="${H - 6}" fill="${txtC}" font-size="10.5" text-anchor="${i === n - 1 && n > 1 ? "end" : i === 0 && n > 1 ? "start" : "middle"}">${esc(l)}</text>` : "").join("");
  const paths = series.map((s, si) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
    const line = `M${pts.join("L")}`;
    const fill = area && si === 0 ? `<path d="${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="url(#g${si})" class="chart-area" />` : "";
    return `<defs><linearGradient id="g${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>${fill}<path class="chart-line" pathLength="1" d="${line}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" style="animation-delay:${si * 120}ms"/>`;
  }).join("");
  host.style.position = "relative";
  host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;height:${H}px">${grid}${xl}${paths}<line data-cursor x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" stroke="${gridC}" stroke-dasharray="3 3" visibility="hidden"/>${series.map((s, i) => `<circle data-dot="${i}" r="3.5" fill="${s.color}" stroke="${dotC}" stroke-width="2" visibility="hidden"/>`).join("")}</svg><div class="chart-tip hidden"></div>`;
  const svg = host.querySelector("svg"), tip = host.querySelector(".chart-tip"), cur = host.querySelector("[data-cursor]");
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1))));
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("visibility", "visible");
    series.forEach((s, si) => { const d = host.querySelector(`[data-dot="${si}"]`); d.setAttribute("cx", x(i)); d.setAttribute("cy", y(s.values[i])); d.setAttribute("visibility", "visible"); });
    tip.classList.remove("hidden");
    tip.innerHTML = `<div class="dim" style="margin-bottom:4px">${esc(labels[i])}</div>${series.map((s) => `<div class="row-flex" style="gap:6px"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<span style="margin-left:auto;padding-left:14px">${fmt(s.values[i])}</span></div>`).join("")}`;
    const left = (x(i) / W) * r.width; tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth - 4) + "px"; tip.style.top = "8px";
  });
  svg.addEventListener("mouseleave", () => { tip.classList.add("hidden"); cur.setAttribute("visibility", "hidden"); host.querySelectorAll("[data-dot]").forEach((d) => d.setAttribute("visibility", "hidden")); });
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function short(v) { return v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "k" : String(Math.round(v * 100) / 100); }

export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

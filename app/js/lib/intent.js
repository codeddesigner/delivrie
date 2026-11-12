// Where to send someone after they sign in or sign up. Survives the emailed code, OAuth redirects and team setup.
import { state } from "./sb.js";

const KEY = "dlv_next";
const TTL = 2 * 3600e3;
const PLANS = ["pro", "scale"];

const safe = (p) => typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !/^\/(login|signup|verify|confirm)\b/.test(p) ? p : null;

// ?next=/path, or ?plan=pro&interval=yearly from the pricing page
export function intentFrom(q = {}) {
  if (safe(q.next)) return q.next;
  if (PLANS.includes(q.plan)) return `/billing?upgrade=${q.plan}${q.interval === "yearly" ? "&interval=yearly" : ""}`;
  if (q.plan === "payg" || q.plan === "credits") return "/billing?upgrade=payg";
  return null;
}
export function rememberNext(p) {
  if (!safe(p)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ p, t: Date.now() })); } catch {}
}
export function peekNext() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Date.now() - v.t < TTL) return safe(v.p); } catch {}
  return null;
}
export function takeNext() {
  const p = peekNext();
  try { localStorage.removeItem(KEY); } catch {}
  return p;
}
// Destination once signed in. Without a team, the saved page waits until the team exists (invites go straight through).
export function nextAfterAuth(fallback = "/emails") {
  const n = peekNext();
  if (n && (state.team || n.startsWith("/invite/"))) { takeNext(); return n; }
  return state.team ? fallback : "/new-team";
}

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// deno-lint-ignore no-explicit-any
export type Any = any;
const env = (k: string) => Deno.env.get(k) ?? "";

export const SUPABASE_URL = env("SUPABASE_URL");
export const db = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
export const APP_URL = (env("APP_URL") || "https://delivrie.io").replace(/\/$/, "");
export const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/delivrie`;
/** Optional platform sender used for onboarding, invites and system mail, e.g. "Delivrie <onboarding@mail.example.com>" */
export const SYSTEM_FROM = env("SYSTEM_FROM");
export const SYSTEM_REGION = env("SYSTEM_REGION") || "eu-west-1";
export const ENFORCE_LIMITS = env("ENFORCE_LIMITS") === "true";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-team-id, idempotency-key, x-client-info, apikey, user-agent",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};

export class HttpError extends Error {
  status: number; name: string;
  constructor(status: number, name: string, message: string) { super(message); this.status = status; this.name = name; }
}
export const bad = (msg: string) => new HttpError(422, "validation_error", msg);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "This API key is restricted") => new HttpError(403, "restricted_api_key", msg);

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
}
export function errorJson(e: unknown) {
  if (e instanceof HttpError) return json({ statusCode: e.status, name: e.name, message: e.message }, e.status);
  console.error(e);
  return json({ statusCode: 500, name: "application_error", message: (e as Error)?.message || "Internal error" }, 500);
}

const enc = new TextEncoder();
export async function sha256(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function hmacB64(keyBytes: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return btoa(String.fromCharCode(...sig));
}
export async function hmacUrl(secret: string, data: string) {
  return (await hmacB64(enc.encode(secret), data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

let _settings: Record<string, string> | null = null;
export async function setting(key: string): Promise<string> {
  if (!_settings) {
    const { data } = await db.from("system_settings").select("key,value");
    _settings = Object.fromEntries((data || []).map((r: Any) => [r.key, r.value]));
  }
  return _settings![key] ?? "";
}
export async function setSetting(key: string, value: string) {
  await db.from("system_settings").upsert({ key, value });
  if (_settings) _settings[key] = value;
}

export function waitUntil(p: Promise<unknown>) {
  const rt = (globalThis as Any).EdgeRuntime;
  const guarded = p.catch((e) => console.error("background task failed", e));
  if (rt?.waitUntil) rt.waitUntil(guarded);
}

// Plan limits from the pricing page. 0 = no limit. Paid plans keep sending past `month` and pay overage.
export const LIMITS: Record<string, { month: number; day: number; domains: number; members: number; webhooks: number; retention_days: number; contacts: number; segments: number; overage: Record<string, number> | null }> = {
  free: { month: 3000, day: 100, domains: 1, members: 1, webhooks: 1, retention_days: 1, contacts: 1000, segments: 3, overage: null },
  pro: { month: 20_000, day: 0, domains: 10, members: 5, webhooks: 10, retention_days: 3, contacts: 0, segments: 0, overage: { USD: 45, NGN: 450_00 } },
  scale: { month: 100_000, day: 0, domains: 1000, members: 0, webhooks: 0, retention_days: 7, contacts: 0, segments: 0, overage: { USD: 40, NGN: 400_00 } },
  enterprise: { month: 0, day: 0, domains: 0, members: 0, webhooks: 0, retention_days: 30, contacts: 0, segments: 0, overage: null },
};
// Marketing add-on: contacts allowed per tier.
export const MARKETING_LIMITS: Record<string, number> = { free: 1000, growth: 5000, pro: 10_000 };

export function asArray(v: unknown): string[] {
  if (v == null || v === "") return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);
}
export function domainOf(addr: string) {
  const m = addr.match(/@([^>\s]+)>?\s*$/);
  return m ? m[1].toLowerCase() : "";
}
export function emailOnly(addr: string) {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim().toLowerCase();
}

/** Supabase-style pagination helpers for list endpoints. */
export function pageParams(url: URL) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50") || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0") || 0, 0);
  return { limit, offset };
}

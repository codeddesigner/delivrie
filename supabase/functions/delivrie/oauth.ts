// OAuth 2.1 for MCP clients (Claude Code, Cursor, v0, Codex…): dynamic client registration, PKCE (S256),
// authorization codes issued from the dashboard consent page, rotating refresh tokens. Figma 9.10.
//
// Public, served through delivrie.io rewrites:
//   GET  /.well-known/oauth-authorization-server   -> /oauth/metadata
//   GET  /.well-known/oauth-protected-resource      -> /oauth/resource
//   POST /api/oauth/register   { client_name, redirect_uris[], client_uri?, logo_uri? }
//   POST /api/oauth/token      grant_type=authorization_code | refresh_token (form or JSON)
//   POST /api/oauth/revoke     token=…
// Dashboard (signed-in member): POST /api/dashboard/oauth/authorize -> { redirect }
import { type Any, APP_URL, CORS, db, HttpError, json, randomToken, sha256, waitUntil } from "./util.ts";

export const SCOPES: Record<string, string> = {
  send: "Send and schedule emails",
  read: "Read emails, logs, domains, contacts and metrics",
  manage: "Create and change domains, contacts, broadcasts, templates and webhooks",
};
const ACCESS_TTL = 3600;
const ISSUER = APP_URL;
const API = `${APP_URL}/api`;

const isLocal = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
function okRedirect(s: string) {
  try {
    const u = new URL(s);
    if (u.hash) return false;
    return u.protocol === "https:" || isLocal(u) || /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["http:", "javascript:", "data:", "file:"].includes(u.protocol);
  } catch { return false; }
}
function parseScopes(s: unknown) {
  const list = String(s || "send read").split(/[\s,]+/).filter((x) => x in SCOPES);
  return list.length ? [...new Set(list)] : ["send", "read"];
}
// Loopback redirects may use any port (RFC 8252), so compare without it.
function sameRedirect(registered: string, given: string) {
  if (registered === given) return true;
  try {
    const a = new URL(registered), b = new URL(given);
    return isLocal(a) && isLocal(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}
async function s256(verifier: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status, { "cache-control": "no-store" });

/** What a token's scopes let it call. */
export function scopeAllows(scopes: string[], method: string, path: string) {
  if (scopes.includes("manage")) return true;
  if (method === "GET") return scopes.includes("read");
  if (/^\/emails(\/batch)?$/.test(path) || /^\/emails\/[^/]+\/(cancel|forward)$/.test(path) || (method === "PATCH" && /^\/emails\/[^/]+$/.test(path))) return scopes.includes("send");
  if (/^\/inbox\/threads\/[^/]+\/reply$/.test(path) || path === "/events") return scopes.includes("send");
  if (method === "PATCH" && /^\/inbox\/threads\/[^/]+$/.test(path)) return scopes.includes("send");
  if (/^\/domains\/[^/]+\/verify$/.test(path)) return scopes.includes("read");
  return false;
}

export async function oauthGrantFromToken(token: string) {
  const { data: g } = await db.from("oauth_grants").select("id,team_id,user_id,scopes,access_expires_at,revoked_at,client_id,oauth_clients(name)").eq("access_hash", await sha256(token)).maybeSingle();
  if (!g || g.revoked_at) throw new HttpError(401, "invalid_token", "This connected app's access was revoked. Reconnect it.");
  if (new Date(g.access_expires_at) < new Date()) throw new HttpError(401, "invalid_token", "Access token expired. Refresh it.");
  waitUntil(db.from("oauth_grants").update({ last_used_at: new Date().toISOString() }).eq("id", g.id));
  return { ...g, client_name: (g as Any).oauth_clients?.name || "Connected app" };
}

async function issue(grantId: string | null, row: Any) {
  const access = "dlvo_" + randomToken(32), refresh = "dlvr_" + randomToken(32);
  const patch = { access_hash: await sha256(access), refresh_hash: await sha256(refresh), access_expires_at: new Date(Date.now() + ACCESS_TTL * 1000).toISOString() };
  if (grantId) await db.from("oauth_grants").update(patch).eq("id", grantId);
  else await db.from("oauth_grants").insert({ ...row, ...patch });
  return json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: row.scopes.join(" ") }, 200, { "cache-control": "no-store" });
}

export async function oauthPublic(req: Request, path: string): Promise<Response | null> {
  if (path === "/oauth/metadata" || path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: ISSUER, authorization_endpoint: `${APP_URL}/oauth/authorize`, token_endpoint: `${API}/oauth/token`,
      registration_endpoint: `${API}/oauth/register`, revocation_endpoint: `${API}/oauth/revoke`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: Object.keys(SCOPES), service_documentation: `${APP_URL}/docs/mcp`,
    });
  }
  if (path === "/oauth/resource" || path.startsWith("/.well-known/oauth-protected-resource")) {
    return json({ resource: `${API}/mcp`, authorization_servers: [ISSUER], scopes_supported: Object.keys(SCOPES), bearer_methods_supported: ["header"], resource_documentation: `${APP_URL}/docs/mcp` });
  }
  if (!path.startsWith("/oauth/") || req.method !== "POST") return null;

  const ct = req.headers.get("content-type") || "";
  const raw = await req.text();
  let b: Any = {};
  try { b = ct.includes("application/json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw)); } catch { return oauthError("invalid_request", "Body must be JSON or form-encoded"); }

  if (path === "/oauth/register") {
    const uris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) return oauthError("invalid_redirect_uri", "redirect_uris must be https, a loopback http URL, or an app scheme");
    const name = String(b.client_name || "MCP client").slice(0, 80);
    const id = "dlvc_" + randomToken(12);
    const { error } = await db.from("oauth_clients").insert({ id, name, redirect_uris: uris, client_uri: b.client_uri ? String(b.client_uri).slice(0, 300) : null, logo_uri: b.logo_uri ? String(b.logo_uri).slice(0, 300) : null });
    if (error) return oauthError("server_error", error.message, 500);
    return json({ client_id: id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
  }

  if (path === "/oauth/token") {
    if (b.grant_type === "authorization_code") {
      if (!b.code || !b.code_verifier || !b.client_id) return oauthError("invalid_request", "code, code_verifier and client_id are required");
      const { data: code } = await db.from("oauth_codes").select("*").eq("code_hash", await sha256(String(b.code))).maybeSingle();
      if (!code || code.used || new Date(code.expires_at) < new Date() || code.client_id !== b.client_id) return oauthError("invalid_grant", "The authorization code is invalid or expired");
      if (b.redirect_uri && b.redirect_uri !== code.redirect_uri) return oauthError("invalid_grant", "redirect_uri doesn't match");
      if (await s256(String(b.code_verifier)) !== code.code_challenge) return oauthError("invalid_grant", "PKCE verification failed");
      const { data: claimed } = await db.from("oauth_codes").update({ used: true }).eq("code_hash", code.code_hash).eq("used", false).select("code_hash");
      if (!claimed?.length) return oauthError("invalid_grant", "The authorization code was already used");
      return issue(null, { client_id: code.client_id, team_id: code.team_id, user_id: code.user_id, scopes: code.scopes });
    }
    if (b.grant_type === "refresh_token") {
      if (!b.refresh_token) return oauthError("invalid_request", "refresh_token is required");
      const { data: g } = await db.from("oauth_grants").select("*").eq("refresh_hash", await sha256(String(b.refresh_token))).maybeSingle();
      if (!g || g.revoked_at || (b.client_id && b.client_id !== g.client_id)) return oauthError("invalid_grant", "The refresh token is invalid or was revoked");
      return issue(g.id, g);
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  if (path === "/oauth/revoke") {
    const h = await sha256(String(b.token || ""));
    await db.from("oauth_grants").update({ revoked_at: new Date().toISOString(), access_hash: null, refresh_hash: null }).or(`access_hash.eq.${h},refresh_hash.eq.${h}`);
    return new Response(null, { status: 200, headers: CORS });
  }
  return null;
}

/** Consent approved in the dashboard: returns the client redirect with a one-time code. */
export async function oauthAuthorize(teamId: string, userId: string, b: Any) {
  const { data: client } = await db.from("oauth_clients").select("*").eq("id", String(b.client_id || "")).maybeSingle();
  if (!client) throw new HttpError(400, "invalid_client", "This app isn't registered. Start the connection again from the app.");
  const redirect = String(b.redirect_uri || client.redirect_uris[0] || "");
  if (!client.redirect_uris.some((r: string) => sameRedirect(r, redirect))) throw new HttpError(400, "invalid_request", "redirect_uri isn't registered for this app");
  const u = new URL(redirect);
  if (b.state) u.searchParams.set("state", String(b.state));
  if (b.deny) { u.searchParams.set("error", "access_denied"); return { redirect: u.toString() }; }
  if (b.code_challenge_method && b.code_challenge_method !== "S256") throw new HttpError(400, "invalid_request", "Only S256 PKCE is supported");
  if (!b.code_challenge) throw new HttpError(400, "invalid_request", "code_challenge is required (PKCE)");
  const code = randomToken(24);
  await db.from("oauth_codes").insert({ code_hash: await sha256(code), client_id: client.id, team_id: teamId, user_id: userId, scopes: parseScopes(b.scope), redirect_uri: redirect, code_challenge: String(b.code_challenge) });
  u.searchParams.set("code", code);
  u.searchParams.set("iss", ISSUER);
  return { redirect: u.toString() };
}

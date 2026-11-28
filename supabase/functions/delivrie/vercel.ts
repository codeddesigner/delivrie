// Vercel integration. A team adds Delivrie from its Vercel integration page; Vercel redirects to
// delivrie.io/integrations/vercel with a code. The dashboard exchanges it here, lists the Vercel projects, and on
// "Connect" Delivrie creates an API key and sets DELIVRIE_API_KEY on the chosen projects.
// Needs VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET (from the integration in Vercel's Integration Console).
import { type Any, APP_URL, bad, db, HttpError, notFound, randomToken, sha256 } from "./util.ts";

// deno-lint-ignore no-explicit-any
type Route = (method: string, path: string, h: (req: Request, c: Any, p: Record<string, string>, url: URL, body: Any) => Promise<any>) => void;

const API = "https://api.vercel.com";
export const VERCEL_REDIRECT = `${APP_URL}/integrations/vercel`;
const creds = () => ({ id: Deno.env.get("VERCEL_CLIENT_ID") || "", secret: Deno.env.get("VERCEL_CLIENT_SECRET") || "" });

async function vercel(token: string, method: string, path: string, teamId: string | null, body?: unknown) {
  const u = new URL(API + path);
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, "vercel_error", `Vercel answered ${res.status}: ${j?.error?.message || "unknown error"}`);
  return j;
}

// New integrations only get tokens that expire within an hour, and no refresh token. Ask for a fresh one for the
// installation whenever we act on it later; fall back to the stored token if that fails.
async function freshToken(conn: Any): Promise<string> {
  const { id, secret } = creds();
  if (id && secret && conn.configuration_id) {
    const res = await fetch(`${API}/v2/oauth/access_token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", installation_id: conn.configuration_id, client_id: id, client_secret: secret }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && j.access_token) return j.access_token;
  }
  return conn.access_token;
}

function dashOnly(c: Any) {
  if (c.via !== "dashboard" || !c.userId) throw new HttpError(403, "forbidden", "Connect Vercel from the Delivrie dashboard");
}

async function getConn(teamId: string, id: string) {
  const { data } = await db.from("vercel_connections").select("*").eq("team_id", teamId).eq("id", id).maybeSingle();
  if (!data) throw notFound("Vercel connection");
  return data;
}
const connOut = (r: Any) => ({ object: "vercel_connection", id: r.id, configuration_id: r.configuration_id, vercel_team_id: r.vercel_team_id, projects: (r.projects || []).map((p: Any) => ({ id: p.id, name: p.name })), api_key_id: r.api_key_id, created_at: r.created_at });

export function registerVercel(route: Route) {
  route("GET", "/dashboard/vercel", async (_r, c) => {
    dashOnly(c);
    const { data } = await db.from("vercel_connections").select("*").eq("team_id", c.teamId).order("created_at", { ascending: false });
    return { object: "list", available: !!creds().id, data: (data || []).map(connOut) };
  });

  // Step 1: exchange Vercel's code and list the projects it can reach.
  route("POST", "/dashboard/vercel/exchange", async (_r, c, _p, _u, b) => {
    dashOnly(c);
    const { id, secret } = creds();
    if (!id || !secret) throw new HttpError(503, "vercel_unavailable", "The Vercel integration isn't set up on this server yet");
    if (!b?.code) throw bad("Missing the code from Vercel. Start again from Vercel's integration page.");
    const res = await fetch(`${API}/v2/oauth/access_token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: secret, code: String(b.code), redirect_uri: VERCEL_REDIRECT }) });
    const tok = await res.json().catch(() => ({}));
    if (!res.ok || !tok.access_token) throw bad(`Vercel didn't accept the code (${tok?.error_description || tok?.error || res.status}). Start again from Vercel's integration page.`);
    const configurationId = String(b.configuration_id || tok.installation_id || "");
    if (!configurationId) throw bad("Missing the Vercel configuration id");
    const { data: conn, error } = await db.from("vercel_connections").upsert({ team_id: c.teamId, configuration_id: configurationId, vercel_team_id: tok.team_id || null, vercel_user_id: tok.user_id || null, access_token: tok.access_token, created_by: c.userId }, { onConflict: "configuration_id" }).select().single();
    if (error) throw bad(error.message);
    const list = await vercel(tok.access_token, "GET", "/v9/projects?limit=100", conn.vercel_team_id);
    return { ...connOut(conn), available_projects: (list.projects || []).map((p: Any) => ({ id: p.id, name: p.name, framework: p.framework || null })) };
  });

  // Step 2: create a key and set DELIVRIE_API_KEY on the chosen projects.
  route("POST", "/dashboard/vercel/:id/connect", async (_r, c, p, _u, b) => {
    dashOnly(c);
    const conn = await getConn(c.teamId, p.id);
    const projects: Any[] = Array.isArray(b?.projects) ? b.projects.slice(0, 50) : [];
    if (!projects.length) throw bad("Choose at least one Vercel project");
    const permission = b?.permission === "full" ? "full" : "sending";
    const token = "dlv_" + randomToken(24);
    const { data: key, error } = await db.from("api_keys").insert({ team_id: c.teamId, name: `Vercel (${projects.length === 1 ? projects[0].name : `${projects.length} projects`})`.slice(0, 100), prefix: token.slice(0, 8), key_hash: await sha256(token), permission, domain_id: b?.domain_id || null, created_by: c.userId }).select("id").single();
    if (error) throw bad(error.message);
    const accessToken = await freshToken(conn);
    const targets = ["production", "preview", "development"];
    const done: Any[] = [], failed: Any[] = [];
    for (const pr of projects) {
      try {
        const out = await vercel(accessToken, "POST", `/v10/projects/${encodeURIComponent(pr.id)}/env?upsert=true`, conn.vercel_team_id, { key: "DELIVRIE_API_KEY", value: token, type: "encrypted", target: targets, comment: "Added by the Delivrie integration" });
        const created = Array.isArray(out.created) ? out.created : out.created ? [out.created] : [];
        done.push({ id: pr.id, name: pr.name, env_ids: created.map((e: Any) => e.id).filter(Boolean) });
      } catch (e) { failed.push({ id: pr.id, name: pr.name, error: (e as Error).message }); }
    }
    if (!done.length) {
      await db.from("api_keys").delete().eq("id", key.id);
      throw bad(`Couldn't set the variable on any project: ${failed.map((f) => `${f.name}: ${f.error}`).join("; ")}`);
    }
    // An earlier key from this connection is replaced.
    if (conn.api_key_id) await db.from("api_keys").delete().eq("team_id", c.teamId).eq("id", conn.api_key_id);
    await db.from("vercel_connections").update({ projects: done, api_key_id: key.id }).eq("id", conn.id);
    return { object: "vercel_connection", id: conn.id, projects: done.map((d) => ({ id: d.id, name: d.name })), failed, key_prefix: token.slice(0, 8), next: b?.next && /^https:\/\/vercel\.com\//.test(String(b.next)) ? String(b.next) : null };
  });

  // Remove: delete the variables, the key and the Vercel configuration.
  route("DELETE", "/dashboard/vercel/:id", async (_r, c, p) => {
    dashOnly(c);
    const conn = await getConn(c.teamId, p.id);
    const accessToken = await freshToken(conn);
    for (const pr of conn.projects || []) for (const envId of pr.env_ids || []) await vercel(accessToken, "DELETE", `/v9/projects/${encodeURIComponent(pr.id)}/env/${encodeURIComponent(envId)}`, conn.vercel_team_id).catch(() => {});
    await vercel(accessToken, "DELETE", `/v1/integrations/configuration/${encodeURIComponent(conn.configuration_id)}`, conn.vercel_team_id).catch(() => {});
    if (conn.api_key_id) await db.from("api_keys").delete().eq("team_id", c.teamId).eq("id", conn.api_key_id);
    await db.from("vercel_connections").delete().eq("id", conn.id);
    return { object: "vercel_connection", id: conn.id, deleted: true };
  });
}

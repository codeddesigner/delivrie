import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const SUPABASE_URL = "https://hnjejflinvaoxbduxeiu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuamVqZmxpbnZhb3hiZHV4ZWl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MjMyOTMsImV4cCI6MjEwOTk5OTI5M30.f0HGnl7_UsEyUBKnyWVyxuC9q1l7nKum0XFokyoKM-8";
export const API_BASE = `${location.origin}/api`;
export const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });

export const state = { session: null, user: null, profile: null, teams: [], team: null, role: null, status: null };

export async function loadSession() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  return state.session;
}

export async function loadTeams() {
  if (!state.user) return [];
  const { data: mem } = await sb.from("team_members").select("role, team_id, created_at, teams(*)").eq("user_id", state.user.id).order("created_at");
  state.teams = (mem || []).filter((m) => m.teams).map((m) => ({ ...m.teams, role: m.role, joined_at: m.created_at }));
  const { data: prof } = await sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  state.profile = prof;
  const saved = localStorage.getItem("dlv_team") || prof?.last_team_id;
  state.team = state.teams.find((t) => t.id === saved) || state.teams[0] || null;
  state.role = state.team?.role || null;
  return state.teams;
}

export function setTeam(id) {
  const t = state.teams.find((x) => x.id === id);
  if (!t) return;
  state.team = t; state.role = t.role;
  try { localStorage.setItem("dlv_team", id); } catch {}
  sb.from("profiles").update({ last_team_id: id }).eq("id", state.user.id).then(() => {});
}

export class ApiError extends Error { constructor(status, name, message) { super(message); this.status = status; this.name = name; } }

/** Call the Delivrie API as the signed-in user, scoped to the current team. */
export async function api(method, path, body) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(state.team ? { "x-team-id": state.team.id } : {}) },
    // Send "{}" for body-less POST/PUT/PATCH (verify, cancel, send…) so the API never sees an empty body.
    body: body === undefined ? (["POST", "PUT", "PATCH"].includes(method) ? "{}" : undefined) : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) throw new ApiError(res.status, json?.name || "error", json?.message || `Request failed (${res.status})`);
  return json;
}

/** Throws a readable error from a Supabase response. */
export function must(r) {
  if (r.error) throw new ApiError(400, r.error.code || "db_error", r.error.message);
  return r.data;
}

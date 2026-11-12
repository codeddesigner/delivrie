// Minimal AWS client: SigV4 signing (WebCrypto) + SES v2 (REST/JSON), SES v1 & SNS (query API).
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface AwsCreds { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export interface SignInput {
  method: string; url: string; region: string; service: string;
  headers?: Record<string, string>; body?: string; creds: AwsCreds; now?: Date;
}

/** Returns headers (including Authorization) for a SigV4-signed request. */
export async function signV4(i: SignInput): Promise<Record<string, string>> {
  const u = new URL(i.url);
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const body = i.body ?? "";
  const payloadHash = await sha256Hex(body);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = String(v).trim();
  headers["host"] = u.host;
  headers["x-amz-date"] = amzDate;
  if (i.creds.sessionToken) headers["x-amz-security-token"] = i.creds.sessionToken;
  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k].replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalPath = u.pathname.split("/").map((seg) => rfc3986(decodeURIComponent(seg))).join("/") || "/";
  const qp = [...u.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);
  const canonicalQuery = qp.map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalRequest = [i.method.toUpperCase(), canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const service = i.service === "ses-v1" ? "ses" : i.service;
  const scope = `${dateStamp}/${i.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let k = await hmac(enc.encode("AWS4" + i.creds.secretAccessKey), dateStamp);
  k = await hmac(k, i.region);
  k = await hmac(k, service);
  k = await hmac(k, "aws4_request");
  const signature = toHex(await hmac(k, stringToSign));
  const out: Record<string, string> = {};
  for (const key of signedHeaderKeys) if (key !== "host") out[key] = headers[key];
  out["authorization"] = `AWS4-HMAC-SHA256 Credential=${i.creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

export class AwsError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export function credsFromEnv(): AwsCreds | null {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const id = env?.get("AWS_ACCESS_KEY_ID"), secret = env?.get("AWS_SECRET_ACCESS_KEY");
  if (!id || !secret) return null;
  return { accessKeyId: id, secretAccessKey: secret, sessionToken: env.get("AWS_SESSION_TOKEN") || undefined };
}

/** SES v2 REST call. Returns parsed JSON (or {}) or throws AwsError. */
export async function sesv2(creds: AwsCreds, region: string, method: string, path: string, body?: unknown) {
  const url = `https://email.${region}.amazonaws.com${path}`;
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers = await signV4({ method, url, region, service: "ses", creds, body: payload, headers: payload ? { "content-type": "application/json" } : {} });
  const res = await fetch(url, { method, headers, body: payload || undefined });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
  if (!res.ok) {
    const code = (res.headers.get("x-amzn-errortype") || json.__type || "AwsError").split(":")[0];
    throw new AwsError(res.status, code, json.message || json.Message || text || res.statusText);
  }
  return json;
}

function xmlValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : null;
}

/** Query-protocol call (SNS or SES v1). Returns raw XML. */
export async function awsQuery(creds: AwsCreds, region: string, service: "sns" | "ses-v1", params: Record<string, string>) {
  const host = service === "sns" ? `sns.${region}.amazonaws.com` : `email.${region}.amazonaws.com`;
  const version = service === "sns" ? "2010-03-31" : "2010-12-01";
  const url = `https://${host}/`;
  const body = Object.entries({ ...params, Version: version }).map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join("&");
  const headers = await signV4({ method: "POST", url, region, service, creds, body, headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" } });
  const res = await fetch(url, { method: "POST", headers, body });
  const xml = await res.text();
  if (!res.ok) throw new AwsError(res.status, xmlValue(xml, "Code") || "AwsError", xmlValue(xml, "Message") || xml.slice(0, 300));
  return { xml, value: (tag: string) => xmlValue(xml, tag), values: (tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]) };
}

export const SES_REGIONS: Record<string, string> = {
  "us-east-1": "North Virginia", "us-east-2": "Ohio", "us-west-1": "N. California", "us-west-2": "Oregon",
  "ca-central-1": "Canada", "sa-east-1": "São Paulo", "eu-west-1": "Ireland", "eu-west-2": "London",
  "eu-west-3": "Paris", "eu-central-1": "Frankfurt", "eu-north-1": "Stockholm", "eu-south-1": "Milan",
  "af-south-1": "Cape Town", "me-south-1": "Bahrain", "ap-south-1": "Mumbai", "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul", "ap-northeast-3": "Osaka", "ap-southeast-1": "Singapore", "ap-southeast-2": "Sydney",
};
// Regions where SES email receiving is available.
export const SES_RECEIVING_REGIONS = new Set(["us-east-1", "us-west-2", "eu-west-1", "eu-west-2", "eu-central-1", "ca-central-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1"]);

import { awsQuery, AwsError, credsFromEnv, sesv2, SES_RECEIVING_REGIONS, SES_REGIONS, type AwsCreds } from "./aws.ts";
import { type Any, db, FUNCTION_URL, HttpError, setting, setSetting } from "./util.ts";
import { b64 } from "./mime.ts";

export function creds(): AwsCreds {
  const c = credsFromEnv();
  if (!c) throw new HttpError(503, "sending_not_configured", "Sending isn't configured yet. Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to the Delivrie edge function secrets.");
  return c;
}
export const hasAws = () => !!credsFromEnv();

export function regionLabel(r: string) { return `${SES_REGIONS[r] || r} (${r})`; }

const EVENT_TYPES_BASE = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "DELIVERY_DELAY", "REJECT", "RENDERING_FAILURE"];

/** SNS topic per region that SES publishes events (and inbound mail) to; auto-subscribed to this function. */
export async function ensureTopic(region: string): Promise<string> {
  const cached = await setting(`sns_topic:${region}`);
  if (cached) return cached;
  const c = creds();
  const created = await awsQuery(c, region, "sns", { Action: "CreateTopic", Name: "delivrie-events" });
  const arn = created.value("TopicArn")!;
  const account = arn.split(":")[4];
  const policy = {
    Version: "2012-10-17",
    Statement: [{ Sid: "AllowSES", Effect: "Allow", Principal: { Service: "ses.amazonaws.com" }, Action: "sns:Publish", Resource: arn, Condition: { StringEquals: { "AWS:SourceAccount": account } } }],
  };
  await awsQuery(c, region, "sns", { Action: "SetTopicAttributes", TopicArn: arn, AttributeName: "Policy", AttributeValue: JSON.stringify(policy) });
  const token = await setting("link_secret");
  const endpoint = `${FUNCTION_URL}/events/ses?token=${encodeURIComponent(token)}`;
  const subs = await awsQuery(c, region, "sns", { Action: "ListSubscriptionsByTopic", TopicArn: arn });
  if (!subs.values("Endpoint").some((e) => e.replace(/&amp;/g, "&") === endpoint)) {
    await awsQuery(c, region, "sns", { Action: "Subscribe", TopicArn: arn, Protocol: "https", Endpoint: endpoint, ReturnSubscriptionArn: "true" });
  }
  await setSetting(`sns_topic:${region}`, arn);
  return arn;
}

function eventDestination(topicArn: string, d: Any) {
  const types = [...EVENT_TYPES_BASE];
  if (d.open_tracking) types.push("OPEN");
  if (d.click_tracking) types.push("CLICK");
  return { Enabled: true, MatchingEventTypes: types, SnsDestination: { TopicArn: topicArn } };
}

async function generateDkimKey() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const priv = b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)));
  const pub = b64(new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)));
  return { priv, pub };
}

export function buildRecords(d: Any, dkimPublic: string) {
  const recs: Any[] = [
    { group: "dkim", record: "DKIM", type: "TXT", name: `${d.dkim_selector}._domainkey`, value: `p=${dkimPublic}`, ttl: "Auto", priority: null, status: "not_started" },
    { group: "sending", record: "SPF", type: "MX", name: d.return_path, value: `feedback-smtp.${d.region}.amazonses.com`, ttl: "Auto", priority: 10, status: "not_started" },
    { group: "sending", record: "SPF", type: "TXT", name: d.return_path, value: "v=spf1 include:amazonses.com ~all", ttl: "Auto", priority: null, status: "not_started" },
    { group: "dmarc", record: "DMARC", type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;", ttl: "Auto", priority: null, status: "optional" },
  ];
  if (d.receiving_enabled) {
    // Receiving can live on a subdomain (in.example.com) so the root domain keeps its own mail provider.
    const sub = d.receiving_subdomain || "";
    recs.push({ group: "receiving", record: "MX", type: "MX", name: sub || "@", value: `inbound-smtp.${d.region}.amazonaws.com`, ttl: "Auto", priority: 10, status: "not_started" });
    if (sub) recs.push({ group: "receiving", record: "DMARC", type: "TXT", name: `_dmarc.${sub}`, value: "v=DMARC1; p=none;", ttl: "Auto", priority: null, status: "optional" });
  }
  return recs;
}

export async function createDomain(teamId: string, name: string, region: string, opts: Any = {}) {
  name = name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) throw new HttpError(422, "validation_error", "Enter a valid domain like mail.example.com");
  if (!SES_REGIONS[region]) throw new HttpError(422, "validation_error", `Unsupported region ${region}`);
  const c = creds();
  const { data: existing } = await db.from("domains").select("id").eq("name", name).limit(1);
  if (existing?.length) throw new HttpError(409, "domain_exists", `${name} is already registered on Delivrie`);
  const { priv, pub } = await generateDkimKey();
  const { data: d, error } = await db.from("domains").insert({
    team_id: teamId, name, region, status: "not_started", return_path: opts.return_path || "send",
    receiving_enabled: !!opts.receiving_enabled, click_tracking: !!opts.click_tracking, open_tracking: !!opts.open_tracking, tls: opts.tls || "opportunistic",
  }).select().single();
  if (error) throw new HttpError(422, "validation_error", error.message);
  try {
    const configSet = `dlv-${d.id}`;
    await sesv2(c, region, "POST", "/v2/email/configuration-sets", { ConfigurationSetName: configSet, DeliveryOptions: { TlsPolicy: d.tls === "enforced" ? "REQUIRE" : "OPTIONAL" }, ReputationOptions: { ReputationMetricsEnabled: true }, SendingOptions: { SendingEnabled: true } });
    const topic = await ensureTopic(region);
    await sesv2(c, region, "POST", `/v2/email/configuration-sets/${configSet}/event-destinations`, { EventDestinationName: "delivrie", EventDestination: eventDestination(topic, d) });
    await sesv2(c, region, "POST", "/v2/email/identities", { EmailIdentity: name, ConfigurationSetName: configSet, DkimSigningAttributes: { DomainSigningSelector: d.dkim_selector, DomainSigningPrivateKey: priv } });
    await sesv2(c, region, "PUT", `/v2/email/identities/${encodeURIComponent(name)}/mail-from`, { MailFromDomain: `${d.return_path}.${name}`, BehaviorOnMxFailure: "USE_DEFAULT_VALUE" });
    if (d.receiving_enabled) await enableReceiving(c, d);
    await db.from("domain_secrets").insert({ domain_id: d.id, dkim_private_key: priv });
    const records = buildRecords(d, pub);
    const { data: updated } = await db.from("domains").update({ config_set: configSet, records, status: "pending" }).eq("id", d.id).select().single();
    return updated;
  } catch (e) {
    // roll back so the user can retry cleanly
    await cleanupSes(c, d).catch(() => {});
    await db.from("domains").delete().eq("id", d.id);
    if (e instanceof AwsError) throw new HttpError(e.status >= 500 ? 502 : 422, "ses_error", `Amazon SES: ${e.message}`);
    throw e;
  }
}

async function cleanupSes(c: AwsCreds, d: Any) {
  await sesv2(c, d.region, "DELETE", `/v2/email/identities/${encodeURIComponent(d.name)}`).catch(() => {});
  await sesv2(c, d.region, "DELETE", `/v2/email/configuration-sets/dlv-${d.id}`).catch(() => {});
  if (d.receiving_enabled) await disableReceiving(c, d).catch(() => {});
}

export async function deleteDomain(d: Any) {
  if (hasAws()) await cleanupSes(creds(), d);
  await db.from("domains").delete().eq("id", d.id);
}

export async function doh(name: string, type: string): Promise<string[]> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" } });
    const j = await r.json();
    return (j.Answer || []).filter((a: Any) => a.type === (type === "TXT" ? 16 : type === "MX" ? 15 : 5)).map((a: Any) => String(a.data).replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch { return []; }
}

/** Checks DNS + SES status and updates the domain. Returns the updated row. */
export async function verifyDomain(d: Any) {
  const recs: Any[] = Array.isArray(d.records) ? d.records : [];
  // Our own DNS look-ups give per-record feedback while SES catches up.
  for (const r of recs) {
    const fqdn = r.name === "@" ? d.name : `${r.name}.${d.name}`;
    const answers = await doh(fqdn, r.type);
    const found = r.type === "MX" ? answers.some((a) => a.toLowerCase().includes(String(r.value).toLowerCase())) : answers.some((a) => a.replace(/\s+/g, "") === String(r.value).replace(/\s+/g, "") || (r.record === "DMARC" && a.startsWith("v=DMARC1")) || (r.record === "SPF" && a.startsWith("v=spf1") && a.includes("amazonses.com")));
    if (r.status !== "optional" || found) r.status = found ? "verified" : (r.status === "not_started" ? "pending" : r.status === "verified" ? "verified" : "pending");
  }
  let status = d.status;
  let verifiedAt = d.verified_at;
  if (hasAws()) {
    const c = creds();
    try {
      const id = await sesv2(c, d.region, "GET", `/v2/email/identities/${encodeURIComponent(d.name)}`);
      const dkim = id?.DkimAttributes?.Status;
      const mailFrom = id?.MailFromAttributes?.MailFromDomainStatus;
      for (const r of recs) {
        if (r.group === "dkim" && dkim === "SUCCESS") r.status = "verified";
        if (r.group === "dkim" && dkim === "FAILED") r.status = "failed";
        if (r.group === "sending" && mailFrom === "SUCCESS") r.status = "verified";
        if (r.group === "sending" && mailFrom === "FAILED") r.status = "failed";
      }
      if (id?.VerifiedForSendingStatus || dkim === "SUCCESS") { status = "verified"; verifiedAt = verifiedAt || new Date().toISOString(); }
      else if (dkim === "FAILED") status = "failed";
      else if (dkim === "TEMPORARY_FAILURE") status = "temporary_failure";
      else status = "pending";
    } catch (e) {
      if (e instanceof AwsError && e.status === 404) status = "failed";
      else throw e;
    }
  }
  const anyFound = recs.some((r) => r.status === "verified");
  const mx = recs.find((r) => r.group === "receiving" && r.type === "MX");
  const receivingVerifiedAt = mx?.status === "verified" ? (d.receiving_verified_at || new Date().toISOString()) : null;
  const { data } = await db.from("domains").update({
    records: recs, status, verified_at: verifiedAt, last_checked_at: new Date().toISOString(), receiving_verified_at: receivingVerifiedAt,
    dns_found_at: d.dns_found_at || (anyFound ? new Date().toISOString() : null),
  }).eq("id", d.id).select().single();
  return data;
}

export async function updateDomainConfig(d: Any, patch: Any) {
  const next = { ...d, ...patch };
  const c = creds();
  const configSet = d.config_set || `dlv-${d.id}`;
  if ("click_tracking" in patch || "open_tracking" in patch) {
    const topic = await ensureTopic(d.region);
    await sesv2(c, d.region, "PUT", `/v2/email/configuration-sets/${configSet}/event-destinations/delivrie`, { EventDestination: eventDestination(topic, next) });
  }
  if ("tls" in patch) await sesv2(c, d.region, "PUT", `/v2/email/configuration-sets/${configSet}/delivery-options`, { TlsPolicy: next.tls === "enforced" ? "REQUIRE" : "OPTIONAL" });
  if ("return_path" in patch && patch.return_path !== d.return_path) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(next.return_path)) throw new HttpError(422, "validation_error", "Return path must be a single subdomain label like send");
    await sesv2(c, d.region, "PUT", `/v2/email/identities/${encodeURIComponent(d.name)}/mail-from`, { MailFromDomain: `${next.return_path}.${d.name}`, BehaviorOnMxFailure: "USE_DEFAULT_VALUE" });
  }
  if ("receiving_subdomain" in patch) {
    const sub = String(patch.receiving_subdomain || "").trim().toLowerCase().replace(new RegExp(`\\.?${d.name.replace(/\./g, "\\.")}$`), "");
    if (sub && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(sub)) throw new HttpError(422, "validation_error", "Receiving subdomain must look like in or inbound");
    patch.receiving_subdomain = sub || null; next.receiving_subdomain = sub || null;
  }
  if ("receiving_mode" in patch && !["all", "specific"].includes(patch.receiving_mode)) throw new HttpError(422, "validation_error", "receiving_mode must be all or specific");
  if ("receiving_addresses" in patch) {
    const list = (Array.isArray(patch.receiving_addresses) ? patch.receiving_addresses : String(patch.receiving_addresses || "").split(/[\s,]+/)).map((a: string) => String(a).trim().toLowerCase()).filter(Boolean);
    const host = next.receiving_subdomain ? `${next.receiving_subdomain}.${d.name}` : d.name;
    patch.receiving_addresses = [...new Set(list.map((a: string) => a.includes("@") ? a : `${a}@${host}`))];
  }
  if ("receiving_enabled" in patch && patch.receiving_enabled !== d.receiving_enabled) {
    if (patch.receiving_enabled) await enableReceiving(c, next); else await disableReceiving(c, next);
  }
  // keep DNS record list in sync with return path / receiving
  const dkimRec = (d.records || []).find((r: Any) => r.group === "dkim");
  const pub = dkimRec ? String(dkimRec.value).replace(/^p=/, "") : "";
  let records = d.records;
  if (("return_path" in patch || "receiving_enabled" in patch || "receiving_subdomain" in patch) && pub) {
    const fresh = buildRecords(next, pub);
    records = fresh.map((r) => ({ ...r, status: (d.records || []).find((o: Any) => o.type === r.type && o.name === r.name && o.value === r.value)?.status || r.status }));
  }
  const allowed: Any = {};
  for (const k of ["click_tracking", "open_tracking", "tls", "return_path", "receiving_enabled", "sending_enabled", "receiving_subdomain", "receiving_mode", "receiving_addresses"]) if (k in patch) allowed[k] = patch[k];
  const { data } = await db.from("domains").update({ ...allowed, records }).eq("id", d.id).select().single();
  return data;
}

// ---------- Inbound (SES receiving) ----------
async function ruleSet(c: AwsCreds, region: string): Promise<string> {
  const active = await awsQuery(c, region, "ses-v1", { Action: "DescribeActiveReceiptRuleSet" });
  const name = active.value("Name");
  if (name) return name;
  await awsQuery(c, region, "ses-v1", { Action: "CreateReceiptRuleSet", RuleSetName: "delivrie" }).catch((e) => { if (!(e instanceof AwsError && e.code === "AlreadyExists")) throw e; });
  await awsQuery(c, region, "ses-v1", { Action: "SetActiveReceiptRuleSet", RuleSetName: "delivrie" });
  return "delivrie";
}
async function enableReceiving(c: AwsCreds, d: Any) {
  if (!SES_RECEIVING_REGIONS.has(d.region)) throw new HttpError(422, "validation_error", `Receiving isn't available in ${regionLabel(d.region)}. Use Ireland (eu-west-1), N. Virginia (us-east-1) or Oregon (us-west-2).`);
  const topic = await ensureTopic(d.region);
  const rs = await ruleSet(c, d.region);
  await awsQuery(c, d.region, "ses-v1", {
    Action: "CreateReceiptRule", RuleSetName: rs, "Rule.Name": `dlv-${d.id}`, "Rule.Enabled": "true", "Rule.ScanEnabled": "true", "Rule.TlsPolicy": "Optional",
    "Rule.Recipients.member.1": d.name, "Rule.Recipients.member.2": `.${d.name}`,
    "Rule.Actions.member.1.SNSAction.TopicArn": topic, "Rule.Actions.member.1.SNSAction.Encoding": "Base64",
  }).catch((e) => { if (!(e instanceof AwsError && e.code === "AlreadyExists")) throw e; });
}
async function disableReceiving(c: AwsCreds, d: Any) {
  const rs = await ruleSet(c, d.region);
  await awsQuery(c, d.region, "ses-v1", { Action: "DeleteReceiptRule", RuleSetName: rs, RuleName: `dlv-${d.id}` }).catch(() => {});
}

export async function accountStatus(region = "eu-west-1") {
  if (!hasAws()) return { configured: false };
  try {
    const a = await sesv2(creds(), region, "GET", "/v2/email/account");
    return { configured: true, production: !!a.ProductionAccessEnabled, sending: !!a.SendingEnabled, max_send_rate: a.SendQuota?.MaxSendRate, max_24h: a.SendQuota?.Max24HourSend, sent_24h: a.SendQuota?.SentLast24Hours, region };
  } catch (e) { return { configured: true, error: (e as Error).message, region }; }
}

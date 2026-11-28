import type {
  ApiKey, Attachment, Automation, Broadcast, Contact, CreateApiKeyRequest, CreateApiKeyResponse, CreateBroadcastRequest,
  CreateContactRequest, CreateDomainRequest, CreateEmailResponse, CreateTemplateRequest, CreateWebhookRequest,
  CreateWebhookResponse, DelivrieErrorResponse, Domain, Email, EmailSummary, ForwardEmailRequest, InboxThread, List,
  ListContactsParams, ListEmailsParams, Log, LogSummary, Metrics, Pagination, ReplyToThreadRequest, RequestOptions, Result,
  Segment, SendEmailRequest, SendEventRequest, Suppression, Template, Topic, UpdateContactRequest, UpdateDomainRequest,
  Usage, Webhook, WebhookDelivery, Deleted, BroadcastRecipients, BroadcastLink, AttachmentDownload, EmailShare,
  ContactImport, CreateContactImportRequest, EmailContent, EmailBlock, EditContentRequest, AiDraftRequest, AiDraft,
} from "./types.js";
import { verifyWebhook, type VerifyWebhookOptions } from "./webhooks.js";

export const VERSION = "0.3.0";
const DEFAULT_BASE_URL = "https://delivrie.io/api";

export interface DelivrieOptions {
  /** Defaults to `https://delivrie.io/api`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** Retries for rate limits, server errors and network errors. Default 2. Sends are only retried with an idempotency key. */
  maxRetries?: number;
  /** A custom fetch, for example in tests or older runtimes. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Query = Record<string, string | number | boolean | undefined | null>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}

// React Email: render a component to HTML and text with @react-email/render, which the app installs alongside
// React Email (it's an optional peer dependency, so the SDK itself stays dependency-free). The specifier is
// left for the runtime to resolve, so bundlers don't fail for apps that never send React components.
async function renderReact(node: unknown): Promise<{ html: string; text: string }> {
  let mod: { render: (n: unknown, o?: { plainText?: boolean }) => string | Promise<string> };
  try {
    const specifier = "@react-email/render";
    mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
  } catch {
    throw new ReactRenderError("To send React Email components, install @react-email/render: npm install @react-email/render");
  }
  try {
    return { html: await mod.render(node), text: await mod.render(node, { plainText: true }) };
  } catch (e) {
    throw new ReactRenderError(`Couldn't render the React component: ${(e as Error)?.message || e}`);
  }
}
class ReactRenderError extends Error {}

async function prepareEmail(e: SendEmailRequest): Promise<Record<string, unknown>> {
  const out = normalizeEmail(e);
  if (e.react !== undefined && e.react !== null) {
    const { html, text } = await renderReact(e.react);
    if (out.html === undefined) out.html = html;
    if (out.text === undefined) out.text = text;
  }
  delete out.react;
  return out;
}

function normalizeEmail(e: SendEmailRequest): Record<string, unknown> {
  const { replyTo, scheduledAt, attachments, ...rest } = e;
  const out: Record<string, unknown> = { ...rest };
  if (out.reply_to === undefined && replyTo !== undefined) out.reply_to = replyTo;
  const when = rest.scheduled_at ?? scheduledAt;
  if (when !== undefined) out.scheduled_at = when instanceof Date ? when.toISOString() : when;
  if (attachments) out.attachments = attachments.map((a: Attachment) => (a.content === undefined || typeof a.content === "string" ? { ...a } : { ...a, content: toBase64(a.content) }));
  return out;
}

/**
 * The Delivrie client.
 *
 * ```ts
 * import { Delivrie } from "delivrie";
 * const delivrie = new Delivrie(process.env.DELIVRIE_API_KEY);
 * const { data, error } = await delivrie.emails.send({ from: "Acme <hi@acme.com>", to: "ada@example.com", subject: "Hi", html: "<p>Hello</p>" });
 * ```
 */
export class Delivrie {
  readonly baseUrl: string;
  private readonly key: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(apiKey?: string, options: DelivrieOptions = {}) {
    // process.env on Node, Bun and Deno (with --allow-env); absent on edge runtimes, where you pass the key directly.
    const env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const key = apiKey ?? env.DELIVRIE_API_KEY;
    if (!key) throw new Error("Missing API key. Pass it to new Delivrie(key) or set DELIVRIE_API_KEY. Create one at https://delivrie.io/api-keys");
    this.key = key;
    this.baseUrl = (options.baseUrl ?? env.DELIVRIE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    const f = options.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!f) throw new Error("No fetch available. Use Node.js 18 or later, or pass options.fetch.");
    this.fetchImpl = f;
    this.extraHeaders = options.headers ?? {};
  }

  /** Low-level request for endpoints the SDK doesn't wrap yet. Paths are relative to the API base, e.g. `/emails`. */
  async request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions & { query?: Query } = {}): Promise<Result<T>> {
    let url = this.baseUrl + path;
    if (opts.query) {
      const q = Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join("&");
      if (q) url += (url.includes("?") ? "&" : "?") + q;
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.key}`,
      accept: "application/json",
      "user-agent": `delivrie-node/${VERSION}`,
      ...this.extraHeaders,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    // GET/DELETE are safe to repeat; POST/PATCH only with an idempotency key, so a retry never sends an email twice.
    const retryable = method === "GET" || method === "DELETE" || !!opts.idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error("timeout")), this.timeout);
      const onAbort = () => ctrl.abort(opts.signal?.reason);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort);
        if (opts.signal?.aborted) return { data: null, error: { statusCode: 0, name: "aborted", message: "The request was aborted" } };
        if (retryable && attempt < this.maxRetries) { await sleep(backoff(attempt)); continue; }
        const timedOut = ctrl.signal.aborted;
        return { data: null, error: { statusCode: 0, name: timedOut ? "timeout" : "network_error", message: timedOut ? `No response within ${this.timeout} ms` : (e as Error)?.message || "Network error" } };
      }
      clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort);

      const text = await res.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.ok) return { data: json as T, error: null };

      const err = toError(res.status, json, text);
      const rateLimited = res.status === 429 && err.name === "rate_limit_exceeded";
      if ((rateLimited || res.status >= 500) && retryable && attempt < this.maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : backoff(attempt));
        continue;
      }
      return { data: null, error: err };
    }
  }

  // ---------------------------------------------------------------- resources

  readonly emails = {
    /** Send one email. Returns its id straight away; delivery events arrive through webhooks. */
    send: async (email: SendEmailRequest, opts?: RequestOptions): Promise<Result<CreateEmailResponse>> => {
      try { return await this.request<CreateEmailResponse>("POST", "/emails", await prepareEmail(email), opts); }
      catch (e) { if (e instanceof ReactRenderError) return renderFailure(e); throw e; }
    },
    /** Send up to 100 emails in one request (no attachments or scheduling). */
    batch: async (emails: SendEmailRequest[], opts?: RequestOptions): Promise<Result<{ data: CreateEmailResponse[] }>> => {
      try { return await this.request<{ data: CreateEmailResponse[] }>("POST", "/emails/batch", await Promise.all(emails.map(prepareEmail)), opts); }
      catch (e) { if (e instanceof ReactRenderError) return renderFailure(e); throw e; }
    },
    get: (id: string) => this.request<Email>("GET", `/emails/${enc(id)}`),
    list: (params: ListEmailsParams = {}) => this.request<List<EmailSummary>>("GET", "/emails", undefined, { query: { ...params } }),
    /** Received (inbound) emails. */
    listReceived: (params: Pagination = {}) => this.request<List<EmailSummary>>("GET", "/emails/received", undefined, { query: { ...params } }),
    /** Move a scheduled email. */
    update: (id: string, params: { scheduled_at: string | Date }) =>
      this.request<{ object: "email"; id: string }>("PATCH", `/emails/${enc(id)}`, { scheduled_at: params.scheduled_at instanceof Date ? params.scheduled_at.toISOString() : params.scheduled_at }),
    /** Cancel a scheduled email. */
    cancel: (id: string) => this.request<{ object: "email"; id: string }>("POST", `/emails/${enc(id)}/cancel`),
    forward: (id: string, params: ForwardEmailRequest) => this.request<CreateEmailResponse>("POST", `/emails/${enc(id)}/forward`, params),
    /** A sent email's files with download links that work for an hour. */
    attachments: (id: string) => this.request<List<AttachmentDownload>>("GET", `/emails/${enc(id)}/attachments`),
    /** A received email's files with download links that work for an hour. */
    receivedAttachments: (id: string) => this.request<List<AttachmentDownload>>("GET", `/emails/received/${enc(id)}/attachments`),
    /** A public link to the email and its delivery timeline. */
    share: (id: string, params: { expires_in_hours?: number } = {}) => this.request<EmailShare>("POST", `/emails/${enc(id)}/share`, params),
    /** Revoke every share link for the email. */
    unshare: (id: string) => this.request<Record<string, unknown>>("DELETE", `/emails/${enc(id)}/share`),
  };

  readonly domains = {
    create: (params: CreateDomainRequest) => this.request<Domain>("POST", "/domains", params),
    get: (id: string) => this.request<Domain>("GET", `/domains/${enc(id)}`),
    /** Check DNS now and update the domain's status. */
    verify: (id: string) => this.request<Domain>("POST", `/domains/${enc(id)}/verify`),
    update: (id: string, params: UpdateDomainRequest) => this.request<Domain>("PATCH", `/domains/${enc(id)}`, params),
    list: () => this.request<List<Domain>>("GET", "/domains"),
    remove: (id: string) => this.request<Deleted>("DELETE", `/domains/${enc(id)}`),
  };

  readonly apiKeys = {
    create: (params: CreateApiKeyRequest) => this.request<CreateApiKeyResponse>("POST", "/api-keys", params),
    list: () => this.request<List<ApiKey>>("GET", "/api-keys"),
    /** Rename a key. */
    update: (id: string, params: { name: string }) => this.request<ApiKey>("PATCH", `/api-keys/${enc(id)}`, params),
    remove: (id: string) => this.request<Deleted>("DELETE", `/api-keys/${enc(id)}`),
  };

  readonly webhooks = {
    create: (params: CreateWebhookRequest) => this.request<CreateWebhookResponse>("POST", "/webhooks", params),
    list: () => this.request<List<Webhook>>("GET", "/webhooks"),
    /** Change the endpoint, events or status (enabled, disabled). */
    update: (id: string, params: { endpoint?: string; events?: string[]; status?: "enabled" | "disabled" }) => this.request<Webhook>("PATCH", `/webhooks/${enc(id)}`, params),
    remove: (id: string) => this.request<Deleted>("DELETE", `/webhooks/${enc(id)}`),
    /** Recent delivery attempts for a webhook. */
    deliveries: (id: string) => this.request<List<WebhookDelivery>>("GET", `/webhooks/${enc(id)}/events`),
    /** Send a test event to the endpoint. */
    test: (id: string) => this.request<Record<string, unknown>>("POST", `/webhooks/${enc(id)}/test`),
    /** Send a past delivery again. */
    replay: (deliveryId: string) => this.request<Record<string, unknown>>("POST", `/webhook-deliveries/${enc(deliveryId)}/replay`),
    /** Check a webhook request's signature and return the parsed event. Rejects with `WebhookVerificationError` if it isn't from Delivrie. */
    verify: <T = Record<string, unknown>>(opts: VerifyWebhookOptions) => verifyWebhook<T>(opts),
  };

  readonly contacts = {
    create: (params: CreateContactRequest) => this.request<{ object: "contact"; id: string }>("POST", "/contacts", params),
    /** By id or email address. */
    get: (idOrEmail: string) => this.request<Contact>("GET", `/contacts/${enc(idOrEmail)}`),
    update: (idOrEmail: string, params: UpdateContactRequest) => this.request<{ object: "contact"; id: string }>("PATCH", `/contacts/${enc(idOrEmail)}`, params),
    list: (params: ListContactsParams = {}) => this.request<List<Contact>>("GET", "/contacts", undefined, { query: { ...params } }),
    remove: (idOrEmail: string) => this.request<Deleted>("DELETE", `/contacts/${enc(idOrEmail)}`),
    imports: {
      /** Import up to 50,000 contacts from CSV text or a list. Runs in the background. */
      create: (params: CreateContactImportRequest) => this.request<ContactImport>("POST", "/contacts/imports", params),
      get: (id: string) => this.request<ContactImport>("GET", `/contacts/imports/${enc(id)}`),
      list: (params: { limit?: number } = {}) => this.request<List<ContactImport>>("GET", "/contacts/imports", undefined, { query: { ...params } }),
    },
  };

  readonly segments = {
    create: (params: { name: string }) => this.request<{ object: "segment"; id: string }>("POST", "/segments", params),
    list: () => this.request<List<Segment>>("GET", "/segments"),
    get: (id: string) => this.request<Segment & { contacts: number }>("GET", `/segments/${enc(id)}`),
    /** Rename a segment. */
    update: (id: string, params: { name: string }) => this.request<Segment>("PATCH", `/segments/${enc(id)}`, params),
    remove: (id: string) => this.request<Deleted>("DELETE", `/segments/${enc(id)}`),
    /** The contacts in a segment. */
    contacts: (id: string, params: Pagination = {}) => this.request<List<Contact> & { total: number }>("GET", `/segments/${enc(id)}/contacts`, undefined, { query: { ...params } }),
    /** Take contacts (emails or ids) out of a segment. The contacts aren't deleted. */
    removeContacts: (id: string, contacts: string[]) => this.request<{ object: "segment"; id: string; removed: number }>("DELETE", `/segments/${enc(id)}/contacts`, { contacts }),
    /** Add contacts by email (they're created if needed). */
    addContacts: (id: string, contacts: Array<string | CreateContactRequest>) =>
      this.request<Record<string, unknown>>("POST", `/segments/${enc(id)}/contacts`, { contacts: contacts.map((c) => (typeof c === "string" ? { email: c } : c)) }),
  };

  readonly topics = { list: () => this.request<List<Topic>>("GET", "/topics") };
  readonly contactProperties = { list: () => this.request<List<Record<string, unknown>>>("GET", "/contact-properties") };

  readonly broadcasts = {
    create: (params: CreateBroadcastRequest) => this.request<{ object: "broadcast"; id: string }>("POST", "/broadcasts", params),
    get: (id: string) => this.request<Broadcast>("GET", `/broadcasts/${enc(id)}`),
    list: () => this.request<List<Broadcast>>("GET", "/broadcasts"),
    /** Send now, or schedule with `scheduled_at`. */
    send: (id: string, params: { scheduled_at?: string | Date } = {}) =>
      this.request<Broadcast>("POST", `/broadcasts/${enc(id)}/send`, params.scheduled_at === undefined ? {} : { scheduled_at: params.scheduled_at instanceof Date ? params.scheduled_at.toISOString() : params.scheduled_at }),
    cancel: (id: string) => this.request<Broadcast>("POST", `/broadcasts/${enc(id)}/cancel`),
    /** How many contacts the broadcast will reach. */
    /** Who it went to (with delivered/opened/clicked/bounced flags), or before sending, who it will reach. */
    recipients: (id: string, params: Pagination & { status?: string } = {}) => this.request<BroadcastRecipients>("GET", `/broadcasts/${enc(id)}/recipients`, undefined, { query: { ...params } }),
    /** Clicked links with total and unique clicks. */
    links: (id: string) => this.request<List<BroadcastLink> & { total_clicks: number }>("GET", `/broadcasts/${enc(id)}/links`),
    /** Edit a draft. */
    update: (id: string, params: Partial<CreateBroadcastRequest>) => this.request<{ object: "broadcast"; id: string }>("PATCH", `/broadcasts/${enc(id)}`, params),
    /** Copy it as a new draft. */
    duplicate: (id: string, params: { name?: string } = {}) => this.request<{ object: "broadcast"; id: string; name: string; status: string }>("POST", `/broadcasts/${enc(id)}/duplicate`, params),
    /** A draft's subject and blocks with ids. */
    getContent: (id: string) => this.request<EmailContent>("GET", `/broadcasts/${enc(id)}/content`),
    /** Edit a draft block by block. Anyone with it open in the editor sees the change live. */
    editContent: (id: string, params: EditContentRequest) => this.request<EmailContent>("POST", `/broadcasts/${enc(id)}/content`, params),
    remove: (id: string) => this.request<Deleted>("DELETE", `/broadcasts/${enc(id)}`),
  };

  readonly templates = {
    create: (params: CreateTemplateRequest) => this.request<{ object: "template"; id: string }>("POST", "/templates", params),
    /** By id or alias. */
    get: (idOrAlias: string) => this.request<Template>("GET", `/templates/${enc(idOrAlias)}`),
    list: () => this.request<List<Template>>("GET", "/templates"),
    /** Publish the current draft so sends use it. */
    publish: (id: string) => this.request<Template>("POST", `/templates/${enc(id)}/publish`),
    /** Change it. Saved as a draft until published. */
    update: (idOrAlias: string, params: Partial<CreateTemplateRequest> & Record<string, unknown>) => this.request<{ object: "template"; id: string }>("PATCH", `/templates/${enc(idOrAlias)}`, params),
    duplicate: (idOrAlias: string, params: { name?: string; alias?: string } = {}) => this.request<{ object: "template"; id: string; name: string }>("POST", `/templates/${enc(idOrAlias)}/duplicate`, params),
    remove: (idOrAlias: string) => this.request<Deleted>("DELETE", `/templates/${enc(idOrAlias)}`),
    getContent: (idOrAlias: string) => this.request<EmailContent>("GET", `/templates/${enc(idOrAlias)}/content`),
    /** Edit it block by block. Anyone with it open in the editor sees the change live. */
    editContent: (idOrAlias: string, params: EditContentRequest) => this.request<EmailContent>("POST", `/templates/${enc(idOrAlias)}/content`, params),
  };

  readonly suppressions = {
    /** Stop sending to one or more addresses. */
    add: (email: string | string[]) => this.request<Record<string, unknown>>("POST", "/suppressions", Array.isArray(email) ? { emails: email } : { email }),
    list: () => this.request<List<Suppression>>("GET", "/suppressions"),
    remove: (email: string) => this.request<Deleted>("DELETE", `/suppressions/${enc(email)}`),
  };

  readonly events = {
    /** Record an event for a contact; live automations listening for it start. */
    send: (params: SendEventRequest) => this.request<Record<string, unknown>>("POST", "/events", params),
    list: () => this.request<List<Record<string, unknown>>>("GET", "/events"),
  };

  readonly automations = {
    list: () => this.request<List<Automation>>("GET", "/automations"),
    get: (id: string) => this.request<Automation>("GET", `/automations/${enc(id)}`),
    create: (params: Record<string, unknown>) => this.request<Automation>("POST", "/automations", params),
    runs: (id: string) => this.request<List<Record<string, unknown>>>("GET", `/automations/${enc(id)}/runs`),
    publish: (id: string) => this.request<Automation>("POST", `/automations/${enc(id)}/publish`),
    pause: (id: string) => this.request<Automation>("POST", `/automations/${enc(id)}/pause`),
    resume: (id: string) => this.request<Automation>("POST", `/automations/${enc(id)}/resume`),
    /** Copy it, with its trigger and steps, as a new draft. */
    duplicate: (id: string, params: { name?: string } = {}) => this.request<Automation>("POST", `/automations/${enc(id)}/duplicate`, params),
    update: (id: string, params: { name?: string; reentry?: "once" | "always" }) => this.request<Automation>("PATCH", `/automations/${enc(id)}`, params),
    remove: (id: string) => this.request<Deleted>("DELETE", `/automations/${enc(id)}`),
  };

  readonly inbox = {
    threads: {
      list: (params: Pagination & Query = {}) => this.request<List<InboxThread>>("GET", "/inbox/threads", undefined, { query: params }),
      get: (id: string) => this.request<InboxThread>("GET", `/inbox/threads/${enc(id)}`),
      update: (id: string, params: Record<string, unknown>) => this.request<InboxThread>("PATCH", `/inbox/threads/${enc(id)}`, params),
      reply: (id: string, params: ReplyToThreadRequest) => this.request<CreateEmailResponse>("POST", `/inbox/threads/${enc(id)}/reply`, params),
      /** Run the inbox's agent on this thread now. */
      runAgent: (id: string) => this.request<Record<string, unknown>>("POST", `/inbox/threads/${enc(id)}/agent`),
      notes: (id: string) => this.request<List<Record<string, unknown>>>("GET", `/inbox/threads/${enc(id)}/notes`),
      addNote: (id: string, body: string) => this.request<Record<string, unknown>>("POST", `/inbox/threads/${enc(id)}/notes`, { body }),
    },
    notes: { remove: (id: string) => this.request<Deleted>("DELETE", `/inbox/notes/${enc(id)}`) },
    drafts: {
      list: (params: { thread_id?: string; inbox?: string; source?: "user" | "agent" } = {}) => this.request<List<Record<string, unknown>>>("GET", "/inbox/drafts", undefined, { query: { ...params } }),
      create: (params: Record<string, unknown>) => this.request<Record<string, unknown>>("POST", "/inbox/drafts", params),
      update: (id: string, params: Record<string, unknown>) => this.request<Record<string, unknown>>("PATCH", `/inbox/drafts/${enc(id)}`, params),
      send: (id: string) => this.request<CreateEmailResponse>("POST", `/inbox/drafts/${enc(id)}/send`),
      remove: (id: string) => this.request<Deleted>("DELETE", `/inbox/drafts/${enc(id)}`),
    },
    labels: { list: () => this.request<List<Record<string, unknown>>>("GET", "/inbox/labels") },
  };

  /** Inboxes (addresses on receiving domains) and their agent settings. */
  readonly inboxes = {
    list: () => this.request<List<Record<string, unknown>>>("GET", "/inboxes"),
    create: (params: { address: string; name?: string; description?: string }) => this.request<Record<string, unknown>>("POST", "/inboxes", params),
    get: (idOrAddress: string) => this.request<Record<string, unknown>>("GET", `/inboxes/${enc(idOrAddress)}`),
    update: (idOrAddress: string, params: Record<string, unknown>) => this.request<Record<string, unknown>>("PATCH", `/inboxes/${enc(idOrAddress)}`, params),
    remove: (idOrAddress: string) => this.request<Deleted>("DELETE", `/inboxes/${enc(idOrAddress)}`),
    agentRuns: (idOrAddress: string, params: { limit?: number } = {}) => this.request<List<Record<string, unknown>>>("GET", `/inboxes/${enc(idOrAddress)}/agent-runs`, undefined, { query: { ...params } }),
  };

  /** AI writing in the team's brand voice. */
  readonly ai = {
    /** Write an email from a url and/or brief. With target, writes it into a template or draft broadcast. */
    draft: (params: AiDraftRequest) => this.request<AiDraft>("POST", "/ai/draft", params),
    /** Rewrite blocks with an instruction. */
    rewrite: (params: { blocks: EmailBlock[]; instruction: string; kind?: "broadcast" | "template"; context?: string }) => this.request<{ object: "ai_rewrite"; blocks: EmailBlock[] }>("POST", "/ai/rewrite", params),
    /** Subject line ideas for an email's text. */
    subjects: (params: { text: string; current?: string }) => this.request<List<{ subject: string; preview_text: string }>>("POST", "/ai/subjects", params),
  };

  readonly metrics = {
    get: (params: { days?: number; domain_id?: string } = {}) => this.request<Metrics>("GET", "/metrics", undefined, { query: params }),
  };

  readonly logs = {
    list: (params: Pagination = {}) => this.request<List<LogSummary>>("GET", "/logs", undefined, { query: { ...params } }),
    get: (id: string) => this.request<Log>("GET", `/logs/${enc(id)}`),
  };

  readonly usage = { get: () => this.request<Usage>("GET", "/usage") };
}

function renderFailure(e: Error): { data: null; error: DelivrieErrorResponse } {
  return { data: null, error: { statusCode: 0, name: "react_render_error", message: e.message } };
}

function backoff(attempt: number) {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function toError(status: number, json: unknown, text: string): DelivrieErrorResponse {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    statusCode: typeof j.statusCode === "number" ? j.statusCode : status,
    name: typeof j.name === "string" ? j.name : status === 401 ? "invalid_api_key" : status === 404 ? "not_found" : status === 429 ? "rate_limit_exceeded" : "application_error",
    message: typeof j.message === "string" ? j.message : text.slice(0, 300) || `Request failed with status ${status}`,
  };
}

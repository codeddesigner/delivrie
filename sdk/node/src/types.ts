// Request and response types for the Delivrie API (https://delivrie.io/docs/api).
// Field names match the API exactly (snake_case), so the API reference and these types read the same.

/** Every call resolves to `{ data, error }`: one of them is null. Calls never throw for API errors. */
export type Result<T> = { data: T; error: null } | { data: null; error: DelivrieErrorResponse };

export interface DelivrieErrorResponse {
  /** HTTP status, or 0 when the request never reached the API (network error or timeout). */
  statusCode: number;
  /** Machine-readable error name, for example `validation_error`, `invalid_api_key`, `rate_limit_exceeded`. */
  name: string;
  message: string;
}

export interface List<T> {
  object: "list";
  data: T[];
  has_more?: boolean;
}

export interface Pagination {
  /** Results per page, 1 to 100. Default 50. */
  limit?: number;
  /** How many results to skip. Default 0. */
  offset?: number;
}

export interface RequestOptions {
  /** Retrying with the same key returns the original result instead of sending again. */
  idempotencyKey?: string;
  /** Abort the request early. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------- emails

export interface Tag {
  /** ASCII letters, numbers, underscores and dashes. */
  name: string;
  value: string;
}

export interface Attachment {
  /** Defaults to the file name in `path`. */
  filename?: string;
  /** File contents as a base64 string (or a Buffer/Uint8Array, which the SDK encodes for you). Up to 40 MB per email. Provide `content` or `path`. */
  content?: string | Uint8Array;
  /** A public https:// URL that Delivrie downloads when the email is accepted. */
  path?: string;
  content_type?: string;
  /** Set to reference the file inline from HTML with `cid:<content_id>`. */
  content_id?: string;
}

export interface TemplateRef {
  /** Template id or alias. The template must be published. */
  id: string;
  variables?: Record<string, string | number | boolean | null>;
}

export interface SendEmailRequest {
  /** Sender on a verified domain. `"Name <email@domain>"` sets a display name. Optional when the template has a default sender. */
  from?: string;
  /** One address or up to 50. */
  to: string | string[];
  /** Required unless you send a template. */
  subject?: string;
  html?: string;
  /** Generated from `html` when omitted. */
  text?: string;
  /**
   * A React Email component, like `<Welcome name="Ada" />`. The SDK renders it to `html` and `text` with
   * `@react-email/render`, which you install alongside React Email. Ignored if you also pass `html`.
   */
  react?: unknown;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  /** Alias of `reply_to`, for code moving over from other providers. */
  replyTo?: string | string[];
  /** Send a published template instead of `html`/`text`. */
  template?: TemplateRef;
  /** ISO 8601 date or a phrase like `"in 1 hour"` or `"tomorrow at 9am"` (UTC). Up to 30 days ahead. */
  scheduled_at?: string | Date;
  /** Alias of `scheduled_at`. */
  scheduledAt?: string | Date;
  tags?: Tag[];
  headers?: Record<string, string>;
  attachments?: Attachment[];
}

export interface CreateEmailResponse {
  id: string;
}

export type EmailStatus =
  | "queued" | "scheduled" | "sending" | "sent" | "delivered" | "delivery_delayed"
  | "opened" | "clicked" | "bounced" | "complained" | "failed" | "canceled" | "received" | (string & {});

export interface EmailEvent {
  type: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface Email {
  object: "email";
  id: string;
  from: string;
  to: string[];
  cc: string[] | null;
  bcc: string[] | null;
  reply_to: string[] | null;
  subject: string;
  html: string | null;
  text: string | null;
  last_event: EmailStatus;
  created_at: string;
  scheduled_at: string | null;
  tags: Tag[] | null;
  error: string | null;
  events: EmailEvent[];
}

export interface EmailSummary {
  id: string;
  from: string;
  to: string[];
  subject: string;
  status: EmailStatus;
  last_event: EmailStatus;
  created_at: string;
  scheduled_at: string | null;
}

export interface ListEmailsParams extends Pagination {
  /** `outbound` (default) or `inbound` for received mail. */
  direction?: "outbound" | "inbound";
}

export interface ForwardEmailRequest {
  to: string | string[];
  /** Sender on a verified domain. */
  from: string;
  /** Optional note shown above the forwarded message. */
  note?: string;
}

// ---------------------------------------------------------------- domains

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl: string;
  priority: number | null;
  status: "not_started" | "pending" | "verified" | "failed" | "optional" | (string & {});
  group?: string;
}

export interface Domain {
  object: "domain";
  id: string;
  name: string;
  status: "not_started" | "pending" | "verified" | "failed" | "temporary_failure" | (string & {});
  region: string;
  region_label: string;
  records: DnsRecord[];
  created_at: string;
  click_tracking: boolean;
  open_tracking: boolean;
  tls: "opportunistic" | "enforced";
  return_path: string;
  receiving_enabled: boolean;
  receiving_subdomain: string | null;
  receiving_mode: string | null;
  receiving_addresses: string[] | null;
  /** Addresses that get a copy of every email this domain receives. Empty when forwarding is off. */
  receiving_forward_to: string[];
  receiving_verified_at: string | null;
}

export interface CreateDomainRequest {
  /** A domain or subdomain you own, for example `mail.example.com`. */
  name: string;
  region?: string;
  /** Subdomain used for bounces. Default `send`. */
  return_path?: string;
  click_tracking?: boolean;
  open_tracking?: boolean;
}

export interface UpdateDomainRequest {
  click_tracking?: boolean;
  open_tracking?: boolean;
  tls?: "opportunistic" | "enforced";
  return_path?: string;
}

// ---------------------------------------------------------------- API keys

export interface ApiKey {
  id: string;
  name: string;
  /** First characters of the key, for recognising it. The full key is only returned when created. */
  prefix: string;
  permission: "full" | "sending";
  domain_id: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface CreateApiKeyRequest {
  name: string;
  /** `full_access` (default) or `sending_access`. */
  permission?: "full_access" | "sending_access";
  /** Limit a sending key to one domain. */
  domain_id?: string;
}

export interface CreateApiKeyResponse {
  id: string;
  /** The key itself. Shown once: store it now. */
  token: string;
}

// ---------------------------------------------------------------- webhooks

export type WebhookEventType =
  | "email.sent" | "email.delivered" | "email.delivery_delayed" | "email.opened" | "email.clicked"
  | "email.bounced" | "email.complained" | "email.failed" | "email.received" | "contact.created"
  | "contact.updated" | "contact.deleted" | "domain.created" | "domain.updated" | "*" | (string & {});

export interface Webhook {
  id: string;
  endpoint: string;
  events: WebhookEventType[];
  status: "enabled" | "disabled" | (string & {});
  created_at: string;
}

export interface CreateWebhookRequest {
  /** An https:// URL. */
  endpoint: string;
  events: WebhookEventType[];
}

export interface CreateWebhookResponse {
  object: "webhook";
  id: string;
  /** Use with `verifyWebhook` to check that requests come from Delivrie. Shown once. */
  signing_secret: string;
}

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  delivered: boolean;
  attempts: number;
  status_code: number | null;
  created_at: string;
  updated_at: string;
}

/** The JSON body Delivrie posts to your endpoint. */
export interface WebhookEvent<T = Record<string, unknown>> {
  type: WebhookEventType;
  created_at: string;
  data: T;
}

// ---------------------------------------------------------------- contacts, segments, topics

export interface Contact {
  object?: "contact";
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  properties: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
}

export interface CreateContactRequest {
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
  properties?: Record<string, unknown>;
  /** Segment ids to add the contact to. */
  segments?: string[];
}

export interface UpdateContactRequest {
  first_name?: string | null;
  last_name?: string | null;
  unsubscribed?: boolean;
  /** Merged into the existing properties. */
  properties?: Record<string, unknown>;
}

export interface ListContactsParams extends Pagination {
  /** ISO date, or `"today"`. */
  created_after?: string;
}

export interface Segment {
  id: string;
  name: string;
  created_at: string;
  [key: string]: unknown;
}

export interface Topic {
  id: string;
  name: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- broadcasts and templates

export interface Broadcast {
  object?: "broadcast";
  id: string;
  name: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "canceled" | (string & {});
  segment_id: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CreateBroadcastRequest {
  from: string;
  subject: string;
  segment_id: string;
  html?: string;
  text?: string;
  topic_id?: string;
  name?: string;
  reply_to?: string;
  preview_text?: string;
}

export interface Template {
  object?: "template";
  id: string;
  name: string;
  alias: string | null;
  status: string;
  published_version: number | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface CreateTemplateRequest {
  name: string;
  /** Lets you send it with `template: { id: "<alias>" }`. */
  alias?: string;
  subject?: string;
  html?: string;
  from?: string;
  variables?: Array<{ key: string; fallback?: string }>;
}

// ---------------------------------------------------------------- suppressions, metrics, logs, usage

export interface Suppression {
  email: string;
  reason: string;
  created_at: string;
  [key: string]: unknown;
}

export interface MetricsDay {
  day: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  [key: string]: unknown;
}

export interface Metrics {
  days: MetricsDay[];
  totals: { sent: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number };
  rates: { delivery: number; bounce: number; complaint: number };
}

export interface LogSummary {
  id: string;
  endpoint: string;
  method: string;
  status: number;
  user_agent: string | null;
  created_at: string;
}

export interface Log extends LogSummary {
  request_body?: unknown;
  response_body?: unknown;
  [key: string]: unknown;
}

export interface Usage {
  [key: string]: unknown;
}

// ---------------------------------------------------------------- events and automations

export interface SendEventRequest {
  /** Event name, for example `user.signed_up`. Starts live automations listening for it. */
  event: string;
  /** The contact the event is about. */
  email: string;
  data?: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- inbox

export interface InboxThread {
  id: string;
  subject: string;
  [key: string]: unknown;
}

export interface ReplyToThreadRequest {
  /** Plain text; it's wrapped in simple HTML for you. Provide text or html. */
  text?: string;
  html?: string;
}

/** GET /broadcasts/:id/recipients. `total`, `topic_opt_out` and `recipients` are counts; `data` lists people. */
export interface BroadcastRecipients {
  object: "list";
  data: Array<{ object: "broadcast_recipient"; email: string; contact_id: string | null; email_id?: string; status: string; sent_at?: string | null; delivered?: boolean; opened?: boolean; clicked?: boolean; bounced?: boolean; complained?: boolean; unsubscribed?: boolean }>;
  has_more: boolean;
  /** Contacts in the segment (before sending) or emails sent. */
  total: number;
  topic_opt_out: number;
  /** How many it reaches after unsubscribes, topic opt-outs and suppressions. */
  recipients: number;
}

export interface BroadcastLink {
  object: "broadcast_link";
  link: string;
  clicks: number;
  unique_clicks: number;
}

/** A sent or received email's file. `download_url` works until `expires_at` (an hour). */
export interface AttachmentDownload {
  object: "attachment";
  id: string;
  filename: string;
  content_type: string;
  size: number | null;
  content_id?: string;
  download_url: string | null;
  expires_at: string | null;
  /** Why there's no download_url: the file is older than storage, or past the 30-day retention. */
  note?: string;
}

export interface EmailShare {
  object: "email_share";
  email_id: string;
  url: string;
  token: string;
  expires_at: string;
}

export interface CreateContactImportRequest {
  /** CSV text with a header row and an email column. Provide csv or contacts. */
  csv?: string;
  /** Contacts as objects, or plain email addresses. */
  contacts?: Array<string | CreateContactRequest>;
  /** Map CSV headers to fields: { "E-mail": "email", "Company": "property:company", "Notes": null }. */
  columns?: Record<string, string | null>;
  /** Add everyone to these segments. */
  segment_ids?: string[];
  /** Update contacts that already exist. Default true. */
  update_existing?: boolean;
}

export interface ContactImport {
  object: "contact_import";
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  segment_ids: string[];
  update_existing: boolean;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  /** The first 100 problems. */
  errors: Array<{ row: number | null; email: string | null; message: string }>;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

/** An editor block: title, heading, eyebrow, text, bulleted, numbered, callout, button, image, rows, divider, spacer, otp, footer. */
export interface EmailBlock {
  id?: string;
  type: string;
  [field: string]: unknown;
}

export type EditOperation =
  | { op: "replace"; id: string; block: EmailBlock }
  | { op: "update"; id: string; set: Record<string, unknown> }
  | { op: "insert"; after?: string | null; before?: string; block?: EmailBlock; blocks?: EmailBlock[] }
  | { op: "delete"; id: string }
  | { op: "move"; id: string; after?: string | null; before?: string };

export interface EditContentRequest {
  ops?: EditOperation[];
  /** Replace every block. */
  blocks?: EmailBlock[];
  subject?: string;
  /** Broadcasts only. */
  preview_text?: string;
  /** One line on what changed, shown in the editor. */
  summary?: string;
}

export interface EmailContent {
  object: "template_content" | "broadcast_content";
  id: string;
  name: string;
  subject: string | null;
  preview_text?: string | null;
  content: { page: Record<string, unknown> | null; blocks: EmailBlock[] };
  agent_edit: { by: string; at: string; rev: number; summary?: string } | null;
  editor_url: string;
}

export interface AiDraftRequest {
  /** A page to write from: a blog post, changelog, product or event page. */
  url?: string;
  /** What the email is for. Provide url, brief or both. */
  brief?: string;
  kind?: "broadcast" | "template";
  length?: "short" | "medium" | "long";
  tone?: string;
  variables?: string[];
  /** Write it straight into this template or draft broadcast. */
  target?: { type: "template" | "broadcast"; id: string };
}

export interface AiDraft {
  object: "ai_draft";
  subject: string;
  preview_text: string;
  content: { blocks: EmailBlock[] };
  notes: string | null;
  source: { url: string; title: string } | null;
  target?: { type: "template" | "broadcast"; id: string };
}

/** @deprecated Use BroadcastRecipients. */
export interface BroadcastRecipientCount {
  /** Contacts in the segment. */
  total: number;
  /** Contacts who opted out of the broadcast's topic. */
  topic_opt_out: number;
  /** Contacts it will be sent to, after unsubscribes, topic opt-outs and suppressions. */
  recipients: number;
}

export interface Deleted {
  object: string;
  id: string;
  deleted: true;
}

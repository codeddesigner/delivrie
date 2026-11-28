// Delivrie on Zapier. Deploy with the Zapier CLI: `zapier push` (see README.md).
const { version } = require("./package.json");
const { version: platformVersion } = require("zapier-platform-core");
const { API, addAuth, handleErrors, call, clean, list } = require("./api");
const { hookTrigger } = require("./hooks");

const authentication = {
  type: "custom",
  fields: [{ key: "api_key", label: "API key", type: "password", required: true, helpText: "Create one in Delivrie under [API keys](https://delivrie.io/api-keys). Full access lets Zaps manage contacts and segments; sending access only sends email." }],
  test: { url: `${API}/usage` },
  connectionLabel: "{{json.plan}} plan",
};

const EMAIL_EVENTS = { "email.delivered": "Delivered", "email.bounced": "Bounced", "email.complained": "Marked as spam", "email.opened": "Opened", "email.clicked": "Link clicked", "email.delivery_delayed": "Delivery delayed", "email.failed": "Failed", "email.sent": "Sent" };

const triggers = [
  hookTrigger({
    key: "email_event", noun: "Email event", label: "Email Event", description: "Triggers when an email is delivered, bounces, is opened or clicked, or is marked as spam.",
    eventChoices: EMAIL_EVENTS,
    sample: { id: "email.delivered:4ef9a417:2026-11-28T09:12:06.511Z", type: "email.delivered", created_at: "2026-11-28T09:12:06.511Z", email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", from: "Acme <orders@mail.acme.com>", to: ["ada@example.com"], subject: "Your order is confirmed" },
    list: async (z) => {
      const r = await call(z, "GET", "/emails", undefined, { limit: 3 });
      return (r.data || []).map((e) => ({ id: `email.${e.last_event || "sent"}:${e.id}`, type: `email.${e.last_event || "sent"}`, created_at: e.created_at, email_id: e.id, from: e.from, to: e.to, subject: e.subject }));
    },
  }),
  hookTrigger({
    key: "email_received", noun: "Received email", label: "New Received Email", description: "Triggers when mail arrives at one of your receiving addresses.",
    events: ["email.received"],
    sample: { id: "email.received:a5c3e1f0:2026-11-28T10:22:30.000Z", type: "email.received", created_at: "2026-11-28T10:22:30.000Z", email_id: "a5c3e1f0-4d2b-4bb1-9a63-7f1e2d0c9b11", from: "Ada Lovelace <ada@example.com>", to: ["support@in.acme.com"], subject: "Question about my order", attachments: [] },
    list: async (z) => {
      const r = await call(z, "GET", "/emails/received", undefined, { limit: 3 });
      return (r.data || []).map((e) => ({ id: `email.received:${e.id}`, type: "email.received", created_at: e.created_at, email_id: e.id, from: e.from, to: e.to, subject: e.subject, attachments: e.attachments }));
    },
  }),
  hookTrigger({
    key: "contact_event", noun: "Contact", label: "Contact Created or Updated", description: "Triggers when a contact is added, changes or unsubscribes, or is deleted.",
    eventChoices: { "contact.created": "Created", "contact.updated": "Updated (including unsubscribes)", "contact.deleted": "Deleted" },
    sample: { id: "contact.created:c1:2026-11-28T09:00:00Z", type: "contact.created", created_at: "2026-11-28T09:00:00Z", email: "ada@example.com", first_name: "Ada", last_name: "Lovelace", unsubscribed: false },
  }),
  hookTrigger({
    key: "inbox_message", noun: "Inbox message", label: "New Inbox Message", description: "Triggers when a customer writes to one of your Delivrie inboxes.",
    events: ["inbox.email.received"],
    sample: { id: "inbox.email.received:t1:2026-11-28T10:22:30Z", type: "inbox.email.received", created_at: "2026-11-28T10:22:30Z", email_id: "a5c3e1f0", thread_id: "8b2f…", inbox_id: "i1", from: "Ada <ada@example.com>", to: ["support@in.acme.com"], subject: "Refund", status: "open" },
  }),
  hookTrigger({
    key: "broadcast_sent", noun: "Broadcast", label: "Broadcast Sent", description: "Triggers when a broadcast finishes sending, with its stats.",
    events: ["broadcast.sent"],
    sample: { id: "broadcast.sent:b1:2026-11-28T12:00:00Z", type: "broadcast.sent", created_at: "2026-11-28T12:00:00Z", name: "November update", subject: "What's new", recipients: 1180, stats: { delivered: 1170, opened: 520, clicked: 140 } },
  }),
  // Hidden triggers that fill dropdowns.
  { key: "segment_list", noun: "Segment", display: { label: "Segments", description: "Lists segments.", hidden: true }, operation: { perform: async (z) => ((await call(z, "GET", "/segments")).data || []).map((s) => ({ id: s.id, name: s.name })) } },
  { key: "template_list", noun: "Template", display: { label: "Templates", description: "Lists published templates.", hidden: true }, operation: { perform: async (z) => ((await call(z, "GET", "/templates")).data || []).filter((t) => t.status === "published").map((t) => ({ id: t.alias || t.id, name: t.name })) } },
];

const creates = [
  {
    key: "send_email", noun: "Email", display: { label: "Send Email", description: "Sends an email from a verified domain, written here or from a published template." },
    operation: {
      inputFields: [
        { key: "from", label: "From", required: true, helpText: "A sender on a verified domain, like `Acme <hello@mail.acme.com>`." },
        { key: "to", label: "To", required: true, list: true },
        { key: "subject", label: "Subject", helpText: "Not needed with a template that has one." },
        { key: "template", label: "Template", dynamic: "template_list.id.name", helpText: "Send a published template instead of writing the email here." },
        { key: "variables", label: "Template variables", dict: true },
        { key: "html", label: "HTML body", type: "text" },
        { key: "text", label: "Plain-text body", type: "text" },
        { key: "reply_to", label: "Reply-to", list: true },
        { key: "cc", label: "Cc", list: true },
        { key: "bcc", label: "Bcc", list: true },
        { key: "scheduled_at", label: "Send at", type: "datetime", helpText: "Leave empty to send now. Up to 30 days ahead." },
        { key: "attachment_url", label: "Attachment URL", helpText: "A public HTTPS link to a file to attach." },
        { key: "idempotency_key", label: "Idempotency key", helpText: "Optional. Repeating a send with the same key returns the first email instead of sending again." },
      ],
      perform: async (z, bundle) => {
        const i = bundle.inputData;
        if (!i.template && !i.html && !i.text) throw new z.errors.Error("Add an HTML or plain-text body, or choose a template.", "ValidationError", 422);
        const body = clean({
          from: i.from, to: list(i.to), subject: i.subject, html: i.html, text: i.text, reply_to: list(i.reply_to), cc: list(i.cc), bcc: list(i.bcc), scheduled_at: i.scheduled_at,
          template: i.template ? { id: i.template, variables: i.variables || {} } : undefined,
          attachments: i.attachment_url ? [{ path: i.attachment_url }] : undefined,
          tags: [{ name: "source", value: "zapier" }],
        });
        const res = await z.request({ url: `${API}/emails`, method: "POST", body, headers: i.idempotency_key ? { "Idempotency-Key": i.idempotency_key } : {}, skipThrowForStatus: true });
        return res.data !== undefined ? res.data : res.json;
      },
      sample: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" },
    },
  },
  {
    key: "upsert_contact", noun: "Contact", display: { label: "Create or Update Contact", description: "Adds a contact, or updates the one with this email, and optionally adds it to a segment." },
    operation: {
      inputFields: [
        { key: "email", label: "Email", required: true },
        { key: "first_name", label: "First name" },
        { key: "last_name", label: "Last name" },
        { key: "segment_id", label: "Add to segment", dynamic: "segment_list.id.name" },
        { key: "properties", label: "Properties", dict: true, helpText: "Custom properties, like plan or city." },
        { key: "unsubscribed", label: "Unsubscribed", type: "boolean" },
      ],
      perform: async (z, bundle) => {
        const i = bundle.inputData;
        const body = clean({ email: i.email, first_name: i.first_name, last_name: i.last_name, properties: i.properties, segments: i.segment_id ? [i.segment_id] : undefined });
        if (i.unsubscribed !== undefined && i.unsubscribed !== "") body.unsubscribed = i.unsubscribed === true || i.unsubscribed === "true";
        return call(z, "POST", "/contacts", body);
      },
      sample: { object: "contact", id: "c_1" },
    },
  },
  {
    key: "add_to_segment", noun: "Segment", display: { label: "Add Contacts to Segment", description: "Adds contacts to a segment, creating any that don't exist." },
    operation: {
      inputFields: [{ key: "segment_id", label: "Segment", required: true, dynamic: "segment_list.id.name" }, { key: "emails", label: "Emails", required: true, list: true }],
      perform: async (z, bundle) => call(z, "POST", `/segments/${encodeURIComponent(bundle.inputData.segment_id)}/contacts`, { contacts: list(bundle.inputData.emails) }),
      sample: { object: "segment", id: "s_1", added: 1 },
    },
  },
  {
    key: "send_event", noun: "Event", display: { label: "Send Event", description: "Records an event for a contact, which starts any live automation listening for it." },
    operation: {
      inputFields: [{ key: "name", label: "Event name", required: true, helpText: "Like `user.signed_up` or `trial.ending`." }, { key: "email", label: "Contact email", required: true }, { key: "data", label: "Event data", dict: true }],
      perform: async (z, bundle) => call(z, "POST", "/events", clean({ name: bundle.inputData.name, email: bundle.inputData.email, data: bundle.inputData.data })),
      sample: { object: "event", id: "ev_1", automations_started: 1 },
    },
  },
  {
    key: "unsubscribe_contact", noun: "Contact", display: { label: "Unsubscribe Contact", description: "Unsubscribes a contact from all broadcasts." },
    operation: {
      inputFields: [{ key: "email", label: "Email", required: true }],
      perform: async (z, bundle) => call(z, "PATCH", `/contacts/${encodeURIComponent(String(bundle.inputData.email).toLowerCase())}`, { unsubscribed: true }),
      sample: { object: "contact", id: "c_1" },
    },
  },
];

const searches = [
  {
    key: "find_contact", noun: "Contact", display: { label: "Find Contact", description: "Finds a contact by email." },
    operation: {
      inputFields: [{ key: "email", label: "Email", required: true }],
      perform: async (z, bundle) => {
        const res = await z.request({ url: `${API}/contacts/${encodeURIComponent(String(bundle.inputData.email).toLowerCase())}`, method: "GET", skipThrowForStatus: true });
        if (res.status === 404) return [];
        if (res.status >= 400) handleErrors(res, z);
        return [res.data !== undefined ? res.data : res.json];
      },
      sample: { object: "contact", id: "c_1", email: "ada@example.com", first_name: "Ada", unsubscribed: false },
    },
  },
];

module.exports = {
  version,
  platformVersion,
  authentication,
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],
  triggers: Object.fromEntries(triggers.map((t) => [t.key, t])),
  creates: Object.fromEntries(creates.map((c) => [c.key, c])),
  searches: Object.fromEntries(searches.map((s) => [s.key, s])),
};

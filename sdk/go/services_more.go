package delivrie

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// raw sends a request and decodes the response into a Raw object.
func (c *Client) raw(ctx context.Context, method, path string, body any, opts ...RequestOption) (Raw, error) {
	out := Raw{}
	return out, c.Do(ctx, method, path, body, &out, opts...)
}

func (c *Client) rawList(ctx context.Context, path string, q url.Values) (*List[Raw], error) {
	out := &List[Raw]{}
	if q == nil {
		return out, c.Do(ctx, http.MethodGet, path, nil, out)
	}
	return out, c.Do(ctx, http.MethodGet, path, nil, out, withQuery(q))
}

func (c *Client) deleted(ctx context.Context, path string, body any) (*Deleted, error) {
	out := &Deleted{}
	return out, c.Do(ctx, http.MethodDelete, path, body, out)
}

// ---------------------------------------------------------------- emails

// Attachments returns a sent email's files with download links that work for an hour.
func (s *EmailsService) Attachments(ctx context.Context, id string) (*List[Raw], error) {
	return s.c.rawList(ctx, "/emails/"+pathEscape(id)+"/attachments", nil)
}

// ReceivedAttachments returns a received email's files with download links that work for an hour.
func (s *EmailsService) ReceivedAttachments(ctx context.Context, id string) (*List[Raw], error) {
	return s.c.rawList(ctx, "/emails/received/"+pathEscape(id)+"/attachments", nil)
}

// Share creates a public link to the email and its delivery timeline. hours is 1 to 720; 0 means the default, 24.
func (s *EmailsService) Share(ctx context.Context, id string, hours int) (Raw, error) {
	body := Raw{}
	if hours > 0 {
		body["expires_in_hours"] = hours
	}
	return s.c.raw(ctx, http.MethodPost, "/emails/"+pathEscape(id)+"/share", body)
}

// Unshare revokes every share link for the email.
func (s *EmailsService) Unshare(ctx context.Context, id string) (Raw, error) {
	return s.c.raw(ctx, http.MethodDelete, "/emails/"+pathEscape(id)+"/share", nil)
}

// ---------------------------------------------------------------- api keys, webhooks

// Update renames an API key.
func (s *APIKeysService) Update(ctx context.Context, id, name string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/api-keys/"+pathEscape(id), Raw{"name": name})
}

// Update changes a webhook's endpoint, events or status ("enabled" or "disabled").
func (s *WebhooksService) Update(ctx context.Context, id string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/webhooks/"+pathEscape(id), changes)
}

// Delete removes a webhook endpoint.
func (s *WebhooksService) Delete(ctx context.Context, id string) (*Deleted, error) {
	return s.c.deleted(ctx, "/webhooks/"+pathEscape(id), nil)
}

// ---------------------------------------------------------------- contacts and segments

// Import starts a background import of up to 50,000 contacts: Raw{"csv": "..."} or Raw{"contacts": [...]}, with
// optional "segment_ids", "columns" and "update_existing".
func (s *ContactsService) Import(ctx context.Context, req Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/contacts/imports", req)
}

// GetImport returns an import's progress: created, updated, skipped and errors.
func (s *ContactsService) GetImport(ctx context.Context, id string) (Raw, error) {
	return s.c.raw(ctx, http.MethodGet, "/contacts/imports/"+pathEscape(id), nil)
}

// ListImports returns recent imports.
func (s *ContactsService) ListImports(ctx context.Context) (*List[Raw], error) {
	return s.c.rawList(ctx, "/contacts/imports", nil)
}

// Get returns a segment with its contact count.
func (s *SegmentsService) Get(ctx context.Context, id string) (Raw, error) {
	return s.c.raw(ctx, http.MethodGet, "/segments/"+pathEscape(id), nil)
}

// Update renames a segment.
func (s *SegmentsService) Update(ctx context.Context, id, name string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/segments/"+pathEscape(id), Raw{"name": name})
}

// Contacts lists the contacts in a segment.
func (s *SegmentsService) Contacts(ctx context.Context, id string, p *ListParams) (*List[Raw], error) {
	return s.c.rawList(ctx, "/segments/"+pathEscape(id)+"/contacts", pageQuery(p))
}

// RemoveContacts takes contacts (emails or ids) out of a segment. The contacts aren't deleted.
func (s *SegmentsService) RemoveContacts(ctx context.Context, id string, contacts ...string) (Raw, error) {
	return s.c.raw(ctx, http.MethodDelete, "/segments/"+pathEscape(id)+"/contacts", Raw{"contacts": contacts})
}

// ---------------------------------------------------------------- broadcasts and templates

// Update edits a draft broadcast.
func (s *BroadcastsService) Update(ctx context.Context, id string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/broadcasts/"+pathEscape(id), changes)
}

// Duplicate copies a broadcast as a new draft. name may be empty.
func (s *BroadcastsService) Duplicate(ctx context.Context, id, name string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/broadcasts/"+pathEscape(id)+"/duplicate", nameBody(name))
}

// RecipientList lists who a broadcast went to, with delivered/opened/clicked/bounced flags (before sending, who it
// will reach). status filters by email status, like "bounced"; it may be empty.
func (s *BroadcastsService) RecipientList(ctx context.Context, id string, p *ListParams, status string) (*List[Raw], error) {
	q := pageQuery(p)
	if status != "" {
		q.Set("status", status)
	}
	return s.c.rawList(ctx, "/broadcasts/"+pathEscape(id)+"/recipients", q)
}

// Links returns the links clicked in a broadcast with total and unique clicks.
func (s *BroadcastsService) Links(ctx context.Context, id string) (*List[Raw], error) {
	return s.c.rawList(ctx, "/broadcasts/"+pathEscape(id)+"/links", nil)
}

// GetContent returns a draft broadcast's subject and blocks with ids.
func (s *BroadcastsService) GetContent(ctx context.Context, id string) (Raw, error) {
	return s.c.raw(ctx, http.MethodGet, "/broadcasts/"+pathEscape(id)+"/content", nil)
}

// EditContent edits a draft broadcast block by block: Raw{"ops": [...]} or Raw{"blocks": [...]}, with optional
// "subject", "preview_text" and "summary". Anyone with it open in the editor sees the change live.
func (s *BroadcastsService) EditContent(ctx context.Context, id string, edit Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/broadcasts/"+pathEscape(id)+"/content", edit)
}

// Update changes a template. Changes are a draft until the template is published again.
func (s *TemplatesService) Update(ctx context.Context, idOrAlias string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/templates/"+pathEscape(idOrAlias), changes)
}

// Duplicate copies a template as a new draft. name may be empty.
func (s *TemplatesService) Duplicate(ctx context.Context, idOrAlias, name string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/templates/"+pathEscape(idOrAlias)+"/duplicate", nameBody(name))
}

// Delete removes a template.
func (s *TemplatesService) Delete(ctx context.Context, idOrAlias string) (*Deleted, error) {
	return s.c.deleted(ctx, "/templates/"+pathEscape(idOrAlias), nil)
}

// GetContent returns a template's subject and blocks with ids.
func (s *TemplatesService) GetContent(ctx context.Context, idOrAlias string) (Raw, error) {
	return s.c.raw(ctx, http.MethodGet, "/templates/"+pathEscape(idOrAlias)+"/content", nil)
}

// EditContent edits a template block by block. Anyone with it open in the editor sees the change live.
func (s *TemplatesService) EditContent(ctx context.Context, idOrAlias string, edit Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/templates/"+pathEscape(idOrAlias)+"/content", edit)
}

// ---------------------------------------------------------------- automations

// Duplicate copies an automation, with its trigger and steps, as a new draft. name may be empty.
func (s *AutomationsService) Duplicate(ctx context.Context, id, name string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/automations/"+pathEscape(id)+"/duplicate", nameBody(name))
}

// Update renames an automation or changes re-entry: Raw{"name": ..., "reentry": "once" | "always"}.
func (s *AutomationsService) Update(ctx context.Context, id string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/automations/"+pathEscape(id), changes)
}

// Delete removes an automation.
func (s *AutomationsService) Delete(ctx context.Context, id string) (*Deleted, error) {
	return s.c.deleted(ctx, "/automations/"+pathEscape(id), nil)
}

// ---------------------------------------------------------------- inbox

// RunAgent runs the inbox's agent on a conversation now.
func (s *InboxService) RunAgent(ctx context.Context, threadID string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/inbox/threads/"+pathEscape(threadID)+"/agent", Raw{})
}

// Notes lists a conversation's internal notes.
func (s *InboxService) Notes(ctx context.Context, threadID string) (*List[Raw], error) {
	return s.c.rawList(ctx, "/inbox/threads/"+pathEscape(threadID)+"/notes", nil)
}

// AddNote adds an internal note to a conversation. Notes are never emailed.
func (s *InboxService) AddNote(ctx context.Context, threadID, body string) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/inbox/threads/"+pathEscape(threadID)+"/notes", Raw{"body": body})
}

// DeleteNote removes a note.
func (s *InboxService) DeleteNote(ctx context.Context, id string) (*Deleted, error) {
	return s.c.deleted(ctx, "/inbox/notes/"+pathEscape(id), nil)
}

// ListDrafts returns open drafts. Filters: "thread_id", "inbox", "source" ("user" or "agent").
func (s *InboxService) ListDrafts(ctx context.Context, filters map[string]string) (*List[Raw], error) {
	q := url.Values{}
	for k, v := range filters {
		q.Set(k, v)
	}
	return s.c.rawList(ctx, "/inbox/drafts", q)
}

// CreateDraft saves a draft: a reply with "thread_id", or a new email with "inbox".
func (s *InboxService) CreateDraft(ctx context.Context, draft Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/inbox/drafts", draft)
}

// UpdateDraft edits a draft.
func (s *InboxService) UpdateDraft(ctx context.Context, id string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/inbox/drafts/"+pathEscape(id), changes)
}

// SendDraft sends a draft. Replies keep their threading.
func (s *InboxService) SendDraft(ctx context.Context, id string) (*SendEmailResponse, error) {
	out := &SendEmailResponse{}
	return out, s.c.Do(ctx, http.MethodPost, "/inbox/drafts/"+pathEscape(id)+"/send", Raw{}, out)
}

// DiscardDraft discards a draft.
func (s *InboxService) DiscardDraft(ctx context.Context, id string) (*Deleted, error) {
	return s.c.deleted(ctx, "/inbox/drafts/"+pathEscape(id), nil)
}

// InboxesService manages inboxes (addresses on receiving domains) and their agent settings.
type InboxesService struct{ c *Client }

// List returns inboxes with open, unread and needs-reply counts.
func (s *InboxesService) List(ctx context.Context) (*List[Raw], error) {
	return s.c.rawList(ctx, "/inboxes", nil)
}

// Create adds an inbox for an address on a receiving domain.
func (s *InboxesService) Create(ctx context.Context, address, name string) (Raw, error) {
	body := Raw{"address": address}
	if name != "" {
		body["name"] = name
	}
	return s.c.raw(ctx, http.MethodPost, "/inboxes", body)
}

// Get returns an inbox by id or address.
func (s *InboxesService) Get(ctx context.Context, idOrAddress string) (Raw, error) {
	return s.c.raw(ctx, http.MethodGet, "/inboxes/"+pathEscape(idOrAddress), nil)
}

// Update changes an inbox's name, description or agent settings.
func (s *InboxesService) Update(ctx context.Context, idOrAddress string, changes Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPatch, "/inboxes/"+pathEscape(idOrAddress), changes)
}

// Delete removes an inbox. Its conversations move to Other mail.
func (s *InboxesService) Delete(ctx context.Context, idOrAddress string) (*Deleted, error) {
	return s.c.deleted(ctx, "/inboxes/"+pathEscape(idOrAddress), nil)
}

// AgentRuns returns the inbox agent's recent runs. limit 0 means the default.
func (s *InboxesService) AgentRuns(ctx context.Context, idOrAddress string, limit int) (*List[Raw], error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	return s.c.rawList(ctx, "/inboxes/"+pathEscape(idOrAddress)+"/agent-runs", q)
}

// ---------------------------------------------------------------- AI writing

// AIService writes and rewrites email in the team's brand voice.
type AIService struct{ c *Client }

// Draft writes an email from "url" and/or "brief". With "target": Raw{"type": "template", "id": ...} it writes the
// result straight into that template or draft broadcast.
func (s *AIService) Draft(ctx context.Context, req Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/ai/draft", req)
}

// Rewrite rewrites "blocks" with an "instruction".
func (s *AIService) Rewrite(ctx context.Context, req Raw) (Raw, error) {
	return s.c.raw(ctx, http.MethodPost, "/ai/rewrite", req)
}

// Subjects suggests subject lines for an email's text.
func (s *AIService) Subjects(ctx context.Context, text string) (*List[Raw], error) {
	out := &List[Raw]{}
	return out, s.c.Do(ctx, http.MethodPost, "/ai/subjects", Raw{"text": text}, out)
}

func nameBody(name string) Raw {
	if name == "" {
		return Raw{}
	}
	return Raw{"name": name}
}

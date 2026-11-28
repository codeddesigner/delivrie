# Go

Send email from Go with the Delivrie Go SDK: typed requests, idempotent retries, errors you can inspect, and webhook verification.

The Go SDK is standard library only and needs Go 1.21 or later.

```bash
go get github.com/bysurce/delivrie/sdk/go
```

The module moved from `github.com/codeddesigner/delivrie/sdk/go` in v0.2.0. Code that imports the old path keeps working on v0.1.0; to upgrade, change the import path and run `go get` again.

## Send an email

```go main.go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	delivrie "github.com/bysurce/delivrie/sdk/go"
)

func main() {
	client := delivrie.New(os.Getenv("DELIVRIE_API_KEY"))

	sent, err := client.Emails.Send(context.Background(), &delivrie.SendEmailRequest{
		From:    "Acme <hello@mail.acme.com>",
		To:      []string{"ada@example.com"},
		Subject: "Your receipt",
		HTML:    "<p>Thanks for your order.</p>",
	}, delivrie.WithIdempotencyKey("order-1042"))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(sent.ID)
}
```

The idempotency key makes the send safe to retry: the same key returns the original email instead of sending it again. With a key, the SDK also retries rate limits, server errors and network errors for you (twice, with backoff).

## Templates, attachments and scheduling

```go
client.Emails.Send(ctx, &delivrie.SendEmailRequest{
	To:          []string{"ada@example.com"},
	Template:    &delivrie.TemplateRef{ID: "welcome", Variables: map[string]any{"name": "Ada"}},
	Attachments: []delivrie.Attachment{{Filename: "invoice.pdf", Content: pdfBytes}},
	ScheduledAt: "tomorrow at 9am",
})
```

With a template, `From` and `Subject` are optional: the template's own are used. `Content` is the raw file; the SDK encodes it. `ScheduledAt` takes an RFC 3339 time or a phrase like `in 1 hour` (UTC), up to 30 days ahead.

## Handle errors

API errors are `*delivrie.Error`, with the HTTP status, Delivrie's error name and a message:

```go
if err != nil {
	var apiErr *delivrie.Error
	if errors.As(err, &apiErr) && apiErr.Name == "validation_error" {
		log.Printf("fix the request: %s", apiErr.Message)
	}
}
```

`delivrie.IsNotFound(err)` and `delivrie.IsRateLimited(err)` cover the common checks. See [Errors](/docs/errors) for every name.

## Everything else

The client covers the whole API: `client.Domains`, `client.APIKeys`, `client.Webhooks`, `client.Contacts`, `client.Segments`, `client.Broadcasts`, `client.Templates`, `client.Suppressions`, `client.Events`, `client.Automations`, `client.Inbox` (threads, drafts, notes), `client.Inboxes`, `client.AI`, `client.Metrics`, `client.Logs` and `client.Usage`. For example, `client.Broadcasts.Duplicate`, `client.Contacts.Import`, `client.Emails.ReceivedAttachments` and `client.Templates.EditContent`.

```go
domain, _ := client.Domains.Create(ctx, &delivrie.CreateDomainRequest{Name: "mail.acme.com"})
for _, r := range domain.Records {
	fmt.Println(r.Type, r.Name, r.Value)
}
```

`client.Do(ctx, "GET", "/path", nil, &out)` calls any endpoint the SDK doesn't wrap yet.

## Verify webhooks

```go webhook.go
func handler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	event, err := delivrie.VerifyWebhook(body, r.Header, os.Getenv("DELIVRIE_WEBHOOK_SECRET"))
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}
	log.Println(event.Type) // "email.delivered", "email.bounced", …
	w.WriteHeader(http.StatusOK)
}
```

Read the body before decoding it: the signature covers the exact bytes. Requests older than 5 minutes are rejected as replays. See [Webhooks](/docs/webhooks).

Already using `resend-go`? Set `RESEND_BASE_URL=https://delivrie.io/api/` and it talks to Delivrie; see [Migrate from Resend](/docs/migrate-from-resend).

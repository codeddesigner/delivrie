package delivrie

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type recorded struct {
	method, path, query string
	header              http.Header
	body                map[string]any
}

func server(t *testing.T, h func(w http.ResponseWriter, r *http.Request, n int)) (*Client, *[]recorded) {
	t.Helper()
	var calls []recorded
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		calls = append(calls, recorded{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Clone(), body})
		w.Header().Set("Content-Type", "application/json")
		h(w, r, int(atomic.AddInt32(&n, 1)))
	}))
	t.Cleanup(srv.Close)
	return New("dlv_test_key", WithBaseURL(srv.URL), WithMaxRetries(2)), &calls
}

func TestSendEmail(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, _ int) { w.Write([]byte(`{"id":"em_123"}`)) })
	res, err := c.Emails.Send(context.Background(), &SendEmailRequest{
		From: "Acme <hi@acme.com>", To: []string{"ada@example.com"}, Subject: "Hi", HTML: "<p>Hi</p>",
		Tags:        []Tag{{Name: "kind", Value: "welcome"}},
		Attachments: []Attachment{{Filename: "a.txt", Content: []byte("hello")}},
	}, WithIdempotencyKey("order-1"))
	if err != nil || res.ID != "em_123" {
		t.Fatalf("got %+v %v", res, err)
	}
	got := (*calls)[0]
	if got.method != "POST" || got.path != "/emails" {
		t.Fatalf("request %s %s", got.method, got.path)
	}
	if got.header.Get("Authorization") != "Bearer dlv_test_key" || got.header.Get("Idempotency-Key") != "order-1" || got.header.Get("User-Agent") != "delivrie-go/"+Version {
		t.Fatalf("headers %v", got.header)
	}
	if got.body["subject"] != "Hi" || got.body["text"] != nil {
		t.Fatalf("body %v", got.body)
	}
	att := got.body["attachments"].([]any)[0].(map[string]any)
	if att["content"] != "aGVsbG8=" {
		t.Fatalf("attachment not base64: %v", att)
	}
}

func TestAPIErrorIsTyped(t *testing.T) {
	c, _ := server(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		w.WriteHeader(422)
		w.Write([]byte(`{"statusCode":422,"name":"validation_error","message":"Provide html or text"}`))
	})
	_, err := c.Emails.Send(context.Background(), &SendEmailRequest{To: []string{"a@b.co"}, Subject: "x"})
	var e *Error
	if !errors.As(err, &e) || e.StatusCode != 422 || e.Name != "validation_error" || e.Message != "Provide html or text" {
		t.Fatalf("got %#v", err)
	}
}

func TestSendIsNotRetriedWithoutIdempotencyKey(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, _ int) { w.WriteHeader(503); w.Write([]byte(`{}`)) })
	_, err := c.Emails.Send(context.Background(), &SendEmailRequest{To: []string{"a@b.co"}, Subject: "x", Text: "x"})
	if err == nil || len(*calls) != 1 {
		t.Fatalf("expected one attempt, got %d (%v)", len(*calls), err)
	}
}

func TestRetriesRateLimitsWithIdempotencyKey(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, n int) {
		if n == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			w.Write([]byte(`{"name":"rate_limit_exceeded","message":"slow down","statusCode":429}`))
			return
		}
		w.Write([]byte(`{"id":"em_9"}`))
	})
	res, err := c.Emails.Send(context.Background(), &SendEmailRequest{To: []string{"a@b.co"}, Subject: "x", Text: "x"}, WithIdempotencyKey("k"))
	if err != nil || res.ID != "em_9" || len(*calls) != 2 {
		t.Fatalf("got %+v %v after %d calls", res, err, len(*calls))
	}
}

func TestGetsAreRetriedOnServerErrors(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, n int) {
		if n < 3 {
			w.WriteHeader(502)
			return
		}
		w.Write([]byte(`{"object":"list","data":[{"id":"d1","name":"acme.com","status":"verified"}]}`))
	})
	c.maxRetries = 2
	list, err := c.Domains.List(context.Background())
	if err != nil || len(list.Data) != 1 || list.Data[0].Name != "acme.com" || len(*calls) != 3 {
		t.Fatalf("got %+v %v after %d calls", list, err, len(*calls))
	}
}

func TestListQueryAndPathEscaping(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, _ int) { w.Write([]byte(`{"object":"list","data":[]}`)) })
	if _, err := c.Emails.List(context.Background(), &ListParams{Limit: 10, Offset: 20}); err != nil {
		t.Fatal(err)
	}
	if (*calls)[0].query != "limit=10&offset=20" {
		t.Fatalf("query %q", (*calls)[0].query)
	}
	if _, err := c.Contacts.Get(context.Background(), "ada+test@example.com"); err == nil {
		// the server returned a list shape, which decodes into an empty contact; only the path matters here
	}
	if (*calls)[1].path != "/contacts/ada+test@example.com" {
		t.Fatalf("path %q", (*calls)[1].path)
	}
}

func TestMissingKey(t *testing.T) {
	t.Setenv("DELIVRIE_API_KEY", "")
	_, err := New("").Usage.Get(context.Background())
	var e *Error
	if !errors.As(err, &e) || e.Name != "missing_api_key" {
		t.Fatalf("got %v", err)
	}
}

func TestIsNotFound(t *testing.T) {
	c, _ := server(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		w.WriteHeader(404)
		w.Write([]byte(`{"name":"not_found","message":"Email not found","statusCode":404}`))
	})
	_, err := c.Emails.Get(context.Background(), "nope")
	if !IsNotFound(err) {
		t.Fatalf("got %v", err)
	}
}

func TestNewEndpoints(t *testing.T) {
	c, calls := server(t, func(w http.ResponseWriter, r *http.Request, _ int) { w.Write([]byte(`{"object":"list","data":[]}`)) })
	ctx := context.Background()
	steps := []func() error{
		func() error { _, err := c.Broadcasts.Duplicate(ctx, "b1", "Copy"); return err },
		func() error { _, err := c.Broadcasts.Links(ctx, "b1"); return err },
		func() error { _, err := c.Broadcasts.RecipientList(ctx, "b1", nil, "bounced"); return err },
		func() error {
			_, err := c.Templates.EditContent(ctx, "welcome", Raw{"ops": []Raw{{"op": "delete", "id": "x"}}})
			return err
		},
		func() error { _, err := c.APIKeys.Update(ctx, "k1", "Prod"); return err },
		func() error { _, err := c.Emails.ReceivedAttachments(ctx, "e1"); return err },
		func() error { _, err := c.Emails.Share(ctx, "e1", 48); return err },
		func() error { _, err := c.Segments.RemoveContacts(ctx, "s1", "a@b.com"); return err },
		func() error { _, err := c.Contacts.Import(ctx, Raw{"csv": "email\na@b.com"}); return err },
		func() error { _, err := c.Automations.Duplicate(ctx, "a1", ""); return err },
		func() error { _, err := c.Webhooks.Delete(ctx, "w1"); return err },
		func() error { _, err := c.Inboxes.List(ctx); return err },
		func() error { _, err := c.Inbox.SendDraft(ctx, "dr1"); return err },
		func() error { _, err := c.AI.Draft(ctx, Raw{"url": "https://acme.com"}); return err },
	}
	for i, f := range steps {
		if err := f(); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}
	want := []string{"POST /broadcasts/b1/duplicate", "GET /broadcasts/b1/links", "GET /broadcasts/b1/recipients", "POST /templates/welcome/content",
		"PATCH /api-keys/k1", "GET /emails/received/e1/attachments", "POST /emails/e1/share", "DELETE /segments/s1/contacts", "POST /contacts/imports",
		"POST /automations/a1/duplicate", "DELETE /webhooks/w1", "GET /inboxes", "POST /inbox/drafts/dr1/send", "POST /ai/draft"}
	for i, w := range want {
		if got := (*calls)[i].method + " " + (*calls)[i].path; got != w {
			t.Fatalf("call %d: got %q, want %q", i, got, w)
		}
	}
	if (*calls)[2].query != "status=bounced" {
		t.Fatalf("query %q", (*calls)[2].query)
	}
	if got := (*calls)[7].body["contacts"].([]any)[0]; got != "a@b.com" {
		t.Fatalf("remove contacts body %v", (*calls)[7].body)
	}
}

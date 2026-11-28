// Package delivrie is the Go client for the Delivrie email API (https://delivrie.io).
//
//	client := delivrie.New(os.Getenv("DELIVRIE_API_KEY"))
//	sent, err := client.Emails.Send(ctx, &delivrie.SendEmailRequest{
//		From:    "Acme <hi@acme.com>",
//		To:      []string{"ada@example.com"},
//		Subject: "Hello",
//		HTML:    "<p>It works</p>",
//	})
//
// Every method takes a context and returns a typed result or an error. API errors are *delivrie.Error, so you can
// check the HTTP status and Delivrie's error name. The client retries rate limits, server errors and network errors
// for safe requests, and for sends only when you pass an idempotency key, so a retry never sends an email twice.
package delivrie

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Version is the SDK version, sent in the User-Agent header.
const Version = "0.3.1"

// DefaultBaseURL is the Delivrie API address.
const DefaultBaseURL = "https://delivrie.io/api"

// Client talks to the Delivrie API. Create one with New and share it; it is safe for concurrent use.
type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
	maxRetries int
	headers    map[string]string

	Emails       *EmailsService
	Domains      *DomainsService
	APIKeys      *APIKeysService
	Webhooks     *WebhooksService
	Contacts     *ContactsService
	Segments     *SegmentsService
	Topics       *TopicsService
	Broadcasts   *BroadcastsService
	Templates    *TemplatesService
	Suppressions *SuppressionsService
	Events       *EventsService
	Automations  *AutomationsService
	Inbox        *InboxService
	Inboxes      *InboxesService
	AI           *AIService
	Metrics      *MetricsService
	Logs         *LogsService
	Usage        *UsageService
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL points the client at another API address.
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") } }

// WithHTTPClient uses your own *http.Client (for proxies, custom transports or tests). Its Timeout applies per attempt.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.httpClient = h } }

// WithMaxRetries sets how many times a retryable request is retried. Default 2.
func WithMaxRetries(n int) Option {
	return func(c *Client) {
		if n < 0 {
			n = 0
		}
		c.maxRetries = n
	}
}

// WithHeader adds a header to every request.
func WithHeader(name, value string) Option { return func(c *Client) { c.headers[name] = value } }

// New creates a client. An empty apiKey falls back to the DELIVRIE_API_KEY environment variable, and the base URL to
// DELIVRIE_BASE_URL when set. Create a key at https://delivrie.io/api-keys.
func New(apiKey string, opts ...Option) *Client {
	if apiKey == "" {
		apiKey = os.Getenv("DELIVRIE_API_KEY")
	}
	base := DefaultBaseURL
	if v := os.Getenv("DELIVRIE_BASE_URL"); v != "" {
		base = strings.TrimRight(v, "/")
	}
	c := &Client{apiKey: apiKey, baseURL: base, httpClient: &http.Client{Timeout: 30 * time.Second}, maxRetries: 2, headers: map[string]string{}}
	for _, o := range opts {
		o(c)
	}
	c.Emails = &EmailsService{c}
	c.Domains = &DomainsService{c}
	c.APIKeys = &APIKeysService{c}
	c.Webhooks = &WebhooksService{c}
	c.Contacts = &ContactsService{c}
	c.Segments = &SegmentsService{c}
	c.Topics = &TopicsService{c}
	c.Broadcasts = &BroadcastsService{c}
	c.Templates = &TemplatesService{c}
	c.Suppressions = &SuppressionsService{c}
	c.Events = &EventsService{c}
	c.Automations = &AutomationsService{c}
	c.Inbox = &InboxService{c}
	c.Inboxes = &InboxesService{c}
	c.AI = &AIService{c}
	c.Metrics = &MetricsService{c}
	c.Logs = &LogsService{c}
	c.Usage = &UsageService{c}
	return c
}

// Error is what the API returns when a request fails. StatusCode is 0 for network errors and timeouts.
type Error struct {
	StatusCode int    `json:"statusCode"`
	Name       string `json:"name"`
	Message    string `json:"message"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("delivrie: %s (%d): %s", e.Name, e.StatusCode, e.Message)
}

// IsNotFound reports whether err is a 404 from the API.
func IsNotFound(err error) bool { var e *Error; return errors.As(err, &e) && e.StatusCode == 404 }

// IsRateLimited reports whether err is a 429 from the API.
func IsRateLimited(err error) bool { var e *Error; return errors.As(err, &e) && e.StatusCode == 429 }

// RequestOption changes a single request.
type RequestOption func(*requestConfig)

type requestConfig struct {
	idempotencyKey string
	query          url.Values
}

// WithIdempotencyKey makes a send safe to retry: the same key returns the original result instead of sending again.
func WithIdempotencyKey(key string) RequestOption {
	return func(r *requestConfig) { r.idempotencyKey = key }
}

func withQuery(q url.Values) RequestOption { return func(r *requestConfig) { r.query = q } }

// Do sends a request to any API path (relative to the base URL, like "/emails") and decodes the JSON response into
// out (which may be nil). Use it for endpoints this SDK doesn't wrap yet.
func (c *Client) Do(ctx context.Context, method, path string, body, out any, opts ...RequestOption) error {
	if c.apiKey == "" {
		return &Error{Name: "missing_api_key", Message: "no API key: pass one to delivrie.New or set DELIVRIE_API_KEY (create one at https://delivrie.io/api-keys)"}
	}
	cfg := requestConfig{}
	for _, o := range opts {
		o(&cfg)
	}
	u := c.baseURL + path
	if len(cfg.query) > 0 {
		u += "?" + cfg.query.Encode()
	}
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return fmt.Errorf("delivrie: encoding request: %w", err)
		}
	}
	// GET and DELETE are safe to repeat; POST and PATCH only with an idempotency key.
	retryable := method == http.MethodGet || method == http.MethodDelete || cfg.idempotencyKey != ""
	for attempt := 0; ; attempt++ {
		var rd io.Reader
		if payload != nil {
			rd = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, u, rd)
		if err != nil {
			return fmt.Errorf("delivrie: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "delivrie-go/"+Version)
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if cfg.idempotencyKey != "" {
			req.Header.Set("Idempotency-Key", cfg.idempotencyKey)
		}
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		res, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return &Error{Name: "aborted", Message: ctx.Err().Error()}
			}
			if retryable && attempt < c.maxRetries {
				if werr := wait(ctx, backoff(attempt)); werr != nil {
					return werr
				}
				continue
			}
			name := "network_error"
			var ue *url.Error
			if errors.As(err, &ue) && ue.Timeout() {
				name = "timeout"
			}
			return &Error{Name: name, Message: err.Error()}
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			if out == nil || len(bytes.TrimSpace(data)) == 0 {
				return nil
			}
			if err := json.Unmarshal(data, out); err != nil {
				return fmt.Errorf("delivrie: decoding response: %w", err)
			}
			return nil
		}
		apiErr := toError(res.StatusCode, data)
		if (res.StatusCode == 429 || res.StatusCode >= 500) && retryable && attempt < c.maxRetries {
			d := backoff(attempt)
			if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && s > 0 {
				if s > 30 {
					s = 30
				}
				d = time.Duration(s) * time.Second
			}
			if werr := wait(ctx, d); werr != nil {
				return werr
			}
			continue
		}
		return apiErr
	}
}

func toError(status int, data []byte) *Error {
	e := &Error{}
	_ = json.Unmarshal(data, e)
	if e.StatusCode == 0 {
		e.StatusCode = status
	}
	if e.Name == "" {
		switch status {
		case 401:
			e.Name = "invalid_api_key"
		case 404:
			e.Name = "not_found"
		case 429:
			e.Name = "rate_limit_exceeded"
		default:
			e.Name = "application_error"
		}
	}
	if e.Message == "" {
		msg := strings.TrimSpace(string(data))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		if msg == "" {
			msg = fmt.Sprintf("request failed with status %d", status)
		}
		e.Message = msg
	}
	return e
}

func backoff(attempt int) time.Duration {
	d := 500 * time.Millisecond << attempt
	if d > 8*time.Second {
		d = 8 * time.Second
	}
	return d + time.Duration(rand.Intn(250))*time.Millisecond
}

func wait(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return &Error{Name: "aborted", Message: ctx.Err().Error()}
	case <-t.C:
		return nil
	}
}

func pathEscape(s string) string { return url.PathEscape(s) }

func pageQuery(p *ListParams) url.Values {
	q := url.Values{}
	if p == nil {
		return q
	}
	if p.Limit > 0 {
		q.Set("limit", strconv.Itoa(p.Limit))
	}
	if p.Offset > 0 {
		q.Set("offset", strconv.Itoa(p.Offset))
	}
	return q
}

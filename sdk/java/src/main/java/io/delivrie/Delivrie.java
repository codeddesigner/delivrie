package io.delivrie;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * The Delivrie client.
 *
 * <pre>{@code
 * Delivrie delivrie = new Delivrie(System.getenv("DELIVRIE_API_KEY"));
 * Map<String, Object> email = delivrie.emails().send(Map.of(
 *     "from", "Acme <hi@acme.com>",
 *     "to", "ada@example.com",
 *     "subject", "Hello",
 *     "html", "<p>It works</p>"));
 * String id = (String) email.get("id");
 * }</pre>
 *
 * <p>Every method returns the API's JSON as a {@code Map<String, Object>} (see {@link Json}) or throws
 * {@link DelivrieException}. Rate limits, server errors and network errors are retried for safe requests, and for
 * sends only with an idempotency key, so a retry never sends an email twice. The client is thread-safe.
 */
public final class Delivrie {
  public static final String VERSION = "0.1.1";
  public static final String DEFAULT_BASE_URL = "https://delivrie.io/api";

  /** Replaces the HTTP call, for tests. Returns the status, lower-cased response headers and body. */
  @FunctionalInterface
  public interface Transport {
    Response send(String method, String url, Map<String, String> headers, String body, Duration timeout) throws IOException;
  }

  /** A raw HTTP response, used by {@link Transport}. */
  public record Response(int status, Map<String, String> headers, String body) {}

  private final String apiKey;
  private final String baseUrl;
  private final Duration timeout;
  private final int maxRetries;
  private final Map<String, String> extraHeaders;
  private final Transport transport;
  private final HttpClient http;

  /** Uses the key and the DELIVRIE_BASE_URL environment variable, if set. */
  public Delivrie(String apiKey) { this(builder().apiKey(apiKey)); }

  /** Uses the DELIVRIE_API_KEY environment variable. */
  public Delivrie() { this(builder()); }

  private Delivrie(Builder b) {
    String key = b.apiKey != null && !b.apiKey.isEmpty() ? b.apiKey : System.getenv("DELIVRIE_API_KEY");
    if (key == null || key.isEmpty()) throw new IllegalArgumentException("Missing API key. Pass it to new Delivrie(key) or set DELIVRIE_API_KEY. Create one at https://delivrie.io/api-keys");
    this.apiKey = key;
    String base = b.baseUrl != null ? b.baseUrl : System.getenv("DELIVRIE_BASE_URL") != null ? System.getenv("DELIVRIE_BASE_URL") : DEFAULT_BASE_URL;
    this.baseUrl = base.replaceAll("/+$", "");
    this.timeout = b.timeout;
    this.maxRetries = Math.max(0, b.maxRetries);
    this.extraHeaders = Map.copyOf(b.headers);
    this.transport = b.transport;
    this.http = b.transport == null ? HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(Math.min(10, b.timeout.toSeconds()))).followRedirects(HttpClient.Redirect.NORMAL).build() : null;
  }

  public static Builder builder() { return new Builder(); }

  /** Options: base URL, timeout, retries, extra headers and a custom transport. */
  public static final class Builder {
    private String apiKey;
    private String baseUrl;
    private Duration timeout = Duration.ofSeconds(30);
    private int maxRetries = 2;
    private final Map<String, String> headers = new LinkedHashMap<>();
    private Transport transport;

    public Builder apiKey(String v) { apiKey = v; return this; }
    public Builder baseUrl(String v) { baseUrl = v; return this; }
    public Builder timeout(Duration v) { timeout = v; return this; }
    public Builder maxRetries(int v) { maxRetries = v; return this; }
    public Builder header(String name, String value) { headers.put(name, value); return this; }
    public Builder transport(Transport v) { transport = v; return this; }
    public Delivrie build() { return new Delivrie(this); }
  }

  // <generated-accessors>
  private final Resources.Emails emails = new Resources.Emails(this);
  /** Send, schedule, cancel, forward and look up emails. */
  public Resources.Emails emails() { return emails; }
  private final Resources.Domains domains = new Resources.Domains(this);
  /** Sending and receiving domains. */
  public Resources.Domains domains() { return domains; }
  private final Resources.ApiKeys apiKeys = new Resources.ApiKeys(this);
  /** API keys. */
  public Resources.ApiKeys apiKeys() { return apiKeys; }
  private final Resources.Webhooks webhooks = new Resources.Webhooks(this);
  /** Webhook endpoints. */
  public Resources.Webhooks webhooks() { return webhooks; }
  private final Resources.Contacts contacts = new Resources.Contacts(this);
  /** Contacts and contact imports. */
  public Resources.Contacts contacts() { return contacts; }
  private final Resources.Segments segments = new Resources.Segments(this);
  /** Segments of contacts. */
  public Resources.Segments segments() { return segments; }
  private final Resources.Broadcasts broadcasts = new Resources.Broadcasts(this);
  /** Broadcasts to a segment. */
  public Resources.Broadcasts broadcasts() { return broadcasts; }
  private final Resources.Templates templates = new Resources.Templates(this);
  /** Email templates. */
  public Resources.Templates templates() { return templates; }
  private final Resources.Suppressions suppressions = new Resources.Suppressions(this);
  /** Addresses Delivrie won't send to. */
  public Resources.Suppressions suppressions() { return suppressions; }
  private final Resources.Events events = new Resources.Events(this);
  /** Events that start automations. */
  public Resources.Events events() { return events; }
  private final Resources.Automations automations = new Resources.Automations(this);
  /** Automations. */
  public Resources.Automations automations() { return automations; }
  private final Resources.Inboxes inboxes = new Resources.Inboxes(this);
  /** Inboxes and their agent settings. */
  public Resources.Inboxes inboxes() { return inboxes; }
  private final Resources.Inbox inbox = new Resources.Inbox(this);
  /** Conversations, drafts and notes in the Inbox. */
  public Resources.Inbox inbox() { return inbox; }
  private final Resources.Ai ai = new Resources.Ai(this);
  /** AI writing in the brand voice. */
  public Resources.Ai ai() { return ai; }
  private final Resources.Logs logs = new Resources.Logs(this);
  /** API request logs. */
  public Resources.Logs logs() { return logs; }
  // </generated-accessors>

  /** Plan, emails sent this month and today, and credits. */
  public Map<String, Object> usage() { return request("GET", "/usage", null, null, null); }

  /** Sent, delivered, opened, clicked, bounced and complained totals, e.g. {@code Map.of("days", 30)}. */
  public Map<String, Object> metrics(Map<String, ?> query) { return request("GET", "/metrics", null, query, null); }

  /** Reads a local file into an attachment: {@code { filename, content }} with base64 content. */
  public static Map<String, Object> attachment(Path file) {
    try {
      Map<String, Object> a = new LinkedHashMap<>();
      a.put("filename", file.getFileName().toString());
      a.put("content", Base64.getEncoder().encodeToString(Files.readAllBytes(file)));
      return a;
    } catch (IOException e) {
      throw new IllegalArgumentException("Can't read attachment " + file + ": " + e.getMessage(), e);
    }
  }

  static String enc(String id) {
    if (id == null || id.isEmpty()) throw new IllegalArgumentException("Missing id");
    return URLEncoder.encode(id, StandardCharsets.UTF_8).replace("+", "%20");
  }

  /**
   * Calls any API path (relative to the base URL, like "/emails") and returns the decoded JSON. A JSON array response
   * is returned as {@code { "data": [...] }}.
   */
  @SuppressWarnings("unchecked")
  public Map<String, Object> request(String method, String path, Object body, Map<String, ?> query, String idempotencyKey) {
    StringBuilder url = new StringBuilder(baseUrl).append(path);
    if (query != null) {
      String sep = path.contains("?") ? "&" : "?";
      for (Map.Entry<String, ?> e : query.entrySet()) {
        if (e.getValue() == null || "".equals(e.getValue())) continue;
        url.append(sep).append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)).append('=').append(URLEncoder.encode(String.valueOf(e.getValue()), StandardCharsets.UTF_8));
        sep = "&";
      }
    }
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("Authorization", "Bearer " + apiKey);
    headers.put("Accept", "application/json");
    headers.put("User-Agent", "delivrie-java/" + VERSION);
    headers.putAll(extraHeaders);
    String payload = null;
    if (body != null) {
      payload = Json.write(body);
      headers.put("Content-Type", "application/json");
    }
    if (idempotencyKey != null && !idempotencyKey.isEmpty()) headers.put("Idempotency-Key", idempotencyKey);
    // GET and DELETE are safe to repeat; POST and PATCH only with an idempotency key.
    boolean retryable = method.equals("GET") || method.equals("DELETE") || headers.containsKey("Idempotency-Key");

    for (int attempt = 0; ; attempt++) {
      Response res;
      try {
        res = send(method, url.toString(), headers, payload);
      } catch (DelivrieException e) {
        if (retryable && attempt < maxRetries) { sleep(backoff(attempt)); continue; }
        throw e;
      }
      Object json = null;
      if (res.body() != null && !res.body().isBlank()) {
        try { json = Json.parse(res.body()); } catch (IllegalArgumentException ignored) { /* not JSON */ }
      }
      if (res.status() >= 200 && res.status() < 300) {
        if (json instanceof Map<?, ?> m) return (Map<String, Object>) m;
        Map<String, Object> wrap = new LinkedHashMap<>();
        if (json != null) wrap.put("data", json);
        return wrap;
      }
      if ((res.status() == 429 || res.status() >= 500) && retryable && attempt < maxRetries) {
        long after = 0;
        try { after = Long.parseLong(res.headers().getOrDefault("retry-after", "0").trim()); } catch (NumberFormatException ignored) { /* a date */ }
        sleep(after > 0 ? Math.min(after, 30) * 1000 : backoff(attempt));
        continue;
      }
      throw DelivrieException.fromResponse(res.status(), json, res.body());
    }
  }

  private long backoff(int attempt) { return Math.min(8000, 500L << attempt) + ThreadLocalRandom.current().nextLong(250); }

  private static void sleep(long ms) {
    try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new DelivrieException("Interrupted", 0, "interrupted", e); }
  }

  private Response send(String method, String url, Map<String, String> headers, String payload) {
    try {
      if (transport != null) return transport.send(method, url, headers, payload, timeout);
      HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url)).timeout(timeout)
          .method(method, payload == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8));
      for (Map.Entry<String, String> h : headers.entrySet()) rb.setHeader(h.getKey(), h.getValue());
      HttpResponse<String> r = http.send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      Map<String, String> rh = new LinkedHashMap<>();
      r.headers().map().forEach((k, v) -> { if (!v.isEmpty()) rh.put(k.toLowerCase(Locale.ROOT), v.get(0)); });
      return new Response(r.statusCode(), rh, r.body());
    } catch (HttpTimeoutException e) {
      throw new DelivrieException("No response within " + timeout.toSeconds() + " seconds", 0, "timeout", e);
    } catch (IOException e) {
      throw new DelivrieException("Couldn't reach Delivrie: " + e.getMessage(), 0, "network_error", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new DelivrieException("Interrupted", 0, "interrupted", e);
    }
  }

  /** For tests and logs: the base URL in use. */
  public String baseUrl() { return baseUrl; }
}

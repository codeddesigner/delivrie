# Delivrie for Java

The official Java client for [Delivrie](https://delivrie.io): transactional email, broadcasts, templates, contacts, automations, the Inbox and AI writing. Java 17 and later, no dependencies.

```xml
<dependency>
  <groupId>io.delivrie</groupId>
  <artifactId>delivrie-java</artifactId>
  <version>0.1.1</version>
</dependency>
```

```java
import io.delivrie.Delivrie;
import java.util.Map;

Delivrie delivrie = new Delivrie(System.getenv("DELIVRIE_API_KEY"));

Map<String, Object> email = delivrie.emails().send(Map.of(
    "from", "Acme <orders@mail.acme.com>",
    "to", "ada@example.com",
    "subject", "Your order is confirmed",
    "html", "<p>Thanks for your order!</p>"));
System.out.println(email.get("id"));
```

Methods take a `Map` (or anything `Json.write` understands: maps, lists, strings, numbers, booleans) and return the API's JSON as a `Map<String, Object>`. Failed requests throw `DelivrieException` with `status()`, `name()` and the message. The client is thread-safe; create one and reuse it.

## More examples

```java
// A published template, safe to retry with an idempotency key
delivrie.emails().send(Map.of("from", "Acme <hi@acme.com>", "to", "ada@example.com",
    "template", Map.of("id", "welcome", "variables", Map.of("first_name", "Ada"))), "signup-42");

// Attachments: a local file, or a public URL Delivrie downloads
delivrie.emails().send(Map.of("from", "...", "to", "...", "subject", "Invoice", "text", "Attached.",
    "attachments", List.of(Delivrie.attachment(Path.of("invoice.pdf")), Map.of("path", "https://acme.com/terms.pdf"))));

// Broadcasts
Map<String, Object> b = delivrie.broadcasts().create(Map.of("name", "Launch", "from", "Acme <news@acme.com>",
    "subject", "We're live", "segment_id", segmentId, "html", "<p>Hello {{first_name}}</p>"));
delivrie.broadcasts().send((String) b.get("id"), Map.of("scheduled_at", "tomorrow at 9am"));

// The Inbox
delivrie.inbox().threads(Map.of("needs_reply", true));

// Anything else
delivrie.request("GET", "/emails", null, Map.of("limit", 5), null);
```

## Webhooks

```java
Map<String, Object> event = Webhook.verify(rawBody, headers, System.getenv("DELIVRIE_WEBHOOK_SECRET"));
```

`headers` is any `Map` of request headers (any letter case, values as strings or lists). It throws `WebhookVerificationException` for anything that isn't a genuine, recent Delivrie webhook.

## Options

```java
Delivrie delivrie = Delivrie.builder()
    .apiKey(key)
    .timeout(Duration.ofSeconds(30))
    .maxRetries(2)
    .build();
```

Rate limits (429), server errors and network errors are retried with backoff for GET and DELETE, and for sends only when you pass an idempotency key, so a retry never sends twice.

Docs: [delivrie.io/docs/java](https://delivrie.io/docs/java) · API reference: [delivrie.io/docs/api](https://delivrie.io/docs/api)

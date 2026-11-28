# Java and Spring

Send email from Java, Spring Boot and Kotlin with the official Delivrie Java SDK: no dependencies, idempotent retries, errors you can inspect, and webhook verification.

The Delivrie Java SDK has no dependencies and runs on Java 17 and later, including Spring Boot, Quarkus, Micronaut and Kotlin. Source: [github.com/bysurce/delivrie](https://github.com/bysurce/delivrie/tree/main/sdk/java).

```xml pom.xml
<dependency>
  <groupId>io.delivrie</groupId>
  <artifactId>delivrie-java</artifactId>
  <version>0.1.1</version>
</dependency>
```

```kotlin build.gradle.kts
implementation("io.delivrie:delivrie-java:0.1.1")
```

## Send an email

```java
import io.delivrie.Delivrie;
import java.util.Map;

Delivrie delivrie = new Delivrie(System.getenv("DELIVRIE_API_KEY"));

Map<String, Object> email = delivrie.emails().send(Map.of(
    "from", "Acme <hello@mail.acme.com>",
    "to", "ada@example.com",
    "subject", "Welcome",
    "html", "<p>Welcome to Acme</p>"));
System.out.println(email.get("id"));
```

Methods take a `Map` with the API's field names and return the API's JSON as a `Map<String, Object>` (objects as maps, arrays as lists, numbers as `Long` or `Double`). The client is thread-safe: in Spring, declare it once as a `@Bean`.

## Errors, retries and idempotency

```java
try {
  delivrie.emails().send(Map.of("from", "Acme <hi@acme.com>", "to", user.email(),
      "template", Map.of("id", "welcome")), "welcome-" + user.id());
} catch (DelivrieException e) {
  log.warn("Delivrie {} {}: {}", e.status(), e.name(), e.getMessage());
}
```

`DelivrieException` has the HTTP `status()` (0 for network errors and timeouts), Delivrie's error `name()` (see [Errors](/docs/errors)) and the message. `GET` and `DELETE` requests are retried twice on rate limits, `5xx` responses and network failures. Sends are retried only when you pass an idempotency key (the second argument of `send`), so a retry never sends twice.

```java
Delivrie delivrie = Delivrie.builder()
    .apiKey(key)
    .timeout(Duration.ofSeconds(10))
    .maxRetries(3)
    .build();
```

## Attachments

```java
delivrie.emails().send(Map.of(
    "from", "Billing <billing@mail.acme.com>", "to", "ada@example.com", "subject", "Your invoice", "text", "Attached.",
    "attachments", List.of(Delivrie.attachment(Path.of("invoice-1042.pdf")), Map.of("path", "https://acme.com/terms.pdf"))));
```

`Delivrie.attachment(path)` reads a local file; a `path` with an `https://` URL is downloaded by Delivrie.

## Spring Boot over SMTP

If you'd rather keep `JavaMailSender`, point it at the [SMTP relay](/docs/smtp):

```properties application.properties
spring.mail.host=smtp.delivrie.io
spring.mail.port=587
spring.mail.username=delivrie
spring.mail.password=${DELIVRIE_API_KEY}
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true
```

## Methods

| Resource | Methods |
| --- | --- |
| `emails()` | `send`, `sendBatch`, `get`, `list`, `listReceived`, `update`, `cancel`, `forward`, `attachments`, `receivedAttachments`, `share` |
| `domains()` | `create`, `get`, `list`, `verify`, `update`, `delete` |
| `apiKeys()` | `create`, `list`, `update`, `delete` |
| `webhooks()` | `create`, `list`, `deliveries`, `test`, `replay` |
| `contacts()` | `create`, `get`, `list`, `update`, `delete`, `importContacts`, `getImport`, `listImports` |
| `segments()` | `create`, `get`, `list`, `update`, `delete`, `contacts`, `addContacts`, `removeContacts` |
| `broadcasts()` | `create`, `get`, `list`, `update`, `send`, `cancel`, `duplicate`, `recipients`, `links`, `delete`, `getContent`, `editContent` |
| `templates()` | `create`, `get`, `list`, `update`, `publish`, `duplicate`, `delete`, `getContent`, `editContent` |
| `suppressions()` | `list`, `add`, `delete` |
| `events()` | `send`, `list` |
| `automations()` | `create`, `get`, `list`, `update`, `delete`, `runs`, `publish`, `pause`, `resume`, `duplicate` |
| `inboxes()` | `list`, `create`, `get`, `update`, `delete`, `agentRuns` |
| `inbox()` | `threads`, `thread`, `updateThread`, `reply`, `runAgent`, `notes`, `addNote`, `deleteNote`, `drafts`, `createDraft`, `updateDraft`, `sendDraft`, `discardDraft`, `labels` |
| `ai()` | `draft`, `rewrite`, `subjects` |
| `logs()` | `list`, `get` |

List methods also take a `Map` of query parameters, like `delivrie.emails().list(Map.of("limit", 10))`. For anything else, `delivrie.request("GET", "/emails", null, Map.of("limit", 10), null)` calls the API with the same auth, retries and errors. Every endpoint is in the [API reference](/docs/api).

## Verify webhooks

```java
@PostMapping("/webhooks/delivrie")
ResponseEntity<Void> webhook(@RequestBody String body, @RequestHeader Map<String, String> headers) {
  try {
    Map<String, Object> event = Webhook.verify(body, headers, System.getenv("DELIVRIE_WEBHOOK_SECRET"));
    // event.get("type"), event.get("data")
    return ResponseEntity.ok().build();
  } catch (WebhookVerificationException e) {
    return ResponseEntity.badRequest().build();
  }
}
```

It checks the signature against the raw body and rejects requests older than five minutes. More in [Webhooks](/docs/webhooks).

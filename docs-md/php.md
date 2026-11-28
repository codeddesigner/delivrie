# PHP and Laravel

Send email from PHP and Laravel with Delivrie: the PHP SDK, Laravel's SMTP mailer, and webhook verification.

## Laravel

Laravel's mail system works with the [SMTP relay](/docs/smtp) out of the box, so `Mail::to(...)->send(...)`, notifications and password resets all go through Delivrie. Update `.env`:

```bash .env
MAIL_MAILER=smtp
MAIL_HOST=smtp.delivrie.io
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=delivrie
MAIL_PASSWORD=dlv_your_key
MAIL_FROM_ADDRESS=hello@mail.acme.com
MAIL_FROM_NAME="Acme"
```

Then clear the config cache (`php artisan config:clear`) and send as usual:

```php
use Illuminate\Support\Facades\Mail;
use App\Mail\OrderShipped;

Mail::to($user)->send(new OrderShipped($order));
```

Already on Laravel's `resend` mailer? Set `RESEND_BASE_URL=https://delivrie.io/api` and `RESEND_API_KEY=dlv_your_key` instead; see [Migrate from Resend](/docs/migrate-from-resend).

## The PHP SDK

PHP 8.1 or later, with only the curl and json extensions.

```bash
composer require delivrie/delivrie-php
```

```php send.php
<?php
require 'vendor/autoload.php';

$delivrie = new \Delivrie\Delivrie(getenv('DELIVRIE_API_KEY'));

$email = $delivrie->emails->send([
    'from' => 'Acme <hello@mail.acme.com>',
    'to' => 'ada@example.com',
    'subject' => 'Your receipt',
    'html' => '<p>Thanks for your order.</p>',
], ['idempotency_key' => 'order-1042']);

echo $email['id'];
```

Every method returns the API's JSON as an array. Errors throw `Delivrie\Exception\DelivrieException`, with `getStatusCode()`, `getErrorName()` (like `validation_error`) and `getMessage()`. With an idempotency key, the SDK retries rate limits, server errors and network errors for you, and a retry never sends twice.

Templates, attachments and scheduling:

```php
$delivrie->emails->send([
    'to' => 'ada@example.com',
    'template' => ['id' => 'welcome', 'variables' => ['name' => 'Ada']],
    'attachments' => [['path' => __DIR__ . '/invoice.pdf']],
    'scheduled_at' => 'tomorrow at 9am',
]);
```

With a template, `from` and `subject` are optional: the template's own are used. `path` reads the file and encodes it for you.

The SDK covers the whole API: `$delivrie->domains`, `apiKeys`, `webhooks`, `contacts`, `segments`, `broadcasts`, `templates`, `suppressions`, `events`, `automations`, `inbox` (threads, drafts, notes), `inboxes`, `ai`, `logs`, plus `usage()` and `metrics()`. For example, `$delivrie->broadcasts->duplicate($id)`, `$delivrie->contacts->import(['csv' => $csv])`, `$delivrie->emails->receivedAttachments($id)` and `$delivrie->templates->editContent($id, ['ops' => [...]])`.

In Laravel, bind it once in a service provider:

```php app/Providers/AppServiceProvider.php
$this->app->singleton(\Delivrie\Delivrie::class, fn () => new \Delivrie\Delivrie(env('DELIVRIE_API_KEY')));
```

## WordPress

Use any SMTP plugin (WP Mail SMTP, FluentSMTP, Post SMTP) with host `smtp.delivrie.io`, port `587`, encryption TLS, username `delivrie` and an API key as the password. See [SMTP](/docs/smtp).

## Verify webhooks

```php webhook.php
<?php
$event = \Delivrie\Webhook::verify(
    file_get_contents('php://input'),   // the raw body, before decoding
    getallheaders(),
    getenv('DELIVRIE_WEBHOOK_SECRET'),  // whsec_…
);
// $event['type'] is "email.delivered", "email.bounced", …
```

It throws `Delivrie\Exception\WebhookVerificationException` for a bad signature, or a request older than 5 minutes. In Laravel, pass `$request->getContent()` and `$request->headers->all()`, and exclude the route from CSRF protection.

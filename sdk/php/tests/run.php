<?php
// Tests for the PHP SDK. No dependencies: php tests/run.php (composer test runs the same).
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Delivrie\\')) {
        require __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, 9)) . '.php';
    }
});

use Delivrie\Delivrie;
use Delivrie\Exception\DelivrieException;
use Delivrie\Exception\WebhookVerificationException;
use Delivrie\Webhook;

$passed = 0;
$failed = 0;
function check(string $name, callable $fn): void
{
    global $passed, $failed;
    try {
        $fn();
        $passed++;
        echo "ok    {$name}\n";
    } catch (Throwable $e) {
        $failed++;
        echo "FAIL  {$name}\n      {$e->getMessage()}\n";
    }
}
function same(mixed $want, mixed $got, string $what = ''): void
{
    if ($want !== $got) {
        throw new RuntimeException(($what ? "{$what}: " : '') . 'expected ' . var_export($want, true) . ', got ' . var_export($got, true));
    }
}

/** A fake transport: records calls and answers from a queue of [status, body, headers]. */
function fake(array $responses): array
{
    $calls = new ArrayObject();
    $transport = static function (string $method, string $url, array $headers, ?string $body) use (&$responses, $calls): array {
        $calls[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body === null ? null : json_decode($body, true)];
        [$status, $json, $h] = array_pad(array_shift($responses) ?? [200, []], 3, []);
        return ['status' => $status, 'headers' => $h, 'body' => is_string($json) ? $json : json_encode($json)];
    };
    return [new Delivrie('dlv_test_key', ['base_url' => 'https://api.test', 'transport' => $transport]), $calls];
}

check('send builds the request and returns the id', function () {
    [$d, $calls] = fake([[200, ['id' => 'em_1']]]);
    $tmp = tempnam(sys_get_temp_dir(), 'att');
    file_put_contents($tmp, 'hello');
    $res = $d->emails->send([
        'from' => 'Acme <hi@acme.com>', 'to' => 'ada@example.com', 'subject' => 'Hi', 'html' => '<p>Hi</p>',
        'scheduled_at' => new DateTimeImmutable('2030-01-02T03:04:05+00:00'),
        'attachments' => [['path' => $tmp, 'filename' => 'hello.txt']],
    ], ['idempotency_key' => 'order-1']);
    same('em_1', $res['id']);
    $c = $calls[0];
    same('POST', $c['method']);
    same('https://api.test/emails', $c['url']);
    same('Bearer dlv_test_key', $c['headers']['Authorization']);
    same('order-1', $c['headers']['Idempotency-Key']);
    same('delivrie-php/' . Delivrie::VERSION, $c['headers']['User-Agent']);
    same('2030-01-02T03:04:05+00:00', $c['body']['scheduled_at']);
    same([['filename' => 'hello.txt', 'content' => base64_encode('hello')]], $c['body']['attachments']);
});

check('API errors throw DelivrieException with status and name', function () {
    [$d] = fake([[422, ['statusCode' => 422, 'name' => 'validation_error', 'message' => 'Provide `html` or `text`']]]);
    try {
        $d->emails->send(['to' => 'a@b.co', 'subject' => 'x']);
        throw new RuntimeException('no exception');
    } catch (DelivrieException $e) {
        same(422, $e->getStatusCode());
        same('validation_error', $e->getErrorName());
        same('Provide `html` or `text`', $e->getMessage());
    }
});

check('sends are not retried without an idempotency key', function () {
    [$d, $calls] = fake([[503, []], [200, ['id' => 'x']]]);
    try { $d->emails->send(['to' => 'a@b.co', 'subject' => 'x', 'text' => 'x']); } catch (DelivrieException) {}
    same(1, count($calls));
});

check('rate limits are retried with an idempotency key, honouring Retry-After', function () {
    [$d, $calls] = fake([[429, ['name' => 'rate_limit_exceeded', 'message' => 'slow'], ['retry-after' => '0']], [200, ['id' => 'em_2']]]);
    same('em_2', $d->emails->send(['to' => 'a@b.co', 'subject' => 'x', 'text' => 'x'], ['idempotency_key' => 'k'])['id']);
    same(2, count($calls));
});

check('GETs are retried on server errors', function () {
    [$d, $calls] = fake([[502, ''], [200, ['object' => 'list', 'data' => [['id' => 'd1', 'name' => 'acme.com']]]]]);
    same('acme.com', $d->domains->list()['data'][0]['name']);
    same(2, count($calls));
});

check('lists send paging, ids are escaped, empty POSTs send {}', function () {
    [$d, $calls] = fake([[200, []], [200, []], [200, []]]);
    $d->emails->list(['limit' => 10, 'offset' => 20]);
    same('https://api.test/emails?limit=10&offset=20', $calls[0]['url']);
    $d->contacts->get('ada+test@example.com');
    same('https://api.test/contacts/ada%2Btest%40example.com', $calls[1]['url']);
    $d->domains->verify('d_1');
    same([], $calls[2]['body']);
});

check('missing key is a clear error', function () {
    putenv('DELIVRIE_API_KEY');
    try { new Delivrie(''); throw new RuntimeException('no exception'); } catch (InvalidArgumentException $e) { same(true, str_contains($e->getMessage(), 'DELIVRIE_API_KEY')); }
});

$secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
$sign = static fn (string $id, int $ts, string $body) => 'v1,' . base64_encode(hash_hmac('sha256', "{$id}.{$ts}.{$body}", base64_decode(substr($secret, 6)), true));

check('webhook verification accepts a valid signature', function () use ($secret, $sign) {
    $body = '{"type":"email.delivered","created_at":"x","data":{"email_id":"em_1"}}';
    $ts = time();
    $event = Webhook::verify($body, ['Webhook-Id' => 'msg_1', 'Webhook-Timestamp' => (string) $ts, 'Webhook-Signature' => 'v1,bm9wZQ== ' . $sign('msg_1', $ts, $body)], $secret);
    same('email.delivered', $event['type']);
});

check('webhook verification rejects tampering, replays and missing headers', function () use ($secret, $sign) {
    $body = '{"type":"email.delivered"}';
    $ts = time();
    $cases = [
        'tampered' => [$body . ' ', ['webhook-id' => 'm', 'webhook-timestamp' => (string) $ts, 'webhook-signature' => $sign('m', $ts, $body)]],
        'old' => [$body, ['webhook-id' => 'm', 'webhook-timestamp' => (string) ($ts - 600), 'webhook-signature' => $sign('m', $ts - 600, $body)]],
        'no headers' => [$body, []],
    ];
    foreach ($cases as $name => [$b, $h]) {
        try { Webhook::verify($b, $h, $secret); throw new RuntimeException("{$name} was accepted"); } catch (WebhookVerificationException) {}
    }
});

check('new endpoints: paths, methods and bodies', function () {
    [$d, $calls] = fake([[200, '{}', []]]);
    $d->broadcasts->duplicate('b1', 'Copy');
    $d->broadcasts->links('b1');
    $d->broadcasts->recipients('b1', ['status' => 'bounced']);
    $d->templates->editContent('welcome', ['ops' => [['op' => 'delete', 'id' => 'x']]]);
    $d->apiKeys->update('k1', 'Prod');
    $d->emails->receivedAttachments('e1');
    $d->emails->share('e1', 48);
    $d->segments->removeContacts('s1', ['a@b.com']);
    $d->contacts->import(['csv' => "email\na@b.com"]);
    $d->automations->duplicate('a1');
    $d->webhooks->remove('w1');
    $d->inboxes->list();
    $d->inbox->sendDraft('dr1');
    $d->ai->draft(['url' => 'https://acme.com']);
    $got = array_map(static fn ($c) => $c['method'] . ' ' . str_replace('https://api.test', '', $c['url']), $calls->getArrayCopy());
    same([
        'POST /broadcasts/b1/duplicate', 'GET /broadcasts/b1/links', 'GET /broadcasts/b1/recipients?status=bounced', 'POST /templates/welcome/content',
        'PATCH /api-keys/k1', 'GET /emails/received/e1/attachments', 'POST /emails/e1/share', 'DELETE /segments/s1/contacts', 'POST /contacts/imports',
        'POST /automations/a1/duplicate', 'DELETE /webhooks/w1', 'GET /inboxes', 'POST /inbox/drafts/dr1/send', 'POST /ai/draft',
    ], $got);
    same(['contacts' => ['a@b.com']], $calls[7]['body']);
    same(['expires_in_hours' => 48], $calls[6]['body']);
});

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed ? 1 : 0);

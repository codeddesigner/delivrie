<?php

declare(strict_types=1);

namespace Delivrie\Resources;

final class Emails extends Resource
{
    /**
     * Sends one email and returns ['id' => ...].
     *
     * $email keys: from, to (string or list), subject, html, text, cc, bcc, reply_to, template ['id' => ..., 'variables' => [...]],
     * scheduled_at (ISO 8601, a DateTimeInterface, or "in 1 hour"), tags [['name' => ..., 'value' => ...]], headers,
     * attachments [['filename' => ..., 'content' => base64] or ['path' => '/file.pdf']].
     *
     * @param array{idempotency_key?: string} $options Retrying with the same idempotency key never sends twice.
     */
    public function send(array $email, array $options = []): array
    {
        return $this->client->request('POST', '/emails', self::prepare($email), $options);
    }

    /** Sends up to 100 emails in one request (no attachments or scheduling). Returns ['data' => [['id' => ...], ...]]. */
    public function sendBatch(array $emails, array $options = []): array
    {
        return $this->client->request('POST', '/emails/batch', array_map([self::class, 'prepare'], array_values($emails)), $options);
    }

    /** An email with its events. */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/emails/' . self::id($id));
    }

    /** @param array{limit?: int, offset?: int} $params */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/emails', null, self::page($params));
    }

    /** Received (inbound) emails. @param array{limit?: int, offset?: int} $params */
    public function listReceived(array $params = []): array
    {
        return $this->client->request('GET', '/emails/received', null, self::page($params));
    }

    /** Moves a scheduled email. */
    public function reschedule(string $id, string|\DateTimeInterface $scheduledAt): array
    {
        return $this->client->request('PATCH', '/emails/' . self::id($id), ['scheduled_at' => self::when($scheduledAt)]);
    }

    /** Cancels a scheduled email. */
    public function cancel(string $id): array
    {
        return $this->client->request('POST', '/emails/' . self::id($id) . '/cancel', new \stdClass());
    }

    /** Forwards a received email. @param array{to: string|string[], from: string, note?: string} $params */
    public function forward(string $id, array $params): array
    {
        return $this->client->request('POST', '/emails/' . self::id($id) . '/forward', $params);
    }

    private static function prepare(array $email): array
    {
        if (isset($email['scheduled_at'])) {
            $email['scheduled_at'] = self::when($email['scheduled_at']);
        }
        if (isset($email['attachments'])) {
            $email['attachments'] = array_map(static function (array $a): array {
                if (isset($a['path'])) {
                    $data = @file_get_contents($a['path']);
                    if ($data === false) {
                        throw new \InvalidArgumentException("Can't read attachment {$a['path']}");
                    }
                    $a['content'] = base64_encode($data);
                    $a['filename'] ??= basename($a['path']);
                    unset($a['path']);
                }
                return $a;
            }, $email['attachments']);
        }
        return $email;
    }

    private static function when(string|\DateTimeInterface $v): string
    {
        return $v instanceof \DateTimeInterface ? $v->format(\DateTimeInterface::ATOM) : $v;
    }

    /** A sent email's files with download links that work for an hour. */
    public function attachments(string $id): array
    {
        return $this->client->request('GET', '/emails/' . self::id($id) . '/attachments');
    }

    /** A received email's files with download links that work for an hour. */
    public function receivedAttachments(string $id): array
    {
        return $this->client->request('GET', '/emails/received/' . self::id($id) . '/attachments');
    }

    /** A public link to the email and its delivery timeline (1 to 720 hours, default 24). */
    public function share(string $id, ?int $expiresInHours = null): array
    {
        return $this->client->request('POST', '/emails/' . self::id($id) . '/share', $expiresInHours === null ? new \stdClass() : ['expires_in_hours' => $expiresInHours]);
    }

    /** Revoke every share link for the email. */
    public function unshare(string $id): array
    {
        return $this->client->request('DELETE', '/emails/' . self::id($id) . '/share');
    }
}

<?php

declare(strict_types=1);

namespace Delivrie;

use Delivrie\Exception\DelivrieException;

/**
 * The Delivrie client.
 *
 *     $delivrie = new \Delivrie\Delivrie(getenv('DELIVRIE_API_KEY'));
 *     $email = $delivrie->emails->send([
 *         'from' => 'Acme <hi@acme.com>',
 *         'to' => 'ada@example.com',
 *         'subject' => 'Hello',
 *         'html' => '<p>It works</p>',
 *     ]);
 *     echo $email['id'];
 *
 * Every method returns the API's JSON as an array, or throws DelivrieException with the HTTP status and Delivrie's
 * error name. Rate limits, server errors and network errors are retried for safe requests, and for sends only with an
 * idempotency key, so a retry never sends an email twice.
 */
final class Delivrie
{
    public const VERSION = '0.2.1';
    public const DEFAULT_BASE_URL = 'https://delivrie.io/api';

    public readonly Resources\Emails $emails;
    public readonly Resources\Domains $domains;
    public readonly Resources\ApiKeys $apiKeys;
    public readonly Resources\Webhooks $webhooks;
    public readonly Resources\Contacts $contacts;
    public readonly Resources\Segments $segments;
    public readonly Resources\Broadcasts $broadcasts;
    public readonly Resources\Templates $templates;
    public readonly Resources\Suppressions $suppressions;
    public readonly Resources\Events $events;
    public readonly Resources\Automations $automations;
    public readonly Resources\Inbox $inbox;
    public readonly Resources\Inboxes $inboxes;
    public readonly Resources\Ai $ai;
    public readonly Resources\Logs $logs;

    private string $apiKey;
    private string $baseUrl;
    private int $timeout;
    private int $maxRetries;
    /** @var array<string, string> */
    private array $headers;
    /** @var callable|null */
    private $transport;

    /**
     * @param string|null $apiKey Falls back to the DELIVRIE_API_KEY environment variable.
     * @param array{base_url?: string, timeout?: int, max_retries?: int, headers?: array<string, string>, transport?: callable} $options
     *        `transport` replaces the HTTP call (for tests): fn(string $method, string $url, array $headers, ?string $body, int $timeout): array{status: int, headers: array<string, string>, body: string}
     */
    public function __construct(?string $apiKey = null, array $options = [])
    {
        $apiKey = $apiKey ?: (getenv('DELIVRIE_API_KEY') ?: '');
        if ($apiKey === '') {
            throw new \InvalidArgumentException('Missing API key. Pass it to new Delivrie($key) or set DELIVRIE_API_KEY. Create one at https://delivrie.io/api-keys');
        }
        $this->apiKey = $apiKey;
        $this->baseUrl = rtrim($options['base_url'] ?? (getenv('DELIVRIE_BASE_URL') ?: self::DEFAULT_BASE_URL), '/');
        $this->timeout = $options['timeout'] ?? 30;
        $this->maxRetries = max(0, $options['max_retries'] ?? 2);
        $this->headers = $options['headers'] ?? [];
        $this->transport = $options['transport'] ?? null;

        $this->emails = new Resources\Emails($this);
        $this->domains = new Resources\Domains($this);
        $this->apiKeys = new Resources\ApiKeys($this);
        $this->webhooks = new Resources\Webhooks($this);
        $this->contacts = new Resources\Contacts($this);
        $this->segments = new Resources\Segments($this);
        $this->broadcasts = new Resources\Broadcasts($this);
        $this->templates = new Resources\Templates($this);
        $this->suppressions = new Resources\Suppressions($this);
        $this->events = new Resources\Events($this);
        $this->automations = new Resources\Automations($this);
        $this->inbox = new Resources\Inbox($this);
        $this->inboxes = new Resources\Inboxes($this);
        $this->ai = new Resources\Ai($this);
        $this->logs = new Resources\Logs($this);
    }

    /** Plan, emails sent this month and today, and credits. */
    public function usage(): array
    {
        return $this->request('GET', '/usage');
    }

    /** Sending metrics for the last $days days, optionally for one domain. */
    public function metrics(int $days = 30, ?string $domainId = null): array
    {
        return $this->request('GET', '/metrics', null, ['query' => array_filter(['days' => $days, 'domain_id' => $domainId])]);
    }

    /**
     * Calls any API path (relative to the base URL, like "/emails") and returns the decoded JSON.
     *
     * @param array{query?: array<string, scalar|null>, idempotency_key?: string} $options
     */
    public function request(string $method, string $path, mixed $body = null, array $options = []): array
    {
        $url = $this->baseUrl . $path;
        $query = array_filter($options['query'] ?? [], static fn ($v) => $v !== null && $v !== '');
        if ($query) {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query);
        }
        $headers = [
            'Authorization' => 'Bearer ' . $this->apiKey,
            'Accept' => 'application/json',
            'User-Agent' => 'delivrie-php/' . self::VERSION,
        ] + $this->headers;
        $payload = null;
        if ($body !== null) {
            $payload = json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $headers['Content-Type'] = 'application/json';
        }
        if (!empty($options['idempotency_key'])) {
            $headers['Idempotency-Key'] = (string) $options['idempotency_key'];
        }
        // GET and DELETE are safe to repeat; POST and PATCH only with an idempotency key.
        $retryable = $method === 'GET' || $method === 'DELETE' || !empty($options['idempotency_key']);

        for ($attempt = 0; ; $attempt++) {
            try {
                $res = $this->send($method, $url, $headers, $payload);
            } catch (DelivrieException $e) {
                if ($retryable && $attempt < $this->maxRetries) {
                    usleep($this->backoff($attempt));
                    continue;
                }
                throw $e;
            }
            $status = $res['status'];
            $json = $res['body'] === '' ? null : json_decode($res['body'], true);
            if ($status >= 200 && $status < 300) {
                return is_array($json) ? $json : [];
            }
            $error = DelivrieException::fromResponse($status, $json, $res['body']);
            if (($status === 429 || $status >= 500) && $retryable && $attempt < $this->maxRetries) {
                $after = (int) ($res['headers']['retry-after'] ?? 0);
                usleep($after > 0 ? min($after, 30) * 1_000_000 : $this->backoff($attempt));
                continue;
            }
            throw $error;
        }
    }

    private function backoff(int $attempt): int
    {
        return min(8_000_000, 500_000 * (2 ** $attempt)) + random_int(0, 250_000);
    }

    /** @return array{status: int, headers: array<string, string>, body: string} */
    private function send(string $method, string $url, array $headers, ?string $payload): array
    {
        if ($this->transport) {
            return ($this->transport)($method, $url, $headers, $payload, $this->timeout);
        }
        $ch = curl_init($url);
        $resHeaders = [];
        $lines = [];
        foreach ($headers as $k => $v) {
            $lines[] = $k . ': ' . $v;
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => min(10, $this->timeout),
            CURLOPT_HEADERFUNCTION => static function ($_ch, string $line) use (&$resHeaders): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $resHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            },
        ]);
        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        }
        $body = curl_exec($ch);
        if ($body === false) {
            $errno = curl_errno($ch);
            $message = curl_error($ch);
            curl_close($ch);
            $timedOut = $errno === CURLE_OPERATION_TIMEDOUT;
            throw new DelivrieException($timedOut ? "No response within {$this->timeout} seconds" : "Couldn't reach Delivrie: {$message}", 0, $timedOut ? 'timeout' : 'network_error');
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ['status' => $status, 'headers' => $resHeaders, 'body' => (string) $body];
    }
}

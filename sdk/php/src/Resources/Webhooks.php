<?php

declare(strict_types=1);

namespace Delivrie\Resources;

use Delivrie\Webhook;

final class Webhooks extends Resource
{
    /** Subscribes an https:// endpoint; 'signing_secret' in the response is shown once. @param array{endpoint: string, events: string[]} $params */
    public function create(array $params): array
    {
        return $this->client->request('POST', '/webhooks', $params);
    }

    public function list(): array
    {
        return $this->client->request('GET', '/webhooks');
    }

    /** Recent delivery attempts for a webhook. */
    public function deliveries(string $id): array
    {
        return $this->client->request('GET', '/webhooks/' . self::id($id) . '/events');
    }

    /** Sends a test event to the endpoint. */
    public function test(string $id): array
    {
        return $this->client->request('POST', '/webhooks/' . self::id($id) . '/test', new \stdClass());
    }

    /** Sends a past delivery again. */
    public function replay(string $deliveryId): array
    {
        return $this->client->request('POST', '/webhook-deliveries/' . self::id($deliveryId) . '/replay', new \stdClass());
    }

    /** Same as \Delivrie\Webhook::verify(). */
    public function verify(string $payload, array $headers, string $secret, int $toleranceSeconds = 300): array
    {
        return Webhook::verify($payload, $headers, $secret, $toleranceSeconds);
    }

    /** Change the endpoint, events or status (enabled, disabled). */
    public function update(string $id, array $changes): array
    {
        return $this->client->request('PATCH', '/webhooks/' . self::id($id), $changes);
    }

    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/webhooks/' . self::id($id));
    }
}

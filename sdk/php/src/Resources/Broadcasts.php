<?php

declare(strict_types=1);

namespace Delivrie\Resources;

final class Broadcasts extends Resource
{
    /** @param array{segment_id: string, from: string, subject: string, html?: string, text?: string, name?: string, reply_to?: string, topic_id?: string} $params */
    public function create(array $params): array
    {
        return $this->client->request('POST', '/broadcasts', $params);
    }

    public function get(string $id): array
    {
        return $this->client->request('GET', '/broadcasts/' . self::id($id));
    }

    public function list(): array
    {
        return $this->client->request('GET', '/broadcasts');
    }

    /** Sends now, or at $scheduledAt (ISO 8601, DateTimeInterface or a phrase like "tomorrow at 9am"). */
    public function send(string $id, string|\DateTimeInterface|null $scheduledAt = null): array
    {
        $body = $scheduledAt === null ? new \stdClass() : ['scheduled_at' => $scheduledAt instanceof \DateTimeInterface ? $scheduledAt->format(\DateTimeInterface::ATOM) : $scheduledAt];
        return $this->client->request('POST', '/broadcasts/' . self::id($id) . '/send', $body);
    }

    public function cancel(string $id): array
    {
        return $this->client->request('POST', '/broadcasts/' . self::id($id) . '/cancel', new \stdClass());
    }

    /** How many contacts the broadcast will reach. */
    /** Who it went to (with delivered/opened/clicked/bounced flags), or before sending, who it will reach. */
    public function recipients(string $id, array $params = []): array
    {
        return $this->client->request('GET', '/broadcasts/' . self::id($id) . '/recipients', null, self::page($params));
    }

    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/broadcasts/' . self::id($id));
    }

    /** Edit a draft. */
    public function update(string $id, array $changes): array
    {
        return $this->client->request('PATCH', '/broadcasts/' . self::id($id), $changes);
    }

    /** Copy it as a new draft. */
    public function duplicate(string $id, ?string $name = null): array
    {
        return $this->client->request('POST', '/broadcasts/' . self::id($id) . '/duplicate', $name === null ? new \stdClass() : ['name' => $name]);
    }

    /** Clicked links with total and unique clicks. */
    public function links(string $id): array
    {
        return $this->client->request('GET', '/broadcasts/' . self::id($id) . '/links');
    }

    public function getContent(string $id): array
    {
        return $this->client->request('GET', '/broadcasts/' . self::id($id) . '/content');
    }

    /** Edit a draft block by block: ['ops' => [...]] or ['blocks' => [...]]. Shows up live in the editor. */
    public function editContent(string $id, array $edit): array
    {
        return $this->client->request('POST', '/broadcasts/' . self::id($id) . '/content', $edit);
    }
}

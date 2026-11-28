<?php

declare(strict_types=1);

namespace Delivrie\Resources;

final class Segments extends Resource
{
    public function create(string $name): array
    {
        return $this->client->request('POST', '/segments', ['name' => $name]);
    }

    public function list(): array
    {
        return $this->client->request('GET', '/segments');
    }

    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/segments/' . self::id($id));
    }

    /** Adds contacts by email address (or full contact arrays); they're created if needed. */
    public function addContacts(string $id, array $contacts): array
    {
        $list = array_map(static fn ($c) => is_string($c) ? ['email' => $c] : $c, array_values($contacts));
        return $this->client->request('POST', '/segments/' . self::id($id) . '/contacts', ['contacts' => $list]);
    }

    /** Subscription topics. */
    public function topics(): array
    {
        return $this->client->request('GET', '/topics');
    }

    /** A segment with its contact count. */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/segments/' . self::id($id));
    }

    /** Rename a segment. */
    public function update(string $id, string $name): array
    {
        return $this->client->request('PATCH', '/segments/' . self::id($id), ['name' => $name]);
    }

    /** The contacts in a segment. */
    public function contacts(string $id, array $params = []): array
    {
        return $this->client->request('GET', '/segments/' . self::id($id) . '/contacts', null, self::page($params));
    }

    /** Take contacts (emails or ids) out of a segment. The contacts aren't deleted. */
    public function removeContacts(string $id, array $contacts): array
    {
        return $this->client->request('DELETE', '/segments/' . self::id($id) . '/contacts', ['contacts' => array_values($contacts)]);
    }
}

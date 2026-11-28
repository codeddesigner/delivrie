<?php

declare(strict_types=1);

namespace Delivrie\Resources;

final class ApiKeys extends Resource
{
    /** Makes a key; 'token' in the response is shown once. @param array{name: string, permission?: 'full_access'|'sending_access', domain_id?: string} $params */
    public function create(array $params): array
    {
        return $this->client->request('POST', '/api-keys', $params);
    }

    public function list(): array
    {
        return $this->client->request('GET', '/api-keys');
    }

    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/api-keys/' . self::id($id));
    }

    /** Rename a key. */
    public function update(string $id, string $name): array
    {
        return $this->client->request('PATCH', '/api-keys/' . self::id($id), ['name' => $name]);
    }
}

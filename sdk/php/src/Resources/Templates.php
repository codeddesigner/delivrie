<?php

declare(strict_types=1);

namespace Delivrie\Resources;

final class Templates extends Resource
{
    /** @param array{name: string, alias?: string, subject?: string, html?: string, from?: string, variables?: array} $params */
    public function create(array $params): array
    {
        return $this->client->request('POST', '/templates', $params);
    }

    /** By id or alias. */
    public function get(string $idOrAlias): array
    {
        return $this->client->request('GET', '/templates/' . self::id($idOrAlias));
    }

    public function list(): array
    {
        return $this->client->request('GET', '/templates');
    }

    /** Makes the current draft the version that sends use. */
    public function publish(string $id): array
    {
        return $this->client->request('POST', '/templates/' . self::id($id) . '/publish', new \stdClass());
    }

    /** Change it. Saved as a draft until published. */
    public function update(string $idOrAlias, array $changes): array
    {
        return $this->client->request('PATCH', '/templates/' . self::id($idOrAlias), $changes);
    }

    public function duplicate(string $idOrAlias, array $params = []): array
    {
        return $this->client->request('POST', '/templates/' . self::id($idOrAlias) . '/duplicate', $params ?: new \stdClass());
    }

    public function remove(string $idOrAlias): array
    {
        return $this->client->request('DELETE', '/templates/' . self::id($idOrAlias));
    }

    public function getContent(string $idOrAlias): array
    {
        return $this->client->request('GET', '/templates/' . self::id($idOrAlias) . '/content');
    }

    /** Edit it block by block: ['ops' => [...]] or ['blocks' => [...]]. Shows up live in the editor. */
    public function editContent(string $idOrAlias, array $edit): array
    {
        return $this->client->request('POST', '/templates/' . self::id($idOrAlias) . '/content', $edit);
    }
}

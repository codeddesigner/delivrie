<?php

declare(strict_types=1);

namespace Delivrie\Resources;

/** Inboxes (addresses on receiving domains) and their agent settings. */
final class Inboxes extends Resource
{
    public function list(): array
    {
        return $this->client->request('GET', '/inboxes');
    }

    public function create(array $params): array
    {
        return $this->client->request('POST', '/inboxes', $params);
    }

    public function get(string $idOrAddress): array
    {
        return $this->client->request('GET', '/inboxes/' . self::id($idOrAddress));
    }

    public function update(string $idOrAddress, array $changes): array
    {
        return $this->client->request('PATCH', '/inboxes/' . self::id($idOrAddress), $changes);
    }

    public function remove(string $idOrAddress): array
    {
        return $this->client->request('DELETE', '/inboxes/' . self::id($idOrAddress));
    }

    public function agentRuns(string $idOrAddress, array $params = []): array
    {
        return $this->client->request('GET', '/inboxes/' . self::id($idOrAddress) . '/agent-runs', null, self::page($params));
    }
}

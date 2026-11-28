<?php

declare(strict_types=1);

namespace Delivrie\Resources;

/** AI writing in the team's brand voice. */
final class Ai extends Resource
{
    /** Write an email from 'url' and/or 'brief'. With 'target' => ['type' => 'template', 'id' => ...], writes it into that email. */
    public function draft(array $params): array
    {
        return $this->client->request('POST', '/ai/draft', $params);
    }

    /** Rewrite 'blocks' with an 'instruction'. */
    public function rewrite(array $params): array
    {
        return $this->client->request('POST', '/ai/rewrite', $params);
    }

    /** Subject line ideas for an email's text. */
    public function subjects(string $text): array
    {
        return $this->client->request('POST', '/ai/subjects', ['text' => $text]);
    }
}

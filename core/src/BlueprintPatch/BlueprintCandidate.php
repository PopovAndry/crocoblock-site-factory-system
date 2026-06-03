<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintDocument;

/**
 * Full candidate blueprint proposed by AI or another generator.
 *
 * Candidates are review artifacts only. They must be converted into an approved
 * BlueprintPatch or otherwise confirmed before runtime apply.
 */
final class BlueprintCandidate
{
    private BlueprintDocument $document;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<string, mixed> $metadata
     */
    public function __construct(BlueprintDocument $document, array $metadata = [])
    {
        $this->document = $document;
        $this->metadata = $metadata;
    }

    public function document(): BlueprintDocument
    {
        return $this->document;
    }

    /**
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        return $this->metadata;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'document' => $this->document->toArray(),
            'metadata' => $this->metadata,
        ];
    }
}

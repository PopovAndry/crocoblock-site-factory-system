<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

/**
 * Safe change proposal for an existing BlueprintDocument.
 *
 * A patch is previewed and validated before any runtime layer may apply it.
 */
final class BlueprintPatch
{
    /** @var array<int, array<string, mixed>> */
    private array $operations;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<int, array<string, mixed>> $operations
     * @param array<string, mixed> $metadata
     */
    public function __construct(array $operations, array $metadata = [])
    {
        $this->operations = $operations;
        $this->metadata = $metadata;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function operations(): array
    {
        return $this->operations;
    }

    /**
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        return $this->metadata;
    }

    public function isEmpty(): bool
    {
        return $this->operations === [];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'operations' => $this->operations,
            'metadata' => $this->metadata,
        ];
    }
}

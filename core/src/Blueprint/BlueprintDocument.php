<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Blueprint;

/**
 * Desired site state document.
 *
 * This Core value object is intentionally WordPress-agnostic. Runtime adapters
 * may interpret the document later, but the document itself never applies state.
 */
final class BlueprintDocument
{
    /** @var array<string, mixed> */
    private array $data;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $metadata
     */
    public function __construct(array $data, array $metadata = [])
    {
        $this->data = $data;
        $this->metadata = $metadata;
    }

    /**
     * @return array<string, mixed>
     */
    public function data(): array
    {
        return $this->data;
    }

    /**
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        return $this->metadata;
    }

    public function version(): ?string
    {
        return isset($this->data['version']) && is_string($this->data['version'])
            ? $this->data['version']
            : null;
    }

    public function preset(): ?string
    {
        return isset($this->metadata['preset']) && is_string($this->metadata['preset'])
            ? $this->metadata['preset']
            : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'data' => $this->data,
            'metadata' => $this->metadata,
        ];
    }
}

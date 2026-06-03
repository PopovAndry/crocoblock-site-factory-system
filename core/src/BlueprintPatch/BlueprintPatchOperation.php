<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

/**
 * One safe BlueprintPatch operation.
 */
final class BlueprintPatchOperation
{
    public const OP_SET = 'set';
    public const OP_ADD = 'add';
    public const OP_REPLACE = 'replace';

    private string $op;
    private string $path;

    /** @var mixed */
    private $value;

    /**
     * @param mixed $value
     */
    public function __construct(string $op, string $path, $value)
    {
        $this->op = $op;
        $this->path = $path;
        $this->value = $value;
    }

    public function op(): string
    {
        return $this->op;
    }

    public function path(): string
    {
        return $this->path;
    }

    /**
     * @return mixed
     */
    public function value()
    {
        return $this->value;
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            (string) ($data['op'] ?? ''),
            (string) ($data['path'] ?? ''),
            $data['value'] ?? null
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'op' => $this->op,
            'path' => $this->path,
            'value' => $this->value,
        ];
    }
}

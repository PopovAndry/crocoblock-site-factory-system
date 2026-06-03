<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Validation;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;

/**
 * Validation output for blueprint, runtime, or proof checks.
 */
final class ValidationResult
{
    private string $status;

    /** @var array<int, ValidationCheck> */
    private array $checks;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<int, ValidationCheck> $checks
     * @param array<string, mixed> $metadata
     */
    public function __construct(array $checks, ?string $status = null, array $metadata = [])
    {
        $this->checks = $checks;
        $this->status = $status ?? self::resolveStatus($checks);
        $this->metadata = $metadata;
        ManifestStatus::assertKnown($this->status);
    }

    public function status(): string
    {
        return $this->status;
    }

    /**
     * @return array<int, ValidationCheck>
     */
    public function checks(): array
    {
        return $this->checks;
    }

    /**
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        return $this->metadata;
    }

    /**
     * @param array<int, ValidationCheck> $checks
     */
    public static function resolveStatus(array $checks): string
    {
        if ($checks === []) {
            return ManifestStatus::WARNING;
        }

        foreach ($checks as $check) {
            if ($check->status() === ManifestStatus::ERROR) {
                return ManifestStatus::ERROR;
            }
        }

        foreach ($checks as $check) {
            if ($check->status() === ManifestStatus::WARNING) {
                return ManifestStatus::WARNING;
            }
        }

        return ManifestStatus::OK;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'status' => $this->status,
            'checks' => array_map(static function (ValidationCheck $check): array {
                return $check->toArray();
            }, $this->checks),
            'metadata' => $this->metadata,
        ];
    }
}

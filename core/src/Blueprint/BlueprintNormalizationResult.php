<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Blueprint;

use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;

/**
 * Result returned by the pure Core blueprint normalizer.
 */
final class BlueprintNormalizationResult
{
    /** @var array<string, mixed> */
    private array $blueprint;

    /** @var array<int, string> */
    private array $warnings;

    /** @var array<int, ValidationCheck> */
    private array $checks;

    /**
     * @param array<string, mixed> $blueprint
     * @param array<int, string> $warnings
     * @param array<int, ValidationCheck> $checks
     */
    public function __construct(array $blueprint, array $warnings = [], array $checks = [])
    {
        $this->blueprint = $blueprint;
        $this->warnings = array_values($warnings);
        $this->checks = array_values($checks);
    }

    /** @return array<string, mixed> */
    public function blueprint(): array
    {
        return $this->blueprint;
    }

    /** @return array<int, string> */
    public function warnings(): array
    {
        return $this->warnings;
    }

    /** @return array<int, ValidationCheck> */
    public function checks(): array
    {
        return $this->checks;
    }

    public function hasWarnings(): bool
    {
        return [] !== $this->warnings;
    }
}
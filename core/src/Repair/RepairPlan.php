<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Repair;

use Crocoblock\SiteFactory\Core\Planning\Plan;

/**
 * Future repair/fix plan.
 *
 * This contract describes repair intent only. Runtime adapters decide whether
 * and how each affected operation can be safely executed.
 */
final class RepairPlan
{
    private Plan $plan;

    /** @var array<int, string> */
    private array $affectedAdapters;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<int, string> $affectedAdapters
     * @param array<string, mixed> $metadata
     */
    public function __construct(Plan $plan, array $affectedAdapters = [], array $metadata = [])
    {
        $this->plan = $plan;
        $this->affectedAdapters = $affectedAdapters;
        $this->metadata = $metadata;
    }

    public function plan(): Plan
    {
        return $this->plan;
    }

    /**
     * @return array<int, string>
     */
    public function affectedAdapters(): array
    {
        return $this->affectedAdapters;
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
            'plan' => $this->plan->toArray(),
            'affected_adapters' => $this->affectedAdapters,
            'metadata' => $this->metadata,
        ];
    }
}

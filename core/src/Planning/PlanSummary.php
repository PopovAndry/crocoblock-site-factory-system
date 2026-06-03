<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * Summary counts for a preview plan.
 */
final class PlanSummary
{
    /** @var array<string, int> */
    private array $counts;

    /**
     * @param array<string, int> $counts
     */
    public function __construct(array $counts = [])
    {
        $this->counts = array_merge([
            PlanItem::ACTION_CREATE => 0,
            PlanItem::ACTION_UPDATE => 0,
            PlanItem::ACTION_DELETE => 0,
            PlanItem::ACTION_SKIP => 0,
            PlanItem::ACTION_WARNING => 0,
            PlanItem::ACTION_ERROR => 0,
        ], $counts);
    }

    public function count(string $action): int
    {
        return $this->counts[$action] ?? 0;
    }

    /**
     * @return array<string, int>
     */
    public function toArray(): array
    {
        return $this->counts;
    }
}

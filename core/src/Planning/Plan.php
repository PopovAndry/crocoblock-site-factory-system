<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * Preview plan before runtime apply.
 */
final class Plan
{
    /** @var array<int, PlanItem> */
    private array $items;

    private PlanSummary $summary;

    /** @var array<string, mixed> */
    private array $metadata;

    /**
     * @param array<int, PlanItem> $items
     * @param array<string, mixed> $metadata
     */
    public function __construct(array $items, ?PlanSummary $summary = null, array $metadata = [])
    {
        $this->items = $items;
        $this->summary = $summary ?? self::summarize($items);
        $this->metadata = $metadata;
    }

    /**
     * @return array<int, PlanItem>
     */
    public function items(): array
    {
        return $this->items;
    }

    public function summary(): PlanSummary
    {
        return $this->summary;
    }

    /**
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        return $this->metadata;
    }

    /**
     * @param array<int, PlanItem> $items
     */
    public static function summarize(array $items): PlanSummary
    {
        $counts = [];

        foreach ($items as $item) {
            $counts[$item->action()] = ($counts[$item->action()] ?? 0) + 1;
        }

        return new PlanSummary($counts);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'items' => array_map(static function (PlanItem $item): array {
                return $item->toArray();
            }, $this->items),
            'summary' => $this->summary->toArray(),
            'metadata' => $this->metadata,
        ];
    }
}

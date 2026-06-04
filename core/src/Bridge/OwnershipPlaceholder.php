<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

/**
 * Core-only placeholder for future WordPress runtime ownership checks.
 *
 * Core can require ownership checks before safe runtime mutation, but it must
 * not inspect WordPress objects, post meta, Crocoblock entities, or adapter
 * state directly.
 */
final class OwnershipPlaceholder
{
    public const SOURCE = 'plugin_runtime';
    public const STATUS_NOT_CHECKED = 'not_checked';
    public const NEXT_REQUIRED_STEP = 'ownership_check';

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'available' => false,
            'status' => self::STATUS_NOT_CHECKED,
            'source' => self::SOURCE,
            'message' => 'Ownership checks require plugin runtime and were not executed.',
            'requires_runtime' => true,
            'next_required_step' => self::NEXT_REQUIRED_STEP,
            'summary' => self::emptySummary(),
            'items' => [],
        ];
    }

    /**
     * @return array<string, int>
     */
    public static function emptySummary(): array
    {
        return [
            'checked' => 0,
            'safe' => 0,
            'user_modified' => 0,
            'locked' => 0,
            'conflict' => 0,
            'warning' => 0,
            'error' => 0,
        ];
    }
}

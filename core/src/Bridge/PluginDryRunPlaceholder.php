<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

/**
 * Core-only placeholder for the future WordPress plugin runtime dry-run.
 *
 * Core preview responses can explain that a runtime dry-run is still required,
 * but Core must not call WordPress, Crocoblock adapters, REST controllers, or
 * filesystem mutators directly.
 */
final class PluginDryRunPlaceholder
{
    public const SOURCE = 'plugin_runtime';
    public const STATUS_NOT_RUN = 'not_run';
    public const NEXT_REQUIRED_STEP = 'plugin_dry_run';

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'available' => false,
            'status' => self::STATUS_NOT_RUN,
            'source' => self::SOURCE,
            'message' => 'Plugin dry-run is not part of this Core-only preview response.',
            'summary' => self::emptySummary(),
            'items' => [],
            'requires_runtime' => true,
            'next_required_step' => self::NEXT_REQUIRED_STEP,
        ];
    }

    /**
     * @return array<string, int>
     */
    public static function emptySummary(): array
    {
        return [
            'create' => 0,
            'update' => 0,
            'delete' => 0,
            'skip' => 0,
            'warning' => 0,
            'error' => 0,
        ];
    }
}

<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

/**
 * Core-only contract helper for grouped runtime evidence.
 *
 * RuntimeEvidence groups plugin dry-run and ownership envelopes as read-only
 * input for future bridge validation. It does not collect evidence itself.
 */
final class RuntimeEvidence
{
    public const MODE_READ_ONLY = 'read_only';
    public const SOURCE_PLUGIN_RUNTIME = 'plugin_runtime';

    public const STATUS_NOT_READY = 'not_ready';
    public const STATUS_OK = 'ok';
    public const STATUS_WARNING = 'warning';
    public const STATUS_ERROR = 'error';

    /**
     * @return array<int, string>
     */
    public static function statuses(): array
    {
        return [
            self::STATUS_NOT_READY,
            self::STATUS_OK,
            self::STATUS_WARNING,
            self::STATUS_ERROR,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function placeholder(): array
    {
        return [
            'version' => 1,
            'mode' => self::MODE_READ_ONLY,
            'source' => self::SOURCE_PLUGIN_RUNTIME,
            'status' => self::STATUS_NOT_READY,
            'complete' => false,
            'applied' => false,
            'runtime_mutation' => false,
            'message' => 'Runtime evidence has not been collected yet.',
            'plugin_dry_run' => (new PluginDryRunPlaceholder())->toArray(),
            'ownership' => (new OwnershipPlaceholder())->toArray(),
            'summary' => [
                'dry_run_available' => false,
                'ownership_available' => false,
                'runtime_checks_complete' => false,
                'blocking_errors' => 0,
                'warnings' => 0,
            ],
        ];
    }
}

<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

/**
 * Core-only constants and shape helpers for preview apply-gate policy.
 *
 * The gate expresses readiness for the next step. It does not apply anything
 * and must not enable runtime mutation in Core-only examples.
 */
final class ApplyGatePolicy
{
    public const STATUS_BLOCKED = 'blocked';
    public const STATUS_READY = 'ready';
    public const STATUS_WARNING = 'warning';
    public const STATUS_ERROR = 'error';

    public const STEP_PLUGIN_DRY_RUN = 'plugin_dry_run';
    public const STEP_OWNERSHIP_CHECK = 'ownership_check';
    public const STEP_USER_CONFIRMATION = 'user_confirmation';
    public const STEP_APPLY = 'apply';
    public const STEP_RESOLVE_CONFLICTS = 'resolve_conflicts';

    /**
     * @return array<int, string>
     */
    public static function statuses(): array
    {
        return [
            self::STATUS_BLOCKED,
            self::STATUS_READY,
            self::STATUS_WARNING,
            self::STATUS_ERROR,
        ];
    }

    /**
     * @return array<int, string>
     */
    public static function nextRequiredSteps(): array
    {
        return [
            self::STEP_PLUGIN_DRY_RUN,
            self::STEP_OWNERSHIP_CHECK,
            self::STEP_USER_CONFIRMATION,
            self::STEP_APPLY,
            self::STEP_RESOLVE_CONFLICTS,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function blockedPlaceholderGate(): array
    {
        return [
            'status' => self::STATUS_BLOCKED,
            'can_apply' => false,
            'requires_user_confirmation' => true,
            'blocking_reasons' => [
                'Plugin dry-run has not been executed.',
                'Ownership check has not been executed.',
            ],
            'warnings' => [],
            'next_required_step' => self::STEP_PLUGIN_DRY_RUN,
        ];
    }
}

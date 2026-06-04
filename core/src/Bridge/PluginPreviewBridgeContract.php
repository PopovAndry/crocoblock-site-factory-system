<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

/**
 * Static shape helpers for the future read-only plugin preview bridge.
 *
 * This class is contract-only. It does not call WordPress, Crocoblock APIs,
 * plugin adapters, REST controllers, or any runtime mutation path.
 */
final class PluginPreviewBridgeContract
{
    public const MODE_READ_ONLY = 'read_only';
    public const INTENT_PREVIEW_BEFORE_APPLY = 'preview_before_apply';
    public const SOURCE_CORE_PREVIEW = 'core_preview_response';
    public const APPLY_GATE_BLOCKED = 'blocked';

    /**
     * @param array<string, mixed> $corePreview
     * @return array<string, mixed>
     */
    public static function inputExample(array $corePreview = []): array
    {
        return [
            'version' => 1,
            'mode' => self::MODE_READ_ONLY,
            'intent' => self::INTENT_PREVIEW_BEFORE_APPLY,
            'applied' => false,
            'runtime_mutation' => false,
            'source' => self::SOURCE_CORE_PREVIEW,
            'core_preview' => $corePreview,
            'requested_runtime_checks' => [
                'plugin_dry_run' => true,
                'ownership_check' => true,
            ],
            'constraints' => [
                'allow_apply' => false,
                'allow_mutation' => false,
                'require_user_confirmation' => true,
                'respect_ownership' => true,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $corePreview
     * @return array<string, mixed>
     */
    public static function responseExample(array $corePreview = []): array
    {
        return [
            'version' => 1,
            'mode' => self::MODE_READ_ONLY,
            'status' => 'warning',
            'applied' => false,
            'runtime_mutation' => false,
            'title' => 'Plugin preview bridge response',
            'message' => 'Read-only plugin preview bridge response generated. Nothing was applied.',
            'core' => [
                'preview' => $corePreview,
            ],
            'plugin' => [
                'dry_run' => (new PluginDryRunPlaceholder())->toArray(),
            ],
            'ownership' => (new OwnershipPlaceholder())->toArray(),
            'apply_gate' => [
                'status' => self::APPLY_GATE_BLOCKED,
                'can_apply' => false,
                'requires_user_confirmation' => true,
                'blocking_reasons' => [
                    'Plugin dry-run has not been executed.',
                    'Ownership check has not been executed.',
                    'User confirmation has not been collected.',
                ],
                'warnings' => [
                    'No runtime checks were executed by this Core-only example.',
                ],
                'next_required_step' => PluginDryRunPlaceholder::NEXT_REQUIRED_STEP,
            ],
        ];
    }
}

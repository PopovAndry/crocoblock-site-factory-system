<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintNormalizationResult;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Planning\Plan;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Builds a read-only Core preview response for a future plugin bridge.
 *
 * This response is a contract draft only. It does not call WordPress, plugin
 * adapters, REST controllers, filesystem mutators, or AI providers.
 */
final class CorePreviewResponseBuilder
{
    /**
     * @param array<string, mixed> $formattedReview
     * @return array<string, mixed>
     */
    public function build(
        BlueprintNormalizationResult $normalization,
        ValidationResult $validation,
        Plan $reviewPlan,
        array $formattedReview
    ): array {
        $normalizationStatus = $normalization->hasWarnings() ? ManifestStatus::WARNING : ManifestStatus::OK;
        $validationStatus = $validation->status();
        $formattedStatus = is_string($formattedReview['status'] ?? null) ? $formattedReview['status'] : ManifestStatus::OK;
        $status = $this->maxStatus([$normalizationStatus, $validationStatus, $formattedStatus]);
        $warnings = $this->warnings($normalization, $validation, $formattedReview);

        return [
            'version' => 1,
            'status' => $status,
            'mode' => 'read_only',
            'applied' => false,
            'runtime_mutation' => false,
            'title' => 'Core preview',
            'message' => 'Read-only Core preview generated. Nothing was applied.',
            'core' => [
                'available' => true,
                'candidate_valid' => ManifestStatus::ERROR !== $validationStatus,
                'normalization' => [
                    'status' => $normalizationStatus,
                    'warnings' => $normalization->warnings(),
                ],
                'validation' => [
                    'status' => $validationStatus,
                    'checks' => array_map(
                        static function ($check): array {
                            return $check->toArray();
                        },
                        $validation->checks()
                    ),
                ],
                'review' => [
                    'plan' => $reviewPlan->toArray(),
                    'formatted' => $formattedReview,
                ],
            ],
            'plugin' => [
                'dry_run' => (new PluginDryRunPlaceholder())->toArray(),
            ],
            'ownership' => (new OwnershipPlaceholder())->toArray(),
            'next_required_step' => 'plugin_dry_run',
            'warnings' => $warnings,
        ];
    }

    /**
     * @param array<int, string> $statuses
     */
    private function maxStatus(array $statuses): string
    {
        if (in_array(ManifestStatus::ERROR, $statuses, true)) {
            return ManifestStatus::ERROR;
        }

        if (in_array(ManifestStatus::WARNING, $statuses, true)) {
            return ManifestStatus::WARNING;
        }

        return ManifestStatus::OK;
    }

    /**
     * @param array<string, mixed> $formattedReview
     * @return array<int, string>
     */
    private function warnings(
        BlueprintNormalizationResult $normalization,
        ValidationResult $validation,
        array $formattedReview
    ): array {
        $warnings = $normalization->warnings();

        foreach ($validation->checks() as $check) {
            if (ManifestStatus::WARNING === $check->status()) {
                $warnings[] = $check->message();
            }
        }

        if (($formattedReview['status'] ?? ManifestStatus::OK) === ManifestStatus::WARNING) {
            $warnings[] = 'Formatted candidate review contains warnings.';
        }

        return array_values(array_unique($warnings));
    }
}

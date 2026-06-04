<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use RuntimeException;

/**
 * Core-only composer for read-only plugin preview bridge response examples.
 *
 * The builder combines existing Core preview data and optional RuntimeEvidence.
 * It does not call WordPress, Crocoblock APIs, plugin adapters, REST, dashboard
 * code, or runtime mutation paths.
 */
final class PluginPreviewBridgeResponseBuilder
{
    /**
     * @param array<string, mixed> $corePreview
     * @param array<string, mixed>|null $runtimeEvidence
     * @return array<string, mixed>
     */
    public function build(array $corePreview, ?array $runtimeEvidence = null): array
    {
        $evidence = $runtimeEvidence ?? RuntimeEvidence::placeholder();
        $dryRun = $this->extractObject($evidence, 'plugin_dry_run');
        $ownership = $this->extractObject($evidence, 'ownership');
        $applyGate = $this->buildApplyGate($evidence, $dryRun, $ownership);
        $status = $this->responseStatus($evidence, $applyGate);

        $response = [
            'version' => 1,
            'mode' => PluginPreviewBridgeContract::MODE_READ_ONLY,
            'status' => $status,
            'applied' => false,
            'runtime_mutation' => false,
            'title' => 'Plugin preview bridge response',
            'message' => 'Read-only plugin preview bridge response generated. Nothing was applied.',
            'core' => [
                'preview' => $corePreview,
            ],
            'plugin' => [
                'dry_run' => $dryRun,
            ],
            'ownership' => $ownership,
            'apply_gate' => $applyGate,
        ];

        if (null !== $runtimeEvidence) {
            $response['runtime_evidence'] = $evidence;
        }

        $validation = (new PluginPreviewBridgeValidator())->validateResponse($response);
        if (ManifestStatus::ERROR === $validation->status()) {
            throw new RuntimeException('Built Plugin Preview Bridge response failed validation.');
        }

        return $response;
    }

    /**
     * @param array<string, mixed> $evidence
     * @param array<string, mixed> $dryRun
     * @param array<string, mixed> $ownership
     * @return array<string, mixed>
     */
    private function buildApplyGate(array $evidence, array $dryRun, array $ownership): array
    {
        $evidenceStatus = $evidence['status'] ?? RuntimeEvidence::STATUS_NOT_READY;
        $ownershipSummary = is_array($ownership['summary'] ?? null) ? $ownership['summary'] : [];
        $warnings = [];
        $blockingReasons = [];
        $status = ApplyGatePolicy::STATUS_BLOCKED;
        $nextStep = ApplyGatePolicy::STEP_PLUGIN_DRY_RUN;

        if (RuntimeEvidence::STATUS_OK === $evidenceStatus) {
            $status = ApplyGatePolicy::STATUS_READY;
            $nextStep = ApplyGatePolicy::STEP_USER_CONFIRMATION;
        } elseif (RuntimeEvidence::STATUS_WARNING === $evidenceStatus) {
            $status = ApplyGatePolicy::STATUS_WARNING;
            $nextStep = ApplyGatePolicy::STEP_USER_CONFIRMATION;
            $warnings[] = 'Runtime evidence contains warnings that require review.';
        } elseif (RuntimeEvidence::STATUS_ERROR === $evidenceStatus) {
            $status = ApplyGatePolicy::STATUS_ERROR;
            $nextStep = ApplyGatePolicy::STEP_RESOLVE_CONFLICTS;
            $blockingReasons[] = 'Runtime evidence contains blocking errors.';
        } else {
            if (($dryRun['status'] ?? null) === PluginDryRunPlaceholder::STATUS_NOT_RUN || false === ($dryRun['available'] ?? null)) {
                $blockingReasons[] = 'Plugin dry-run has not been executed.';
                $nextStep = ApplyGatePolicy::STEP_PLUGIN_DRY_RUN;
            } elseif (($ownership['status'] ?? null) === OwnershipPlaceholder::STATUS_NOT_CHECKED || false === ($ownership['available'] ?? null)) {
                $blockingReasons[] = 'Ownership check has not been executed.';
                $nextStep = ApplyGatePolicy::STEP_OWNERSHIP_CHECK;
            }
        }

        if ((int) ($ownershipSummary['user_modified'] ?? 0) > 0) {
            $warnings[] = 'Ownership evidence contains user-modified items.';
        }

        return [
            'status' => $status,
            'can_apply' => false,
            'requires_user_confirmation' => true,
            'blocking_reasons' => $blockingReasons,
            'warnings' => $warnings,
            'next_required_step' => $nextStep,
        ];
    }

    /**
     * @param array<string, mixed> $evidence
     * @param array<string, mixed> $applyGate
     */
    private function responseStatus(array $evidence, array $applyGate): string
    {
        if (($applyGate['status'] ?? null) === ApplyGatePolicy::STATUS_ERROR) {
            return ManifestStatus::ERROR;
        }

        if (($applyGate['status'] ?? null) === ApplyGatePolicy::STATUS_WARNING || ($evidence['status'] ?? null) !== RuntimeEvidence::STATUS_OK) {
            return ManifestStatus::WARNING;
        }

        return ManifestStatus::OK;
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function extractObject(array $data, string $key): array
    {
        $value = $data[$key] ?? null;

        if (!is_array($value)) {
            throw new RuntimeException('RuntimeEvidence is missing object: ' . $key);
        }

        return $value;
    }
}

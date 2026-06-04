<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Core-only validator for apply-gate policy examples.
 *
 * This validator checks gate semantics only. It does not run dry-run,
 * ownership, apply, WordPress, Crocoblock, REST, or adapter logic.
 */
final class ApplyGatePolicyValidator
{
    /**
     * @param array<string, mixed> $gate
     * @param array<string, mixed> $context
     */
    public function validate(array $gate, array $context = []): ValidationResult
    {
        $checks = [];

        $status = $gate['status'] ?? null;
        $nextRequiredStep = $gate['next_required_step'] ?? null;

        $this->expectOneOf($checks, 'status', $status, ApplyGatePolicy::statuses(), 'Apply gate status must be blocked, ready, warning, or error.');
        $this->expectSame($checks, 'can_apply', $gate['can_apply'] ?? null, false, 'Core-only apply gate must not allow apply.');
        $this->expectSame($checks, 'requires_user_confirmation', $gate['requires_user_confirmation'] ?? null, true, 'Apply gate must require user confirmation.');
        $this->expectOneOf($checks, 'next_required_step', $nextRequiredStep, ApplyGatePolicy::nextRequiredSteps(), 'Apply gate next_required_step is invalid.');

        if (!is_array($gate['blocking_reasons'] ?? null) || !array_is_list($gate['blocking_reasons'])) {
            $checks[] = $this->error('blocking_reasons', 'Apply gate blocking_reasons must be a list.');
        }

        if (!is_array($gate['warnings'] ?? null) || !array_is_list($gate['warnings'])) {
            $checks[] = $this->error('warnings', 'Apply gate warnings must be a list.');
        }

        $dryRun = is_array($context['plugin_dry_run'] ?? null) ? $context['plugin_dry_run'] : null;
        $ownership = is_array($context['ownership'] ?? null) ? $context['ownership'] : null;
        $dryRunMissing = null === $dryRun || false === ($dryRun['available'] ?? null) || ($dryRun['status'] ?? null) === PluginDryRunPlaceholder::STATUS_NOT_RUN;
        $ownershipMissing = null === $ownership || false === ($ownership['available'] ?? null) || ($ownership['status'] ?? null) === OwnershipPlaceholder::STATUS_NOT_CHECKED;
        $dryRunStatus = is_array($dryRun) ? ($dryRun['status'] ?? null) : null;
        $ownershipStatus = is_array($ownership) ? ($ownership['status'] ?? null) : null;
        $ownershipSummary = is_array($ownership['summary'] ?? null) ? $ownership['summary'] : [];

        if ($dryRunMissing) {
            $this->expectSame($checks, 'status', $status, ApplyGatePolicy::STATUS_BLOCKED, 'Apply gate must be blocked when plugin dry-run is missing or not run.');
            $this->expectSame($checks, 'next_required_step', $nextRequiredStep, ApplyGatePolicy::STEP_PLUGIN_DRY_RUN, 'Apply gate next step should be plugin_dry_run when dry-run is missing.');
        } elseif ($ownershipMissing) {
            $this->expectSame($checks, 'status', $status, ApplyGatePolicy::STATUS_BLOCKED, 'Apply gate must be blocked when ownership is missing or not checked.');
            $this->expectSame($checks, 'next_required_step', $nextRequiredStep, ApplyGatePolicy::STEP_OWNERSHIP_CHECK, 'Apply gate next step should be ownership_check when ownership is missing.');
        }

        if (ManifestStatus::ERROR === $dryRunStatus) {
            $this->expectSame($checks, 'status', $status, ApplyGatePolicy::STATUS_ERROR, 'Apply gate status must be error when plugin dry-run has errors.');
            $this->expectSame($checks, 'next_required_step', $nextRequiredStep, ApplyGatePolicy::STEP_RESOLVE_CONFLICTS, 'Apply gate next step should resolve conflicts when dry-run has errors.');
        }

        $hasOwnershipConflict = ManifestStatus::ERROR === $ownershipStatus
            || (int) ($ownershipSummary['conflict'] ?? 0) > 0
            || (int) ($ownershipSummary['locked'] ?? 0) > 0;

        if ($hasOwnershipConflict) {
            if (!in_array($status, [ApplyGatePolicy::STATUS_BLOCKED, ApplyGatePolicy::STATUS_WARNING, ApplyGatePolicy::STATUS_ERROR], true)) {
                $checks[] = $this->error('status', 'Apply gate cannot be ready when ownership has conflicts, locked items, or errors.');
            }

            if (!in_array($nextRequiredStep, [ApplyGatePolicy::STEP_RESOLVE_CONFLICTS, ApplyGatePolicy::STEP_USER_CONFIRMATION], true)) {
                $checks[] = $this->error('next_required_step', 'Apply gate next step should resolve conflicts or request user confirmation for ownership conflicts.');
            }
        }

        $hasUserModified = (int) ($ownershipSummary['user_modified'] ?? 0) > 0;
        if ($hasUserModified && ApplyGatePolicy::STATUS_READY === $status) {
            $checks[] = $this->error('status', 'Apply gate cannot be ready when ownership contains user-modified items.');
        }

        if (ApplyGatePolicy::STATUS_READY === $status) {
            if ($dryRunMissing || $ownershipMissing) {
                $checks[] = $this->error('status', 'Apply gate cannot be ready without completed plugin dry-run and ownership evidence.');
            }

            if (ManifestStatus::OK !== $dryRunStatus || ManifestStatus::OK !== $ownershipStatus) {
                $checks[] = $this->error('status', 'Apply gate ready requires ok dry-run and ok ownership status.');
            }

            $this->expectSame($checks, 'requires_user_confirmation', $gate['requires_user_confirmation'] ?? null, true, 'Apply gate ready means ready for user confirmation, not immediate apply.');
            $this->expectSame($checks, 'next_required_step', $nextRequiredStep, ApplyGatePolicy::STEP_USER_CONFIRMATION, 'Apply gate ready should require user confirmation next.');
        }

        if (ApplyGatePolicy::STATUS_BLOCKED === $status && false !== ($gate['can_apply'] ?? null)) {
            $checks[] = $this->error('can_apply', 'Blocked apply gate cannot allow apply.');
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('apply_gate', 'Apply gate policy contract shape is valid.');
        }

        return new ValidationResult($checks);
    }

    /**
     * @param array<int, ValidationCheck> $checks
     * @param mixed $actual
     * @param mixed $expected
     */
    private function expectSame(array &$checks, string $scope, $actual, $expected, string $message): void
    {
        if ($actual !== $expected) {
            $checks[] = $this->error($scope, $message);
        }
    }

    /**
     * @param array<int, ValidationCheck> $checks
     * @param mixed $actual
     * @param array<int, string> $allowed
     */
    private function expectOneOf(array &$checks, string $scope, $actual, array $allowed, string $message): void
    {
        if (!is_string($actual) || !in_array($actual, $allowed, true)) {
            $checks[] = $this->error($scope, $message);
        }
    }

    private function ok(string $scope, string $message): ValidationCheck
    {
        return new ValidationCheck(ManifestStatus::OK, $scope, $message);
    }

    private function error(string $scope, string $message): ValidationCheck
    {
        return new ValidationCheck(ManifestStatus::ERROR, $scope, $message);
    }

    /**
     * @param array<int, ValidationCheck> $checks
     */
    private function hasErrors(array $checks): bool
    {
        foreach ($checks as $check) {
            if ($check->status() === ManifestStatus::ERROR) {
                return true;
            }
        }

        return false;
    }
}

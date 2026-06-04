<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Core-only validator for RuntimeEvidence examples.
 *
 * This validator checks evidence shape and consistency only. It does not call
 * WordPress, Crocoblock runtime APIs, plugin adapters, or mutation paths.
 */
final class RuntimeEvidenceValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];

        $status = $data['status'] ?? null;
        $complete = $data['complete'] ?? null;
        $dryRun = is_array($data['plugin_dry_run'] ?? null) ? $data['plugin_dry_run'] : null;
        $ownership = is_array($data['ownership'] ?? null) ? $data['ownership'] : null;
        $summary = is_array($data['summary'] ?? null) ? $data['summary'] : null;

        $this->expectSame($checks, 'version', $data['version'] ?? null, 1, 'RuntimeEvidence version must be 1.');
        $this->expectSame($checks, 'mode', $data['mode'] ?? null, RuntimeEvidence::MODE_READ_ONLY, 'RuntimeEvidence mode must be read_only.');
        $this->expectSame($checks, 'source', $data['source'] ?? null, RuntimeEvidence::SOURCE_PLUGIN_RUNTIME, 'RuntimeEvidence source must be plugin_runtime.');
        $this->expectOneOf($checks, 'status', $status, RuntimeEvidence::statuses(), 'RuntimeEvidence status must be not_ready, ok, warning, or error.');
        $this->expectBool($checks, 'complete', $complete, 'RuntimeEvidence complete must be boolean.');
        $this->expectSame($checks, 'applied', $data['applied'] ?? null, false, 'RuntimeEvidence must not be marked applied.');
        $this->expectSame($checks, 'runtime_mutation', $data['runtime_mutation'] ?? null, false, 'RuntimeEvidence must not report runtime mutation.');

        if (!is_string($data['message'] ?? null) || '' === $data['message']) {
            $checks[] = $this->error('message', 'RuntimeEvidence message must be a non-empty string.');
        }

        if (array_key_exists('can_apply', $data)) {
            $checks[] = $this->error('can_apply', 'RuntimeEvidence must not contain apply permissions.');
        }

        if (null === $dryRun) {
            $checks[] = $this->error('plugin_dry_run', 'RuntimeEvidence must include plugin_dry_run object.');
        }

        if (null === $ownership) {
            $checks[] = $this->error('ownership', 'RuntimeEvidence must include ownership object.');
        }

        if (null === $summary) {
            $checks[] = $this->error('summary', 'RuntimeEvidence must include summary object.');
        } else {
            foreach (['dry_run_available', 'ownership_available', 'runtime_checks_complete'] as $key) {
                if (!is_bool($summary[$key] ?? null)) {
                    $checks[] = $this->error('summary.' . $key, 'RuntimeEvidence summary ' . $key . ' must be boolean.');
                }
            }

            foreach (['blocking_errors', 'warnings'] as $key) {
                if (!is_int($summary[$key] ?? null)) {
                    $checks[] = $this->error('summary.' . $key, 'RuntimeEvidence summary ' . $key . ' must be integer.');
                }
            }
        }

        $dryRunMissing = null === $dryRun || false === ($dryRun['available'] ?? null) || ($dryRun['status'] ?? null) === PluginDryRunPlaceholder::STATUS_NOT_RUN;
        $ownershipMissing = null === $ownership || false === ($ownership['available'] ?? null) || ($ownership['status'] ?? null) === OwnershipPlaceholder::STATUS_NOT_CHECKED;
        $dryRunStatus = is_array($dryRun) ? ($dryRun['status'] ?? null) : null;
        $ownershipStatus = is_array($ownership) ? ($ownership['status'] ?? null) : null;
        $ownershipSummary = is_array($ownership['summary'] ?? null) ? $ownership['summary'] : [];

        if ($dryRunMissing || $ownershipMissing) {
            $this->expectSame($checks, 'status', $status, RuntimeEvidence::STATUS_NOT_READY, 'RuntimeEvidence must be not_ready when dry-run or ownership evidence is missing.');
            $this->expectSame($checks, 'complete', $complete, false, 'Placeholder RuntimeEvidence must be incomplete.');
        }

        if (true === $complete && ($dryRunMissing || $ownershipMissing)) {
            $checks[] = $this->error('complete', 'RuntimeEvidence complete can only be true after dry-run and ownership evidence are available.');
        }

        if (RuntimeEvidence::STATUS_OK === $status) {
            $this->expectSame($checks, 'complete', $complete, true, 'RuntimeEvidence ok requires complete evidence.');
            $this->expectSame($checks, 'plugin_dry_run.status', $dryRunStatus, ManifestStatus::OK, 'RuntimeEvidence ok requires dry-run status ok.');
            $this->expectSame($checks, 'ownership.status', $ownershipStatus, ManifestStatus::OK, 'RuntimeEvidence ok requires ownership status ok.');
        }

        if (RuntimeEvidence::STATUS_WARNING === $status) {
            $this->expectSame($checks, 'complete', $complete, true, 'RuntimeEvidence warning requires complete evidence.');
        }

        if (RuntimeEvidence::STATUS_ERROR === $status) {
            $this->expectSame($checks, 'complete', $complete, true, 'RuntimeEvidence error examples should use complete runtime evidence.');
        }

        if (ManifestStatus::ERROR === $dryRunStatus) {
            $this->expectSame($checks, 'status', $status, RuntimeEvidence::STATUS_ERROR, 'Dry-run error must make RuntimeEvidence status error.');
        }

        $hasOwnershipError = ManifestStatus::ERROR === $ownershipStatus
            || (int) ($ownershipSummary['conflict'] ?? 0) > 0
            || (int) ($ownershipSummary['locked'] ?? 0) > 0
            || (int) ($ownershipSummary['error'] ?? 0) > 0;

        if ($hasOwnershipError && !in_array($status, [RuntimeEvidence::STATUS_WARNING, RuntimeEvidence::STATUS_ERROR], true)) {
            $checks[] = $this->error('status', 'Ownership errors, conflicts, or locked items require warning or error RuntimeEvidence status.');
        }

        if (null !== $summary) {
            $this->expectSame($checks, 'summary.dry_run_available', $summary['dry_run_available'] ?? null, !$dryRunMissing, 'RuntimeEvidence summary dry_run_available must match dry-run availability.');
            $this->expectSame($checks, 'summary.ownership_available', $summary['ownership_available'] ?? null, !$ownershipMissing, 'RuntimeEvidence summary ownership_available must match ownership availability.');
            $this->expectSame($checks, 'summary.runtime_checks_complete', $summary['runtime_checks_complete'] ?? null, true === $complete, 'RuntimeEvidence summary runtime_checks_complete must match complete.');
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('runtime_evidence', 'RuntimeEvidence contract shape is valid.');
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

    /**
     * @param array<int, ValidationCheck> $checks
     * @param mixed $actual
     */
    private function expectBool(array &$checks, string $scope, $actual, string $message): void
    {
        if (!is_bool($actual)) {
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

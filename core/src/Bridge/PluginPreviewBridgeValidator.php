<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Bridge;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Core-only validator for Plugin Preview Bridge input/response contracts.
 *
 * This validator checks read-only contract shape only. It does not call
 * WordPress, Crocoblock runtime APIs, plugin adapters, or bridge endpoints.
 */
final class PluginPreviewBridgeValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validateInput(array $data): ValidationResult
    {
        $checks = [];

        $this->expectSame($checks, 'version', $data['version'] ?? null, 1, 'Bridge input version must be 1.');
        $this->expectSame($checks, 'mode', $data['mode'] ?? null, PluginPreviewBridgeContract::MODE_READ_ONLY, 'Bridge input mode must be read_only.');
        $this->expectSame($checks, 'intent', $data['intent'] ?? null, PluginPreviewBridgeContract::INTENT_PREVIEW_BEFORE_APPLY, 'Bridge input intent must be preview_before_apply.');
        $this->expectSame($checks, 'applied', $data['applied'] ?? null, false, 'Bridge input must not be marked applied.');
        $this->expectSame($checks, 'runtime_mutation', $data['runtime_mutation'] ?? null, false, 'Bridge input must not allow runtime mutation.');
        $this->expectSame($checks, 'source', $data['source'] ?? null, PluginPreviewBridgeContract::SOURCE_CORE_PREVIEW, 'Bridge input source must be core_preview_response.');

        if (!isset($data['core_preview']) || !is_array($data['core_preview'])) {
            $checks[] = $this->error('core_preview', 'Bridge input must include a core_preview object.');
        }

        $runtimeChecks = $data['requested_runtime_checks'] ?? null;
        if (!is_array($runtimeChecks)) {
            $checks[] = $this->error('requested_runtime_checks', 'Bridge input must include requested_runtime_checks object.');
        } else {
            foreach (['plugin_dry_run', 'ownership_check'] as $key) {
                if (!is_bool($runtimeChecks[$key] ?? null)) {
                    $checks[] = $this->error('requested_runtime_checks.' . $key, 'Requested runtime check flags must be booleans.');
                }
            }
        }

        $constraints = $data['constraints'] ?? null;
        if (!is_array($constraints)) {
            $checks[] = $this->error('constraints', 'Bridge input must include constraints object.');
        } else {
            $this->expectSame($checks, 'constraints.allow_apply', $constraints['allow_apply'] ?? null, false, 'Bridge input constraints must not allow apply.');
            $this->expectSame($checks, 'constraints.allow_mutation', $constraints['allow_mutation'] ?? null, false, 'Bridge input constraints must not allow mutation.');
            $this->expectSame($checks, 'constraints.require_user_confirmation', $constraints['require_user_confirmation'] ?? null, true, 'Bridge input must require user confirmation.');
            $this->expectSame($checks, 'constraints.respect_ownership', $constraints['respect_ownership'] ?? null, true, 'Bridge input must respect ownership.');
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('plugin_preview_bridge_input', 'Plugin Preview Bridge input contract shape is valid.');
        }

        return new ValidationResult($checks);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function validateResponse(array $data): ValidationResult
    {
        $checks = [];

        $this->expectSame($checks, 'version', $data['version'] ?? null, 1, 'Bridge response version must be 1.');
        $this->expectSame($checks, 'mode', $data['mode'] ?? null, PluginPreviewBridgeContract::MODE_READ_ONLY, 'Bridge response mode must be read_only.');
        $this->expectOneOf($checks, 'status', $data['status'] ?? null, [ManifestStatus::OK, ManifestStatus::WARNING, ManifestStatus::ERROR], 'Bridge response status must be ok, warning, or error.');
        $this->expectSame($checks, 'applied', $data['applied'] ?? null, false, 'Bridge response must not be marked applied.');
        $this->expectSame($checks, 'runtime_mutation', $data['runtime_mutation'] ?? null, false, 'Bridge response must not report runtime mutation.');

        $core = $data['core'] ?? null;
        if (!is_array($core) || !is_array($core['preview'] ?? null)) {
            $checks[] = $this->error('core.preview', 'Bridge response must include core.preview object.');
        }

        $pluginDryRun = $data['plugin']['dry_run'] ?? null;
        if (!is_array($pluginDryRun)) {
            $checks[] = $this->error('plugin.dry_run', 'Bridge response must include plugin.dry_run object.');
        }

        $ownership = $data['ownership'] ?? null;
        if (!is_array($ownership)) {
            $checks[] = $this->error('ownership', 'Bridge response must include ownership object.');
        }

        $applyGate = $data['apply_gate'] ?? null;
        if (!is_array($applyGate)) {
            $checks[] = $this->error('apply_gate', 'Bridge response must include apply_gate object.');
            return new ValidationResult($checks);
        }

        $this->expectOneOf($checks, 'apply_gate.status', $applyGate['status'] ?? null, ['blocked', 'ready', 'warning', 'error'], 'Apply gate status must be blocked, ready, warning, or error.');
        $this->expectSame($checks, 'apply_gate.can_apply', $applyGate['can_apply'] ?? null, false, 'Core-only bridge response must not allow apply.');
        $this->expectSame($checks, 'apply_gate.requires_user_confirmation', $applyGate['requires_user_confirmation'] ?? null, true, 'Apply gate must require user confirmation.');

        if (!is_array($applyGate['blocking_reasons'] ?? null) || !$this->isList($applyGate['blocking_reasons'])) {
            $checks[] = $this->error('apply_gate.blocking_reasons', 'Apply gate blocking_reasons must be a list.');
        }

        if (!is_array($applyGate['warnings'] ?? null) || !$this->isList($applyGate['warnings'])) {
            $checks[] = $this->error('apply_gate.warnings', 'Apply gate warnings must be a list.');
        }

        if (!is_string($applyGate['next_required_step'] ?? null) || '' === $applyGate['next_required_step']) {
            $checks[] = $this->error('apply_gate.next_required_step', 'Apply gate next_required_step must be a non-empty string.');
        }

        $dryRunAvailable = is_array($pluginDryRun) ? ($pluginDryRun['available'] ?? null) : null;
        $ownershipAvailable = is_array($ownership) ? ($ownership['available'] ?? null) : null;
        $canApply = $applyGate['can_apply'] ?? null;

        if ((false === $dryRunAvailable || false === $ownershipAvailable) && false !== $canApply) {
            $checks[] = $this->error('apply_gate.can_apply', 'Apply gate cannot allow apply when dry-run or ownership placeholders are present.');
        }

        if (is_array($pluginDryRun) && ($pluginDryRun['status'] ?? null) === PluginDryRunPlaceholder::STATUS_NOT_RUN) {
            $message = strtolower((string) ($pluginDryRun['message'] ?? ''));
            if ($this->claimsRuntimeCheckExecuted($message)) {
                $checks[] = $this->error('plugin.dry_run.message', 'Dry-run placeholder must not claim runtime dry-run was executed.');
            }
        }

        if (is_array($ownership) && ($ownership['status'] ?? null) === OwnershipPlaceholder::STATUS_NOT_CHECKED) {
            $message = strtolower((string) ($ownership['message'] ?? ''));
            if ($this->claimsRuntimeCheckExecuted($message)) {
                $checks[] = $this->error('ownership.message', 'Ownership placeholder must not claim ownership checks were executed.');
            }
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('plugin_preview_bridge_response', 'Plugin Preview Bridge response contract shape is valid.');
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
     * @param array<mixed> $value
     */
    private function isList(array $value): bool
    {
        return array_is_list($value);
    }

    private function claimsRuntimeCheckExecuted(string $message): bool
    {
        if (str_contains($message, 'not executed') || str_contains($message, 'not run')) {
            return false;
        }

        return str_contains($message, 'completed') || str_contains($message, 'executed');
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

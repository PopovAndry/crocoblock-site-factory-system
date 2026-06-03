<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Draft validator for BlueprintPatch array contracts.
 *
 * This validates shape only. It does not apply operations or inspect a runtime.
 */
final class BlueprintPatchValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];

        if (isset($data['applies_changes']) && true === $data['applies_changes']) {
            $checks[] = $this->error('applies_changes', 'BlueprintPatch must be a proposal only and must not declare direct apply behavior.');
        }

        $operations = $data['operations'] ?? null;

        if (!is_array($operations)) {
            $checks[] = $this->error('operations', 'BlueprintPatch must include an operations array.');
            return new ValidationResult($checks);
        }

        $checks[] = $this->ok('operations', 'BlueprintPatch operations array exists.');

        foreach ($operations as $index => $operation) {
            $scope = sprintf('operations.%s', (string) $index);

            if (!is_array($operation)) {
                $checks[] = $this->error($scope, 'BlueprintPatch operation must be an object.');
                continue;
            }

            $op = $operation['op'] ?? null;
            $path = $operation['path'] ?? null;

            if (is_string($op) && in_array($op, ['direct_apply', 'wordpress_mutation', 'php_code', 'callback', 'delete', 'remove'], true)) {
                $checks[] = $this->error($scope, 'BlueprintPatch operation op is unsafe for Core v1: ' . $op . '.');
            } elseif (!is_string($op) || !in_array($op, ['set', 'add', 'replace'], true)) {
                $checks[] = $this->error($scope, 'BlueprintPatch operation op must be set, add, or replace.');
            }

            if (!is_string($path) || '' === trim($path) || '/' !== substr($path, 0, 1)) {
                $checks[] = $this->error($scope, 'BlueprintPatch operation path must be a JSON-pointer-like string.');
            }

            if (!array_key_exists('value', $operation)) {
                $checks[] = $this->error($scope, 'BlueprintPatch set/add/replace operations must include value.');
            }

            foreach (['direct_apply', 'wordpress_mutation', 'php_code', 'callback'] as $unsafeKey) {
                if (!empty($operation[$unsafeKey])) {
                    $checks[] = $this->error($scope . '.' . $unsafeKey, 'BlueprintPatch operation must not declare ' . $unsafeKey . '.');
                }
            }
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('blueprint_patch', 'BlueprintPatch contract shape is valid.');
        }

        return new ValidationResult($checks);
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

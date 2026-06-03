<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Validation;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;

/**
 * Draft validator for ValidationResult array contracts.
 */
final class ValidationResultValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];
        $status = $data['status'] ?? null;
        $resultChecks = $data['checks'] ?? null;

        if (isset($status) && (!is_string($status) || !ManifestStatus::isKnown($status))) {
            $checks[] = $this->error('status', 'ValidationResult status must be ok, warning, or error.');
        }

        if (!is_array($resultChecks)) {
            $checks[] = $this->error('checks', 'ValidationResult must include a checks array.');
            return new ValidationResult($checks);
        }

        $checks[] = $this->ok('checks', 'ValidationResult checks array exists.');

        foreach ($resultChecks as $index => $check) {
            $scope = sprintf('checks.%s', (string) $index);

            if (!is_array($check)) {
                $checks[] = $this->error($scope, 'Validation check must be an object.');
                continue;
            }

            $checkStatus = $check['status'] ?? null;

            if (!is_string($checkStatus) || !ManifestStatus::isKnown($checkStatus)) {
                $checks[] = $this->error($scope . '.status', 'Validation check status must be ok, warning, or error.');
            }

            if (isset($check['scope']) && !is_string($check['scope'])) {
                $checks[] = $this->error($scope . '.scope', 'Validation check scope must be a string when present.');
            }

            if (!isset($check['message']) || !is_string($check['message'])) {
                $checks[] = $this->error($scope . '.message', 'Validation check message must be a string.');
            }

            if (isset($check['context']) && !is_array($check['context'])) {
                $checks[] = $this->error($scope . '.context', 'Validation check context must be an object when present.');
            }
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('validation_result', 'ValidationResult contract shape is valid.');
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

<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Manifest;

use Crocoblock\SiteFactory\Core\Planning\PlanValidator;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;
use Crocoblock\SiteFactory\Core\Validation\ValidationResultValidator;

/**
 * Draft validator for RunManifest array contracts.
 */
final class RunManifestValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];

        foreach (['id', 'timestamp', 'status'] as $key) {
            if (!isset($data[$key]) || !is_string($data[$key]) || '' === trim($data[$key])) {
                $checks[] = $this->error($key, 'RunManifest ' . $key . ' must be a non-empty string.');
            }
        }

        if (isset($data['status']) && is_string($data['status']) && !ManifestStatus::isKnown($data['status'])) {
            $checks[] = $this->error('status', 'RunManifest status must be ok, warning, or error.');
        }

        if (!isset($data['blueprint']) || !is_array($data['blueprint'])) {
            $checks[] = $this->error('blueprint', 'RunManifest must include a blueprint object.');
        } else {
            $checks[] = $this->ok('blueprint', 'RunManifest blueprint object exists.');
        }

        if (!isset($data['plan']) || !is_array($data['plan'])) {
            $checks[] = $this->error('plan', 'RunManifest must include a plan object.');
        } else {
            $checks = array_merge($checks, $this->prefixChecks('plan', (new PlanValidator())->validate($data['plan'])->checks()));
        }

        if (!isset($data['validation']) || !is_array($data['validation'])) {
            $checks[] = $this->error('validation', 'RunManifest must include a validation object.');
        } else {
            $checks = array_merge($checks, $this->prefixChecks('validation', (new ValidationResultValidator())->validate($data['validation'])->checks()));
        }

        if (isset($data['context']) && !is_array($data['context'])) {
            $checks[] = $this->error('context', 'RunManifest context must be an object when present.');
        }

        if (isset($data['execution']) && !is_array($data['execution'])) {
            $checks[] = $this->error('execution', 'RunManifest execution must be an object when present.');
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('run_manifest', 'RunManifest contract shape is valid.');
        }

        return new ValidationResult($checks);
    }

    /**
     * @param array<int, ValidationCheck> $checks
     * @return array<int, ValidationCheck>
     */
    private function prefixChecks(string $prefix, array $checks): array
    {
        return array_map(
            static function (ValidationCheck $check) use ($prefix): ValidationCheck {
                return new ValidationCheck(
                    $check->status(),
                    $prefix . '.' . $check->scope(),
                    $check->message(),
                    $check->context()
                );
            },
            $checks
        );
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

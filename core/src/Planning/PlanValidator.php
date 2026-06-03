<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Draft validator for Plan array contracts.
 */
final class PlanValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];
        $items = $data['items'] ?? null;
        $summary = $data['summary'] ?? null;

        if (!is_array($items)) {
            $checks[] = $this->error('items', 'Plan must include an items array.');
            return new ValidationResult($checks);
        }

        $checks[] = $this->ok('items', 'Plan items array exists.');

        if (!is_array($summary)) {
            $checks[] = $this->error('summary', 'Plan must include a summary object.');
        } else {
            foreach (['create', 'update', 'delete', 'skip', 'warning', 'error'] as $key) {
                if (isset($summary[$key]) && !is_int($summary[$key])) {
                    $checks[] = $this->error('summary.' . $key, 'Plan summary counts must be integers.');
                }
            }
        }

        foreach ($items as $index => $item) {
            $scope = sprintf('items.%s', (string) $index);

            if (!is_array($item)) {
                $checks[] = $this->error($scope, 'Plan item must be an object.');
                continue;
            }

            $action = $item['action'] ?? null;

            if (!is_string($action) || !in_array($action, ['create', 'update', 'delete', 'skip', 'warning', 'error'], true)) {
                $checks[] = $this->error($scope, 'Plan item action must be create, update, delete, skip, warning, or error.');
            }

            foreach (['adapter', 'entity', 'message'] as $key) {
                if (isset($item[$key]) && !is_string($item[$key])) {
                    $checks[] = $this->error($scope . '.' . $key, 'Plan item ' . $key . ' must be a string when present.');
                }
            }

            if (isset($item['diff']) && !is_array($item['diff'])) {
                $checks[] = $this->error($scope . '.diff', 'Plan item diff must be an object when present.');
            }
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('plan', 'Plan contract shape is valid.');
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

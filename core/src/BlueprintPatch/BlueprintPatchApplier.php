<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\BlueprintPatch;

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Planning\Plan;
use Crocoblock\SiteFactory\Core\Planning\PlanItem;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Applies a validated BlueprintPatch to a Blueprint array in memory only.
 */
final class BlueprintPatchApplier
{
    private BlueprintValidator $blueprintValidator;
    private BlueprintPatchValidator $patchValidator;

    public function __construct(?BlueprintValidator $blueprintValidator = null, ?BlueprintPatchValidator $patchValidator = null)
    {
        $this->blueprintValidator = $blueprintValidator ?? new BlueprintValidator();
        $this->patchValidator = $patchValidator ?? new BlueprintPatchValidator();
    }

    /**
     * @param array<string, mixed> $blueprint
     * @param array<string, mixed> $patch
     */
    public function apply(array $blueprint, array $patch): BlueprintPatchApplyResult
    {
        $blueprintValidation = $this->blueprintValidator->validate($blueprint);
        $patchValidation = $this->patchValidator->validate($patch);

        if ($blueprintValidation->status() === ManifestStatus::ERROR || $patchValidation->status() === ManifestStatus::ERROR) {
            $checks = array_merge($blueprintValidation->checks(), $patchValidation->checks());

            return new BlueprintPatchApplyResult(
                $blueprint,
                new Plan([
                    new PlanItem('Core BlueprintPatch', PlanItem::ACTION_ERROR, 'blueprint_patch', 'BlueprintPatch could not be applied because validation failed.'),
                ]),
                new ValidationResult($checks)
            );
        }

        $candidate = $this->deepCopy($blueprint);
        $planItems = [];
        $checks = [];

        foreach ($patch['operations'] ?? [] as $index => $operationData) {
            if (!is_array($operationData)) {
                continue;
            }

            $operation = BlueprintPatchOperation::fromArray($operationData);
            $result = $this->applyOperation($candidate, $operation);
            $scope = 'operations.' . (string) $index;

            if (!$result['ok']) {
                $checks[] = new ValidationCheck(ManifestStatus::ERROR, $scope, $result['message']);
                $planItems[] = new PlanItem('Core BlueprintPatch', PlanItem::ACTION_ERROR, $operation->path(), $result['message']);
                continue;
            }

            $checks[] = new ValidationCheck(ManifestStatus::OK, $scope, $result['message']);
            $planItems[] = new PlanItem(
                'Core BlueprintPatch',
                $operation->op() === BlueprintPatchOperation::OP_ADD ? PlanItem::ACTION_CREATE : PlanItem::ACTION_UPDATE,
                $operation->path(),
                $result['message'],
                [
                    'op' => $operation->op(),
                    'path' => $operation->path(),
                ]
            );
        }

        $candidateValidation = $this->blueprintValidator->validate($candidate);
        $checks = array_merge($checks, $candidateValidation->checks());

        return new BlueprintPatchApplyResult(
            $candidate,
            new Plan($planItems),
            new ValidationResult($checks)
        );
    }

    /**
     * @param array<string, mixed> $blueprint
     * @return array<string, mixed>
     */
    private function deepCopy(array $blueprint): array
    {
        $encoded = json_encode($blueprint);

        if (!is_string($encoded)) {
            return $blueprint;
        }

        $decoded = json_decode($encoded, true);

        return is_array($decoded) ? $decoded : $blueprint;
    }

    /**
     * @param array<string, mixed> $candidate
     * @return array{ok: bool, message: string}
     */
    private function applyOperation(array &$candidate, BlueprintPatchOperation $operation): array
    {
        $segments = $this->pathSegments($operation->path());

        if ($segments === []) {
            return [
                'ok' => false,
                'message' => 'BlueprintPatch path must target a field inside the blueprint document.',
            ];
        }

        $target =& $candidate;
        $last = array_pop($segments);

        foreach ($segments as $segment) {
            if (!is_array($target) || !array_key_exists($segment, $target)) {
                return [
                    'ok' => false,
                    'message' => 'BlueprintPatch path does not exist: ' . $operation->path() . '.',
                ];
            }

            $target =& $target[$segment];
        }

        if (!is_array($target)) {
            return [
                'ok' => false,
                'message' => 'BlueprintPatch target parent is not an array: ' . $operation->path() . '.',
            ];
        }

        if ($operation->op() === BlueprintPatchOperation::OP_REPLACE && !array_key_exists((string) $last, $target)) {
            return [
                'ok' => false,
                'message' => 'BlueprintPatch replace path does not exist: ' . $operation->path() . '.',
            ];
        }

        if ($operation->op() === BlueprintPatchOperation::OP_ADD) {
            if ((string) $last === '-') {
                $target[] = $operation->value();
            } elseif ($this->isList($target) && ctype_digit((string) $last)) {
                array_splice($target, (int) $last, 0, [$operation->value()]);
            } else {
                $target[(string) $last] = $operation->value();
            }
        } else {
            $target[(string) $last] = $operation->value();
        }

        return [
            'ok' => true,
            'message' => sprintf('BlueprintPatch %s applied in memory: %s.', $operation->op(), $operation->path()),
        ];
    }

    /**
     * @return array<int, string>
     */
    private function pathSegments(string $path): array
    {
        if ('' === trim($path) || '/' !== substr($path, 0, 1)) {
            return [];
        }

        $parts = explode('/', substr($path, 1));

        return array_map(
            static function (string $part): string {
                return str_replace(['~1', '~0'], ['/', '~'], rawurldecode($part));
            },
            $parts
        );
    }

    /**
     * @param array<mixed> $value
     */
    private function isList(array $value): bool
    {
        return [] === $value || array_keys($value) === range(0, count($value) - 1);
    }
}

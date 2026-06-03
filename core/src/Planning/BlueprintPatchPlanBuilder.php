<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchApplyResult;
use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchOperation;

/**
 * Builds a product-facing preview Plan from an in-memory BlueprintPatch result.
 */
final class BlueprintPatchPlanBuilder
{
    private PreviewPlanFormatter $formatter;

    public function __construct(?PreviewPlanFormatter $formatter = null)
    {
        $this->formatter = $formatter ?? new PreviewPlanFormatter();
    }

    /**
     * @param array<string, mixed> $originalBlueprint
     * @param array<string, mixed> $candidateBlueprint
     * @param array<int, array<string, mixed>> $operations
     */
    public function build(array $originalBlueprint, array $candidateBlueprint, array $operations): Plan
    {
        $items = [];

        foreach ($operations as $index => $operationData) {
            if (!is_array($operationData)) {
                $items[] = new PlanItem(
                    'Core BlueprintPatch Preview',
                    PlanItem::ACTION_ERROR,
                    'operations.' . (string) $index,
                    'Patch operation is not readable.'
                );
                continue;
            }

            $operation = BlueprintPatchOperation::fromArray($operationData);
            $items[] = $this->buildItem($originalBlueprint, $candidateBlueprint, $operation);
        }

        return new Plan(
            $items,
            null,
            [
                'source' => 'blueprint_patch_preview',
                'runtime_apply' => false,
            ]
        );
    }

    /**
     * @param array<string, mixed> $originalBlueprint
     * @param array<int, array<string, mixed>> $operations
     */
    public function buildFromApplyResult(array $originalBlueprint, array $operations, BlueprintPatchApplyResult $result): Plan
    {
        return $this->build($originalBlueprint, $result->candidateBlueprint(), $operations);
    }

    /**
     * @param array<string, mixed> $originalBlueprint
     * @param array<string, mixed> $candidateBlueprint
     */
    private function buildItem(array $originalBlueprint, array $candidateBlueprint, BlueprintPatchOperation $operation): PlanItem
    {
        $path = $operation->path();
        $label = $this->formatter->labelForPath($path);
        $beforeExists = $this->readPath($originalBlueprint, $path, $before);
        $afterExists = $this->readPath($candidateBlueprint, $path, $after);

        if (!$afterExists) {
            return new PlanItem(
                'Core BlueprintPatch Preview',
                PlanItem::ACTION_ERROR,
                $path,
                sprintf('Preview could not read candidate value for %s.', $label)
            );
        }

        $beforeText = $this->formatter->valueToText($beforeExists ? $before : null);
        $afterText = $this->formatter->valueToText($after);
        $action = $operation->op() === BlueprintPatchOperation::OP_ADD || !$beforeExists
            ? PlanItem::ACTION_CREATE
            : PlanItem::ACTION_UPDATE;

        $message = $action === PlanItem::ACTION_CREATE
            ? $this->formatter->createMessage($label, $afterText)
            : $this->formatter->updateMessage($label, $beforeText, $afterText);

        return new PlanItem(
            'Core BlueprintPatch Preview',
            $action,
            $path,
            $message,
            [
                'path' => $path,
                'label' => $label,
                'before' => $beforeExists ? $before : null,
                'after' => $after,
                'op' => $operation->op(),
            ]
        );
    }

    /**
     * @param array<string, mixed> $document
     * @param mixed $value
     */
    private function readPath(array $document, string $path, &$value): bool
    {
        $segments = $this->pathSegments($path);

        if ($segments === []) {
            return false;
        }

        $current = $document;

        foreach ($segments as $segment) {
            if (!is_array($current) || !array_key_exists($segment, $current)) {
                return false;
            }

            $current = $current[$segment];
        }

        $value = $current;
        return true;
    }

    /**
     * @return array<int, string>
     */
    private function pathSegments(string $path): array
    {
        if ('' === trim($path) || '/' !== substr($path, 0, 1) || '/' === $path) {
            return [];
        }

        return array_map(
            static function (string $part): string {
                return str_replace(['~1', '~0'], ['/', '~'], rawurldecode($part));
            },
            explode('/', substr($path, 1))
        );
    }
}

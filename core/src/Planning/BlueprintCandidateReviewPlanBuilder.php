<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * Builds a read-only review plan from a normalized BlueprintCandidate.
 *
 * This compares desired-state blueprint arrays only. It does not call
 * WordPress, plugin adapters, filesystem APIs, or AI providers.
 */
final class BlueprintCandidateReviewPlanBuilder
{
    private const ADAPTER = 'Core BlueprintCandidate Review';

    /** @var array<string, string> */
    private const SECTION_LABELS = [
        '/site/style' => 'Site style tokens',
        '/design' => 'Design context',
        '/image_context' => 'Image context',
        '/pages' => 'Pages',
        '/cpt' => 'CPT definitions',
        '/taxonomies' => 'Taxonomies',
        '/terms' => 'Terms',
        '/content' => 'Content',
        '/queries' => 'Query definitions',
        '/filters' => 'Filter definitions',
        '/forms' => 'Form definitions',
        '/listings' => 'Listing definitions',
        '/render' => 'Render settings',
        '/single' => 'Single templates',
        '/assets' => 'Assets',
    ];

    /** @var array<int, string> */
    private const KNOWN_ROOTS = [
        'version',
        'site',
        'theme',
        'plugins',
        'pages',
        'cpt',
        'taxonomies',
        'terms',
        'content',
        'queries',
        'filters',
        'forms',
        'listings',
        'render',
        'single',
        'design',
        'style',
        'image_context',
        'assets',
    ];

    /**
     * @param array<string, mixed> $baseline
     * @param array<string, mixed> $candidate
     */
    public function build(array $baseline, array $candidate): Plan
    {
        $items = [];
        $this->appendScalarItem($items, $baseline, $candidate, '/site/name', 'Site name');

        foreach (self::SECTION_LABELS as $path => $label) {
            $this->appendSectionItem($items, $baseline, $candidate, $path, $label);
        }

        foreach ($candidate as $section => $value) {
            if (!is_string($section) || in_array($section, self::KNOWN_ROOTS, true)) {
                continue;
            }

            $items[] = new PlanItem(
                self::ADAPTER,
                PlanItem::ACTION_WARNING,
                '/' . $section,
                'Unknown candidate section preserved: ' . $section . '.',
                [
                    'path' => '/' . $section,
                    'label' => 'Unknown candidate section',
                    'after' => $value,
                    'type' => 'unknown_section',
                ]
            );
        }

        if ([] === $items) {
            $items[] = new PlanItem(
                self::ADAPTER,
                PlanItem::ACTION_SKIP,
                'blueprint_candidate',
                'Candidate blueprint does not change tracked Core review sections.'
            );
        }

        return new Plan(
            $items,
            null,
            [
                'source' => 'blueprint_candidate_review',
                'runtime_apply' => false,
                'plugin_dry_run' => false,
            ]
        );
    }

    /**
     * @param array<int, PlanItem> $items
     * @param array<string, mixed> $baseline
     * @param array<string, mixed> $candidate
     */
    private function appendScalarItem(array &$items, array $baseline, array $candidate, string $path, string $label): void
    {
        $beforeExists = $this->readPath($baseline, $path, $before);
        $afterExists = $this->readPath($candidate, $path, $after);

        if (!$afterExists || ($beforeExists && $before === $after)) {
            return;
        }

        $action = $beforeExists ? PlanItem::ACTION_UPDATE : PlanItem::ACTION_CREATE;
        $message = $beforeExists
            ? sprintf('%s changed from "%s" to "%s".', $label, $this->valueToText($before), $this->valueToText($after))
            : sprintf('%s added as "%s".', $label, $this->valueToText($after));

        $items[] = new PlanItem(
            self::ADAPTER,
            $action,
            $path,
            $message,
            [
                'path' => $path,
                'label' => $label,
                'before' => $beforeExists ? $before : null,
                'after' => $after,
                'type' => 'scalar',
            ]
        );
    }

    /**
     * @param array<int, PlanItem> $items
     * @param array<string, mixed> $baseline
     * @param array<string, mixed> $candidate
     */
    private function appendSectionItem(array &$items, array $baseline, array $candidate, string $path, string $label): void
    {
        $beforeExists = $this->readPath($baseline, $path, $before);
        $afterExists = $this->readPath($candidate, $path, $after);

        if (!$beforeExists && !$afterExists) {
            return;
        }

        if ($beforeExists && $afterExists && $before === $after) {
            return;
        }

        $action = $beforeExists && $afterExists
            ? PlanItem::ACTION_UPDATE
            : ($afterExists ? PlanItem::ACTION_CREATE : PlanItem::ACTION_DELETE);

        $message = $this->sectionMessage($label, $action, $beforeExists ? $before : null, $afterExists ? $after : null);

        $items[] = new PlanItem(
            self::ADAPTER,
            $action,
            $path,
            $message,
            [
                'path' => $path,
                'label' => $label,
                'before' => $beforeExists ? $this->summarize($before) : null,
                'after' => $afterExists ? $this->summarize($after) : null,
                'type' => 'section_summary',
            ]
        );
    }

    /**
     * @param mixed $before
     * @param mixed $after
     */
    private function sectionMessage(string $label, string $action, $before, $after): string
    {
        if (PlanItem::ACTION_CREATE === $action) {
            return sprintf('%s added: %s.', $label, $this->summarize($after));
        }

        if (PlanItem::ACTION_DELETE === $action) {
            return sprintf('%s removed from candidate.', $label);
        }

        return sprintf('%s changed: %s -> %s.', $label, $this->summarize($before), $this->summarize($after));
    }

    /**
     * @param mixed $value
     */
    private function summarize($value): string
    {
        if (is_string($value) || is_int($value) || is_float($value) || is_bool($value) || null === $value) {
            return $this->valueToText($value);
        }

        if (!is_array($value)) {
            return 'value';
        }

        if ($this->isList($value)) {
            $ids = [];

            foreach ($value as $item) {
                if (is_array($item)) {
                    $id = $item['slug'] ?? $item['key'] ?? $item['title'] ?? null;

                    if (is_string($id) && '' !== $id) {
                        $ids[] = $id;
                    }
                }
            }

            return sprintf('%d item%s%s', count($value), 1 === count($value) ? '' : 's', $ids ? ' [' . implode(', ', array_slice($ids, 0, 5)) . ']' : '');
        }

        $keys = array_slice(array_map('strval', array_keys($value)), 0, 8);

        return sprintf('%d key%s%s', count($value), 1 === count($value) ? '' : 's', $keys ? ' [' . implode(', ', $keys) . ']' : '');
    }

    /**
     * @param mixed $value
     */
    private function valueToText($value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (null === $value) {
            return 'not set';
        }

        if (is_string($value) || is_int($value) || is_float($value)) {
            return (string) $value;
        }

        return $this->summarize($value);
    }

    /**
     * @param array<string, mixed> $document
     * @param mixed $value
     */
    private function readPath(array $document, string $path, &$value): bool
    {
        $current = $document;

        foreach ($this->pathSegments($path) as $segment) {
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

    /** @param mixed $value */
    private function isList($value): bool
    {
        if (!is_array($value)) {
            return false;
        }

        return [] === $value || array_keys($value) === range(0, count($value) - 1);
    }
}

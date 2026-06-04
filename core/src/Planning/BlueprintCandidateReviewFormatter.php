<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Planning;

/**
 * Groups a BlueprintCandidate review Plan into product-facing sections.
 *
 * This is a Core-only presentation formatter. It does not call WordPress,
 * plugin adapters, AI providers, filesystem APIs, or runtime dry-runs.
 */
final class BlueprintCandidateReviewFormatter
{
    /** @var array<string, array<string, string>> */
    private const SECTION_DEFINITIONS = [
        'identity' => [
            'title' => 'Identity & Business',
            'description' => 'Site identity and business information changes.',
        ],
        'design' => [
            'title' => 'Design & Style',
            'description' => 'Visual profile, style tokens, image context, and component choices.',
        ],
        'structure' => [
            'title' => 'Site Structure',
            'description' => 'Pages, CPTs, taxonomies, templates, and render structure.',
        ],
        'dynamic_features' => [
            'title' => 'Dynamic Features',
            'description' => 'Queries, filters, forms, listings, and Crocoblock-driven features.',
        ],
        'content' => [
            'title' => 'Content & Assets',
            'description' => 'Demo content, media, and asset declarations.',
        ],
        'safety' => [
            'title' => 'Safety & Warnings',
            'description' => 'Warnings, unknown sections, and review requirements.',
        ],
        'advanced' => [
            'title' => 'Advanced',
            'description' => 'Technical review items that do not fit product-facing groups.',
        ],
    ];

    /** @var array<string, string> */
    private const PATH_GROUPS = [
        '/site/name' => 'identity',
        '/site/language' => 'identity',
        '/site/permalink' => 'identity',
        '/design' => 'design',
        '/style' => 'design',
        '/site/style' => 'design',
        '/image_context' => 'design',
        '/pages' => 'structure',
        '/cpt' => 'structure',
        '/taxonomies' => 'structure',
        '/terms' => 'structure',
        '/render' => 'structure',
        '/single' => 'structure',
        '/queries' => 'dynamic_features',
        '/filters' => 'dynamic_features',
        '/forms' => 'dynamic_features',
        '/listings' => 'dynamic_features',
        '/content' => 'content',
        '/assets' => 'content',
    ];

    /**
     * @param Plan|array<string, mixed> $plan
     * @return array<string, mixed>
     */
    public function format($plan): array
    {
        $planArray = $plan instanceof Plan ? $plan->toArray() : $plan;
        $summary = $this->normalizeSummary($planArray['summary'] ?? []);
        $sections = $this->emptySections();

        foreach (($planArray['items'] ?? []) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $formatted = $this->formatItem($item);
            $sectionKey = $this->sectionKeyForItem($formatted);
            $sections[$sectionKey]['items'][] = $formatted;
        }

        return [
            'version' => 1,
            'status' => $this->statusFromSummary($summary),
            'title' => 'Candidate review',
            'summary' => $summary,
            'sections' => array_values($sections),
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function emptySections(): array
    {
        $sections = [];

        foreach (self::SECTION_DEFINITIONS as $key => $definition) {
            $sections[$key] = [
                'key' => $key,
                'title' => $definition['title'],
                'description' => $definition['description'],
                'items' => [],
            ];
        }

        return $sections;
    }

    /**
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private function formatItem(array $item): array
    {
        $diff = isset($item['diff']) && is_array($item['diff']) ? $item['diff'] : [];
        $action = is_string($item['action'] ?? null) ? $item['action'] : 'warning';
        $path = is_string($diff['path'] ?? null) ? $diff['path'] : (is_string($item['entity'] ?? null) ? $item['entity'] : '');

        return [
            'action' => $action,
            'severity' => $this->severityForAction($action),
            'type' => is_string($diff['type'] ?? null) ? $diff['type'] : 'plan_item',
            'entity' => is_string($item['entity'] ?? null) ? $item['entity'] : $path,
            'message' => is_string($item['message'] ?? null) ? $item['message'] : 'Review item requires attention.',
            'path' => $path,
            'before' => $diff['before'] ?? null,
            'after' => $diff['after'] ?? null,
        ];
    }

    /**
     * @param array<string, mixed> $item
     */
    private function sectionKeyForItem(array $item): string
    {
        $action = is_string($item['action'] ?? null) ? $item['action'] : '';
        $type = is_string($item['type'] ?? null) ? $item['type'] : '';
        $path = is_string($item['path'] ?? null) ? $item['path'] : '';

        if (PlanItem::ACTION_WARNING === $action || PlanItem::ACTION_ERROR === $action || 'unknown_section' === $type) {
            return 'safety';
        }

        foreach (self::PATH_GROUPS as $prefix => $section) {
            if ($path === $prefix || 0 === strpos($path, $prefix . '/')) {
                return $section;
            }
        }

        return 'advanced';
    }

    private function severityForAction(string $action): string
    {
        if (PlanItem::ACTION_ERROR === $action) {
            return 'error';
        }

        if (PlanItem::ACTION_WARNING === $action) {
            return 'warning';
        }

        return 'info';
    }

    /**
     * @param mixed $summary
     * @return array<string, int>
     */
    private function normalizeSummary($summary): array
    {
        $result = [];

        foreach (['create', 'update', 'delete', 'skip', 'warning', 'error'] as $key) {
            $value = is_array($summary) ? ($summary[$key] ?? 0) : 0;
            $result[$key] = is_int($value) ? $value : 0;
        }

        return $result;
    }

    /**
     * @param array<string, int> $summary
     */
    private function statusFromSummary(array $summary): string
    {
        if (($summary['error'] ?? 0) > 0) {
            return 'error';
        }

        if (($summary['warning'] ?? 0) > 0) {
            return 'warning';
        }

        return 'ok';
    }
}

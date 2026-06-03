<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Blueprint;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

/**
 * Draft validator for BlueprintDocument array contracts.
 *
 * This validates desired-state shape only. It does not inspect WordPress,
 * execute adapters, resolve assets, or enforce Crocoblock plugin availability.
 */
final class BlueprintValidator
{
    /**
     * @param array<string, mixed> $data
     */
    public function validate(array $data): ValidationResult
    {
        $checks = [];

        foreach (BlueprintValidationRules::REQUIRED_ROOT_SECTIONS as $section) {
            if (!array_key_exists($section, $data)) {
                $checks[] = $this->error($section, 'Blueprint is missing required root section: ' . $section . '.');
            }
        }

        foreach ($data as $section => $value) {
            if (!is_string($section)) {
                $checks[] = $this->warning('root', 'Blueprint root section key should be a string.');
                continue;
            }

            if (!BlueprintValidationRules::isKnownRootSection($section)) {
                $checks[] = $this->warning($section, 'Unknown blueprint root section will be preserved but is not validated by Core v1.');
            }
        }

        if (isset($data['version']) && !is_string($data['version']) && !is_numeric($data['version'])) {
            $checks[] = $this->error('version', 'Blueprint version must be a string or number when present.');
        }

        foreach (BlueprintValidationRules::ARRAY_ROOT_SECTIONS as $section) {
            if (isset($data[$section]) && !is_array($data[$section])) {
                $checks[] = $this->error($section, 'Blueprint root section ' . $section . ' must be an object.');
                continue;
            }

            if (isset($data[$section]) && $this->isList($data[$section])) {
                $checks[] = $this->error($section, 'Blueprint root section ' . $section . ' must be an object, not a list.');
            }
        }

        foreach (BlueprintValidationRules::LIST_ROOT_SECTIONS as $section) {
            if (isset($data[$section]) && !$this->isList($data[$section])) {
                $checks[] = $this->error($section, 'Blueprint root section ' . $section . ' must be a list.');
            }
        }

        if (isset($data['site']) && is_array($data['site'])) {
            $checks = array_merge($checks, $this->validateSite($data['site']));
        }

        if (isset($data['plugins']) && is_array($data['plugins'])) {
            $checks = array_merge($checks, $this->validatePlugins($data['plugins']));
        }

        if (isset($data['cpt']) && is_array($data['cpt'])) {
            $checks = array_merge($checks, $this->validateSluggedList($data['cpt'], 'cpt', 'CPT'));
        }

        if (isset($data['taxonomies']) && is_array($data['taxonomies'])) {
            $checks = array_merge($checks, $this->validateSluggedList($data['taxonomies'], 'taxonomies', 'Taxonomy'));
        }

        if (isset($data['listings']) && is_array($data['listings'])) {
            $checks = array_merge($checks, $this->validateSluggedList($data['listings'], 'listings', 'Listing'));
        }

        if (isset($data['pages']) && is_array($data['pages'])) {
            $checks = array_merge($checks, $this->validatePages($data['pages']));
        }

        if (isset($data['queries']) && is_array($data['queries'])) {
            $checks = array_merge($checks, $this->validateQueries($data['queries']));
        }

        if (isset($data['filters']) && is_array($data['filters'])) {
            $checks = array_merge($checks, $this->validateFilters($data['filters']));
        }

        if (isset($data['content']) && is_array($data['content'])) {
            $checks = array_merge($checks, $this->validateContent($data['content']));
        }

        if (!$this->hasErrors($checks)) {
            $checks[] = $this->ok('blueprint', 'Blueprint desired-state shape is valid for Core v1.');
        }

        return new ValidationResult($checks);
    }

    /**
     * @param array<string, mixed> $site
     * @return array<int, ValidationCheck>
     */
    private function validateSite(array $site): array
    {
        $checks = [];

        if (!isset($site['name']) || !is_string($site['name']) || '' === trim($site['name'])) {
            $checks[] = $this->error('site.name', 'Blueprint site.name must be a non-empty string.');
        }

        if (isset($site['style']) && !is_array($site['style'])) {
            $checks[] = $this->error('site.style', 'Blueprint site.style must be an object when present.');
        }

        if (isset($site['assets']) && !is_array($site['assets'])) {
            $checks[] = $this->error('site.assets', 'Blueprint site.assets must be an object when present.');
        }

        if (isset($site['forms']) && !is_array($site['forms'])) {
            $checks[] = $this->error('site.forms', 'Blueprint site.forms must be an object when present.');
        }

        return $checks;
    }

    /**
     * @param array<int, mixed> $plugins
     * @return array<int, ValidationCheck>
     */
    private function validatePlugins(array $plugins): array
    {
        $checks = [];

        foreach ($plugins as $index => $plugin) {
            $scope = 'plugins.' . (string) $index;

            if (!is_array($plugin)) {
                $checks[] = $this->error($scope, 'Plugin entry must be an object.');
                continue;
            }

            if (!isset($plugin['slug']) || !is_string($plugin['slug']) || '' === trim($plugin['slug'])) {
                $checks[] = $this->error($scope . '.slug', 'Plugin entry must include a non-empty slug.');
            }
        }

        return $checks;
    }

    /**
     * @param array<int, mixed> $items
     * @return array<int, ValidationCheck>
     */
    private function validateSluggedList(array $items, string $scopePrefix, string $label): array
    {
        $checks = [];

        foreach ($items as $index => $item) {
            $scope = $scopePrefix . '.' . (string) $index;

            if (!is_array($item)) {
                $checks[] = $this->error($scope, $label . ' entry must be an object.');
                continue;
            }

            if (!isset($item['slug']) || !is_string($item['slug']) || '' === trim($item['slug'])) {
                $checks[] = $this->error($scope . '.slug', $label . ' entry must include a non-empty slug.');
            }
        }

        return $checks;
    }

    /**
     * @param array<string, mixed> $pages
     * @return array<int, ValidationCheck>
     */
    private function validatePages(array $pages): array
    {
        $checks = [];

        foreach ($pages as $key => $page) {
            $scope = 'pages.' . (string) $key;

            if (!in_array((string) $key, BlueprintValidationRules::KNOWN_PAGE_KEYS, true)) {
                $checks[] = $this->warning($scope, 'Unknown page section will be preserved but is not validated by Core v1.');
            }

            if (!is_array($page)) {
                $checks[] = $this->error($scope, 'Page section must be an object.');
                continue;
            }

            if (isset($page['slug']) && !is_string($page['slug'])) {
                $checks[] = $this->error($scope . '.slug', 'Page slug must be a string when present.');
            }

            if (isset($page['title']) && !is_string($page['title'])) {
                $checks[] = $this->error($scope . '.title', 'Page title must be a string when present.');
            }
        }

        return $checks;
    }

    /**
     * @param array<int, mixed> $queries
     * @return array<int, ValidationCheck>
     */
    private function validateQueries(array $queries): array
    {
        $checks = [];

        foreach ($queries as $index => $query) {
            $scope = 'queries.' . (string) $index;

            if (!is_array($query)) {
                $checks[] = $this->error($scope, 'Query entry must be an object.');
                continue;
            }

            foreach (['slug', 'provider', 'type', 'post_type'] as $key) {
                if (!isset($query[$key]) || !is_string($query[$key]) || '' === trim($query[$key])) {
                    $checks[] = $this->error($scope . '.' . $key, 'Query entry must include a non-empty ' . $key . ' string.');
                }
            }
        }

        return $checks;
    }

    /**
     * @param array<int, mixed> $filters
     * @return array<int, ValidationCheck>
     */
    private function validateFilters(array $filters): array
    {
        $checks = [];

        foreach ($filters as $index => $filter) {
            $scope = 'filters.' . (string) $index;

            if (!is_array($filter)) {
                $checks[] = $this->error($scope, 'Filter entry must be an object.');
                continue;
            }

            foreach (['slug', 'provider', 'type'] as $key) {
                if (!isset($filter[$key]) || !is_string($filter[$key]) || '' === trim($filter[$key])) {
                    $checks[] = $this->error($scope . '.' . $key, 'Filter entry must include a non-empty ' . $key . ' string.');
                }
            }
        }

        return $checks;
    }

    /**
     * @param array<string, mixed> $content
     * @return array<int, ValidationCheck>
     */
    private function validateContent(array $content): array
    {
        $checks = [];

        foreach ($content as $postType => $items) {
            $scope = 'content.' . (string) $postType;

            if (!$this->isList($items)) {
                $checks[] = $this->error($scope, 'Content post type section must be a list.');
                continue;
            }

            foreach ($items as $index => $item) {
                if (!is_array($item)) {
                    $checks[] = $this->error($scope . '.' . (string) $index, 'Content item must be an object.');
                    continue;
                }

                if (!isset($item['title']) || !is_string($item['title']) || '' === trim($item['title'])) {
                    $checks[] = $this->error($scope . '.' . (string) $index . '.title', 'Content item must include a non-empty title.');
                }
            }
        }

        return $checks;
    }

    /**
     * @param mixed $value
     */
    private function isList($value): bool
    {
        if (!is_array($value)) {
            return false;
        }

        return [] === $value || array_keys($value) === range(0, count($value) - 1);
    }

    private function ok(string $scope, string $message): ValidationCheck
    {
        return new ValidationCheck(ManifestStatus::OK, $scope, $message);
    }

    private function warning(string $scope, string $message): ValidationCheck
    {
        return new ValidationCheck(ManifestStatus::WARNING, $scope, $message);
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

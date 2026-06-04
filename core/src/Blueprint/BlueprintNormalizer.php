<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Blueprint;

use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationCheck;

/**
 * Pure desired-state blueprint normalizer.
 *
 * The normalizer prepares blueprint arrays for Core validation and future
 * planning. It never calls WordPress, adapters, filesystem mutators, or AI.
 */
final class BlueprintNormalizer
{
    /** @var array<int, string> */
    private const KNOWN_ROOT_SECTIONS = [
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

    /** @var array<int, string> */
    private const LIST_ROOT_SECTIONS = [
        'plugins',
        'cpt',
        'taxonomies',
        'queries',
        'filters',
        'forms',
        'listings',
    ];

    /** @var array<int, string> */
    private const OBJECT_ROOT_SECTIONS = [
        'site',
        'theme',
        'pages',
        'terms',
        'content',
        'render',
        'single',
        'design',
        'style',
        'image_context',
        'assets',
    ];

    /** @var array<int, string> */
    private const DANGEROUS_FIELDS = [
        'php_code',
        'callback',
        'eval',
        'sql',
        'shell',
        'wordpress_mutation',
        'direct_apply',
        'raw_css',
        'custom_js',
    ];

    /** @var array<int, string> */
    private const HYPHEN_IDENTIFIERS = [
        'slug',
        'listing',
    ];

    /** @var array<int, string> */
    private const UNDERSCORE_IDENTIFIERS = [
        'key',
        'post_type',
        'taxonomy',
        'query_var',
        'query',
        'provider',
        'type',
        'source',
        'mode',
    ];

    /**
     * @param array<string, mixed> $blueprint
     * @param array<string, mixed> $options
     */
    public function normalize(array $blueprint, array $options = []): BlueprintNormalizationResult
    {
        $strict = (bool) ($options['strict'] ?? false);
        $preserveUnknown = (bool) ($options['preserve_unknown_sections'] ?? true);
        $warnings = [];
        $checks = [];
        $normalized = $blueprint;

        foreach ($normalized as $section => $value) {
            if (!is_string($section)) {
                $message = 'Blueprint root section key should be a string.';
                $warnings[] = $message;
                $checks[] = $this->check($strict ? ManifestStatus::ERROR : ManifestStatus::WARNING, 'root', $message);
                continue;
            }

            if (!in_array($section, self::KNOWN_ROOT_SECTIONS, true)) {
                $message = 'Unknown root section preserved by Core normalizer: ' . $section . '.';
                $warnings[] = $message;
                $checks[] = $this->check(ManifestStatus::WARNING, $section, $message);

                if (!$preserveUnknown) {
                    unset($normalized[$section]);
                }
            }
        }

        foreach ($normalized as $section => $value) {
            if (!is_string($section)) {
                continue;
            }

            if (is_string($value)) {
                $normalized[$section] = trim($value);
                continue;
            }

            if (in_array($section, self::LIST_ROOT_SECTIONS, true)) {
                if (!$this->isList($value)) {
                    $message = 'Expected blueprint root section ' . $section . ' to be a list.';
                    $warnings[] = $message;
                    $checks[] = $this->check($strict ? ManifestStatus::ERROR : ManifestStatus::WARNING, $section, $message);
                    continue;
                }

                $normalized[$section] = $this->normalizeList($value, $section, $warnings, $checks, $strict);
                continue;
            }

            if (in_array($section, self::OBJECT_ROOT_SECTIONS, true)) {
                if (!is_array($value) || $this->isList($value)) {
                    $message = 'Expected blueprint root section ' . $section . ' to be an object.';
                    $warnings[] = $message;
                    $checks[] = $this->check($strict ? ManifestStatus::ERROR : ManifestStatus::WARNING, $section, $message);
                    continue;
                }

                $normalized[$section] = $this->normalizeObject($value, $section, $warnings, $checks, $strict);
                continue;
            }

            if (is_array($value)) {
                $normalized[$section] = $this->normalizeValue($value, $section, $warnings, $checks, $strict);
            }
        }

        return new BlueprintNormalizationResult($normalized, array_values(array_unique($warnings)), $checks);
    }

    /**
     * @param array<int, mixed> $items
     * @param array<int, string> $warnings
     * @param array<int, ValidationCheck> $checks
     * @return array<int, mixed>
     */
    private function normalizeList(array $items, string $scope, array &$warnings, array &$checks, bool $strict): array
    {
        $result = [];

        foreach ($items as $index => $item) {
            $result[] = $this->normalizeValue($item, $scope . '.' . (string) $index, $warnings, $checks, $strict);
        }

        return $result;
    }

    /**
     * @param mixed $value
     * @param array<int, string> $warnings
     * @param array<int, ValidationCheck> $checks
     * @return mixed
     */
    private function normalizeValue($value, string $scope, array &$warnings, array &$checks, bool $strict)
    {
        if (is_string($value)) {
            return trim($value);
        }

        if (!is_array($value)) {
            return $value;
        }

        if ($this->isList($value)) {
            return $this->normalizeList($value, $scope, $warnings, $checks, $strict);
        }

        return $this->normalizeObject($value, $scope, $warnings, $checks, $strict);
    }

    /**
     * @param array<string, mixed> $object
     * @param array<int, string> $warnings
     * @param array<int, ValidationCheck> $checks
     * @return array<string, mixed>
     */
    private function normalizeObject(array $object, string $scope, array &$warnings, array &$checks, bool $strict): array
    {
        $result = [];

        foreach ($object as $key => $value) {
            $normalizedKey = is_string($key) ? trim($key) : (string) $key;
            $field = strtolower($normalizedKey);

            if (in_array($field, self::DANGEROUS_FIELDS, true)) {
                $message = 'Dangerous blueprint field found for validation review: ' . $scope . '.' . $normalizedKey . '.';
                $warnings[] = $message;
                $checks[] = $this->check($strict ? ManifestStatus::ERROR : ManifestStatus::WARNING, $scope . '.' . $normalizedKey, $message);
            }

            $normalizedValue = $this->normalizeValue($value, $scope . '.' . $normalizedKey, $warnings, $checks, $strict);

            if (is_string($normalizedValue) && in_array($field, self::HYPHEN_IDENTIFIERS, true)) {
                $normalizedValue = $this->normalizeIdentifier($normalizedValue, '-');
            } elseif (is_string($normalizedValue) && in_array($field, self::UNDERSCORE_IDENTIFIERS, true)) {
                $normalizedValue = $this->normalizeIdentifier($normalizedValue, '_');
            }

            $result[$normalizedKey] = $normalizedValue;
        }

        return $result;
    }

    private function normalizeIdentifier(string $value, string $separator): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[\s_-]+/', $separator, $value) ?? $value;
        $allowed = '-' === $separator ? '/[^a-z0-9\-]/' : '/[^a-z0-9_]/';
        $value = preg_replace($allowed, '', $value) ?? $value;
        $value = preg_replace('/' . preg_quote($separator, '/') . '+/', $separator, $value) ?? $value;

        return trim($value, '-_');
    }

    /** @param mixed $value */
    private function isList($value): bool
    {
        if (!is_array($value)) {
            return false;
        }

        return [] === $value || array_keys($value) === range(0, count($value) - 1);
    }

    private function check(string $status, string $scope, string $message): ValidationCheck
    {
        return new ValidationCheck($status, $scope, $message);
    }
}

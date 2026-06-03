<?php

declare(strict_types=1);

namespace Crocoblock\SiteFactory\Core\Blueprint;

/**
 * Draft Blueprint validation rules.
 *
 * These rules describe desired-state document shape only. They are intentionally
 * tolerant of future optional sections and do not validate WordPress runtime.
 */
final class BlueprintValidationRules
{
    /** @var array<int, string> */
    public const KNOWN_ROOT_SECTIONS = [
        'version',
        'site',
        'theme',
        'plugins',
        'cpt',
        'taxonomies',
        'terms',
        'content',
        'listings',
        'pages',
        'render',
        'single',
        'queries',
        'filters',
        'forms',
        'style',
        'design',
        'image_context',
    ];

    /** @var array<int, string> */
    public const REQUIRED_ROOT_SECTIONS = [
        'site',
    ];

    /** @var array<int, string> */
    public const ARRAY_ROOT_SECTIONS = [
        'site',
        'theme',
        'cpt',
        'taxonomies',
        'terms',
        'content',
        'listings',
        'pages',
        'render',
        'single',
        'style',
        'design',
        'image_context',
    ];

    /** @var array<int, string> */
    public const LIST_ROOT_SECTIONS = [
        'plugins',
        'queries',
        'filters',
        'forms',
    ];

    /** @var array<int, string> */
    public const KNOWN_PAGE_KEYS = [
        'home',
        'archive',
        'native_filters',
        'contact',
        'queries',
        'navigation',
    ];

    private function __construct()
    {
    }

    public static function isKnownRootSection(string $section): bool
    {
        return in_array($section, self::KNOWN_ROOT_SECTIONS, true);
    }
}

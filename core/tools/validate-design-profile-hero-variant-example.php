<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$systemRoot = dirname($root);

/**
 * @return array<string, mixed>
 */
function load_design_hero_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

if (!defined('ABSPATH')) {
    define('ABSPATH', $systemRoot . DIRECTORY_SEPARATOR);
}

if (!function_exists('add_action')) {
    function add_action(...$args): void
    {
    }
}

if (!function_exists('did_action')) {
    function did_action(...$args): int
    {
        return 0;
    }
}

if (!function_exists('sanitize_key')) {
    function sanitize_key($key): string
    {
        $key = strtolower((string) $key);

        return preg_replace('/[^a-z0-9_\-]/', '', $key) ?? '';
    }
}

require_once $systemRoot . '/wordpress-plugin/includes/ai/design-profile-schema.php';
require_once $systemRoot . '/wordpress-plugin/includes/api/rest.php';
require_once $systemRoot . '/wordpress-plugin/includes/apply/real-estate-apply-service.php';

$inputPath = $root . '/examples/design-profile-hero-variant.centered-overlay.input.json';
$expectedPath = $root . '/examples/design-profile-hero-variant.centered-overlay.expected.json';

$input = load_design_hero_json_object($inputPath);
$expected = load_design_hero_json_object($expectedPath);
$originalInput = $input;

if (!function_exists('factory_ai_build_real_estate_apply_design_context')) {
    fwrite(STDERR, 'Missing factory_ai_build_real_estate_apply_design_context().' . PHP_EOL);
    exit(1);
}

if (!function_exists('factory_real_estate_apply_service_apply_home_hero_variant')) {
    fwrite(STDERR, 'Missing factory_real_estate_apply_service_apply_home_hero_variant().' . PHP_EOL);
    exit(1);
}

$result = factory_ai_build_real_estate_apply_design_context($input);
$failed = false;

if ($input !== $originalInput) {
    fwrite(STDERR, 'Design hero bridge helper mutated the original input array.' . PHP_EOL);
    $failed = true;
}

if ($result !== $expected) {
    fwrite(STDERR, 'Design hero bridge output did not match expected fixture.' . PHP_EOL);
    fwrite(STDERR, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

if (($result['design_profile']['hero_variant'] ?? null) !== 'centered_overlay') {
    fwrite(STDERR, 'Regression: design_profile.hero_variant is not centered_overlay.' . PHP_EOL);
    $failed = true;
}

$styleContext = is_array($result['style_context'] ?? null) ? $result['style_context'] : [];

if (($styleContext['hero_variant'] ?? null) !== 'centered_overlay') {
    fwrite(STDERR, 'Regression: style_context.hero_variant fell back from centered_overlay.' . PHP_EOL);
    $failed = true;
}

$blueprint = [
    'pages' => [
        'home' => [
            'sections' => [
                [
                    'type' => 'hero',
                    'title' => 'Kyiv Slate Realty',
                    'subtitle' => 'Centered overlay hero proof',
                    'cta_label' => 'Browse properties',
                    'cta_url' => '/properties/',
                ],
                [
                    'type' => 'listing',
                    'title' => 'Latest Properties',
                ],
            ],
        ],
    ],
];
$originalBlueprint = $blueprint;
$bridgedBlueprint = factory_real_estate_apply_service_apply_home_hero_variant($blueprint, 'centered_overlay');
$sections = is_array($bridgedBlueprint['pages']['home']['sections'] ?? null) ? $bridgedBlueprint['pages']['home']['sections'] : [];
$heroSection = is_array($sections[0] ?? null) ? $sections[0] : [];
$listingSection = is_array($sections[1] ?? null) ? $sections[1] : [];

if ($blueprint !== $originalBlueprint) {
    fwrite(STDERR, 'Hero variant bridge mutated the original blueprint array.' . PHP_EOL);
    $failed = true;
}

if (($heroSection['variant'] ?? null) !== 'centered_overlay') {
    fwrite(STDERR, 'Regression: home hero variant was not persisted as centered_overlay.' . PHP_EOL);
    $failed = true;
}

if (($heroSection['title'] ?? null) !== 'Kyiv Slate Realty') {
    fwrite(STDERR, 'Regression: home hero title changed while applying hero variant.' . PHP_EOL);
    $failed = true;
}

if (($listingSection['type'] ?? null) !== 'listing') {
    fwrite(STDERR, 'Regression: non-hero home sections were unexpectedly changed.' . PHP_EOL);
    $failed = true;
}

if (($heroSection['variant'] ?? null) === 'image_left_scrim') {
    fwrite(STDERR, 'Regression: centered_overlay hero variant silently fell back to image_left_scrim.' . PHP_EOL);
    $failed = true;
}

echo 'Design profile hero variant regression guard' . PHP_EOL;
echo 'Design profile hero variant: ' . ($result['design_profile']['hero_variant'] ?? 'missing') . PHP_EOL;
echo 'Style context hero variant: ' . ($styleContext['hero_variant'] ?? 'missing') . PHP_EOL;
echo 'Persisted home hero variant: ' . ($heroSection['variant'] ?? 'missing') . PHP_EOL;
echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);

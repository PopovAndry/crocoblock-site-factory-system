<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$systemRoot = dirname($root);

/**
 * @return array<string, mixed>
 */
function load_design_bridge_json_object(string $path): array
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

$inputPath = $root . '/examples/design-profile-bridge.slate.input.json';
$expectedPath = $root . '/examples/design-profile-bridge.slate.expected.json';

$input = load_design_bridge_json_object($inputPath);
$expected = load_design_bridge_json_object($expectedPath);
$original = $input;

if (!function_exists('factory_ai_build_real_estate_apply_design_context')) {
    fwrite(STDERR, 'Missing factory_ai_build_real_estate_apply_design_context().' . PHP_EOL);
    exit(1);
}

$result = factory_ai_build_real_estate_apply_design_context($input);
$failed = false;

if ($input !== $original) {
    fwrite(STDERR, 'Design bridge helper mutated the original input array.' . PHP_EOL);
    $failed = true;
}

if ($result !== $expected) {
    fwrite(STDERR, 'Design bridge output did not match expected fixture.' . PHP_EOL);
    fwrite(STDERR, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    $failed = true;
}

$styleContext = is_array($result['style_context'] ?? null) ? $result['style_context'] : [];
$styleTokens = is_array($result['style_tokens'] ?? null) ? $result['style_tokens'] : [];

if (($result['design_profile']['palette']['preset'] ?? null) !== 'slate') {
    fwrite(STDERR, 'Regression: design_profile.palette.preset is not slate.' . PHP_EOL);
    $failed = true;
}

if (($styleContext['primary_preset'] ?? null) !== 'slate') {
    fwrite(STDERR, 'Regression: style_context.primary_preset fell back from slate.' . PHP_EOL);
    $failed = true;
}

$expectedTokens = [
    'primary' => '#334155',
    'accent' => '#64748b',
    'background' => '#f8fafc',
    'text' => '#0f172a',
];

foreach ($expectedTokens as $token => $value) {
    if (($styleTokens[$token] ?? null) !== $value) {
        fwrite(STDERR, sprintf('Regression: style token %s expected %s but got %s.', $token, $value, (string) ($styleTokens[$token] ?? 'null')) . PHP_EOL);
        $failed = true;
    }
}

if (($styleContext['primary_preset'] ?? null) === 'turquoise' || ($styleTokens['primary_preset'] ?? null) === 'turquoise') {
    fwrite(STDERR, 'Regression: slate bridge silently fell back to turquoise.' . PHP_EOL);
    $failed = true;
}

echo 'Design profile bridge regression guard' . PHP_EOL;
echo 'Palette preset: ' . ($result['design_profile']['palette']['preset'] ?? 'missing') . PHP_EOL;
echo 'Style preset: ' . ($styleContext['primary_preset'] ?? 'missing') . PHP_EOL;
echo 'Primary token: ' . ($styleTokens['primary'] ?? 'missing') . PHP_EOL;
echo 'Accent token: ' . ($styleTokens['accent'] ?? 'missing') . PHP_EOL;
echo 'Background token: ' . ($styleTokens['background'] ?? 'missing') . PHP_EOL;
echo 'Text token: ' . ($styleTokens['text'] ?? 'missing') . PHP_EOL;
echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);

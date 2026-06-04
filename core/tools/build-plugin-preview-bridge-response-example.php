<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Bridge\PluginPreviewBridgeResponseBuilder;
use Crocoblock\SiteFactory\Core\Bridge\PluginPreviewBridgeValidator;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;

$root = dirname(__DIR__);

spl_autoload_register(
    static function (string $class): void {
        $prefix = 'Crocoblock\\SiteFactory\\Core\\';

        if (0 !== strpos($class, $prefix)) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = dirname(__DIR__) . '/src/' . str_replace('\\', '/', $relative) . '.php';

        if (is_file($path)) {
            require_once $path;
        }
    }
);

/**
 * @return array<string, mixed>
 */
function load_bridge_response_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

/**
 * @param array<string, mixed> $data
 */
function write_bridge_response_fixture(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
}

$cases = [
    'placeholder' => [
        'runtime_evidence' => 'runtime-evidence.placeholder.example.json',
        'expected' => 'plugin-preview-bridge-response.placeholder-built.example.json',
    ],
    'ready' => [
        'runtime_evidence' => 'runtime-evidence.ok.example.json',
        'expected' => 'plugin-preview-bridge-response.ready-built.example.json',
    ],
    'warning' => [
        'runtime_evidence' => 'runtime-evidence.warning.example.json',
        'expected' => 'plugin-preview-bridge-response.warning-built.example.json',
    ],
    'error' => [
        'runtime_evidence' => 'runtime-evidence.error.example.json',
        'expected' => 'plugin-preview-bridge-response.error-built.example.json',
    ],
];

$corePreview = load_bridge_response_json_object($root . '/examples/core-preview-response.example.json');
$builder = new PluginPreviewBridgeResponseBuilder();
$validator = new PluginPreviewBridgeValidator();
$writeFixtures = in_array('--write-fixtures', $argv, true);
$failed = false;

echo 'Plugin Preview Bridge response builder' . PHP_EOL;

foreach ($cases as $name => $case) {
    $runtimeEvidence = load_bridge_response_json_object($root . '/examples/' . $case['runtime_evidence']);
    $built = $builder->build($corePreview, $runtimeEvidence);
    $expectedPath = $root . '/examples/' . $case['expected'];
    $validation = $validator->validateResponse($built);

    if (ManifestStatus::ERROR === $validation->status()) {
        echo $name . ': validation error [UNEXPECTED]' . PHP_EOL;
        $failed = true;
        continue;
    }

    if ($writeFixtures) {
        write_bridge_response_fixture($expectedPath, $built);
        echo $name . ': wrote ' . $case['expected'] . PHP_EOL;
        continue;
    }

    if (!is_file($expectedPath)) {
        echo $name . ': missing expected fixture ' . $case['expected'] . PHP_EOL;
        $failed = true;
        continue;
    }

    $expected = load_bridge_response_json_object($expectedPath);
    $matches = $built === $expected;
    echo $name . ': ' . ($matches ? 'ok' : 'mismatch') . ' (apply_gate=' . $built['apply_gate']['status'] . ', response=' . $built['status'] . ')' . PHP_EOL;

    if (!$matches) {
        $failed = true;
    }
}

if ($writeFixtures) {
    echo 'Wrote Plugin Preview Bridge response fixtures.' . PHP_EOL;
    exit(0);
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);

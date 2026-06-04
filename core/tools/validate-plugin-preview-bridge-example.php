<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Bridge\PluginPreviewBridgeValidator;
use Crocoblock\SiteFactory\Core\Manifest\ManifestStatus;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;

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
function load_bridge_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

/**
 * @param array<int, array{file:string,type:string,expected:string}> $examples
 */
function run_bridge_examples(array $examples, PluginPreviewBridgeValidator $validator, string $root): bool
{
    $failed = false;

    foreach ($examples as $example) {
        $path = $root . '/examples/' . $example['file'];
        $data = load_bridge_json_object($path);
        $result = 'input' === $example['type']
            ? $validator->validateInput($data)
            : $validator->validateResponse($data);

        $status = $result->status();
        $expected = $example['expected'];
        $matchesExpectation = $status === $expected;

        echo $example['file'] . ': ' . $status . ' (expected ' . $expected . ')' . ($matchesExpectation ? '' : ' [UNEXPECTED]') . PHP_EOL;
        print_bridge_checks($result);

        if (!$matchesExpectation) {
            $failed = true;
        }
    }

    return !$failed;
}

function print_bridge_checks(ValidationResult $result): void
{
    foreach ($result->checks() as $check) {
        echo sprintf(
            '  [%s] %s: %s',
            $check->status(),
            $check->scope(),
            $check->message()
        ) . PHP_EOL;
    }
}

$validator = new PluginPreviewBridgeValidator();
$examples = [
    [
        'file' => 'plugin-preview-bridge-input.example.json',
        'type' => 'input',
        'expected' => ManifestStatus::OK,
    ],
    [
        'file' => 'plugin-preview-bridge-response.example.json',
        'type' => 'response',
        'expected' => ManifestStatus::OK,
    ],
    [
        'file' => 'invalid/plugin-preview-bridge-input.allows-apply.invalid.json',
        'type' => 'input',
        'expected' => ManifestStatus::ERROR,
    ],
    [
        'file' => 'invalid/plugin-preview-bridge-input.runtime-mutation.invalid.json',
        'type' => 'input',
        'expected' => ManifestStatus::ERROR,
    ],
    [
        'file' => 'invalid/plugin-preview-bridge-response.can-apply-with-placeholders.invalid.json',
        'type' => 'response',
        'expected' => ManifestStatus::ERROR,
    ],
    [
        'file' => 'invalid/plugin-preview-bridge-response.missing-apply-gate.invalid.json',
        'type' => 'response',
        'expected' => ManifestStatus::ERROR,
    ],
    [
        'file' => 'invalid/plugin-preview-bridge-response.invalid-mode.invalid.json',
        'type' => 'response',
        'expected' => ManifestStatus::ERROR,
    ],
];

echo 'Plugin Preview Bridge contract validation' . PHP_EOL;
$ok = run_bridge_examples($examples, $validator, $root);
echo $ok ? 'OK' . PHP_EOL : 'FAILED' . PHP_EOL;

exit($ok ? 0 : 1);

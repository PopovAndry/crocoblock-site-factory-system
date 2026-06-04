<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Bridge\ApplyGatePolicyValidator;
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
function load_apply_gate_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

function validate_apply_gate_fixture(
    string $file,
    string $expected,
    ApplyGatePolicyValidator $validator,
    string $root
): bool {
    $data = load_apply_gate_json_object($root . '/examples/' . $file);
    $gate = $data['apply_gate'] ?? null;

    if (!is_array($gate)) {
        echo $file . ': error (expected ' . $expected . ')' . PHP_EOL;
        echo '  [error] apply_gate: Fixture must include apply_gate object.' . PHP_EOL;
        return ManifestStatus::ERROR === $expected;
    }

    $result = $validator->validate(
        $gate,
        [
            'plugin_dry_run' => is_array($data['plugin_dry_run'] ?? null) ? $data['plugin_dry_run'] : null,
            'ownership' => is_array($data['ownership'] ?? null) ? $data['ownership'] : null,
            'core_only' => true,
        ]
    );

    $status = $result->status();
    $matchesExpectation = $status === $expected;

    echo $file . ': ' . $status . ' (expected ' . $expected . ')' . ($matchesExpectation ? '' : ' [UNEXPECTED]') . PHP_EOL;
    print_apply_gate_checks($result);

    return $matchesExpectation;
}

function print_apply_gate_checks(ValidationResult $result): void
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

$validator = new ApplyGatePolicyValidator();
$examples = [
    ['file' => 'apply-gate.blocked-placeholder.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'apply-gate.ready-for-confirmation.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'apply-gate.warning-needs-review.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'invalid/apply-gate.ready-without-dry-run.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/apply-gate.ready-without-ownership.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/apply-gate.ready-without-user-confirmation.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/apply-gate.can-apply-while-blocked.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/apply-gate.invalid-status.invalid.json', 'expected' => ManifestStatus::ERROR],
];

$failed = false;

echo 'Apply Gate Policy contract validation' . PHP_EOL;

foreach ($examples as $example) {
    if (!validate_apply_gate_fixture($example['file'], $example['expected'], $validator, $root)) {
        $failed = true;
    }
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);

<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Bridge\RuntimeEvidenceValidator;
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
function load_runtime_evidence_json_object(string $path): array
{
    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        throw new RuntimeException('Expected JSON object at ' . $path);
    }

    return $data;
}

function validate_runtime_evidence_fixture(
    string $file,
    string $expected,
    RuntimeEvidenceValidator $validator,
    string $root
): bool {
    $data = load_runtime_evidence_json_object($root . '/examples/' . $file);
    $result = $validator->validate($data);
    $status = $result->status();
    $matchesExpectation = $status === $expected;

    echo $file . ': ' . $status . ' (expected ' . $expected . ')' . ($matchesExpectation ? '' : ' [UNEXPECTED]') . PHP_EOL;
    print_runtime_evidence_checks($result);

    return $matchesExpectation;
}

function print_runtime_evidence_checks(ValidationResult $result): void
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

$validator = new RuntimeEvidenceValidator();
$examples = [
    ['file' => 'runtime-evidence.placeholder.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'runtime-evidence.ok.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'runtime-evidence.warning.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'runtime-evidence.error.example.json', 'expected' => ManifestStatus::OK],
    ['file' => 'invalid/runtime-evidence.missing-dry-run.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/runtime-evidence.missing-ownership.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/runtime-evidence.claims-complete-with-placeholders.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/runtime-evidence.invalid-status.invalid.json', 'expected' => ManifestStatus::ERROR],
    ['file' => 'invalid/runtime-evidence.mutation-flag.invalid.json', 'expected' => ManifestStatus::ERROR],
];

$failed = false;

echo 'RuntimeEvidence contract validation' . PHP_EOL;

foreach ($examples as $example) {
    if (!validate_runtime_evidence_fixture($example['file'], $example['expected'], $validator, $root)) {
        $failed = true;
    }
}

echo $failed ? 'FAILED' . PHP_EOL : 'OK' . PHP_EOL;

exit($failed ? 1 : 0);

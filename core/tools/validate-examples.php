<?php

declare(strict_types=1);

use Crocoblock\SiteFactory\Core\Blueprint\BlueprintValidator;
use Crocoblock\SiteFactory\Core\BlueprintPatch\BlueprintPatchValidator;
use Crocoblock\SiteFactory\Core\Manifest\RunManifestValidator;
use Crocoblock\SiteFactory\Core\Planning\PlanValidator;
use Crocoblock\SiteFactory\Core\Validation\ValidationResult;
use Crocoblock\SiteFactory\Core\Validation\ValidationResultValidator;

$root = dirname(__DIR__);
$systemRoot = dirname($root);

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

$examples = [
    [
        'file' => 'blueprint-patch.example.json',
        'validator' => new BlueprintPatchValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'blueprint-patch.real-estate-safe.example.json',
        'validator' => new BlueprintPatchValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'blueprint-patch.real-estate-unsafe.invalid.json',
        'validator' => new BlueprintPatchValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'plan.example.json',
        'validator' => new PlanValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'blueprint-patch-preview-plan.example.json',
        'validator' => new PlanValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'validation-result.example.json',
        'validator' => new ValidationResultValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'run-manifest.example.json',
        'validator' => new RunManifestValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'real-estate-blueprint.example.json',
        'validator' => new BlueprintValidator(),
        'expected' => 'ok',
    ],
    [
        'file' => 'invalid/blueprint.missing-version.invalid.json',
        'validator' => new BlueprintValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/blueprint.invalid-cpt.invalid.json',
        'validator' => new BlueprintValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/blueprint.unknown-root-warning.invalid.json',
        'validator' => new BlueprintValidator(),
        'expected' => 'warning',
    ],
    [
        'file' => 'invalid/blueprint-patch.missing-operations.invalid.json',
        'validator' => new BlueprintPatchValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/blueprint-patch.unsafe-direct-apply.invalid.json',
        'validator' => new BlueprintPatchValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/plan.invalid-item-action.invalid.json',
        'validator' => new PlanValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/validation-result.invalid-status.invalid.json',
        'validator' => new ValidationResultValidator(),
        'expected' => 'error',
    ],
    [
        'file' => 'invalid/run-manifest.missing-validation.invalid.json',
        'validator' => new RunManifestValidator(),
        'expected' => 'error',
    ],
];

$failed = false;

foreach ($examples as $example) {
    $file = $example['file'];
    $validator = $example['validator'];
    $expected = $example['expected'];
    $path = $root . '/examples/' . $file;

    if (!is_file($path)) {
        fwrite(STDERR, "Missing example: {$file}" . PHP_EOL);
        $failed = true;
        continue;
    }

    $json = file_get_contents($path);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        fwrite(STDERR, "Invalid JSON object: {$file}" . PHP_EOL);
        $failed = true;
        continue;
    }

    /** @var ValidationResult $result */
    $result = $validator->validate($data);
    $status = $result->status();
    $matchesExpectation = $status === $expected;

    echo "{$file}: {$status} (expected {$expected})" . ($matchesExpectation ? '' : ' [UNEXPECTED]') . PHP_EOL;

    foreach ($result->checks() as $check) {
        echo sprintf(
            "  [%s] %s: %s",
            $check->status(),
            $check->scope(),
            $check->message()
        ) . PHP_EOL;
    }

    if (!$matchesExpectation) {
        $failed = true;
    }
}

exit($failed ? 1 : 0);
